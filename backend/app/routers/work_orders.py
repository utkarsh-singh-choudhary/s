from datetime import date, datetime

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.auth import require_roles
from app.core.audit import record_audit
from app.models.models import WorkOrder, WorkOrderStatus, WorkOrderPriority, Employee, Role, Machine, SparePart, SparePartTransaction

router = APIRouter(prefix="/api/work-orders", tags=["work-orders"])

LogRoles = require_roles(Role.TECHNICIAN, Role.SUPERVISOR, Role.MANAGER, Role.ADMIN)
ViewRoles = require_roles(Role.ADMIN, Role.MANAGER, Role.SUPERVISOR, Role.TECHNICIAN, Role.VIEWER)

WO_NUMBER_BASE = 10000

# A work order can only move forward through this sequence (or straight to
# CLOSED from any non-terminal state, e.g. "duplicate/cancelled") - keeps the
# status column meaningful instead of a free-for-all string.
FORWARD_TRANSITIONS = {
    WorkOrderStatus.OPEN: {WorkOrderStatus.ASSIGNED, WorkOrderStatus.IN_PROGRESS, WorkOrderStatus.CLOSED},
    WorkOrderStatus.ASSIGNED: {WorkOrderStatus.IN_PROGRESS, WorkOrderStatus.CLOSED},
    WorkOrderStatus.IN_PROGRESS: {WorkOrderStatus.WAITING_PARTS, WorkOrderStatus.WAITING_APPROVAL, WorkOrderStatus.COMPLETED, WorkOrderStatus.CLOSED},
    WorkOrderStatus.WAITING_PARTS: {WorkOrderStatus.IN_PROGRESS, WorkOrderStatus.CLOSED},
    WorkOrderStatus.WAITING_APPROVAL: {WorkOrderStatus.IN_PROGRESS, WorkOrderStatus.COMPLETED, WorkOrderStatus.CLOSED},
    WorkOrderStatus.COMPLETED: {WorkOrderStatus.VERIFIED, WorkOrderStatus.IN_PROGRESS},
    WorkOrderStatus.VERIFIED: {WorkOrderStatus.CLOSED},
    WorkOrderStatus.CLOSED: set(),
}


class WorkOrderIn(BaseModel):
    machine_id: str
    title: str
    description: str | None = None
    priority: WorkOrderPriority = WorkOrderPriority.MEDIUM
    breakdown_event_id: str | None = None
    pm_plan_id: str | None = None
    assigned_to: str | None = None
    due_date: date | None = None


class WorkOrderStatusIn(BaseModel):
    status: WorkOrderStatus
    root_cause: str | None = None
    five_whys: list[dict] | None = None
    action_taken: str | None = None
    parts_used: str | None = None
    labor_hours: int | None = None
    downtime_minutes: int | None = None


class WorkOrderPartConsumeIn(BaseModel):
    spare_part_id: str
    quantity: int
    reason: str | None = None


class WorkOrderAssignIn(BaseModel):
    assigned_to: str


def _serialize(wo: WorkOrder, names: dict) -> dict:
    return {
        "id": wo.id,
        "number": wo.number,
        "display_number": f"WO-{wo.number}",
        "machine_id": wo.machine_id,
        "breakdown_event_id": wo.breakdown_event_id,
        "pm_plan_id": wo.pm_plan_id,
        "title": wo.title,
        "description": wo.description,
        "priority": wo.priority,
        "status": wo.status,
        "reported_by": wo.reported_by,
        "reported_by_name": names.get(wo.reported_by),
        "assigned_to": wo.assigned_to,
        "assigned_to_name": names.get(wo.assigned_to),
        "due_date": wo.due_date,
        "root_cause": wo.root_cause,
        "five_whys": wo.five_whys,
        "action_taken": wo.action_taken,
        "parts_used": wo.parts_used,
        "labor_hours": wo.labor_hours,
        "downtime_minutes": wo.downtime_minutes,
        "closed_at": wo.closed_at,
        "verified_by": wo.verified_by,
        "verified_by_name": names.get(wo.verified_by),
        "created_at": wo.created_at,
        "updated_at": wo.updated_at,
    }


