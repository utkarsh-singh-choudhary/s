"""
Breakdown management: a full incident lifecycle (BD-YYYY-NNNNN), structured
root-cause analysis, corrective/preventive actions, linked work orders, cost
roll-up and evidence files.

Status flow:
  REPORTED -> UNDER_DIAGNOSIS -> REPAIR_IN_PROGRESS -> AWAITING_VERIFICATION -> RESTORED -> CLOSED

"Restored" (the machine runs again - `resumed_at`) is deliberately separate
from "closed" (the paperwork/investigation is finished): a machine can be
running while the root cause, corrective action or approval is still open.
"""

from datetime import date, datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import func, or_
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, aliased

from app.core.audit import record_audit
from app.core.auth import require_roles
from app.core.database import get_db
from app.core.listing import apply_date_range, export_response, page_params, resolve_range
from app.core.settings_service import get_setting
from app.models.models import (
    BreakdownEvent, CorrectiveAction, Employee, Machine, Role, WorkOrder, WorkOrderStatus,
)
from app.notifications.ops_alerts import send_ops_alert
from app.reports.reliability import build_reliability_report
from app.services.costs import breakdown_cost, downtime_minutes
from app.services.wo_service import FAILURE_CATEGORIES, create_work_order

router = APIRouter(prefix="/api/breakdowns", tags=["breakdowns"])

LogRoles = require_roles(Role.TECHNICIAN, Role.SUPERVISOR, Role.MANAGER, Role.ADMIN)
ViewRoles = require_roles(Role.ADMIN, Role.MANAGER, Role.SUPERVISOR, Role.TECHNICIAN, Role.VIEWER)
EditRoles = require_roles(Role.SUPERVISOR, Role.MANAGER, Role.ADMIN)
ManagerRoles = require_roles(Role.MANAGER, Role.ADMIN)
ExportRoles = require_roles(Role.SUPERVISOR, Role.MANAGER, Role.ADMIN)

SEVERITIES = ("LOW", "MEDIUM", "HIGH", "CRITICAL")
IMPACTS = ("STOPPED", "REDUCED", "QUALITY", "NONE")
STATUSES = ("REPORTED", "UNDER_DIAGNOSIS", "REPAIR_IN_PROGRESS", "AWAITING_VERIFICATION", "RESTORED", "CLOSED")
RCA_STATUSES = ("NOT_STARTED", "IN_PROGRESS", "UNVERIFIED", "CONFIRMED")
FISHBONE_KEYS = ("people", "machine", "method", "material", "measurement", "environment")
HIGH_SEVERITY = ("HIGH", "CRITICAL")

TRANSITIONS = {
    "REPORTED": {"UNDER_DIAGNOSIS", "REPAIR_IN_PROGRESS"},
    "UNDER_DIAGNOSIS": {"REPAIR_IN_PROGRESS"},
    "REPAIR_IN_PROGRESS": {"UNDER_DIAGNOSIS", "AWAITING_VERIFICATION", "RESTORED"},
    "AWAITING_VERIFICATION": {"REPAIR_IN_PROGRESS", "RESTORED"},
    "RESTORED": {"CLOSED", "REPAIR_IN_PROGRESS"},
    "CLOSED": set(),  # only the audited /reopen action leaves CLOSED
}


# ----------------------------------------------------------------- helpers

def _check_choice(value, allowed, label):
    if value is not None and value not in allowed:
        raise HTTPException(400, f"{label} must be one of: {', '.join(allowed)}")


def _names(db: Session, ids) -> dict:
    ids = {i for i in ids if i}
    if not ids:
        return {}
    return {e.id: e.name for e in db.query(Employee).filter(Employee.id.in_(ids)).all()}


def _next_bd_number(db: Session, at: datetime) -> str:
    prefix = f"BD-{at.year}-"
    last = db.query(func.max(BreakdownEvent.bd_number)).filter(BreakdownEvent.bd_number.like(prefix + "%")).scalar()
    n = int(last.rsplit("-", 1)[1]) + 1 if last else 1
    return f"{prefix}{n:05d}"


def _check_times(breakdown_at: datetime | None, resumed_at: datetime | None):
    now = datetime.utcnow()
    for label, t in (("Breakdown time", breakdown_at), ("Restoration time", resumed_at)):
        if t and t > now + timedelta(minutes=5):
            raise HTTPException(400, f"{label} cannot be in the future")
    if breakdown_at and resumed_at and resumed_at < breakdown_at:
        raise HTTPException(400, "Restoration time cannot be before the breakdown time")


def recurring_ids(db: Session) -> set:
    """Incidents that repeat on the same machine within `recurrence_window_days` of the previous one."""
    window = timedelta(days=int(get_setting(db, "recurrence_window_days") or 30))
    rows = db.query(BreakdownEvent.id, BreakdownEvent.machine_id, BreakdownEvent.breakdown_at).order_by(
        BreakdownEvent.machine_id, BreakdownEvent.breakdown_at).all()
    out, prev = set(), {}
    for rid, mid, at in rows:
        p = prev.get(mid)
        if p and at - p <= window:
            out.add(rid)
        prev[mid] = at
    return out


