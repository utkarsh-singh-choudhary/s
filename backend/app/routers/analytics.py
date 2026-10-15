"""
Analytics: reliability, downtime, PM compliance and maintenance cost, plus the
"needs attention" list and a technician workload / conflict view.

Definitions (also returned by /overview so the UI can show them):
- Breakdown count: incidents whose breakdown time falls in the period.
- Downtime: minutes from breakdown time to restoration (still-open incidents
  count up to now).
- MTTR: average repair time (breakdown -> restored) over repaired incidents;
  scrapped/replaced events and still-open ones are excluded.
- MTBF: operating hours / failures, where operating hours = hours in the
  period (clipped to when the machine was added) minus downtime. Shown only
  when there are at least `mtbf_min_failures` failures - fewer than that is
  "insufficient data", never a made-up number.
- Repeat failure: an incident on the same machine within
  `recurrence_window_days` of the previous one.
- PM compliance: PM plans due in the period (planned date up to today) that
  are COMPLETED, divided by those due. "On time" additionally requires the
  actual completion date to be on or before the planned date.
- Maintenance cost: approved/recorded actual cost only (parts + labour +
  approved external/consumable/other); estimates are never mixed in.
"""

from collections import defaultdict
from datetime import date, datetime, timedelta

from fastapi import APIRouter, Depends
from sqlalchemy import String, cast
from sqlalchemy.orm import Session

from app.core.auth import require_roles
from app.core.database import get_db
from app.core.listing import day_end_exclusive, day_start, resolve_range
from app.core.settings_service import get_setting
from app.core.timeutils import today_local
from app.models.models import (
    BreakdownEvent, CorrectiveAction, Employee, Machine, NotificationLog, PMActual, PMPlan, PMStatus, Role,
    SparePart, WorkOrder, WorkOrderCost, WorkOrderLabourEntry, WorkOrderStatus,
)
from app.routers.breakdowns import recurring_ids
from app.services.costs import downtime_minutes, parts_for_work_orders

router = APIRouter(prefix="/api/analytics", tags=["analytics"])
ViewRoles = require_roles(Role.ADMIN, Role.MANAGER, Role.SUPERVISOR)

DEFINITIONS = {
    "breakdown_count": "Incidents whose breakdown time falls inside the selected period.",
    "downtime": "Minutes from breakdown to restoration; incidents still open count up to now.",
    "mttr": "Average hours from breakdown to restoration over repaired incidents (scrap/replace and open incidents excluded).",
    "mtbf": "Operating hours (period hours, minus downtime) divided by the number of failures. Not shown below the minimum failure count.",
    "repeat_rate": "Share of incidents that happened on the same machine within the repeat window of the previous incident.",
    "pm_compliance": "PM plans due in the period that are completed, divided by PM plans due (planned date up to today).",
    "pm_on_time": "Completed PMs whose actual completion date is on or before the planned date, divided by PMs due.",
    "maintenance_cost": "Actual recorded cost only: parts at their recorded unit cost, labour at the rate on each entry, and approved external/consumable/other costs. Estimates are not included.",
}


def _month_key(d: datetime | date) -> str:
    return f"{d.year}-{d.month:02d}"


def _range(preset, date_from, date_to):
    return resolve_range(preset or "this_fy", date_from, date_to)