def _employee_names(db: Session, work_orders: list[WorkOrder]) -> dict:
    ids = set()
    for wo in work_orders:
        ids |= {wo.reported_by, wo.assigned_to, wo.verified_by}
    ids.discard(None)
    if not ids:
        return {}
    return {e.id: e.name for e in db.query(Employee).filter(Employee.id.in_(ids)).all()}


@router.get("")
def list_work_orders(
    machine_id: str | None = None,
    status: WorkOrderStatus | None = None,
    assigned_to: str | None = None,
    db: Session = Depends(get_db),
    _user=Depends(ViewRoles),
):
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
    """Work orders assigned to the logged-in technician, open ones first — feeds the /technician mobile view."""
    orders = (
        db.query(WorkOrder)
        .filter(WorkOrder.assigned_to == user.id, WorkOrder.status != WorkOrderStatus.CLOSED)
        .order_by(WorkOrder.due_date.asc().nullslast(), WorkOrder.created_at.desc())
        .all()
    )
    names = _employee_names(db, orders)
    return [_serialize(wo, names) for wo in orders]


@router.get("/{work_order_id}")
def get_work_order(work_order_id: str, db: Session = Depends(get_db), _user=Depends(ViewRoles)):
    wo = db.query(WorkOrder).get(work_order_id)
    if not wo:
        raise HTTPException(404, "Work order not found")
    names = _employee_names(db, [wo])
    return _serialize(wo, names)


@router.post("")
def create_work_order(payload: WorkOrderIn, db: Session = Depends(get_db), user: Employee = Depends(LogRoles)):
    if not db.query(Machine).get(payload.machine_id):
        raise HTTPException(404, "Machine not found")

    next_number = (db.query(func.max(WorkOrder.number)).scalar() or (WO_NUMBER_BASE - 1)) + 1
    wo = WorkOrder(
        number=next_number,
        machine_id=payload.machine_id,
        breakdown_event_id=payload.breakdown_event_id,
        pm_plan_id=payload.pm_plan_id,
        title=payload.title,
        description=payload.description,
        priority=payload.priority,
        assigned_to=payload.assigned_to,
        due_date=payload.due_date,
        reported_by=user.id,
        status=WorkOrderStatus.ASSIGNED if payload.assigned_to else WorkOrderStatus.OPEN,
    )
    db.add(wo)
    db.commit()
    record_audit(db, action="WORK_ORDER_CREATED", entity_type="WorkOrder", entity_id=wo.id,
                 actor_id=user.id, new_value={"machine_id": payload.machine_id, "title": payload.title})
    names = _employee_names(db, [wo])
    return _serialize(wo, names)


@router.post("/{work_order_id}/assign")
def assign_work_order(work_order_id: str, payload: WorkOrderAssignIn, db: Session = Depends(get_db), user: Employee = Depends(LogRoles)):
    wo = db.query(WorkOrder).get(work_order_id)
    if not wo:
        raise HTTPException(404, "Work order not found")
    if not db.query(Employee).get(payload.assigned_to):
        raise HTTPException(404, "Assignee not found")
    old_assignee = wo.assigned_to
    wo.assigned_to = payload.assigned_to
    if wo.status == WorkOrderStatus.OPEN:
        wo.status = WorkOrderStatus.ASSIGNED
    db.commit()
    record_audit(db, action="WORK_ORDER_ASSIGNED", entity_type="WorkOrder", entity_id=wo.id,
                 actor_id=user.id, old_value={"assigned_to": old_assignee}, new_value={"assigned_to": payload.assigned_to})
    names = _employee_names(db, [wo])
    return _serialize(wo, names)