def _row(b: BreakdownEvent, names: dict, machines: dict, recurring: set | None = None) -> dict:
    m = machines.get(b.machine_id)
    return {
        "id": b.id,
        "bd_number": b.bd_number,
        "machine_id": b.machine_id,
        "machine_number": m.machine_number if m else None,
        "machine_name": m.machine_name if m else None,
        "location": m.location if m else None,
        "critical_machine": bool(m and m.critical),
        "breakdown_at": b.breakdown_at,
        "reported_at": b.reported_at,
        "resumed_at": b.resumed_at,
        "closed_at": b.closed_at,
        "downtime_minutes": downtime_minutes(b),
        "cause": b.cause,
        "action_taken": b.action_taken,
        "failure_category": b.failure_category,
        "failure_mode": b.failure_mode,
        "severity": b.severity,
        "production_impact": b.production_impact,
        "temporary_action": b.temporary_action,
        "corrective_action": b.corrective_action,
        "root_cause": b.root_cause,
        "root_cause_confirmed": b.rca_status == "CONFIRMED",
        "rca_status": b.rca_status,
        "status": b.status,
        "resulted_in_scrap_or_replace": b.resulted_in_scrap_or_replace,
        "reported_by": b.reported_by,
        "reported_by_name": names.get(b.reported_by),
        "repaired_by": b.repaired_by,
        "repaired_by_name": names.get(b.repaired_by),
        "restored_by_name": names.get(b.repaired_by),
        "verified_by": b.verified_by,
        "verified_by_name": names.get(b.verified_by),
        "verified_at": b.verified_at,
        "is_open": b.resumed_at is None,
        "is_closed": b.status == "CLOSED",
        "recurring": (b.id in recurring) if recurring is not None else None,
    }


def _machines_for(db: Session, events) -> dict:
    ids = {e.machine_id for e in events}
    return {m.id: m for m in db.query(Machine).filter(Machine.id.in_(ids)).all()} if ids else {}


def _get(db: Session, event_id: str) -> BreakdownEvent:
    b = db.query(BreakdownEvent).get(event_id)
    if not b:
        raise HTTPException(404, "Breakdown event not found")
    return b


def _snapshot(b: BreakdownEvent) -> dict:
    return {
        "status": b.status, "severity": b.severity, "breakdown_at": str(b.breakdown_at),
        "resumed_at": str(b.resumed_at) if b.resumed_at else None, "cause": b.cause,
        "action_taken": b.action_taken, "failure_category": b.failure_category, "failure_mode": b.failure_mode,
        "production_impact": b.production_impact, "temporary_action": b.temporary_action,
        "corrective_action": b.corrective_action, "rca_status": b.rca_status,
        "resulted_in_scrap_or_replace": b.resulted_in_scrap_or_replace,
    }


# ----------------------------------------------------------------- reporting

class BreakdownIn(BaseModel):
    machine_id: str
    breakdown_at: datetime | None = None
    failure_category: str | None = None
    failure_mode: str | None = None
    severity: str = "MEDIUM"
    production_impact: str | None = None
    cause: str | None = None            # first observation / symptom
    temporary_action: str | None = None
    create_work_order: bool = False
    force: bool = False                 # report even if this machine already has an open incident


def _report(db: Session, user: Employee, machine_id, breakdown_at, **f) -> BreakdownEvent:
    machine = db.query(Machine).get(machine_id)
    if not machine:
        raise HTTPException(404, "Machine not found")
    now = datetime.utcnow()
    breakdown_at = breakdown_at or now
    _check_times(breakdown_at, None)
    for attempt in range(5):
        event = BreakdownEvent(
            machine_id=machine_id, breakdown_at=breakdown_at, reported_at=now, reported_by=user.id,
            status="REPORTED", rca_status="NOT_STARTED", bd_number=_next_bd_number(db, now), **f)
        db.add(event)
        try:
            db.flush()
            break
        except IntegrityError:
            db.rollback()
            if attempt == 4:
                raise HTTPException(409, "Could not allocate a breakdown number, please try again")
    db.commit()
    return event


def _alert_if_serious(db: Session, event: BreakdownEvent, machine: Machine):
    if event.severity in HIGH_SEVERITY and get_setting(db, "alert_emails_critical_breakdown") is not False:
        send_ops_alert(
            db, subject=f"[{event.severity}] Breakdown {event.bd_number} on {machine.machine_number}",
            body=(f"{event.severity} breakdown reported on {machine.machine_number} - {machine.machine_name}"
                  f"{' (' + machine.location + ')' if machine.location else ''}.\n"
                  f"Failure: {event.failure_category or '-'} / {event.failure_mode or '-'}\n"
                  f"Production impact: {event.production_impact or '-'}\n"
                  f"Observation: {event.cause or '-'}\n\nOpen the Breakdowns page for details."),
            entity_type="BreakdownEvent", entity_id=event.id)


