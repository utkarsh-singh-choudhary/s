"""
Maintenance activity explorer: filter / search / sort / paginate PM plans, and
the KPI strip (PM counts, breakdowns, spend, downtime) for the same date range.

Date rules (see core/listing.py): the range is inclusive on both ends, dates
are ISO on the wire (dd-mm-yyyy is only how the screen/export shows them), and
you choose WHICH date is filtered:
  - planned : the PM's planned date
  - actual  : the date the PM was actually completed
so "completed in October" counts a PM planned in September but finished in
October, exactly once.
"""

from datetime import date, datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import String, cast, func, or_
from sqlalchemy.orm import Session, aliased

from app.core.audit import record_audit
from app.core.auth import require_roles
from app.core.database import get_db
from app.core.listing import apply_date_range, day_end_exclusive, day_start, export_response, paginate, resolve_range
from app.core.settings_service import get_setting
from app.core.timeutils import today_local
from app.models.models import (
    BreakdownEvent, Employee, Machine, PMActual, PMAttachment, PMPlan, PMStatus, Role, SparePartTransaction,
    WorkOrder, WorkOrderCost, WorkOrderLabourEntry,
)
from app.routers.breakdowns import recurring_ids
from app.services.costs import downtime_minutes, parts_for_work_orders

router = APIRouter(prefix="/api/activity", tags=["activity"])

ViewRoles = require_roles(Role.ADMIN, Role.MANAGER, Role.SUPERVISOR, Role.TECHNICIAN, Role.VIEWER)
ExportRoles = require_roles(Role.SUPERVISOR, Role.MANAGER, Role.ADMIN)

OPEN_STATES = (PMStatus.PLANNED, PMStatus.REMINDER_SENT, PMStatus.DUE, PMStatus.IN_PROGRESS, PMStatus.OVERDUE)
DONE_STATES = (PMStatus.COMPLETED, PMStatus.PENDING_SUPERVISOR_CONFIRMATION)


def effective_status(status: PMStatus, planned: date | None, today: date) -> str:
    if status in OPEN_STATES and planned and planned < today:
        return "OVERDUE"
    if status in (PMStatus.REMINDER_SENT, PMStatus.DUE):
        return "PLANNED"
    return status.value


def _pm_filtered(db: Session, *, q, status, machine_id, assigned_to, date_basis, preset, date_from, date_to):
    today = today_local()
    asg, comp = aliased(Employee), aliased(Employee)
    query = (db.query(PMPlan, PMActual, Machine)
             .join(Machine, Machine.id == PMPlan.machine_id)
             .outerjoin(PMActual, PMActual.pm_plan_id == PMPlan.id)
             .outerjoin(asg, asg.id == PMPlan.assigned_to)
             .outerjoin(comp, comp.id == PMActual.completed_by))
    if machine_id:
        query = query.filter(PMPlan.machine_id == machine_id)
    if assigned_to:
        query = query.filter(PMPlan.assigned_to == assigned_to)
    if status:
        s = status.upper()
        if s == "OVERDUE":
            query = query.filter(PMPlan.status.in_(OPEN_STATES), PMPlan.planned_date < today)
        elif s == "PLANNED":
            query = query.filter(PMPlan.status.in_((PMStatus.PLANNED, PMStatus.REMINDER_SENT, PMStatus.DUE)),
                                 or_(PMPlan.planned_date >= today, PMPlan.planned_date.is_(None)))
        elif s == "OPEN":
            query = query.filter(PMPlan.status.in_(OPEN_STATES))
        else:
            try:
                query = query.filter(PMPlan.status == PMStatus(s))
            except ValueError:
                raise HTTPException(400, "Unknown status")
    if q and q.strip():
        like = f"%{q.strip()}%"
        query = query.filter(or_(
            Machine.machine_number.ilike(like), Machine.machine_name.ilike(like), Machine.location.ilike(like),
            asg.name.ilike(like), comp.name.ilike(like), PMPlan.month.ilike(like),
            cast(PMPlan.status, String).ilike(like)))
    start, end = resolve_range(preset, date_from, date_to)
    if date_basis not in ("planned", "actual"):
        raise HTTPException(400, "date_basis must be planned or actual")
    col = PMPlan.planned_date if date_basis == "planned" else PMActual.actual_date
    if date_basis == "actual" and (start or end):
        query = query.filter(PMActual.actual_date.isnot(None))
    query = apply_date_range(query, col, start, end)
    return query, asg, comp


def _pm_sort(query, sort, basis):
    col = PMPlan.planned_date if basis == "planned" else PMActual.actual_date
    sort = sort or "newest"
    if sort == "newest":
        return query.order_by(col.desc().nullslast(), PMPlan.id)
    if sort == "oldest":
        return query.order_by(col.asc().nullslast(), PMPlan.id)
    if sort == "machine":
        return query.order_by(Machine.machine_number, PMPlan.planned_date)
    if sort == "downtime":
        return query.order_by(PMActual.downtime_minutes.desc().nullslast(), PMPlan.planned_date.desc())
    raise HTTPException(400, "sort must be newest, oldest, machine or downtime")


