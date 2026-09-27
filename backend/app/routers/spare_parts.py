from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.auth import require_roles
from app.core.audit import record_audit
from app.models.models import SparePart, SparePartTransaction, WorkOrder, Employee, Role

router = APIRouter(prefix="/api/spare-parts", tags=["spare-parts"])

ViewRoles = require_roles(Role.ADMIN, Role.MANAGER, Role.SUPERVISOR, Role.TECHNICIAN, Role.VIEWER)
LogRoles = require_roles(Role.TECHNICIAN, Role.SUPERVISOR, Role.MANAGER, Role.ADMIN)
ManageRoles = require_roles(Role.SUPERVISOR, Role.MANAGER, Role.ADMIN)


class SparePartIn(BaseModel):
    part_code: str
    name: str
    description: str | None = None
    unit: str = "pcs"
    minimum_stock: int = 0
    initial_stock: int = 0
    unit_cost: int | None = None
    storage_location: str | None = None
    preferred_vendor: str | None = None


class StockAdjustIn(BaseModel):
    change: int  # positive = receipt, negative = consumption/write-off
    reason: str | None = None
    work_order_id: str | None = None


def _serialize(p: SparePart) -> dict:
    available = p.stock_on_hand - p.reserved_stock
    return {
        "id": p.id,
        "part_code": p.part_code,
        "name": p.name,
        "description": p.description,
        "unit": p.unit,
        "stock_on_hand": p.stock_on_hand,
        "minimum_stock": p.minimum_stock,
        "reserved_stock": p.reserved_stock,
        "available_stock": available,
        "low_stock": p.stock_on_hand <= p.minimum_stock,
        "unit_cost": p.unit_cost,
        "storage_location": p.storage_location,
        "preferred_vendor": p.preferred_vendor,
        "updated_at": p.updated_at,
    }


@router.get("")
def list_spare_parts(low_stock_only: bool = False, db: Session = Depends(get_db), _user=Depends(ViewRoles)):
    parts = db.query(SparePart).order_by(SparePart.name).all()
    rows = [_serialize(p) for p in parts]
    if low_stock_only:
        rows = [r for r in rows if r["low_stock"]]
    return rows


@router.get("/{part_id}")
def get_spare_part(part_id: str, db: Session = Depends(get_db), _user=Depends(ViewRoles)):
    p = db.query(SparePart).get(part_id)
    if not p:
        raise HTTPException(404, "Spare part not found")
    return _serialize(p)


@router.get("/{part_id}/transactions")
def list_transactions(part_id: str, db: Session = Depends(get_db), _user=Depends(ViewRoles)):
    if not db.query(SparePart).get(part_id):
        raise HTTPException(404, "Spare part not found")
    txns = (
        db.query(SparePartTransaction)
        .filter(SparePartTransaction.spare_part_id == part_id)
        .order_by(SparePartTransaction.created_at.desc())
        .all()
    )
    names = {}
    ids = {t.performed_by for t in txns if t.performed_by}
    if ids:
        names = {e.id: e.name for e in db.query(Employee).filter(Employee.id.in_(ids)).all()}
    return [
        {
            "id": t.id,
            "change": t.change,
            "reason": t.reason,
            "work_order_id": t.work_order_id,
            "performed_by": t.performed_by,
            "performed_by_name": names.get(t.performed_by),
            "created_at": t.created_at,
        }
        for t in txns
    ]


@router.post("")
def create_spare_part(payload: SparePartIn, db: Session = Depends(get_db), user: Employee = Depends(ManageRoles)):
    if db.query(SparePart).filter(SparePart.part_code == payload.part_code).first():
        raise HTTPException(400, "A spare part with this code already exists")
    part = SparePart(
        part_code=payload.part_code,
        name=payload.name,
        description=payload.description,
        unit=payload.unit,
        minimum_stock=payload.minimum_stock,
        stock_on_hand=payload.initial_stock,
        unit_cost=payload.unit_cost,
        storage_location=payload.storage_location,
        preferred_vendor=payload.preferred_vendor,
    )
    db.add(part)
    db.commit()
    if payload.initial_stock:
        db.add(SparePartTransaction(spare_part_id=part.id, change=payload.initial_stock, reason="Initial stock", performed_by=user.id))
        db.commit()
    record_audit(db, action="SPARE_PART_CREATED", entity_type="SparePart", entity_id=part.id,
                 actor_id=user.id, new_value={"part_code": part.part_code, "name": part.name})
    return _serialize(part)


@router.post("/{part_id}/adjust")
def adjust_stock(part_id: str, payload: StockAdjustIn, db: Session = Depends(get_db), user: Employee = Depends(LogRoles)):
    part = db.query(SparePart).get(part_id)
    if not part:
        raise HTTPException(404, "Spare part not found")
    if payload.change == 0:
        raise HTTPException(400, "Change must be non-zero")
    new_stock = part.stock_on_hand + payload.change
    if new_stock < 0:
        raise HTTPException(400, f"Cannot reduce stock below zero (currently {part.stock_on_hand})")
    if payload.work_order_id and not db.query(WorkOrder).get(payload.work_order_id):
        raise HTTPException(404, "Work order not found")

    part.stock_on_hand = new_stock
    part.updated_at = datetime.utcnow()
    db.add(SparePartTransaction(
        spare_part_id=part.id,
        work_order_id=payload.work_order_id,
        change=payload.change,
        reason=payload.reason,
        performed_by=user.id,
    ))
    db.commit()
    record_audit(db, action="SPARE_PART_STOCK_ADJUSTED", entity_type="SparePart", entity_id=part.id,
                 actor_id=user.id, old_value={"stock_on_hand": part.stock_on_hand - payload.change},
                 new_value={"stock_on_hand": part.stock_on_hand})
    return _serialize(part)