@router.post("/new")
def report_breakdown_full(payload: BreakdownIn, db: Session = Depends(get_db), user: Employee = Depends(LogRoles)):
    _check_choice(payload.severity, SEVERITIES, "severity")
    _check_choice(payload.failure_category, FAILURE_CATEGORIES, "failure_category")
    _check_choice(payload.production_impact, IMPACTS, "production_impact")
    machine = db.query(Machine).get(payload.machine_id)
    if not machine:
        raise HTTPException(404, "Machine not found")
    if not machine.active:
        raise HTTPException(400, "This machine is archived - restore it before reporting a breakdown")

    if not payload.force:
        open_one = db.query(BreakdownEvent).filter(
            BreakdownEvent.machine_id == payload.machine_id, BreakdownEvent.resumed_at.is_(None),
            BreakdownEvent.status != "CLOSED").first()
        if open_one:
            raise HTTPException(409, {
                "message": f"{machine.machine_number} already has an open breakdown ({open_one.bd_number}). "
                           "Update that incident instead of creating a duplicate.",
                "existing_id": open_one.id, "existing_number": open_one.bd_number})

    event = _report(
        db, user, payload.machine_id, payload.breakdown_at,
        failure_category=payload.failure_category, failure_mode=payload.failure_mode,
        severity=payload.severity, production_impact=payload.production_impact,
        cause=payload.cause, temporary_action=payload.temporary_action)
    record_audit(db, action="BREAKDOWN_REPORTED", entity_type="BreakdownEvent", entity_id=event.id,
                 actor_id=user.id, new_value={"bd_number": event.bd_number, "machine_id": event.machine_id,
                                              "severity": event.severity, "breakdown_at": str(event.breakdown_at)})
    wo = None
    if payload.create_work_order:
        wo = create_work_order(
            db, user, machine_id=event.machine_id, breakdown_event_id=event.id, source="BREAKDOWN",
            title=f"{event.bd_number}: {event.failure_mode or event.failure_category or 'Breakdown repair'}",
            description=event.cause, failure_category=event.failure_category,
            priority=event.severity if event.severity in ("LOW", "MEDIUM", "HIGH", "CRITICAL") else "MEDIUM")
        record_audit(db, action="WORK_ORDER_CREATED", entity_type="WorkOrder", entity_id=wo.id, actor_id=user.id,
                     new_value={"from_breakdown": event.bd_number})
    _alert_if_serious(db, event, machine)
    return {"id": event.id, "bd_number": event.bd_number, "work_order_id": wo.id if wo else None}


@router.post("")
def report_breakdown(
    machine_id: str, breakdown_at: datetime, cause: str | None = None,
    db: Session = Depends(get_db), user: Employee = Depends(LogRoles),
):
    """Original quick-report call (kept so older screens keep working). Prefer POST /new."""
    event = _report(db, user, machine_id, breakdown_at, cause=cause)
    record_audit(db, action="BREAKDOWN_REPORTED", entity_type="BreakdownEvent", entity_id=event.id, actor_id=user.id,
                 new_value={"bd_number": event.bd_number, "machine_id": machine_id, "breakdown_at": str(breakdown_at)})
    return {"id": event.id, "bd_number": event.bd_number, "machine_id": machine_id, "breakdown_at": str(breakdown_at)}


@router.post("/{event_id}/resolve")
def resolve_breakdown(
    event_id: str, resumed_at: datetime, action_taken: str | None = None,
    resulted_in_scrap_or_replace: bool = False,
    db: Session = Depends(get_db), user: Employee = Depends(LogRoles),
):
    """Quick "machine is running again" (older screens). HIGH/CRITICAL incidents go to verification first."""
    b = _get(db, event_id)
    if b.status == "CLOSED":
        raise HTTPException(400, "This breakdown is already closed")
    _check_times(b.breakdown_at, resumed_at)
    b.resumed_at = resumed_at
    b.action_taken = action_taken
    b.corrective_action = b.corrective_action or action_taken
    b.resulted_in_scrap_or_replace = resulted_in_scrap_or_replace
    b.repaired_by = user.id
    b.status = "AWAITING_VERIFICATION" if b.severity in HIGH_SEVERITY else "RESTORED"
    db.commit()
    record_audit(db, action="BREAKDOWN_RESOLVED", entity_type="BreakdownEvent", entity_id=event_id, actor_id=user.id,
                 new_value={"resumed_at": str(resumed_at), "status": b.status,
                            "resulted_in_scrap_or_replace": resulted_in_scrap_or_replace})
    return {"id": b.id, "resumed_at": str(resumed_at), "status": b.status}


# ----------------------------------------------------------------- editing

class BreakdownUpdateIn(BaseModel):
    breakdown_at: datetime | None = None
    resumed_at: datetime | None = None
    cause: str | None = None
    action_taken: str | None = None
    resulted_in_scrap_or_replace: bool | None = None
    failure_category: str | None = None
    failure_mode: str | None = None
    severity: str | None = None
    production_impact: str | None = None
    temporary_action: str | None = None
    corrective_action: str | None = None


@router.put("/{event_id}")
def update_breakdown(event_id: str, payload: BreakdownUpdateIn, db: Session = Depends(get_db),
                     user: Employee = Depends(EditRoles)):
    """Correct an incident. Supervisor+ only, because this changes MTBF/MTTR/cost history."""
    b = _get(db, event_id)
    if b.status == "CLOSED" and user.role not in (Role.MANAGER, Role.ADMIN):
        raise HTTPException(403, "Closed breakdowns can only be edited by a manager or admin (or reopened first)")
    req = payload.model_dump(exclude_unset=True)
    _check_choice(req.get("severity"), SEVERITIES, "severity")
    _check_choice(req.get("failure_category"), FAILURE_CATEGORIES, "failure_category")
    _check_choice(req.get("production_impact"), IMPACTS, "production_impact")
    old = _snapshot(b)
    for k, v in req.items():
        setattr(b, k, v)
    _check_times(b.breakdown_at, b.resumed_at)
    db.commit()
    record_audit(db, action="BREAKDOWN_UPDATED", entity_type="BreakdownEvent", entity_id=b.id, actor_id=user.id,
                 old_value=old, new_value=_snapshot(b))
    names = _names(db, [b.reported_by, b.repaired_by, b.verified_by])
    return _row(b, names, _machines_for(db, [b]))


# ----------------------------------------------------------------- lifecycle

class StatusIn(BaseModel):
    status: str
    note: str | None = None
    resumed_at: datetime | None = None
    temporary_action: str | None = None
    corrective_action: str | None = None


def _open_wos(db: Session, b: BreakdownEvent) -> list[WorkOrder]:
    done = (WorkOrderStatus.COMPLETED, WorkOrderStatus.VERIFIED, WorkOrderStatus.CLOSED)
    return db.query(WorkOrder).filter(WorkOrder.breakdown_event_id == b.id, WorkOrder.cancelled.isnot(True),
                                      WorkOrder.status.notin_(done)).all()