@router.get("/overview")
def overview(
    date_preset: str | None = "this_fy", date_from: date | None = None, date_to: date | None = None,
    machine_id: str | None = None,
    db: Session = Depends(get_db), _user=Depends(ViewRoles),
):
    start, end = _range(date_preset, date_from, date_to)
    today = today_local()
    now = datetime.utcnow()
    min_failures = int(get_setting(db, "mtbf_min_failures") or 3)
    rate = float(get_setting(db, "downtime_minute_cost") or 0)
    currency = get_setting(db, "currency") or "INR"

    machines = {m.id: m for m in db.query(Machine).filter(Machine.active.isnot(False)).all()}
    if machine_id:
        machines = {k: v for k, v in machines.items() if k == machine_id}

    bq = db.query(BreakdownEvent)
    if start:
        bq = bq.filter(BreakdownEvent.breakdown_at >= day_start(start))
    if end:
        bq = bq.filter(BreakdownEvent.breakdown_at < day_end_exclusive(end))
    breakdowns = [b for b in bq.all() if b.machine_id in machines]
    repeats = recurring_ids(db)

    # period boundaries for the MTBF denominator
    period_end = datetime.combine(min(end, today), datetime.min.time()) + timedelta(days=1) if end else now
    period_end = min(period_end, now)

    # cost by work order -> machine
    wo_rows = db.query(WorkOrder).filter(WorkOrder.cancelled.isnot(True)).all()
    wo_in_scope = []
    for w in wo_rows:
        when = w.completed_at or w.closed_at or w.started_at or w.created_at
        if w.machine_id not in machines:
            continue
        if start and (not when or when < day_start(start)):
            continue
        if end and (not when or when >= day_end_exclusive(end)):
            continue
        wo_in_scope.append(w)
    wo_ids = [w.id for w in wo_in_scope]
    wo_machine = {w.id: w.machine_id for w in wo_in_scope}
    cost_by_machine = defaultdict(lambda: {"parts": 0.0, "labour": 0.0, "external": 0.0})
    cost_by_month = defaultdict(float)
    if wo_ids:
        wo_month = {w.id: _month_key(w.completed_at or w.closed_at or w.started_at or w.created_at) for w in wo_in_scope}
        for line in parts_for_work_orders(db, wo_ids):
            wid = line["work_order_id"]
            if wid in wo_machine:
                cost_by_machine[wo_machine[wid]]["parts"] += line["cost"]
                cost_by_month[wo_month[wid]] += line["cost"]
        for l in db.query(WorkOrderLabourEntry).filter(WorkOrderLabourEntry.work_order_id.in_(wo_ids)).all():
            c = l.hours * l.hourly_rate
            cost_by_machine[wo_machine[l.work_order_id]]["labour"] += c
            cost_by_month[wo_month[l.work_order_id]] += c
        for c in db.query(WorkOrderCost).filter(WorkOrderCost.work_order_id.in_(wo_ids),
                                                WorkOrderCost.approved_at.isnot(None)).all():
            t = (c.amount or 0) + (c.tax_amount or 0)
            cost_by_machine[wo_machine[c.work_order_id]]["external"] += t
            cost_by_month[wo_month[c.work_order_id]] += t

    # PM compliance
    pq = db.query(PMPlan).filter(PMPlan.planned_date.isnot(None), PMPlan.planned_date <= today,
                                 cast(PMPlan.status, String) != "CANCELLED")
    if start:
        pq = pq.filter(PMPlan.planned_date >= start)
    if end:
        pq = pq.filter(PMPlan.planned_date <= end)
    plans = [p for p in pq.all() if p.machine_id in machines]
    actuals = {a.pm_plan_id: a for a in db.query(PMActual).filter(PMActual.pm_plan_id.in_([p.id for p in plans])).all()} if plans else {}
    pm_due, pm_done, pm_on_time = defaultdict(int), defaultdict(int), defaultdict(int)
    for p in plans:
        pm_due[p.machine_id] += 1
        if p.status == PMStatus.COMPLETED:
            pm_done[p.machine_id] += 1
            a = actuals.get(p.id)
            if a and a.actual_date and p.planned_date and a.actual_date <= p.planned_date:
                pm_on_time[p.machine_id] += 1

    by_machine = defaultdict(list)
    for b in breakdowns:
        by_machine[b.machine_id].append(b)

    rows = []
    for mid, m in machines.items():
        evs = sorted(by_machine.get(mid, []), key=lambda b: b.breakdown_at)
        n = len(evs)
        downtime = sum(downtime_minutes(b, now) or 0 for b in evs)
        repaired = [b for b in evs if b.resumed_at and not b.resulted_in_scrap_or_replace]
        mttr = round(sum((b.resumed_at - b.breakdown_at).total_seconds() for b in repaired) / len(repaired) / 3600, 2) if repaired else None
        if start:
            mach_start = datetime.combine(start, datetime.min.time())
        else:   # no start date: observe from when the machine was added, or its first failure if that is earlier
            mach_start = min([t for t in (m.created_at, evs[0].breakdown_at if evs else None) if t] or [now])
        period_hours = max(0.0, (period_end - mach_start).total_seconds() / 3600)
        mtbf = None
        if n >= min_failures and period_hours > 0:
            mtbf = round(max(0.0, period_hours - downtime / 60) / n, 1)
        c = cost_by_machine.get(mid, {"parts": 0, "labour": 0, "external": 0})
        total_cost = round(c["parts"] + c["labour"] + c["external"], 2)
        due, done = pm_due.get(mid, 0), pm_done.get(mid, 0)
        rows.append({
            "machine_id": mid, "machine_number": m.machine_number, "machine_name": m.machine_name,
            "critical": bool(m.critical), "machine_type": m.machine_type,
            "breakdown_count": n, "repeat_count": sum(1 for b in evs if b.id in repeats),
            "downtime_minutes": downtime, "downtime_cost": round(downtime * rate, 2),
            "mttr_hours": mttr, "mtbf_hours": mtbf,
            "mtbf_status": "ok" if mtbf is not None else ("no_failures" if n == 0 else "insufficient_data"),
            "maintenance_cost": total_cost, "cost_parts": round(c["parts"], 2), "cost_labour": round(c["labour"], 2),
            "cost_external": round(c["external"], 2),
            "pm_due": due, "pm_completed": done, "pm_on_time": pm_on_time.get(mid, 0),
            "pm_compliance_pct": round(100 * done / due, 1) if due else None,
        })
    rows.sort(key=lambda r: (-r["downtime_minutes"], -r["maintenance_cost"], r["machine_number"] or ""))

    # monthly trend
    months = defaultdict(lambda: {"breakdowns": 0, "downtime_minutes": 0, "cost": 0.0, "pm_due": 0, "pm_completed": 0})
    for b in breakdowns:
        k = _month_key(b.breakdown_at)
        months[k]["breakdowns"] += 1
        months[k]["downtime_minutes"] += downtime_minutes(b, now) or 0
    for k, v in cost_by_month.items():
        months[k]["cost"] += v
    for p in plans:
        k = _month_key(p.planned_date)
        months[k]["pm_due"] += 1
        if p.status == PMStatus.COMPLETED:
            months[k]["pm_completed"] += 1
    trend = [{"month": k, **{kk: (round(vv, 2) if isinstance(vv, float) else vv) for kk, vv in v.items()}}
             for k, v in sorted(months.items())]

    # pareto
    cat, mode = defaultdict(int), defaultdict(int)
    for b in breakdowns:
        cat[b.failure_category or "UNSPECIFIED"] += 1
        if b.failure_mode:
            mode[b.failure_mode.strip().title()] += 1

    # overdue critical assets
    overdue_critical = []
    for p in db.query(PMPlan).filter(PMPlan.planned_date < today,
                                     cast(PMPlan.status, String).notin_(["COMPLETED", "CANCELLED", "PENDING_SUPERVISOR_CONFIRMATION"])).all():
        m = machines.get(p.machine_id)
        if m and m.critical:
            overdue_critical.append({"pm_id": p.id, "machine_id": m.id, "machine_number": m.machine_number,
                                     "machine_name": m.machine_name, "planned_date": str(p.planned_date),
                                     "days_overdue": (today - p.planned_date).days})
    overdue_critical.sort(key=lambda r: -r["days_overdue"])

    n_all = len(breakdowns)
    total_downtime = sum(r["downtime_minutes"] for r in rows)
    due_all = sum(r["pm_due"] for r in rows)
    done_all = sum(r["pm_completed"] for r in rows)
    repaired_all = [b for b in breakdowns if b.resumed_at and not b.resulted_in_scrap_or_replace]
    summary = {
        "period_from": str(start) if start else None, "period_to": str(end) if end else None,
        "breakdowns": n_all,
        "repeat_failures": sum(1 for b in breakdowns if b.id in repeats),
        "repeat_rate_pct": round(100 * sum(1 for b in breakdowns if b.id in repeats) / n_all, 1) if n_all else None,
        "downtime_minutes": total_downtime, "downtime_cost": round(total_downtime * rate, 2),
        "mttr_hours": round(sum((b.resumed_at - b.breakdown_at).total_seconds() for b in repaired_all) / len(repaired_all) / 3600, 2) if repaired_all else None,
        "maintenance_cost": round(sum(r["maintenance_cost"] for r in rows), 2),
        "pm_due": due_all, "pm_completed": done_all,
        "pm_compliance_pct": round(100 * done_all / due_all, 1) if due_all else None,
        "pm_on_time_pct": round(100 * sum(r["pm_on_time"] for r in rows) / due_all, 1) if due_all else None,
        "currency": currency, "mtbf_min_failures": min_failures,
    }
    return {
        "summary": summary, "machines": rows, "trend": trend,
        "failure_categories": sorted([{"name": k, "count": v} for k, v in cat.items()], key=lambda x: -x["count"]),
        "failure_modes": sorted([{"name": k, "count": v} for k, v in mode.items()], key=lambda x: -x["count"])[:15],
        "overdue_critical": overdue_critical,
        "definitions": DEFINITIONS,
    }