@router.post("/{work_order_id}/status")
def update_work_order_status(work_order_id: str, payload: WorkOrderStatusIn, db: Session = Depends(get_db), user: Employee = Depends(LogRoles)):
    wo = db.query(WorkOrder).get(work_order_id)
    if not wo:
        raise HTTPException(404, "Work order not found")

    allowed = FORWARD_TRANSITIONS.get(wo.status, set())
    if payload.status != wo.status and payload.status not in allowed:
        raise HTTPException(400, f"Cannot move work order from {wo.status.value} to {payload.status.value}")

    old_status = wo.status.value
    wo.status = payload.status
    if payload.root_cause is not None:
        wo.root_cause = payload.root_cause
    if payload.five_whys is not None:
        wo.five_whys = payload.five_whys
    if payload.action_taken is not None:
        wo.action_taken = payload.action_taken
    if payload.parts_used is not None:
        wo.parts_used = payload.parts_used
    if payload.labor_hours is not None:
        wo.labor_hours = payload.labor_hours
    if payload.downtime_minutes is not None:
        wo.downtime_minutes = payload.downtime_minutes

    if payload.status == WorkOrderStatus.VERIFIED:
        wo.verified_by = user.id
    if payload.status == WorkOrderStatus.CLOSED:
        wo.closed_at = datetime.utcnow()

    db.commit()
    record_audit(db, action="WORK_ORDER_STATUS_CHANGED", entity_type="WorkOrder", entity_id=wo.id,
                 actor_id=user.id, old_value={"status": old_status}, new_value={"status": payload.status.value})
    names = _employee_names(db, [wo])
    return _serialize(wo, names)


@router.get("/{work_order_id}/parts")
def list_consumed_parts(work_order_id: str, db: Session = Depends(get_db), _user=Depends(ViewRoles)):
    if not db.query(WorkOrder).get(work_order_id):
        raise HTTPException(404, "Work order not found")
    txns = (
        db.query(SparePartTransaction)
        .filter(SparePartTransaction.work_order_id == work_order_id)
        .order_by(SparePartTransaction.created_at.desc())
        .all()
    )
    part_ids = {t.spare_part_id for t in txns}
    parts = {p.id: p for p in db.query(SparePart).filter(SparePart.id.in_(part_ids)).all()} if part_ids else {}
    return [
        {
            "id": t.id,
            "spare_part_id": t.spare_part_id,
            "part_code": parts[t.spare_part_id].part_code if t.spare_part_id in parts else None,
            "part_name": parts[t.spare_part_id].name if t.spare_part_id in parts else None,
            "quantity": -t.change,  # stored as a negative stock movement; show as a positive quantity consumed
            "reason": t.reason,
            "created_at": t.created_at,
        }
        for t in txns
        if t.change < 0
    ]


@router.post("/{work_order_id}/consume-part")
def consume_part(work_order_id: str, payload: WorkOrderPartConsumeIn, db: Session = Depends(get_db), user: Employee = Depends(LogRoles)):
    wo = db.query(WorkOrder).get(work_order_id)
    if not wo:
        raise HTTPException(404, "Work order not found")
    part = db.query(SparePart).get(payload.spare_part_id)
    if not part:
        raise HTTPException(404, "Spare part not found")
    if payload.quantity <= 0:
        raise HTTPException(400, "Quantity must be positive")
    if part.stock_on_hand - payload.quantity < 0:
        raise HTTPException(400, f"Only {part.stock_on_hand} {part.unit} of {part.name} in stock")

    part.stock_on_hand -= payload.quantity
    db.add(SparePartTransaction(
        spare_part_id=part.id,
        work_order_id=wo.id,
        change=-payload.quantity,
        reason=payload.reason or f"Consumed on WO-{wo.number}",
        performed_by=user.id,
    ))

    note = f"{part.part_code} x{payload.quantity}"
    wo.parts_used = f"{wo.parts_used}, {note}" if wo.parts_used else note

    db.commit()
    record_audit(db, action="WORK_ORDER_PART_CONSUMED", entity_type="WorkOrder", entity_id=wo.id,
                 actor_id=user.id, new_value={"spare_part_id": part.id, "quantity": payload.quantity})
    names = _employee_names(db, [wo])
    return _serialize(wo, names)