def closure_blockers(db: Session, b: BreakdownEvent) -> list[str]:
    out = []
    if not b.resumed_at:
        out.append("Record when the machine was restored to service")
    if not (b.corrective_action or "").strip():
        out.append("Permanent corrective action is not recorded")
    if b.severity in HIGH_SEVERITY or b.rca_status != "NOT_STARTED":
        if b.rca_status != "CONFIRMED":
            out.append("Root cause is not confirmed (RCA status: %s)" % b.rca_status)
    if b.severity in HIGH_SEVERITY and not b.verified_by:
        out.append("A supervisor or manager must verify this %s incident" % b.severity)
    actions = db.query(CorrectiveAction).filter(CorrectiveAction.breakdown_event_id == b.id).all()
    if b.severity in HIGH_SEVERITY and not actions:
        out.append("Add at least one corrective or preventive action (with an owner)")
    for a in actions:
        if a.status != "DONE":
            out.append(f"Action not finished: {a.description[:60]}")
    for wo in _open_wos(db, b):
        out.append(f"Work order WO-{wo.number} is still {wo.status.value}")
    return out


@router.post("/{event_id}/status")
def change_status(event_id: str, payload: StatusIn, db: Session = Depends(get_db), user: Employee = Depends(LogRoles)):
    b = _get(db, event_id)
    target = payload.status
    _check_choice(target, STATUSES, "status")
    if target == b.status:
        return {"id": b.id, "status": b.status}
    if target not in TRANSITIONS.get(b.status, set()):
        raise HTTPException(400, f"Cannot move from {b.status} to {target}. "
                                 + ("Use Reopen (manager/admin) to reopen a closed breakdown." if b.status == "CLOSED" else ""))
    is_editor = user.role in (Role.SUPERVISOR, Role.MANAGER, Role.ADMIN)
    old = _snapshot(b)
    now = datetime.utcnow()

    if payload.temporary_action is not None:
        b.temporary_action = payload.temporary_action
    if payload.corrective_action is not None:
        b.corrective_action = payload.corrective_action

    if target == "AWAITING_VERIFICATION":
        if not ((b.temporary_action or "").strip() or (b.corrective_action or "").strip()):
            raise HTTPException(400, "Record the temporary or corrective action taken before sending for verification")
        if payload.resumed_at:
            _check_times(b.breakdown_at, payload.resumed_at)
            b.resumed_at = payload.resumed_at
            b.repaired_by = b.repaired_by or user.id
        b.repaired_by = b.repaired_by or user.id
    elif target == "RESTORED":
        if b.status == "AWAITING_VERIFICATION" or b.severity in HIGH_SEVERITY:
            if not is_editor:
                raise HTTPException(403, "A supervisor, manager or admin must verify this restoration")
            if b.severity in HIGH_SEVERITY and b.repaired_by == user.id and user.role != Role.ADMIN:
                raise HTTPException(403, "A HIGH/CRITICAL restoration must be verified by someone other than the person who restored it")
        if b.severity in HIGH_SEVERITY and b.status != "AWAITING_VERIFICATION":
            raise HTTPException(400, "HIGH/CRITICAL incidents must go through Awaiting verification first")
        if not ((b.temporary_action or "").strip() or (b.corrective_action or "").strip()):
            raise HTTPException(400, "Record the temporary or corrective action taken first")
        resumed = payload.resumed_at or b.resumed_at or now
        _check_times(b.breakdown_at, resumed)
        b.resumed_at = resumed
        b.repaired_by = b.repaired_by or user.id
        if is_editor:
            b.verified_by, b.verified_at = user.id, now
    elif target == "CLOSED":
        if not is_editor:
            raise HTTPException(403, "Only a supervisor, manager or admin can close a breakdown")
        if b.severity == "CRITICAL" and user.role not in (Role.MANAGER, Role.ADMIN):
            raise HTTPException(403, "A CRITICAL incident must be closed (approved) by a manager or admin")
        problems = closure_blockers(db, b)
        if problems:
            raise HTTPException(400, {"message": "Cannot close this breakdown yet", "blockers": problems})
        b.closed_at, b.closed_by = now, user.id
    elif target == "REPAIR_IN_PROGRESS" and b.status in ("RESTORED", "AWAITING_VERIFICATION"):
        if b.status == "RESTORED" and not is_editor:
            raise HTTPException(403, "Only a supervisor, manager or admin can send a restored breakdown back to repair")
        if not (payload.note or "").strip():
            raise HTTPException(400, "A reason is required to send this back to repair")
        b.resumed_at = None   # it is down again; the earlier restoration no longer stands
        b.verified_by = b.verified_at = None

    b.status = target
    db.commit()
    record_audit(db, action="BREAKDOWN_STATUS_CHANGED", entity_type="BreakdownEvent", entity_id=b.id, actor_id=user.id,
                 old_value=old, new_value={**_snapshot(b), "note": payload.note})
    return {"id": b.id, "status": b.status}


class ReopenIn(BaseModel):
    reason: str