def _pm_rows(db: Session, triples, today: date) -> list[dict]:
    plan_ids = [p.id for p, _, _ in triples]
    files = {}
    if plan_ids:
        files = dict(db.query(PMAttachment.pm_plan_id, func.count(PMAttachment.id))
                     .filter(PMAttachment.pm_plan_id.in_(plan_ids)).group_by(PMAttachment.pm_plan_id).all())
    emp_ids = {i for p, a, _ in triples for i in (p.assigned_to, a.completed_by if a else None) if i}
    names = {e.id: e.name for e in db.query(Employee).filter(Employee.id.in_(emp_ids)).all()} if emp_ids else {}
    rows = []
    for p, a, m in triples:
        rows.append({
            "id": p.id, "machine_id": p.machine_id, "machine_number": m.machine_number, "machine_name": m.machine_name,
            "location": m.location, "critical": bool(m.critical),
            "planned_date": p.planned_date, "planned_week": p.planned_week, "month": p.month,
            "financial_year": p.financial_year, "status": p.status.value,
            "effective_status": effective_status(p.status, p.planned_date, today),
            "days_overdue": (today - p.planned_date).days if p.status in OPEN_STATES and p.planned_date and p.planned_date < today else 0,
            "assigned_to": p.assigned_to, "assigned_to_name": names.get(p.assigned_to),
            "actual_date": a.actual_date if a else None,
            "completed_by_name": names.get(a.completed_by) if a else None,
            "completion_class": a.completion_class.value if a and a.completion_class else None,
            "delay_days": a.delay_days if a else None,
            "downtime_minutes": a.downtime_minutes if a else None,
            "file_count": files.get(p.id, 0),
        })
    return rows


@router.get("/pm")
def search_pm(
    q: str | None = None, status: str | None = None, machine_id: str | None = None, assigned_to: str | None = None,
    date_basis: str = "planned", date_preset: str | None = None, date_from: date | None = None,
    date_to: date | None = None, sort: str = "newest", page: int = 1, page_size: int = 25,
    db: Session = Depends(get_db), _user=Depends(ViewRoles),
):
    today = today_local()
    query, _, _ = _pm_filtered(db, q=q, status=status, machine_id=machine_id, assigned_to=assigned_to,
                               date_basis=date_basis, preset=date_preset, date_from=date_from, date_to=date_to)
    # summary over EVERYTHING that matches (not just this page)
    agg = [(s, pd) for s, pd in query.with_entities(PMPlan.status, PMPlan.planned_date).all()]
    summary = {"total": len(agg), "completed": 0, "planned": 0, "overdue": 0, "missed": 0, "pending_confirmation": 0}
    for s, pd in agg:
        eff = effective_status(s, pd, today)
        if eff == "COMPLETED":
            summary["completed"] += 1
        elif eff == "OVERDUE":
            summary["overdue"] += 1
        elif eff == "MISSED":
            summary["missed"] += 1
        elif eff == "PENDING_SUPERVISOR_CONFIRMATION":
            summary["pending_confirmation"] += 1
        elif eff in ("PLANNED", "IN_PROGRESS"):
            summary["planned"] += 1
    ordered = _pm_sort(query, sort, date_basis)
    triples, total, page, pages = paginate(ordered, page, page_size)
    sr, er = resolve_range(date_preset, date_from, date_to)
    return {"items": _pm_rows(db, triples, today), "total": total, "page": page,
            "page_size": min(max(1, page_size), 200), "pages": pages,
            "range": {"from": sr, "to": er, "basis": date_basis}, "summary": summary}


@router.get("/pm/export")
def export_pm(
    q: str | None = None, status: str | None = None, machine_id: str | None = None, assigned_to: str | None = None,
    date_basis: str = "planned", date_preset: str | None = None, date_from: date | None = None,
    date_to: date | None = None, sort: str = "newest", format: str = "csv",
    db: Session = Depends(get_db), user: Employee = Depends(ExportRoles),
):
    today = today_local()
    query, _, _ = _pm_filtered(db, q=q, status=status, machine_id=machine_id, assigned_to=assigned_to,
                               date_basis=date_basis, preset=date_preset, date_from=date_from, date_to=date_to)
    triples = _pm_sort(query, sort, date_basis).limit(20000).all()
    rows = _pm_rows(db, triples, today)
    record_audit(db, action="EXPORT_PM_PLANS", entity_type="PMPlan", actor_id=user.id,
                 new_value={"rows": len(rows), "format": format})
    cols = [("machine_number", "Machine"), ("machine_name", "Machine name"), ("location", "Location"),
            ("planned_date", "Planned date"), ("actual_date", "Completed on"), ("effective_status", "Status"),
            ("days_overdue", "Days overdue"), ("assigned_to_name", "Assigned to"), ("completed_by_name", "Completed by"),
            ("completion_class", "Result"), ("delay_days", "Delay (days)"), ("downtime_minutes", "Downtime (min)"),
            ("month", "Month"), ("financial_year", "Financial year"), ("file_count", "Files")]
    return export_response(rows, cols, format, "pm_plans")


