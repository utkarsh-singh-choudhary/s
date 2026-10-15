"""Work-order helpers shared by the work-order and breakdown routers."""

from datetime import datetime

from fastapi import HTTPException
from sqlalchemy import func
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.models.models import (
    Employee, Machine, WorkOrder, WorkOrderLog, WorkOrderPriority, WorkOrderStatus,
)

WO_NUMBER_BASE = 10000
SOURCES = ("BREAKDOWN", "PM", "INSPECTION", "OPERATOR_REQUEST", "IMPROVEMENT")
FAILURE_CATEGORIES = ("MECHANICAL", "ELECTRICAL", "HYDRAULIC", "PNEUMATIC", "SOFTWARE", "LUBRICATION", "OTHER")
SAFETY_RISKS = ("LOW", "MEDIUM", "HIGH")
WAIT_REASONS = ("PARTS", "APPROVAL", "ACCESS", "VENDOR", "SHUTDOWN")
RESOLUTION_CODES = ("REPAIRED", "REPLACED_PART", "ADJUSTED", "CLEANED_LUBRICATED", "SOFTWARE_FIX",
                    "TEMPORARY_FIX", "NO_FAULT_FOUND", "EXTERNAL_VENDOR", "OTHER")


def log_event(db: Session, wo_id: str, event: str, by: str | None, from_status=None, to_status=None,
              reason: str | None = None, note: str | None = None) -> WorkOrderLog:
    row = WorkOrderLog(work_order_id=wo_id, event=event, from_status=from_status, to_status=to_status,
                       reason=reason, note=note, by_id=by, logged_at=datetime.utcnow())
    db.add(row)
    return row


def create_work_order(db: Session, user: Employee, **f) -> WorkOrder:
    """Create (and commit) a work order with an auto-generated WO number."""
    machine = db.query(Machine).get(f["machine_id"])
    if not machine:
        raise HTTPException(404, "Machine not found")
    if f.get("source") and f["source"] not in SOURCES:
        raise HTTPException(400, f"source must be one of {', '.join(SOURCES)}")
    if f.get("failure_category") and f["failure_category"] not in FAILURE_CATEGORIES:
        raise HTTPException(400, f"failure_category must be one of {', '.join(FAILURE_CATEGORIES)}")
    if f.get("safety_risk") and f["safety_risk"] not in SAFETY_RISKS:
        raise HTTPException(400, f"safety_risk must be one of {', '.join(SAFETY_RISKS)}")
    for key in ("assigned_to", "supervisor_id"):
        if f.get(key) and not db.query(Employee).get(f[key]):
            raise HTTPException(404, f"{key} employee not found")

    source = f.get("source") or ("BREAKDOWN" if f.get("breakdown_event_id") else "PM" if f.get("pm_plan_id") else "OPERATOR_REQUEST")
    for attempt in range(5):
        next_number = (db.query(func.max(WorkOrder.number)).scalar() or (WO_NUMBER_BASE - 1)) + 1
        wo = WorkOrder(
            number=next_number, reported_by=user.id, source=source,
            priority=f.get("priority") or WorkOrderPriority.MEDIUM,
            status=WorkOrderStatus.ASSIGNED if f.get("assigned_to") else WorkOrderStatus.OPEN,
            **{k: v for k, v in f.items() if k not in ("source", "priority") and v is not None},
        )
        db.add(wo)
        try:
            db.flush()
            break
        except IntegrityError:  # two people took the same number at once - retry with the next one
            db.rollback()
            if attempt == 4:
                raise HTTPException(409, "Could not allocate a work order number, please try again")
    log_event(db, wo.id, "CREATED", user.id, to_status=wo.status.value, note=f"Source: {source}")
    db.commit()
    return wo