@router.post("/{event_id}/reopen")
def reopen_breakdown(event_id: str, payload: ReopenIn, db: Session = Depends(get_db),
                     user: Employee = Depends(ManagerRoles)):
    b = _get(db, event_id)
    if b.status != "CLOSED":
        raise HTTPException(400, "Only a closed breakdown can be reopened")
    if len((payload.reason or "").strip()) < 5:
        raise HTTPException(400, "Give a reason for reopening (at least a few words)")
    old = _snapshot(b)
    b.status = "REPAIR_IN_PROGRESS"
    b.closed_at = b.closed_by = None
    b.resumed_at = None
    b.verified_by = b.verified_at = None
    if b.rca_status == "CONFIRMED":
        b.rca_status = "UNVERIFIED"
    db.commit()
    record_audit(db, action="BREAKDOWN_REOPENED", entity_type="BreakdownEvent", entity_id=b.id, actor_id=user.id,
                 old_value=old, new_value={**_snapshot(b), "reason": payload.reason})
    return {"id": b.id, "status": b.status}


# ----------------------------------------------------------------- root-cause analysis

class FiveWhy(BaseModel):
    question: str = ""
    answer: str = ""
    evidence: str = ""
    confirmed: bool = False


class RcaIn(BaseModel):
    symptom: str | None = None
    observed_condition: str | None = None
    immediate_cause: str | None = None
    contributing_factors: list[str] | None = None
    five_whys: list[FiveWhy] | None = None
    fishbone: dict[str, list[str]] | None = None
    root_cause: str | None = None
    rca_status: str | None = None


@router.put("/{event_id}/rca")
def save_rca(event_id: str, payload: RcaIn, db: Session = Depends(get_db), user: Employee = Depends(LogRoles)):
    b = _get(db, event_id)
    if b.status == "CLOSED":
        raise HTTPException(400, "This breakdown is closed - reopen it to change the investigation")
    req = payload.model_dump(exclude_unset=True)
    _check_choice(req.get("rca_status"), RCA_STATUSES, "rca_status")
    if payload.fishbone is not None:
        bad = [k for k in payload.fishbone if k not in FISHBONE_KEYS]
        if bad:
            raise HTTPException(400, f"Unknown fishbone group(s): {', '.join(bad)}. Use: {', '.join(FISHBONE_KEYS)}")
    is_editor = user.role in (Role.SUPERVISOR, Role.MANAGER, Role.ADMIN)

    data = dict(b.rca_data or {})
    content_changed = False
    for key in ("symptom", "observed_condition", "immediate_cause"):
        if key in req and (req[key] or "") != (data.get(key) or ""):
            data[key] = req[key]
            content_changed = True
    if payload.contributing_factors is not None:
        data["contributing_factors"] = [c.strip() for c in payload.contributing_factors if c.strip()]
        content_changed = True
    if payload.five_whys is not None:
        data["five_whys"] = [w.model_dump() for w in payload.five_whys]
        content_changed = True
    if payload.fishbone is not None:
        data["fishbone"] = {k: [c.strip() for c in v if c.strip()] for k, v in payload.fishbone.items()}
        content_changed = True
    if "root_cause" in req and (req["root_cause"] or "") != (b.root_cause or ""):
        b.root_cause = req["root_cause"]
        content_changed = True

    old_status = b.rca_status
    new_status = req.get("rca_status") or old_status
    if content_changed and old_status == "CONFIRMED" and "rca_status" not in req:
        new_status = "UNVERIFIED"   # editing a confirmed analysis un-confirms it until re-approved
    if content_changed and new_status == "NOT_STARTED":
        new_status = "IN_PROGRESS"

    if new_status == "CONFIRMED":
        problems = []
        if not (b.root_cause or "").strip():
            problems.append("Write the root cause")
        whys = [w for w in data.get("five_whys", []) if (w.get("answer") or "").strip()]
        if not whys:
            problems.append("Answer at least one 'why'")
        for i, w in enumerate(whys, 1):
            if not w.get("confirmed"):
                problems.append(f"Why #{i} is still a guess - mark it confirmed only once proven")
            if not (w.get("evidence") or "").strip():
                problems.append(f"Why #{i} needs evidence (what was seen, measured or checked)")
        if b.severity in HIGH_SEVERITY and not is_editor:
            problems.append("A supervisor or manager must confirm the root cause of a HIGH/CRITICAL incident")
        if problems:
            raise HTTPException(400, {"message": "Root cause cannot be marked confirmed yet", "blockers": problems})
        data["confirmed_by"], data["confirmed_at"] = user.id, datetime.utcnow().isoformat()
    elif old_status == "CONFIRMED":
        data.pop("confirmed_by", None)
        data.pop("confirmed_at", None)

    data["updated_by"], data["updated_at"] = user.id, datetime.utcnow().isoformat()
    b.rca_data = data
    b.rca_status = new_status
    db.commit()
    record_audit(db, action="BREAKDOWN_RCA_SAVED", entity_type="BreakdownEvent", entity_id=b.id, actor_id=user.id,
                 old_value={"rca_status": old_status}, new_value={"rca_status": new_status, "root_cause": b.root_cause})
    return {"id": b.id, "rca_status": b.rca_status, "rca": b.rca_data, "root_cause": b.root_cause}


# ----------------------------------------------------------------- corrective / preventive actions

class ActionIn(BaseModel):
    kind: str = "CORRECTIVE"
    description: str
    owner_id: str | None = None
    target_date: date | None = None


class ActionUpdateIn(BaseModel):
    description: str | None = None
    owner_id: str | None = None
    target_date: date | None = None
    status: str | None = None
    effectiveness: str | None = None
    effectiveness_note: str | None = None


def _action_row(a: CorrectiveAction, names: dict) -> dict:
    return {
        "id": a.id, "kind": a.kind, "description": a.description, "owner_id": a.owner_id,
        "owner_name": names.get(a.owner_id), "target_date": a.target_date, "status": a.status,
        "completed_at": a.completed_at, "effectiveness": a.effectiveness, "effectiveness_note": a.effectiveness_note,
        "overdue": bool(a.target_date and a.status != "DONE" and a.target_date < date.today()),
    }