@router.get("/kpis")
def kpis(date_preset: str | None = None, date_from: date | None = None, date_to: date | None = None,
         db: Session = Depends(get_db), _user=Depends(ViewRoles)):
    today = today_local()
    start, end = resolve_range(date_preset, date_from, date_to)

    def pm_in(col_query, col):
        return apply_date_range(col_query, col, start, end)

    plans = pm_in(db.query(PMPlan), PMPlan.planned_date)
    planned_total = plans.count()
    overdue = plans.filter(PMPlan.status.in_(OPEN_STATES), PMPlan.planned_date < today).count()
    missed = plans.filter(PMPlan.status == PMStatus.MISSED).count()
    planned_and_done = plans.filter(PMPlan.status.in_(DONE_STATES)).count()
    completed_in_range = pm_in(db.query(PMActual).join(PMPlan, PMPlan.id == PMActual.pm_plan_id)
                               .filter(PMPlan.status.in_(DONE_STATES)), PMActual.actual_date).count()
    pm_downtime = pm_in(db.query(func.coalesce(func.sum(PMActual.downtime_minutes), 0)), PMActual.actual_date).scalar() or 0

    bds_q = apply_date_range(db.query(BreakdownEvent), BreakdownEvent.breakdown_at, start, end, is_datetime=True)
    bds = bds_q.all()
    rec = recurring_ids(db)
    restored = apply_date_range(db.query(BreakdownEvent), BreakdownEvent.resumed_at, start, end, is_datetime=True).count()
    bd_downtime = sum(downtime_minutes(b) or 0 for b in bds)

    # Spend = money recorded in the period (parts by movement date, labour by work date, approved costs by approval date)
    s_dt = day_start(start) if start else None
    e_dt = day_end_exclusive(end) if end else None

    def window(q_, col):
        if s_dt:
            q_ = q_.filter(col >= s_dt)
        if e_dt:
            q_ = q_.filter(col < e_dt)
        return q_

    parts_spend = 0.0
    for t in window(db.query(SparePartTransaction).filter(SparePartTransaction.work_order_id.isnot(None)),
                    SparePartTransaction.created_at).all():
        from app.services.costs import txn_kind
        k = txn_kind(t)
        if k in ("CONSUME", "RETURN"):
            unit = t.unit_cost if t.unit_cost is not None else (t.spare_part.unit_cost or 0)
            parts_spend += abs(t.change) * unit * (1 if k == "CONSUME" else -1)
    labour_spend = sum(e.hours * e.hourly_rate for e in window(
        db.query(WorkOrderLabourEntry), func.coalesce(WorkOrderLabourEntry.started_at, WorkOrderLabourEntry.created_at)).all())
    other_spend = sum((c.amount or 0) + (c.tax_amount or 0) for c in window(
        db.query(WorkOrderCost).filter(WorkOrderCost.approved_at.isnot(None)), WorkOrderCost.approved_at).all())

    return {
        "range": {"from": start, "to": end},
        "currency": get_setting(db, "currency") or "INR",
        "pm": {"planned": planned_total, "completed": completed_in_range, "planned_and_completed": planned_and_done,
               "overdue": overdue, "missed": missed},
        "breakdowns": {"new": len(bds), "open": sum(1 for b in bds if b.resumed_at is None),
                       "restored": restored, "recurring": sum(1 for b in bds if b.id in rec)},
        "spend": {"total": round(parts_spend + labour_spend + other_spend, 2), "parts": round(parts_spend, 2),
                  "labour": round(labour_spend, 2), "external_and_other": round(other_spend, 2)},
        "downtime": {"hours": round((bd_downtime + pm_downtime) / 60, 1),
                     "breakdown_hours": round(bd_downtime / 60, 1), "pm_hours": round(pm_downtime / 60, 1)},
        "definitions": {
            "pm.planned": "PM plans whose PLANNED date is inside the range.",
            "pm.completed": "PMs whose ACTUAL completion date is inside the range (a PM planned in September and done in October counts in October).",
            "pm.overdue": "PM plans planned inside the range that are still not done and whose planned date has passed.",
            "pm.missed": "PM plans planned inside the range that were marked missed.",
            "breakdowns.new": "Breakdowns that started inside the range.",
            "breakdowns.open": "Of those, the ones where the machine is still not restored.",
            "breakdowns.restored": "Breakdowns whose restoration time is inside the range.",
            "breakdowns.recurring": "Of the new ones, repeats on the same machine within the repeat window setting.",
            "spend": "Money recorded in the range: net parts issued (at the price when issued), labour entries (at the rate when entered) and APPROVED external/other costs (by approval date).",
            "downtime": "Breakdown downtime for incidents started in the range (open ones counted until now) plus downtime logged on PM completions in the range.",
        },
    }