@router.get("/attention")
def attention(db: Session = Depends(get_db), _user=Depends(require_roles(Role.ADMIN, Role.MANAGER, Role.SUPERVISOR))):
    """Things that need a person to act - the 'operational alerts' list."""
    today = today_local()
    items = []

    def add(kind, severity, text, link=None, count=1):
        items.append({"kind": kind, "severity": severity, "text": text, "link": link, "count": count})

    for b in db.query(BreakdownEvent).filter(BreakdownEvent.status != "CLOSED", BreakdownEvent.resumed_at.is_(None),
                                             BreakdownEvent.severity.in_(["HIGH", "CRITICAL"])).all():
        m = db.query(Machine).get(b.machine_id)
        add("OPEN_CRITICAL_BREAKDOWN", "high", f"{b.bd_number or 'Breakdown'} ({b.severity}) - {m.machine_number if m else ''} is still down",
            f"/breakdowns/{b.id}")
    n = db.query(WorkOrder).filter(WorkOrder.status == WorkOrderStatus.COMPLETED, WorkOrder.cancelled.isnot(True)).count()
    if n:
        add("WO_AWAITING_VERIFICATION", "medium", f"{n} completed work order(s) waiting for verification", "/work-orders?status=COMPLETED", n)
    n = db.query(WorkOrder).filter(WorkOrder.status == WorkOrderStatus.WAITING_APPROVAL, WorkOrder.cancelled.isnot(True)).count()
    if n:
        add("WO_WAITING_APPROVAL", "medium", f"{n} work order(s) waiting for approval", "/work-orders?status=WAITING_APPROVAL", n)
    n = db.query(WorkOrderCost).filter(WorkOrderCost.approved_at.is_(None)).count()
    if n:
        add("COSTS_UNAPPROVED", "medium", f"{n} external/other cost(s) not yet approved", "/work-orders", n)
    n = db.query(PMPlan).filter(cast(PMPlan.status, String) == "PENDING_SUPERVISOR_CONFIRMATION").count()
    if n:
        add("PM_AWAITING_CONFIRMATION", "medium", f"{n} PM(s) waiting for supervisor confirmation", "/pm?status=PENDING_SUPERVISOR_CONFIRMATION", n)
    crit = 0
    for p in db.query(PMPlan).filter(PMPlan.planned_date < today,
                                     cast(PMPlan.status, String).notin_(["COMPLETED", "CANCELLED", "PENDING_SUPERVISOR_CONFIRMATION"])).all():
        m = db.query(Machine).get(p.machine_id)
        if m and m.critical:
            crit += 1
    if crit:
        add("OVERDUE_CRITICAL_PM", "high", f"{crit} overdue PM(s) on critical machines", "/pm?status=OVERDUE", crit)
    n = db.query(CorrectiveAction).filter(CorrectiveAction.status != "DONE", CorrectiveAction.target_date.isnot(None),
                                          CorrectiveAction.target_date < today).count()
    if n:
        add("ACTIONS_OVERDUE", "medium", f"{n} corrective/preventive action(s) past their target date", "/breakdowns", n)
    n = db.query(WorkOrder).filter(WorkOrder.due_date.isnot(None), WorkOrder.due_date < today,
                                   WorkOrder.cancelled.isnot(True),
                                   WorkOrder.status.notin_([WorkOrderStatus.COMPLETED, WorkOrderStatus.VERIFIED, WorkOrderStatus.CLOSED])).count()
    if n:
        add("WO_OVERDUE", "medium", f"{n} work order(s) past their due date", "/work-orders", n)
    n = db.query(SparePart).filter(SparePart.stock_on_hand <= SparePart.minimum_stock).count()
    if n:
        add("LOW_STOCK", "medium", f"{n} spare part(s) at or below minimum stock", "/spare-parts?low_stock_only=true", n)
    n = db.query(NotificationLog).filter(cast(NotificationLog.delivery_status, String) == "FAILED").count()
    if n:
        add("NOTIFICATIONS_FAILED", "low", f"{n} reminder email(s) failed to send", None, n)
    order = {"high": 0, "medium": 1, "low": 2}
    items.sort(key=lambda i: order[i["severity"]])
    return {"items": items, "total": len(items)}