@router.post("/{event_id}/actions")
def add_action(event_id: str, payload: ActionIn, db: Session = Depends(get_db), user: Employee = Depends(LogRoles)):
    b = _get(db, event_id)
    _check_choice(payload.kind, ("CORRECTIVE", "PREVENTIVE"), "kind")
    if not payload.description.strip():
        raise HTTPException(400, "Describe the action")
    if payload.owner_id and not db.query(Employee).get(payload.owner_id):
        raise HTTPException(404, "Owner not found")
    a = CorrectiveAction(breakdown_event_id=b.id, kind=payload.kind, description=payload.description.strip(),
                         owner_id=payload.owner_id, target_date=payload.target_date, created_by=user.id)
    db.add(a)
    db.commit()
    record_audit(db, action="BREAKDOWN_ACTION_ADDED", entity_type="BreakdownEvent", entity_id=b.id, actor_id=user.id,
                 new_value={"kind": a.kind, "description": a.description})
    return _action_row(a, _names(db, [a.owner_id]))


@router.put("/{event_id}/actions/{action_id}")
def update_action(event_id: str, action_id: str, payload: ActionUpdateIn, db: Session = Depends(get_db),
                  user: Employee = Depends(LogRoles)):
    a = db.query(CorrectiveAction).filter(CorrectiveAction.id == action_id,
                                          CorrectiveAction.breakdown_event_id == event_id).first()
    if not a:
        raise HTTPException(404, "Action not found")
    req = payload.model_dump(exclude_unset=True)
    _check_choice(req.get("status"), ("OPEN", "IN_PROGRESS", "DONE"), "status")
    _check_choice(req.get("effectiveness"), ("PENDING", "EFFECTIVE", "NOT_EFFECTIVE"), "effectiveness")
    if ("effectiveness" in req and req["effectiveness"] != "PENDING") and user.role not in (Role.SUPERVISOR, Role.MANAGER, Role.ADMIN):
        raise HTTPException(403, "Only a supervisor, manager or admin can record the effectiveness review")
    if req.get("effectiveness") in ("EFFECTIVE", "NOT_EFFECTIVE") and (a.status != "DONE" and req.get("status") != "DONE"):
        raise HTTPException(400, "Complete the action before reviewing its effectiveness")
    old = {"status": a.status, "effectiveness": a.effectiveness}
    for k, v in req.items():
        setattr(a, k, v)
    if a.status == "DONE" and not a.completed_at:
        a.completed_at = datetime.utcnow()
    if a.status != "DONE":
        a.completed_at = None
    db.commit()
    record_audit(db, action="BREAKDOWN_ACTION_UPDATED", entity_type="BreakdownEvent", entity_id=event_id,
                 actor_id=user.id, old_value=old, new_value={"status": a.status, "effectiveness": a.effectiveness})
    return _action_row(a, _names(db, [a.owner_id]))


@router.delete("/{event_id}/actions/{action_id}")
def delete_action(event_id: str, action_id: str, db: Session = Depends(get_db), user: Employee = Depends(EditRoles)):
    a = db.query(CorrectiveAction).filter(CorrectiveAction.id == action_id,
                                          CorrectiveAction.breakdown_event_id == event_id).first()
    if not a:
        raise HTTPException(404, "Action not found")
    desc = a.description
    db.delete(a)
    db.commit()
    record_audit(db, action="BREAKDOWN_ACTION_DELETED", entity_type="BreakdownEvent", entity_id=event_id,
                 actor_id=user.id, old_value={"description": desc})
    return {"success": True}


# ----------------------------------------------------------------- work orders

class RaiseWOIn(BaseModel):
    title: str | None = None
    assigned_to: str | None = None
    priority: str | None = None


@router.post("/{event_id}/work-order")
def raise_work_order(event_id: str, payload: RaiseWOIn, db: Session = Depends(get_db), user: Employee = Depends(LogRoles)):
    """Create a work order for this incident - or return the open one that already exists."""
    b = _get(db, event_id)
    if b.status == "CLOSED":
        raise HTTPException(400, "This breakdown is closed")
    existing = db.query(WorkOrder).filter(
        WorkOrder.breakdown_event_id == b.id, WorkOrder.cancelled.isnot(True),
        WorkOrder.status.notin_((WorkOrderStatus.CLOSED,))).first()
    if existing:
        return {"id": existing.id, "display_number": f"WO-{existing.number}", "created": False}
    wo = create_work_order(
        db, user, machine_id=b.machine_id, breakdown_event_id=b.id, source="BREAKDOWN",
        title=payload.title or f"{b.bd_number}: {b.failure_mode or b.failure_category or 'Breakdown repair'}",
        description=b.cause, failure_category=b.failure_category, assigned_to=payload.assigned_to,
        priority=payload.priority or (b.severity if b.severity in ("LOW", "MEDIUM", "HIGH", "CRITICAL") else "MEDIUM"))
    record_audit(db, action="WORK_ORDER_CREATED", entity_type="WorkOrder", entity_id=wo.id, actor_id=user.id,
                 new_value={"from_breakdown": b.bd_number})
    return {"id": wo.id, "display_number": f"WO-{wo.number}", "created": True}


