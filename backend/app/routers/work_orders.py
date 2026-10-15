"""
Work orders: assignment, validated status lifecycle, work log, labour, costs,
parts, machine-specific checklist, approvals, cancellation and audited reopen.

Lifecycle:
  OPEN -> ASSIGNED -> IN_PROGRESS <-> WAITING_PARTS / WAITING_APPROVAL
       -> COMPLETED -> VERIFIED -> CLOSED
Cancelling is a separate action that needs a reason. Nobody can jump to a
final status while the mandatory safety, checklist or repair details are
incomplete - the API answers with the exact list of what is missing.
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
from app.core.timeutils import today_local
from app.models.models import (
    BreakdownEvent, ChecklistTemplateItem, Employee, EvidenceFile, Machine, Role, SparePart, SparePartTransaction,
    WorkOrder, WorkOrderChecklistResponse, WorkOrderCost, WorkOrderLabourEntry, WorkOrderLog,
    WorkOrderPriority, WorkOrderStatus,
)
from app.services import checklist_engine as ce
from app.services.costs import parts_for_work_orders, work_order_cost
from app.services.wo_service import (
    FAILURE_CATEGORIES, RESOLUTION_CODES, SAFETY_RISKS, SOURCES, WAIT_REASONS, create_work_order, log_event,
)

router = APIRouter(prefix="/api/work-orders", tags=["work-orders"])

LogRoles = require_roles(Role.TECHNICIAN, Role.SUPERVISOR, Role.MANAGER, Role.ADMIN)
ViewRoles = require_roles(Role.ADMIN, Role.MANAGER, Role.SUPERVISOR, Role.TECHNICIAN, Role.VIEWER)
EditRoles = require_roles(Role.SUPERVISOR, Role.MANAGER, Role.ADMIN)
ManagerRoles = require_roles(Role.MANAGER, Role.ADMIN)

S = WorkOrderStatus
FORWARD_TRANSITIONS = {
    S.OPEN: {S.ASSIGNED, S.IN_PROGRESS},
    S.ASSIGNED: {S.IN_PROGRESS},
    S.IN_PROGRESS: {S.WAITING_PARTS, S.WAITING_APPROVAL, S.COMPLETED},
    S.WAITING_PARTS: {S.IN_PROGRESS},
    S.WAITING_APPROVAL: {S.IN_PROGRESS},
    S.COMPLETED: {S.VERIFIED, S.CLOSED, S.IN_PROGRESS},
    S.VERIFIED: {S.CLOSED},
    S.CLOSED: set(),
}
WORKING = (S.IN_PROGRESS, S.WAITING_PARTS, S.WAITING_APPROVAL)
LOCKED = (S.VERIFIED, S.CLOSED)
HIGH = ("HIGH", "CRITICAL")


# ----------------------------------------------------------------- helpers

def _names(db: Session, ids) -> dict:
    ids = {i for i in ids if i}
    return {e.id: e.name for e in db.query(Employee).filter(Employee.id.in_(ids)).all()} if ids else {}


def _employee_names(db: Session, work_orders: list[WorkOrder]) -> dict:
    return _names(db, [i for wo in work_orders for i in (wo.reported_by, wo.assigned_to, wo.verified_by,
                                                         wo.supervisor_id, wo.completed_by)])


def _get(db: Session, wo_id: str, lock: bool = False) -> WorkOrder:
    q = db.query(WorkOrder).filter(WorkOrder.id == wo_id)
    if lock:
        q = q.with_for_update()
    wo = q.first()
    if not wo:
        raise HTTPException(404, "Work order not found")
    return wo


def _serialize(wo: WorkOrder, names: dict) -> dict:
    return {
        "id": wo.id,
        "number": wo.number,
        "display_number": f"WO-{wo.number}",
        "machine_id": wo.machine_id,
        "breakdown_event_id": wo.breakdown_event_id,
        "pm_plan_id": wo.pm_plan_id,
        "parent_work_order_id": wo.parent_work_order_id,
        "source": wo.source,
        "title": wo.title,
        "description": wo.description,
        "failure_category": wo.failure_category,
        "priority": wo.priority,
        "status": wo.status,
        "cancelled": bool(wo.cancelled),
        "cancel_reason": wo.cancel_reason,
        "reported_by": wo.reported_by,
        "reported_by_name": names.get(wo.reported_by),
        "assigned_to": wo.assigned_to,
        "assigned_to_name": names.get(wo.assigned_to),
        "supervisor_id": wo.supervisor_id,
        "supervisor_name": names.get(wo.supervisor_id),
        "planned_start": wo.planned_start,
        "due_date": wo.due_date,
        "safety_risk": wo.safety_risk,
        "permit_required": bool(wo.permit_required),
        "loto_required": bool(wo.loto_required),
        "safety_confirmed": bool(wo.safety_confirmed),
        "estimated_hours": wo.estimated_hours,
        "estimated_cost": wo.estimated_cost,
        "waiting_reason": wo.waiting_reason,
        "diagnosis": wo.diagnosis,
        "root_cause": wo.root_cause,
        "five_whys": wo.five_whys,
        "action_taken": wo.action_taken,
        "repair_summary": wo.repair_summary,
        "resolution_code": wo.resolution_code,
        "parts_used": wo.parts_used,
        "labor_hours": wo.labor_hours,
        "downtime_minutes": wo.downtime_minutes,
        "started_at": wo.started_at,
        "completed_at": wo.completed_at,
        "completed_by": wo.completed_by,
        "completed_by_name": names.get(wo.completed_by),
        "restored_at": wo.restored_at,
        "closed_at": wo.closed_at,
        "verified_by": wo.verified_by,
        "verified_by_name": names.get(wo.verified_by),
        "reopen_count": wo.reopen_count or 0,
        "created_at": wo.created_at,
        "updated_at": wo.updated_at,
    }


def _requires_verification(db: Session, wo: WorkOrder) -> bool:
    if wo.priority and wo.priority.value in HIGH:
        return True
    if wo.safety_risk == "HIGH" or wo.loto_required or wo.permit_required:
        return True
    m = db.query(Machine).get(wo.machine_id)
    if m and m.critical:
        return True
    if wo.breakdown_event_id:
        bd = db.query(BreakdownEvent).get(wo.breakdown_event_id)
        if bd and bd.severity in HIGH:
            return True
    return False


def _can_work(user: Employee, wo: WorkOrder) -> bool:
    return user.role in (Role.SUPERVISOR, Role.MANAGER, Role.ADMIN) or wo.assigned_to in (None, user.id)


def _ensure_editable(wo: WorkOrder):
    if wo.cancelled:
        raise HTTPException(400, "This work order was cancelled")
    if wo.status in LOCKED:
        raise HTTPException(400, f"This work order is {wo.status.value} and locked - ask a manager to reopen it")


def _check_times(start: datetime | None, end: datetime | None, label="Time"):
    if end and end > datetime.utcnow() + timedelta(minutes=5):
        raise HTTPException(400, f"{label} cannot be in the future")
    if start and end and end < start:
        raise HTTPException(400, f"{label}: end is before start")


def _checklist_task_type(wo: WorkOrder) -> str:
    return "INSPECTION" if wo.source == "INSPECTION" else "REPAIR"


def _checklist_state(db: Session, wo: WorkOrder) -> dict:
    machine = db.query(Machine).get(wo.machine_id)
    template = ce.applicable_template(db, machine, _checklist_task_type(wo))
    if not template:
        return {"template": None, "items": [], "blockers": [], "critical_fails": []}
    items = ce.active_items(db, template)
    rows = db.query(WorkOrderChecklistResponse).filter(WorkOrderChecklistResponse.work_order_id == wo.id).all()
    by_item = {r.checklist_template_item_id: r for r in rows}
    answers = {r.checklist_template_item_id: {"result": r.result, "reading": r.reading, "note": r.note} for r in rows}
    has_evidence = db.query(EvidenceFile).filter(EvidenceFile.entity_type == "work_order",
                                                 EvidenceFile.entity_id == wo.id).count() > 0
    ev = ce.evaluate(items, answers, has_evidence)
    out_items = []
    for i in items:
        r = by_item.get(i.id)
        out_items.append({**ce.item_dict(i), "result": r.result if r else None, "reading": r.reading if r else None,
                          "note": r.note if r else None})
    return {
        "template": {"id": template.id, "name": template.name, "version": template.version,
                     "task_type": template.task_type},
        "items": out_items, "blockers": ev["blockers"], "critical_fails": [i.text for i in ev["critical_fails"]],
    }


def completion_blockers(db: Session, wo: WorkOrder) -> list[str]:
    out = []
    if not (wo.repair_summary or "").strip():
        out.append("Write a repair summary")
    if wo.resolution_code not in RESOLUTION_CODES:
        out.append("Choose a resolution code")
    if not ((wo.diagnosis or wo.root_cause or "").strip()):
        out.append("Record the diagnosis")
    if not (wo.action_taken or "").strip():
        out.append("Record the action taken")
    if wo.downtime_minutes is None:
        out.append("Enter the downtime in minutes (0 if none)")
    has_labour = db.query(WorkOrderLabourEntry).filter(WorkOrderLabourEntry.work_order_id == wo.id).count() > 0
    if not has_labour and not (wo.labor_hours or 0) > 0:
        out.append("Record at least one labour entry")
    if (wo.loto_required or wo.permit_required) and not wo.safety_confirmed:
        out.append("Confirm the permit / lock-out tag-out was completed")
    out += _checklist_state(db, wo)["blockers"]
    return out


# ----------------------------------------------------------------- create / edit

class WorkOrderIn(BaseModel):
    machine_id: str
    title: str
    description: str | None = None
    priority: WorkOrderPriority = WorkOrderPriority.MEDIUM
    source: str | None = None
    breakdown_event_id: str | None = None
    pm_plan_id: str | None = None
    failure_category: str | None = None
    assigned_to: str | None = None
    supervisor_id: str | None = None
    due_date: date | None = None
    planned_start: datetime | None = None
    safety_risk: str | None = None
    permit_required: bool = False
    loto_required: bool = False
    estimated_hours: float | None = None
    estimated_cost: float | None = None


class WorkOrderUpdateIn(BaseModel):
    title: str | None = None
    description: str | None = None
    priority: WorkOrderPriority | None = None
    due_date: date | None = None
    planned_start: datetime | None = None
    failure_category: str | None = None
    supervisor_id: str | None = None
    safety_risk: str | None = None
    permit_required: bool | None = None
    loto_required: bool | None = None
    safety_confirmed: bool | None = None
    estimated_hours: float | None = None
    estimated_cost: float | None = None
    diagnosis: str | None = None
    action_taken: str | None = None
    repair_summary: str | None = None
    resolution_code: str | None = None
    root_cause: str | None = None
    downtime_minutes: int | None = None


@router.post("")
def create_wo(payload: WorkOrderIn, db: Session = Depends(get_db), user: Employee = Depends(LogRoles)):
    if not payload.title.strip():
        raise HTTPException(400, "Title cannot be empty")
    if payload.breakdown_event_id:
        bd = db.query(BreakdownEvent).get(payload.breakdown_event_id)
        if not bd:
            raise HTTPException(404, "Breakdown not found")
        if bd.machine_id != payload.machine_id:
            raise HTTPException(400, "That breakdown is for a different machine")
        dupe = db.query(WorkOrder).filter(WorkOrder.breakdown_event_id == bd.id, WorkOrder.cancelled.isnot(True),
                                          WorkOrder.status != WorkOrderStatus.CLOSED).first()
        if dupe:
            raise HTTPException(409, {"message": f"{bd.bd_number} already has an open work order (WO-{dupe.number}).",
                                      "existing_id": dupe.id})
    if payload.assigned_to and user.role == Role.TECHNICIAN and payload.assigned_to != user.id:
        raise HTTPException(403, "Only a supervisor, manager or admin can assign work to someone else")
    data = payload.model_dump()
    data["title"] = payload.title.strip()
    wo = create_work_order(db, user, **data)
    record_audit(db, action="WORK_ORDER_CREATED", entity_type="WorkOrder", entity_id=wo.id, actor_id=user.id,
                 new_value={"number": wo.number, "machine_id": payload.machine_id, "title": wo.title, "source": wo.source})
    return _serialize(wo, _employee_names(db, [wo]))


@router.put("/{work_order_id}")
def update_wo(work_order_id: str, payload: WorkOrderUpdateIn, db: Session = Depends(get_db),
              user: Employee = Depends(LogRoles)):
    wo = _get(db, work_order_id)
    _ensure_editable(wo)
    is_priv = user.role in (Role.SUPERVISOR, Role.MANAGER, Role.ADMIN)
    if not is_priv and wo.reported_by != user.id and wo.assigned_to != user.id:
        raise HTTPException(403, "You can only edit work orders you reported or are assigned to")
    req = payload.model_dump(exclude_unset=True)
    if "title" in req and not (req["title"] or "").strip():
        raise HTTPException(400, "Title cannot be empty")
    if req.get("failure_category") and req["failure_category"] not in FAILURE_CATEGORIES:
        raise HTTPException(400, f"failure_category must be one of {', '.join(FAILURE_CATEGORIES)}")
    if req.get("safety_risk") and req["safety_risk"] not in SAFETY_RISKS:
        raise HTTPException(400, f"safety_risk must be one of {', '.join(SAFETY_RISKS)}")
    if req.get("resolution_code") and req["resolution_code"] not in RESOLUTION_CODES:
        raise HTTPException(400, f"resolution_code must be one of {', '.join(RESOLUTION_CODES)}")
    if "downtime_minutes" in req and req["downtime_minutes"] is not None and req["downtime_minutes"] < 0:
        raise HTTPException(400, "Downtime cannot be negative")
    # Planning / safety-rule fields belong to supervisors; the person doing the job may only confirm safety.
    planning = {"priority", "supervisor_id", "safety_risk", "permit_required", "loto_required",
                "estimated_hours", "estimated_cost", "planned_start", "due_date"}
    if not is_priv and planning & set(req):
        raise HTTPException(403, "Only a supervisor, manager or admin can change planning and safety-rule fields")
    old = {k: str(getattr(wo, k)) for k in req}
    for k, v in req.items():
        setattr(wo, k, v)
    db.commit()
    record_audit(db, action="WORK_ORDER_UPDATED", entity_type="WorkOrder", entity_id=wo.id, actor_id=user.id,
                 old_value=old, new_value={k: str(getattr(wo, k)) for k in req})
    return _serialize(wo, _employee_names(db, [wo]))


class WorkOrderAssignIn(BaseModel):
    assigned_to: str


@router.post("/{work_order_id}/assign")
def assign_wo(work_order_id: str, payload: WorkOrderAssignIn, db: Session = Depends(get_db),
              user: Employee = Depends(LogRoles)):
    wo = _get(db, work_order_id)
    _ensure_editable(wo)
    if not db.query(Employee).get(payload.assigned_to):
        raise HTTPException(404, "Assignee not found")
    if user.role == Role.TECHNICIAN and payload.assigned_to != user.id:
        raise HTTPException(403, "Only a supervisor, manager or admin can assign work to someone else")
    old = wo.assigned_to
    wo.assigned_to = payload.assigned_to
    if wo.status == S.OPEN:
        wo.status = S.ASSIGNED
    log_event(db, wo.id, "ASSIGNED", user.id, note=f"assigned_to={payload.assigned_to}")
    db.commit()
    record_audit(db, action="WORK_ORDER_ASSIGNED", entity_type="WorkOrder", entity_id=wo.id, actor_id=user.id,
                 old_value={"assigned_to": old}, new_value={"assigned_to": payload.assigned_to})
    return _serialize(wo, _employee_names(db, [wo]))


# ----------------------------------------------------------------- status lifecycle

class WorkOrderStatusIn(BaseModel):
    status: WorkOrderStatus
    reason: str | None = None            # waiting reason, or why work was sent back
    note: str | None = None
    restored_at: datetime | None = None
    restore_machine: bool = False        # also mark the linked breakdown as machine-restored
    # legacy fields (older screens)
    root_cause: str | None = None
    five_whys: list[dict] | None = None
    action_taken: str | None = None
    parts_used: str | None = None
    labor_hours: int | None = None
    downtime_minutes: int | None = None


def _transition(db: Session, wo: WorkOrder, user: Employee, to: WorkOrderStatus, reason=None, note=None,
                restored_at=None, restore_machine=False) -> WorkOrder:
    frm = wo.status
    if wo.cancelled:
        raise HTTPException(400, "This work order was cancelled")
    if to == frm:
        return wo
    if to not in FORWARD_TRANSITIONS.get(frm, set()):
        raise HTTPException(400, f"Cannot move work order from {frm.value} to {to.value}")
    is_editor = user.role in (Role.SUPERVISOR, Role.MANAGER, Role.ADMIN)
    now = datetime.utcnow()
    event = "STATUS"

    if to in (S.IN_PROGRESS, S.WAITING_PARTS, S.WAITING_APPROVAL, S.COMPLETED) and not _can_work(user, wo):
        raise HTTPException(403, "This work order is assigned to someone else")

    if to == S.IN_PROGRESS and frm in (S.OPEN, S.ASSIGNED):
        if not wo.assigned_to:
            if user.role == Role.TECHNICIAN:
                wo.assigned_to = user.id
            else:
                raise HTTPException(400, "Assign a technician before starting work")
        if (wo.loto_required or wo.permit_required) and not wo.safety_confirmed:
            raise HTTPException(400, {"message": "Safety steps are not confirmed",
                                      "blockers": ["Confirm the permit / lock-out tag-out before starting work"]})
        wo.started_at = wo.started_at or now
        event = "START"
    elif to == S.IN_PROGRESS and frm in (S.WAITING_PARTS, S.WAITING_APPROVAL):
        wo.waiting_reason = None
        event = "RESUME"
    elif to == S.IN_PROGRESS and frm == S.COMPLETED:
        if not is_editor:
            raise HTTPException(403, "Only a supervisor, manager or admin can send completed work back")
        if not (reason or note or "").strip():
            raise HTTPException(400, "Give a reason for sending this work back")
        wo.completed_at = wo.completed_by = None
        event = "REJECTED"
    elif to in (S.WAITING_PARTS, S.WAITING_APPROVAL):
        reason = (reason or ("PARTS" if to == S.WAITING_PARTS else "")).upper()
        allowed = ("PARTS",) if to == S.WAITING_PARTS else tuple(r for r in WAIT_REASONS if r != "PARTS")
        if reason not in allowed:
            raise HTTPException(400, f"Waiting reason must be one of: {', '.join(allowed)}")
        wo.waiting_reason = reason
        event = "PAUSE"
    elif to == S.COMPLETED:
        problems = completion_blockers(db, wo)
        if problems:
            raise HTTPException(400, {"message": "This work order cannot be completed yet", "blockers": problems})
        restored = restored_at or now
        _check_times(wo.started_at or wo.created_at, restored, "Restoration time")
        wo.completed_at, wo.completed_by, wo.restored_at = now, user.id, restored
        wo.waiting_reason = None
        if restore_machine and wo.breakdown_event_id:
            bd = db.query(BreakdownEvent).get(wo.breakdown_event_id)
            if bd and bd.status != "CLOSED":
                if bd.resumed_at is None:
                    bd.resumed_at = restored
                    bd.repaired_by = bd.repaired_by or user.id
                bd.corrective_action = bd.corrective_action or wo.repair_summary
                if bd.status in ("REPORTED", "UNDER_DIAGNOSIS", "REPAIR_IN_PROGRESS"):
                    bd.status = "AWAITING_VERIFICATION"
                record_audit(db, action="BREAKDOWN_RESTORED_FROM_WO", entity_type="BreakdownEvent", entity_id=bd.id,
                             actor_id=user.id, new_value={"work_order": f"WO-{wo.number}", "resumed_at": str(restored)},
                             commit=False)
        event = "FINISH"
    elif to == S.VERIFIED:
        if not is_editor:
            raise HTTPException(403, "Only a supervisor, manager or admin can verify a work order")
        if wo.completed_by == user.id and user.role != Role.ADMIN and _requires_verification(db, wo):
            raise HTTPException(403, "This job needs verification by someone other than the person who completed it")
        wo.verified_by = user.id
        event = "VERIFY"
    elif to == S.CLOSED:
        if frm == S.COMPLETED and _requires_verification(db, wo):
            raise HTTPException(400, "This is a critical / safety job - it must be verified by a supervisor before closing")
        if not is_editor:
            raise HTTPException(403, "Only a supervisor, manager or admin can close a work order")
        wo.closed_at = now
        event = "CLOSE"

    wo.status = to
    log_event(db, wo.id, event, user.id, frm.value, to.value, reason=reason, note=note)
    return wo


@router.post("/{work_order_id}/status")
def update_wo_status(work_order_id: str, payload: WorkOrderStatusIn, db: Session = Depends(get_db),
                     user: Employee = Depends(LogRoles)):
    wo = _get(db, work_order_id, lock=True)
    old = wo.status.value
    # Save the descriptive fields the screen sent, then check the rules against them.
    if wo.status not in LOCKED:
        for f in ("root_cause", "five_whys", "action_taken", "parts_used", "labor_hours", "downtime_minutes"):
            v = getattr(payload, f)
            if v is not None:
                setattr(wo, f, v)
    _transition(db, wo, user, payload.status, payload.reason, payload.note, payload.restored_at, payload.restore_machine)
    db.commit()
    record_audit(db, action="WORK_ORDER_STATUS_CHANGED", entity_type="WorkOrder", entity_id=wo.id, actor_id=user.id,
                 old_value={"status": old}, new_value={"status": wo.status.value, "reason": payload.reason,
                                                        "note": payload.note})
    return _serialize(wo, _employee_names(db, [wo]))


class WorkLogIn(BaseModel):
    event: str            # START | PAUSE | RESUME | FINISH
    reason: str | None = None
    note: str | None = None
    restored_at: datetime | None = None
    restore_machine: bool = False


@router.post("/{work_order_id}/worklog")
def work_log(work_order_id: str, payload: WorkLogIn, db: Session = Depends(get_db), user: Employee = Depends(LogRoles)):
    """Start / pause / resume / finish buttons - each is a validated status move with a timestamp."""
    wo = _get(db, work_order_id, lock=True)
    ev = payload.event.upper()
    if ev not in ("START", "PAUSE", "RESUME", "FINISH"):
        raise HTTPException(400, "event must be START, PAUSE, RESUME or FINISH")
    old = wo.status.value
    if ev in ("START", "RESUME"):
        to = S.IN_PROGRESS
    elif ev == "FINISH":
        to = S.COMPLETED
    else:
        to = S.WAITING_PARTS if (payload.reason or "").upper() == "PARTS" else S.WAITING_APPROVAL
    _transition(db, wo, user, to, payload.reason, payload.note, payload.restored_at, payload.restore_machine)
    db.commit()
    record_audit(db, action="WORK_ORDER_STATUS_CHANGED", entity_type="WorkOrder", entity_id=wo.id, actor_id=user.id,
                 old_value={"status": old}, new_value={"status": wo.status.value, "event": ev, "reason": payload.reason})
    return _serialize(wo, _employee_names(db, [wo]))


class ReasonIn(BaseModel):
    reason: str


@router.post("/{work_order_id}/cancel")
def cancel_wo(work_order_id: str, payload: ReasonIn, db: Session = Depends(get_db), user: Employee = Depends(EditRoles)):
    wo = _get(db, work_order_id, lock=True)
    if wo.cancelled or wo.status in LOCKED or wo.status == S.COMPLETED:
        raise HTTPException(400, "Only a work order that is not yet completed can be cancelled")
    if len((payload.reason or "").strip()) < 5:
        raise HTTPException(400, "Cancellation needs a reason (at least a few words)")
    old = wo.status.value
    wo.cancelled, wo.cancel_reason = True, payload.reason.strip()
    wo.status, wo.closed_at = S.CLOSED, datetime.utcnow()
    log_event(db, wo.id, "CANCEL", user.id, old, S.CLOSED.value, note=wo.cancel_reason)
    db.commit()
    record_audit(db, action="WORK_ORDER_CANCELLED", entity_type="WorkOrder", entity_id=wo.id, actor_id=user.id,
                 old_value={"status": old}, new_value={"reason": wo.cancel_reason})
    return _serialize(wo, _employee_names(db, [wo]))


@router.post("/{work_order_id}/reopen")
def reopen_wo(work_order_id: str, payload: ReasonIn, db: Session = Depends(get_db), user: Employee = Depends(ManagerRoles)):
    wo = _get(db, work_order_id, lock=True)
    if wo.cancelled:
        raise HTTPException(400, "A cancelled work order cannot be reopened - raise a new one")
    if wo.status not in (S.COMPLETED, S.VERIFIED, S.CLOSED):
        raise HTTPException(400, "Only completed, verified or closed work orders can be reopened")
    if len((payload.reason or "").strip()) < 5:
        raise HTTPException(400, "Reopening needs a reason (at least a few words)")
    old = wo.status.value
    wo.status = S.IN_PROGRESS
    wo.reopen_count = (wo.reopen_count or 0) + 1
    wo.closed_at = wo.completed_at = wo.completed_by = wo.verified_by = None
    log_event(db, wo.id, "REOPEN", user.id, old, S.IN_PROGRESS.value, note=payload.reason.strip())
    db.commit()
    record_audit(db, action="WORK_ORDER_REOPENED", entity_type="WorkOrder", entity_id=wo.id, actor_id=user.id,
                 old_value={"status": old}, new_value={"status": "IN_PROGRESS", "reason": payload.reason.strip()})
    return _serialize(wo, _employee_names(db, [wo]))


# ----------------------------------------------------------------- labour

class LabourIn(BaseModel):
    technician_id: str | None = None
    started_at: datetime | None = None
    ended_at: datetime | None = None
    hours: float | None = None
    note: str | None = None


def _sync_hours(db: Session, wo: WorkOrder):
    total = db.query(func.coalesce(func.sum(WorkOrderLabourEntry.hours), 0)).filter(
        WorkOrderLabourEntry.work_order_id == wo.id).scalar() or 0
    wo.labor_hours = int(round(total))


@router.post("/{work_order_id}/labour")
def add_labour(work_order_id: str, payload: LabourIn, db: Session = Depends(get_db), user: Employee = Depends(LogRoles)):
    wo = _get(db, work_order_id, lock=True)
    _ensure_editable(wo)
    tech_id = payload.technician_id or user.id
    tech = db.query(Employee).get(tech_id)
    if not tech:
        raise HTTPException(404, "Technician not found")
    if tech_id != user.id and user.role not in (Role.SUPERVISOR, Role.MANAGER, Role.ADMIN):
        raise HTTPException(403, "You can only record your own labour time")
    if payload.started_at and payload.ended_at:
        _check_times(payload.started_at, payload.ended_at, "Labour time")
        hours = (payload.ended_at - payload.started_at).total_seconds() / 3600
    elif payload.hours is not None:
        hours = payload.hours
    else:
        raise HTTPException(400, "Give either start and end times, or the hours worked")
    hours = round(hours, 2)
    if not (0 < hours <= 24):
        raise HTTPException(400, "Hours must be more than 0 and at most 24 per entry")
    if payload.started_at:
        dupe = db.query(WorkOrderLabourEntry).filter(
            WorkOrderLabourEntry.work_order_id == wo.id, WorkOrderLabourEntry.technician_id == tech_id,
            WorkOrderLabourEntry.started_at == payload.started_at, WorkOrderLabourEntry.ended_at == payload.ended_at).first()
        if dupe:
            raise HTTPException(409, "This labour entry was already recorded")
    rate = tech.hourly_rate if tech.hourly_rate is not None else float(get_setting(db, "labor_hour_cost") or 0)
    entry = WorkOrderLabourEntry(work_order_id=wo.id, technician_id=tech_id, started_at=payload.started_at,
                                 ended_at=payload.ended_at, hours=hours, hourly_rate=rate, note=payload.note,
                                 created_by=user.id)
    db.add(entry)
    db.flush()
    _sync_hours(db, wo)
    log_event(db, wo.id, "LABOUR", user.id, note=f"{tech.name}: {hours} h")
    db.commit()
    record_audit(db, action="WORK_ORDER_LABOUR_ADDED", entity_type="WorkOrder", entity_id=wo.id, actor_id=user.id,
                 new_value={"technician": tech.name, "hours": hours, "rate": rate})
    return {"id": entry.id, "hours": hours, "hourly_rate": rate, "cost": round(hours * rate, 2)}


@router.delete("/{work_order_id}/labour/{labour_id}")
def delete_labour(work_order_id: str, labour_id: str, db: Session = Depends(get_db), user: Employee = Depends(LogRoles)):
    wo = _get(db, work_order_id, lock=True)
    _ensure_editable(wo)
    e = db.query(WorkOrderLabourEntry).filter(WorkOrderLabourEntry.id == labour_id,
                                              WorkOrderLabourEntry.work_order_id == wo.id).first()
    if not e:
        raise HTTPException(404, "Labour entry not found")
    if e.created_by != user.id and user.role not in (Role.SUPERVISOR, Role.MANAGER, Role.ADMIN):
        raise HTTPException(403, "You can only remove labour entries you recorded")
    info = {"technician_id": e.technician_id, "hours": e.hours}
    db.delete(e)
    db.flush()
    _sync_hours(db, wo)
    log_event(db, wo.id, "LABOUR_REMOVED", user.id, note=f"{e.hours} h")
    db.commit()
    record_audit(db, action="WORK_ORDER_LABOUR_REMOVED", entity_type="WorkOrder", entity_id=wo.id, actor_id=user.id,
                 old_value=info)
    return {"success": True}


# ----------------------------------------------------------------- costs

COST_CATEGORIES = ("EXTERNAL_SERVICE", "CONSUMABLE", "OTHER")


class CostIn(BaseModel):
    category: str
    description: str
    amount: float
    tax_amount: float = 0
    vendor: str | None = None
    invoice_ref: str | None = None


@router.post("/{work_order_id}/costs")
def add_cost(work_order_id: str, payload: CostIn, db: Session = Depends(get_db), user: Employee = Depends(LogRoles)):
    wo = _get(db, work_order_id, lock=True)
    _ensure_editable(wo)
    if payload.category not in COST_CATEGORIES:
        raise HTTPException(400, f"category must be one of {', '.join(COST_CATEGORIES)}")
    if not payload.description.strip():
        raise HTTPException(400, "Describe the cost")
    if payload.amount <= 0 or payload.tax_amount < 0:
        raise HTTPException(400, "Amount must be more than 0 and tax cannot be negative")
    if payload.category == "EXTERNAL_SERVICE" and not (payload.vendor or "").strip():
        raise HTTPException(400, "Enter the vendor for an external service")
    c = WorkOrderCost(work_order_id=wo.id, category=payload.category, description=payload.description.strip(),
                      amount=payload.amount, tax_amount=payload.tax_amount, vendor=payload.vendor,
                      invoice_ref=payload.invoice_ref, currency=get_setting(db, "currency") or "INR",
                      recorded_by=user.id)
    db.add(c)
    log_event(db, wo.id, "COST_ADDED", user.id, note=f"{payload.category}: {payload.amount}")
    db.commit()
    record_audit(db, action="WORK_ORDER_COST_ADDED", entity_type="WorkOrder", entity_id=wo.id, actor_id=user.id,
                 new_value={"category": c.category, "amount": c.amount, "vendor": c.vendor})
    return {"id": c.id}


@router.post("/{work_order_id}/costs/{cost_id}/approve")
def approve_cost(work_order_id: str, cost_id: str, db: Session = Depends(get_db), user: Employee = Depends(EditRoles)):
    wo = _get(db, work_order_id, lock=True)
    c = db.query(WorkOrderCost).filter(WorkOrderCost.id == cost_id, WorkOrderCost.work_order_id == wo.id).first()
    if not c:
        raise HTTPException(404, "Cost not found")
    if c.approved_at:
        return {"id": c.id, "approved": True}
    total = (c.amount or 0) + (c.tax_amount or 0)
    if total > float(get_setting(db, "cost_approval_manager_threshold") or 0) and user.role not in (Role.MANAGER, Role.ADMIN):
        raise HTTPException(403, "This amount needs approval from a manager or admin")
    if c.recorded_by == user.id and user.role != Role.ADMIN:
        raise HTTPException(403, "Costs must be approved by someone other than the person who entered them")
    c.approved_by, c.approved_at = user.id, datetime.utcnow()
    db.commit()
    record_audit(db, action="WORK_ORDER_COST_APPROVED", entity_type="WorkOrder", entity_id=wo.id, actor_id=user.id,
                 new_value={"cost_id": c.id, "amount": total})
    return {"id": c.id, "approved": True}


@router.delete("/{work_order_id}/costs/{cost_id}")
def delete_cost(work_order_id: str, cost_id: str, db: Session = Depends(get_db), user: Employee = Depends(LogRoles)):
    wo = _get(db, work_order_id, lock=True)
    _ensure_editable(wo)
    c = db.query(WorkOrderCost).filter(WorkOrderCost.id == cost_id, WorkOrderCost.work_order_id == wo.id).first()
    if not c:
        raise HTTPException(404, "Cost not found")
    if c.approved_at and user.role not in (Role.MANAGER, Role.ADMIN):
        raise HTTPException(403, "Only a manager or admin can remove an approved cost")
    if not c.approved_at and c.recorded_by != user.id and user.role not in (Role.SUPERVISOR, Role.MANAGER, Role.ADMIN):
        raise HTTPException(403, "You can only remove costs you entered")
    info = {"category": c.category, "amount": c.amount, "approved": bool(c.approved_at)}
    db.delete(c)
    db.commit()
    record_audit(db, action="WORK_ORDER_COST_REMOVED", entity_type="WorkOrder", entity_id=wo.id, actor_id=user.id,
                 old_value=info)
    return {"success": True}


# ----------------------------------------------------------------- parts

class PartMoveIn(BaseModel):
    spare_part_id: str
    quantity: int
    reason: str | None = None
    request_id: str | None = None   # send the same id again and the move is NOT repeated


# Kept under the old name too - some screens import it.
WorkOrderPartConsumeIn = PartMoveIn


def _existing_move(db: Session, key: str | None):
    return db.query(SparePartTransaction).filter(SparePartTransaction.idempotency_key == key).first() if key else None


@router.get("/{work_order_id}/parts")
def list_consumed_parts(work_order_id: str, db: Session = Depends(get_db), _user=Depends(ViewRoles)):
    if not db.query(WorkOrder).get(work_order_id):
        raise HTTPException(404, "Work order not found")
    lines = parts_for_work_orders(db, [work_order_id])
    return [{**l, "part_name": l["part_name"]} for l in reversed(lines)]


@router.post("/{work_order_id}/consume-part")
def consume_part(work_order_id: str, payload: PartMoveIn, db: Session = Depends(get_db), user: Employee = Depends(LogRoles)):
    wo = _get(db, work_order_id, lock=True)
    _ensure_editable(wo)
    if payload.quantity <= 0:
        raise HTTPException(400, "Quantity must be positive")
    if wo.status in (S.OPEN, S.ASSIGNED):
        raise HTTPException(400, "Start the work order before booking parts to it")
    key = f"wo:{wo.id}:{payload.request_id}"[:100] if payload.request_id else None
    if _existing_move(db, key):
        return _serialize(wo, _employee_names(db, [wo]))   # repeated request - already done
    part = db.query(SparePart).filter(SparePart.id == payload.spare_part_id).with_for_update().first()
    if not part:
        raise HTTPException(404, "Spare part not found")
    available = part.stock_on_hand - (part.reserved_stock or 0)
    if payload.quantity > available:
        raise HTTPException(400, f"Only {available} {part.unit} of {part.name} available (stock {part.stock_on_hand}, reserved {part.reserved_stock or 0})")

    part.stock_on_hand -= payload.quantity
    db.add(SparePartTransaction(
        spare_part_id=part.id, work_order_id=wo.id, breakdown_event_id=wo.breakdown_event_id,
        change=-payload.quantity, txn_type="CONSUME", unit_cost=part.unit_cost, idempotency_key=key,
        reason=payload.reason or f"Consumed on WO-{wo.number}", performed_by=user.id))
    note = f"{part.part_code} x{payload.quantity}"
    wo.parts_used = f"{wo.parts_used}, {note}" if wo.parts_used else note
    log_event(db, wo.id, "PART_CONSUMED", user.id, note=note)
    try:
        db.commit()
    except IntegrityError:   # the same request arrived twice at the same moment
        db.rollback()
        return _serialize(_get(db, work_order_id), _employee_names(db, [wo]))
    record_audit(db, action="WORK_ORDER_PART_CONSUMED", entity_type="WorkOrder", entity_id=wo.id, actor_id=user.id,
                 new_value={"spare_part_id": part.id, "quantity": payload.quantity, "unit_cost": part.unit_cost})
    return _serialize(wo, _employee_names(db, [wo]))


@router.post("/{work_order_id}/return-part")
def return_part(work_order_id: str, payload: PartMoveIn, db: Session = Depends(get_db), user: Employee = Depends(LogRoles)):
    """Put unused parts back in stock - at the price they were originally issued at."""
    wo = _get(db, work_order_id, lock=True)
    _ensure_editable(wo)
    if payload.quantity <= 0:
        raise HTTPException(400, "Quantity must be positive")
    key = f"wo:{wo.id}:ret:{payload.request_id}"[:100] if payload.request_id else None
    if _existing_move(db, key):
        return _serialize(wo, _employee_names(db, [wo]))
    part = db.query(SparePart).filter(SparePart.id == payload.spare_part_id).with_for_update().first()
    if not part:
        raise HTTPException(404, "Spare part not found")
    lines = [l for l in parts_for_work_orders(db, [wo.id]) if l["spare_part_id"] == part.id]
    consumed = sum(l["quantity"] for l in lines if l["kind"] == "CONSUME")
    returned = -sum(l["quantity"] for l in lines if l["kind"] == "RETURN")
    if payload.quantity > consumed - returned:
        raise HTTPException(400, f"Only {consumed - returned} of this part is currently booked to this work order")
    spent = sum(l["cost"] for l in lines if l["kind"] == "CONSUME")
    unit = (spent / consumed) if consumed else part.unit_cost
    part.stock_on_hand += payload.quantity
    db.add(SparePartTransaction(
        spare_part_id=part.id, work_order_id=wo.id, breakdown_event_id=wo.breakdown_event_id,
        change=payload.quantity, txn_type="RETURN", unit_cost=unit, idempotency_key=key,
        reason=payload.reason or f"Returned from WO-{wo.number}", performed_by=user.id))
    log_event(db, wo.id, "PART_RETURNED", user.id, note=f"{part.part_code} x{payload.quantity}")
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        return _serialize(_get(db, work_order_id), _employee_names(db, [wo]))
    record_audit(db, action="WORK_ORDER_PART_RETURNED", entity_type="WorkOrder", entity_id=wo.id, actor_id=user.id,
                 new_value={"spare_part_id": part.id, "quantity": payload.quantity})
    return _serialize(wo, _employee_names(db, [wo]))


# ----------------------------------------------------------------- checklist

class ChecklistAnswerIn(BaseModel):
    item_id: str
    result: str          # PASS | FAIL | NA
    reading: str | None = None
    note: str | None = None


class ChecklistIn(BaseModel):
    answers: list[ChecklistAnswerIn]


@router.get("/{work_order_id}/checklist")
def get_checklist(work_order_id: str, db: Session = Depends(get_db), _user=Depends(ViewRoles)):
    return _checklist_state(db, _get(db, work_order_id))


@router.post("/{work_order_id}/checklist")
def save_checklist(work_order_id: str, payload: ChecklistIn, db: Session = Depends(get_db),
                   user: Employee = Depends(LogRoles)):
    wo = _get(db, work_order_id, lock=True)
    _ensure_editable(wo)
    if wo.status not in WORKING and wo.status != S.COMPLETED:
        raise HTTPException(400, "Start the work order before filling in the checklist")
    if not _can_work(user, wo):
        raise HTTPException(403, "This work order is assigned to someone else")
    machine = db.query(Machine).get(wo.machine_id)
    template = ce.applicable_template(db, machine, _checklist_task_type(wo))
    if not template:
        raise HTTPException(400, "No checklist is configured for this machine and job type")
    items = {i.id: i for i in ce.active_items(db, template)}
    try:
        ce.normalise_answers([a.model_dump() for a in payload.answers])
    except ValueError as exc:
        raise HTTPException(400, str(exc))
    created = []
    for a in payload.answers:
        item = items.get(a.item_id)
        if not item:
            raise HTTPException(400, "That checklist item does not belong to this machine's current checklist")
        result = a.result.upper()
        row = db.query(WorkOrderChecklistResponse).filter(
            WorkOrderChecklistResponse.work_order_id == wo.id,
            WorkOrderChecklistResponse.checklist_template_item_id == item.id).first()
        if not row:
            row = WorkOrderChecklistResponse(work_order_id=wo.id, checklist_template_item_id=item.id, result=result)
            db.add(row)
        row.result, row.reading, row.note = result, (a.reading or "").strip() or None, a.note
        row.item_text, row.item_required, row.template_version = item.text, bool(item.required), template.version
        row.performed_by, row.performed_at = user.id, datetime.utcnow()
        # A failed CRITICAL check raises a linked corrective work order (once).
        if item.critical and result == "FAIL":
            title = f"Corrective: {item.text}"[:255]
            exists = db.query(WorkOrder).filter(WorkOrder.parent_work_order_id == wo.id, WorkOrder.title == title).first()
            if not exists:
                child = create_work_order(
                    db, user, machine_id=wo.machine_id, title=title, source="INSPECTION", priority="HIGH",
                    parent_work_order_id=wo.id, breakdown_event_id=wo.breakdown_event_id,
                    description=f"Critical checklist item failed on WO-{wo.number}: {item.text}. {a.note or ''}".strip(),
                    failure_category=wo.failure_category)
                created.append(f"WO-{child.number}")
                record_audit(db, action="WORK_ORDER_CREATED", entity_type="WorkOrder", entity_id=child.id,
                             actor_id=user.id, new_value={"from_failed_check": item.text, "parent": f"WO-{wo.number}"})
    log_event(db, wo.id, "CHECKLIST", user.id, note=f"{len(payload.answers)} answers (v{template.version})")
    db.commit()
    record_audit(db, action="WORK_ORDER_CHECKLIST_SAVED", entity_type="WorkOrder", entity_id=wo.id, actor_id=user.id,
                 new_value={"template": template.name, "version": template.version, "answers": len(payload.answers)})
    state = _checklist_state(db, wo)
    state["created_work_orders"] = created
    return state


# ----------------------------------------------------------------- lists / search / detail

def _wo_filtered(db: Session, *, q, status, priority, source, machine_id, assigned_to, overdue_only,
                 date_basis, preset, date_from, date_to):
    rep, asg = aliased(Employee), aliased(Employee)
    query = (db.query(WorkOrder).join(Machine, Machine.id == WorkOrder.machine_id)
             .outerjoin(rep, rep.id == WorkOrder.reported_by).outerjoin(asg, asg.id == WorkOrder.assigned_to))
    if machine_id:
        query = query.filter(WorkOrder.machine_id == machine_id)
    if status:
        query = query.filter(WorkOrder.status == status)
    if priority:
        query = query.filter(WorkOrder.priority == priority)
    if source:
        query = query.filter(WorkOrder.source == source)
    if assigned_to:
        query = query.filter(WorkOrder.assigned_to == assigned_to)
    if overdue_only:
        query = query.filter(WorkOrder.due_date < today_local(),
                             WorkOrder.status.notin_((S.COMPLETED, S.VERIFIED, S.CLOSED)))
    if q and q.strip():
        term = q.strip()
        like = f"%{term}%"
        digits = term.upper().replace("WO-", "").replace("WO", "").strip()
        conds = [Machine.machine_number.ilike(like), Machine.machine_name.ilike(like), Machine.location.ilike(like),
                 WorkOrder.title.ilike(like), WorkOrder.root_cause.ilike(like), WorkOrder.diagnosis.ilike(like),
                 WorkOrder.repair_summary.ilike(like), rep.name.ilike(like), asg.name.ilike(like)]
        if digits.isdigit():
            conds.append(WorkOrder.number == int(digits))
        query = query.filter(or_(*conds))
    start, end = resolve_range(preset, date_from, date_to)
    basis = date_basis or "created"
    cols = {"created": (WorkOrder.created_at, True), "scheduled": (WorkOrder.planned_start, True),
            "due": (WorkOrder.due_date, False), "completed": (WorkOrder.completed_at, True),
            "closed": (WorkOrder.closed_at, True)}
    if basis not in cols:
        raise HTTPException(400, "date_basis must be created, scheduled, due, completed or closed")
    col, is_dt = cols[basis]
    return apply_date_range(query, col, start, end, is_datetime=is_dt)


def _wo_rows(db: Session, sort: str, with_cost: bool, **f):
    orders = _wo_filtered(db, **f).all()
    names = _employee_names(db, orders)
    machines = {m.id: m for m in db.query(Machine).filter(Machine.id.in_({o.machine_id for o in orders})).all()} if orders else {}
    today = today_local()
    rows = []
    for o in orders:
        r = _serialize(o, names)
        m = machines.get(o.machine_id)
        r.update({"machine_number": m.machine_number if m else None, "machine_name": m.machine_name if m else None,
                  "location": m.location if m else None, "priority_value": o.priority.value if o.priority else None,
                  "status_value": o.status.value,
                  "overdue": bool(o.due_date and o.due_date < today and o.status not in (S.COMPLETED, S.VERIFIED, S.CLOSED))})
        rows.append(r)
    rank = {"CRITICAL": 4, "HIGH": 3, "MEDIUM": 2, "LOW": 1}
    sort = sort or "newest"
    if with_cost or sort == "cost":
        by_id = {o.id: o for o in orders}
        for r in rows:
            r["actual_cost"] = work_order_cost(db, by_id[r["id"]])["actual_total"]
    if sort == "oldest":
        rows.sort(key=lambda r: r["created_at"])
    elif sort == "newest":
        rows.sort(key=lambda r: r["created_at"], reverse=True)
    elif sort == "priority":
        rows.sort(key=lambda r: (-rank.get(r["priority_value"], 0), r["created_at"]))
    elif sort == "cost":
        rows.sort(key=lambda r: -(r.get("actual_cost") or 0))
    elif sort == "downtime":
        rows.sort(key=lambda r: -(r["downtime_minutes"] or 0))
    else:
        raise HTTPException(400, "sort must be newest, oldest, priority, cost or downtime")
    return rows


@router.get("/search")
def search_work_orders(
    q: str | None = None, status: WorkOrderStatus | None = None, priority: WorkOrderPriority | None = None,
    source: str | None = None, machine_id: str | None = None, assigned_to: str | None = None,
    overdue_only: bool = False, date_basis: str = "created", date_preset: str | None = None,
    date_from: date | None = None, date_to: date | None = None, sort: str = "newest",
    page: int = 1, page_size: int = 25,
    db: Session = Depends(get_db), _user=Depends(ViewRoles),
):
    rows = _wo_rows(db, sort, False, q=q, status=status, priority=priority, source=source, machine_id=machine_id,
                    assigned_to=assigned_to, overdue_only=overdue_only, date_basis=date_basis, preset=date_preset,
                    date_from=date_from, date_to=date_to)
    page, page_size = page_params(page, page_size)
    total = len(rows)
    pages = max(1, -(-total // page_size))
    page = min(page, pages)
    items = rows[(page - 1) * page_size: page * page_size]
    if "actual_cost" not in (items[0] if items else {}):
        by_id = {o.id: o for o in db.query(WorkOrder).filter(WorkOrder.id.in_([i["id"] for i in items])).all()} if items else {}
        for r in items:
            r["actual_cost"] = work_order_cost(db, by_id[r["id"]])["actual_total"]
    sr, er = resolve_range(date_preset, date_from, date_to)
    return {
        "items": items, "total": total, "page": page, "page_size": page_size, "pages": pages,
        "range": {"from": sr, "to": er, "basis": date_basis},
        "summary": {
            "total": total,
            "open": sum(1 for r in rows if r["status_value"] not in ("COMPLETED", "VERIFIED", "CLOSED")),
            "overdue": sum(1 for r in rows if r["overdue"]),
            "completed": sum(1 for r in rows if r["status_value"] in ("COMPLETED", "VERIFIED", "CLOSED") and not r["cancelled"]),
            "downtime_hours": round(sum((r["downtime_minutes"] or 0) for r in rows) / 60, 1),
        },
    }


@router.get("/export")
def export_work_orders(
    q: str | None = None, status: WorkOrderStatus | None = None, priority: WorkOrderPriority | None = None,
    source: str | None = None, machine_id: str | None = None, assigned_to: str | None = None,
    overdue_only: bool = False, date_basis: str = "created", date_preset: str | None = None,
    date_from: date | None = None, date_to: date | None = None, sort: str = "newest", format: str = "csv",
    db: Session = Depends(get_db), user: Employee = Depends(EditRoles),
):
    rows = _wo_rows(db, sort, True, q=q, status=status, priority=priority, source=source, machine_id=machine_id,
                    assigned_to=assigned_to, overdue_only=overdue_only, date_basis=date_basis, preset=date_preset,
                    date_from=date_from, date_to=date_to)
    record_audit(db, action="EXPORT_WORK_ORDERS", entity_type="WorkOrder", actor_id=user.id,
                 new_value={"rows": len(rows), "format": format})
    cols = [("display_number", "WO No"), ("machine_number", "Machine"), ("machine_name", "Machine name"),
            ("location", "Location"), ("title", "Title"), ("source", "Source"), ("priority_value", "Priority"),
            ("status_value", "Status"), ("assigned_to_name", "Assigned to"), ("created_at", "Created"),
            ("due_date", "Due"), ("completed_at", "Completed"), ("closed_at", "Closed"),
            ("downtime_minutes", "Downtime (min)"), ("labor_hours", "Labour (h)"), ("actual_cost", "Actual cost"),
            ("resolution_code", "Resolution"), ("repair_summary", "Repair summary")]
    return export_response(rows, cols, format, "work_orders")


@router.get("")
def list_work_orders(machine_id: str | None = None, status: WorkOrderStatus | None = None,
                     assigned_to: str | None = None, db: Session = Depends(get_db), _user=Depends(ViewRoles)):
    q = db.query(WorkOrder)
    if machine_id:
        q = q.filter(WorkOrder.machine_id == machine_id)
    if status:
        q = q.filter(WorkOrder.status == status)
    if assigned_to:
        q = q.filter(WorkOrder.assigned_to == assigned_to)
    orders = q.order_by(WorkOrder.created_at.desc()).all()
    names = _employee_names(db, orders)
    return [_serialize(wo, names) for wo in orders]


@router.get("/mine")
def list_my_work_orders(db: Session = Depends(get_db), user: Employee = Depends(LogRoles)):
    orders = (
        db.query(WorkOrder)
        .filter(WorkOrder.assigned_to == user.id, WorkOrder.status != WorkOrderStatus.CLOSED)
        .order_by(WorkOrder.due_date.asc().nullslast(), WorkOrder.created_at.desc())
        .all()
    )
    names = _employee_names(db, orders)
    return [_serialize(wo, names) for wo in orders]


@router.get("/{work_order_id}/detail")
def work_order_detail(work_order_id: str, db: Session = Depends(get_db), _user=Depends(ViewRoles)):
    wo = _get(db, work_order_id)
    machine = db.query(Machine).get(wo.machine_id)
    bd = db.query(BreakdownEvent).get(wo.breakdown_event_id) if wo.breakdown_event_id else None
    logs = db.query(WorkOrderLog).filter(WorkOrderLog.work_order_id == wo.id).order_by(WorkOrderLog.logged_at).all()
    labour = db.query(WorkOrderLabourEntry).filter(WorkOrderLabourEntry.work_order_id == wo.id).order_by(
        WorkOrderLabourEntry.created_at).all()
    costs = db.query(WorkOrderCost).filter(WorkOrderCost.work_order_id == wo.id).order_by(WorkOrderCost.recorded_at).all()
    evidence = db.query(EvidenceFile).filter(EvidenceFile.entity_type == "work_order", EvidenceFile.entity_id == wo.id) \
        .order_by(EvidenceFile.created_at).all()
    children = db.query(WorkOrder).filter(WorkOrder.parent_work_order_id == wo.id).all()
    names = _names(db, [i for x in (wo.reported_by, wo.assigned_to, wo.verified_by, wo.supervisor_id, wo.completed_by) for i in (x,)]
                   + [l.by_id for l in logs] + [e.technician_id for e in labour] + [c.recorded_by for c in costs]
                   + [c.approved_by for c in costs] + [e.uploaded_by for e in evidence])
    frm = wo.status
    allowed = sorted(s.value for s in FORWARD_TRANSITIONS.get(frm, set())) if not wo.cancelled else []
    return {
        "work_order": _serialize(wo, names),
        "machine": {"id": machine.id, "machine_number": machine.machine_number, "machine_name": machine.machine_name,
                    "location": machine.location, "critical": bool(machine.critical),
                    "machine_type": machine.machine_type} if machine else None,
        "breakdown": {"id": bd.id, "bd_number": bd.bd_number, "severity": bd.severity, "status": bd.status} if bd else None,
        "parent_work_order_id": wo.parent_work_order_id,
        "child_work_orders": [{"id": c.id, "display_number": f"WO-{c.number}", "title": c.title, "status": c.status.value}
                              for c in children],
        "logs": [{"id": l.id, "event": l.event, "from_status": l.from_status, "to_status": l.to_status,
                  "reason": l.reason, "note": l.note, "by_name": names.get(l.by_id), "at": l.logged_at} for l in logs],
        "labour": [{"id": e.id, "technician_id": e.technician_id, "technician_name": names.get(e.technician_id),
                    "started_at": e.started_at, "ended_at": e.ended_at, "hours": e.hours, "hourly_rate": e.hourly_rate,
                    "cost": round(e.hours * e.hourly_rate, 2), "note": e.note} for e in labour],
        "cost_items": [{"id": c.id, "category": c.category, "description": c.description, "amount": c.amount,
                        "tax_amount": c.tax_amount or 0, "vendor": c.vendor, "invoice_ref": c.invoice_ref,
                        "currency": c.currency, "recorded_by_name": names.get(c.recorded_by), "recorded_at": c.recorded_at,
                        "approved": bool(c.approved_at), "approved_by_name": names.get(c.approved_by),
                        "approved_at": c.approved_at} for c in costs],
        "parts": parts_for_work_orders(db, [wo.id]),
        "cost_summary": work_order_cost(db, wo),
        "checklist": _checklist_state(db, wo),
        "evidence": [{"id": e.id, "filename": e.filename, "content_type": e.content_type, "size_bytes": e.size_bytes,
                      "label": e.label, "uploaded_by_name": names.get(e.uploaded_by), "created_at": e.created_at}
                     for e in evidence],
        "allowed_next_statuses": allowed,
        "requires_verification": _requires_verification(db, wo),
        "completion_blockers": completion_blockers(db, wo) if frm in WORKING else [],
        "resolution_codes": list(RESOLUTION_CODES),
    }


@router.get("/{work_order_id}")
def get_work_order(work_order_id: str, db: Session = Depends(get_db), _user=Depends(ViewRoles)):
    wo = _get(db, work_order_id)
    return _serialize(wo, _employee_names(db, [wo]))