@router.get("/workload")
def workload(
    date_from: date | None = None, date_to: date | None = None,
    db: Session = Depends(get_db), _user=Depends(ViewRoles),
):
    """Open work per technician, with overlaps: two jobs planned/started for the same person at the same time, and
    the same machine having PM and a repair open together."""
    today = today_local()
    start = date_from or today
    end = date_to or (today + timedelta(days=14))
    people = {e.id: e.name for e in db.query(Employee).filter(Employee.active.isnot(False)).all()}
    wos = db.query(WorkOrder).filter(
        WorkOrder.cancelled.isnot(True),
        WorkOrder.status.notin_([WorkOrderStatus.COMPLETED, WorkOrderStatus.VERIFIED, WorkOrderStatus.CLOSED]),
    ).all()
    plans = db.query(PMPlan).filter(PMPlan.planned_date >= start, PMPlan.planned_date <= end,
                                    cast(PMPlan.status, String).in_(["PLANNED", "REMINDER_SENT", "DUE", "IN_PROGRESS", "OVERDUE"])).all()
    load = defaultdict(lambda: {"work_orders": 0, "in_progress": 0, "pm_plans": 0, "estimated_hours": 0.0})
    for w in wos:
        if w.assigned_to:
            load[w.assigned_to]["work_orders"] += 1
            load[w.assigned_to]["estimated_hours"] += w.estimated_hours or 0
            if w.status == WorkOrderStatus.IN_PROGRESS:
                load[w.assigned_to]["in_progress"] += 1
    for p in plans:
        if p.assigned_to:
            load[p.assigned_to]["pm_plans"] += 1

    conflicts = []
    for pid, l in load.items():
        if l["in_progress"] > 1:
            conflicts.append({"type": "MULTIPLE_JOBS_IN_PROGRESS", "person": people.get(pid),
                              "text": f"{people.get(pid)} has {l['in_progress']} work orders in progress at the same time"})
    by_day = defaultdict(list)
    for p in plans:
        if p.assigned_to:
            by_day[(p.assigned_to, p.planned_date)].append(p)
    for (pid, d), ps in by_day.items():
        if len(ps) > 4:
            conflicts.append({"type": "OVERLOADED_DAY", "person": people.get(pid),
                              "text": f"{people.get(pid)} has {len(ps)} PM plans on {d.strftime('%d-%m-%Y')}"})
    machines_with_repair = {w.machine_id for w in wos}
    for p in plans:
        if p.machine_id in machines_with_repair:
            m = db.query(Machine).get(p.machine_id)
            conflicts.append({"type": "PM_AND_REPAIR", "person": people.get(p.assigned_to),
                              "text": f"{m.machine_number if m else ''}: PM planned {p.planned_date.strftime('%d-%m-%Y')} while a repair work order is still open"})
    return {
        "from": str(start), "to": str(end),
        "people": sorted([{"employee_id": pid, "name": people.get(pid), **{k: (round(v, 1) if isinstance(v, float) else v) for k, v in l.items()}}
                          for pid, l in load.items()], key=lambda r: -(r["work_orders"] + r["pm_plans"])),
        "conflicts": conflicts,
    }