@router.post("/{event_id}/link-work-order/{wo_id}")
def link_work_order(event_id: str, wo_id: str, db: Session = Depends(get_db), user: Employee = Depends(EditRoles)):
    b = _get(db, event_id)
    wo = db.query(WorkOrder).get(wo_id)
    if not wo:
        raise HTTPException(404, "Work order not found")
    if wo.machine_id != b.machine_id:
        raise HTTPException(400, "That work order is for a different machine")
    if wo.breakdown_event_id and wo.breakdown_event_id != b.id:
        raise HTTPException(409, "That work order is already linked to another breakdown")
    wo.breakdown_event_id = b.id
    db.commit()
    record_audit(db, action="WORK_ORDER_LINKED", entity_type="WorkOrder", entity_id=wo.id, actor_id=user.id,
                 new_value={"breakdown": b.bd_number})
    return {"success": True}


# ----------------------------------------------------------------- detail

@router.get("/reliability")
def get_reliability_report(machine_id: str | None = None, db: Session = Depends(get_db), _user=Depends(ViewRoles)):
    """MTBF/MTTR per machine - see app/reports/reliability.py (and /api/analytics for the full set)."""
    reports = build_reliability_report(db, machine_id=machine_id)
    return {
        "machines": [
            {
                "machine_id": r.machine_id, "machine_number": r.machine_number,
                "machine_name": r.machine_name, "breakdown_count": r.breakdown_count,
                "open_breakdowns": r.open_breakdowns,
                "mtbf_hours": r.mtbf_hours, "mttr_hours": r.mttr_hours,
                "events": r.events,
            }
            for r in reports
        ]
    }


def _filtered(db: Session, *, q, status, severity, category, machine_id, open_only, date_basis, preset, date_from, date_to):
    rep, rest = aliased(Employee), aliased(Employee)
    query = (db.query(BreakdownEvent).join(Machine, Machine.id == BreakdownEvent.machine_id)
             .outerjoin(rep, rep.id == BreakdownEvent.reported_by)
             .outerjoin(rest, rest.id == BreakdownEvent.repaired_by))
    if machine_id:
        query = query.filter(BreakdownEvent.machine_id == machine_id)
    if status:
        query = query.filter(BreakdownEvent.status == status)
    if severity:
        query = query.filter(BreakdownEvent.severity == severity)
    if category:
        query = query.filter(BreakdownEvent.failure_category == category)
    if open_only:
        query = query.filter(BreakdownEvent.resumed_at.is_(None))
    if q and q.strip():
        like = f"%{q.strip()}%"
        query = query.filter(or_(
            Machine.machine_number.ilike(like), Machine.machine_name.ilike(like), Machine.location.ilike(like),
            BreakdownEvent.bd_number.ilike(like), BreakdownEvent.failure_mode.ilike(like),
            BreakdownEvent.root_cause.ilike(like), BreakdownEvent.cause.ilike(like),
            BreakdownEvent.status.ilike(like), rep.name.ilike(like), rest.name.ilike(like)))
    start, end = resolve_range(preset, date_from, date_to)
    column = {"incident": BreakdownEvent.breakdown_at, "restored": BreakdownEvent.resumed_at,
              "reported": BreakdownEvent.reported_at}.get(date_basis or "incident")
    if column is None:
        raise HTTPException(400, "date_basis must be incident, restored or reported")
    return apply_date_range(query, column, start, end, is_datetime=True)


def _search_rows(db, sort, **f):
    events = _filtered(db, **f).all()
    machines = _machines_for(db, events)
    names = _names(db, [i for e in events for i in (e.reported_by, e.repaired_by, e.verified_by)])
    rec = recurring_ids(db)
    rows = [_row(e, names, machines, rec) for e in events]
    sev_rank = {"CRITICAL": 4, "HIGH": 3, "MEDIUM": 2, "LOW": 1}
    sort = sort or "newest"
    if sort == "oldest":
        rows.sort(key=lambda r: r["breakdown_at"])
    elif sort == "severity":
        rows.sort(key=lambda r: (-sev_rank.get(r["severity"], 0), r["breakdown_at"]), reverse=False)
    elif sort == "downtime":
        rows.sort(key=lambda r: -(r["downtime_minutes"] or 0))
    elif sort == "cost":
        by_id = {e.id: e for e in events}
        costs = {r["id"]: breakdown_cost(db, by_id[r["id"]])["actual_total"] for r in rows}
        for r in rows:
            r["repair_cost"] = costs[r["id"]]
        rows.sort(key=lambda r: -r["repair_cost"])
    elif sort == "newest":
        rows.sort(key=lambda r: r["breakdown_at"], reverse=True)
    else:
        raise HTTPException(400, "sort must be newest, oldest, severity, downtime or cost")
    return rows


def _filter_params(q, status, severity, category, machine_id, open_only, date_basis, date_preset, date_from, date_to):
    return dict(q=q, status=status, severity=severity, category=category, machine_id=machine_id, open_only=open_only,
                date_basis=date_basis, preset=date_preset, date_from=date_from, date_to=date_to)


@router.get("/search")
def search_breakdowns(
    q: str | None = None, status: str | None = None, severity: str | None = None, category: str | None = None,
    machine_id: str | None = None, open_only: bool = False,
    date_basis: str = "incident", date_preset: str | None = None, date_from: date | None = None,
    date_to: date | None = None, sort: str = "newest", page: int = 1, page_size: int = 25,
    db: Session = Depends(get_db), _user=Depends(ViewRoles),
):
    """Filtered, sorted, paginated list. `total` is the number of ALL matching records, not just this page."""
    rows = _search_rows(db, sort, **_filter_params(q, status, severity, category, machine_id, open_only, date_basis,
                                                   date_preset, date_from, date_to))
    page, page_size = page_params(page, page_size)
    total = len(rows)
    pages = max(1, -(-total // page_size))
    page = min(page, pages)
    start_d, end_d = resolve_range(date_preset, date_from, date_to)
    return {
        "items": rows[(page - 1) * page_size: page * page_size],
        "total": total, "page": page, "page_size": page_size, "pages": pages,
        "range": {"from": start_d, "to": end_d, "basis": date_basis},
        "summary": {
            "total": total,
            "open": sum(1 for r in rows if r["is_open"]),
            "restored": sum(1 for r in rows if not r["is_open"]),
            "closed": sum(1 for r in rows if r["is_closed"]),
            "recurring": sum(1 for r in rows if r["recurring"]),
            "downtime_hours": round(sum((r["downtime_minutes"] or 0) for r in rows) / 60, 1),
        },
    }


@router.get("/export")
def export_breakdowns(
    q: str | None = None, status: str | None = None, severity: str | None = None, category: str | None = None,
    machine_id: str | None = None, open_only: bool = False,
    date_basis: str = "incident", date_preset: str | None = None, date_from: date | None = None,
    date_to: date | None = None, sort: str = "newest", format: str = "csv",
    db: Session = Depends(get_db), user: Employee = Depends(ExportRoles),
):
    rows = _search_rows(db, sort, **_filter_params(q, status, severity, category, machine_id, open_only, date_basis,
                                                   date_preset, date_from, date_to))
    for r in rows:
        r["downtime_hours"] = round((r["downtime_minutes"] or 0) / 60, 2)
    record_audit(db, action="EXPORT_BREAKDOWNS", entity_type="BreakdownEvent", actor_id=user.id,
                 new_value={"rows": len(rows), "format": format})
    cols = [("bd_number", "Breakdown No"), ("machine_number", "Machine"), ("machine_name", "Machine name"),
            ("location", "Location"), ("breakdown_at", "Started"), ("reported_at", "Reported"),
            ("resumed_at", "Restored"), ("downtime_hours", "Downtime (h)"), ("failure_category", "Category"),
            ("failure_mode", "Failure mode"), ("severity", "Severity"), ("production_impact", "Production impact"),
            ("status", "Status"), ("rca_status", "RCA status"), ("root_cause", "Root cause"),
            ("corrective_action", "Corrective action"), ("reported_by_name", "Reported by"),
            ("restored_by_name", "Restored by"), ("verified_by_name", "Verified by")]
    return export_response(rows, cols, format, "breakdowns")


@router.get("")
def list_breakdowns(machine_id: str | None = None, open_only: bool = False, db: Session = Depends(get_db),
                    _user=Depends(ViewRoles)):
    """Unpaged history, newest first (machine detail page). Use /search for the filtered list."""
    q = db.query(BreakdownEvent)
    if machine_id:
        q = q.filter(BreakdownEvent.machine_id == machine_id)
    if open_only:
        q = q.filter(BreakdownEvent.resumed_at.is_(None))
    events = q.order_by(BreakdownEvent.breakdown_at.desc()).all()
    machines = _machines_for(db, events)
    names = _names(db, [i for e in events for i in (e.reported_by, e.repaired_by, e.verified_by)])
    return [_row(e, names, machines) for e in events]


@router.get("/{event_id}")
def breakdown_detail(event_id: str, db: Session = Depends(get_db), _user=Depends(ViewRoles)):
    b = _get(db, event_id)
    machines = _machines_for(db, [b])
    actions = db.query(CorrectiveAction).filter(CorrectiveAction.breakdown_event_id == b.id).order_by(
        CorrectiveAction.created_at).all()
    wos = db.query(WorkOrder).filter(WorkOrder.breakdown_event_id == b.id).order_by(WorkOrder.created_at).all()
    ids = [b.reported_by, b.repaired_by, b.verified_by, b.closed_by] + [a.owner_id for a in actions] + \
          [w.assigned_to for w in wos] + [(b.rca_data or {}).get(k) for k in ("confirmed_by", "updated_by")]
    names = _names(db, ids)

    similar_q = db.query(BreakdownEvent).filter(BreakdownEvent.id != b.id)
    conds = [BreakdownEvent.machine_id == b.machine_id]
    if b.failure_category:
        conds.append((BreakdownEvent.failure_category == b.failure_category) & (BreakdownEvent.failure_mode == b.failure_mode)
                     if b.failure_mode else (BreakdownEvent.failure_category == b.failure_category))
    similar = similar_q.filter(or_(*conds)).order_by(BreakdownEvent.breakdown_at.desc()).limit(8).all()
    sim_machines = _machines_for(db, similar)

    row = _row(b, names, machines, recurring_ids(db))
    current = b.status
    nexts = sorted(TRANSITIONS.get(current, set()))
    return {
        **row,
        "rca": b.rca_data or {},
        "rca_confirmed_by_name": names.get((b.rca_data or {}).get("confirmed_by")),
        "closed_by_name": names.get(b.closed_by),
        "actions": [_action_row(a, names) for a in actions],
        "work_orders": [{
            "id": w.id, "display_number": f"WO-{w.number}", "title": w.title, "status": w.status.value,
            "priority": w.priority.value if w.priority else None, "assigned_to_name": names.get(w.assigned_to),
            "cancelled": bool(w.cancelled)} for w in wos],
        "costs": breakdown_cost(db, b),
        "similar": [{
            "id": s.id, "bd_number": s.bd_number, "breakdown_at": s.breakdown_at,
            "machine_number": sim_machines[s.machine_id].machine_number if s.machine_id in sim_machines else None,
            "same_machine": s.machine_id == b.machine_id, "failure_category": s.failure_category,
            "failure_mode": s.failure_mode, "root_cause": s.root_cause, "status": s.status} for s in similar],
        "allowed_next_statuses": nexts,
        "closure_blockers": closure_blockers(db, b) if current != "CLOSED" else [],
    }
