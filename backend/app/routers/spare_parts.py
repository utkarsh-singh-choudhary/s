"""
Spare parts: searchable stock list, an append-only movement ledger (receipt,
consume, return, damaged, adjustment), protection against negative stock and
repeated requests, manager approval for big adjustments, usage history per
part, and alerts for low stock / parts needed by upcoming PMs.
"""

from datetime import datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import or_
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.audit import record_audit
from app.core.auth import require_roles
from app.core.database import get_db
from app.core.settings_service import get_setting
from app.core.timeutils import today_local
from app.models.models import (
    BreakdownEvent, Employee, Machine, PMPlan, PMStatus, Role, SparePart, SparePartTransaction, WorkOrder,
    WorkOrderStatus,
)
from app.services.costs import txn_kind

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
    category: str | None = None
    compatible_machine_ids: list[str] | None = None
    lead_time_days: int | None = None


class StockAdjustIn(BaseModel):
    change: int  # positive = stock in, negative = stock out
    reason: str | None = None
    work_order_id: str | None = None
    txn_type: str | None = None          # RECEIPT | ADJUSTMENT | DAMAGED (default: by sign)
    unit_cost: float | None = None       # price paid on a RECEIPT
    request_id: str | None = None        # send the same id twice and it is applied once


class SparePartUpdateIn(BaseModel):
    # part_code and stock_on_hand are deliberately excluded - part_code is an
    # identifier, and stock only changes via /adjust so the SparePartTransaction
    # ledger stays the single source of truth for stock history.
    name: str | None = None
    description: str | None = None
    unit: str | None = None
    minimum_stock: int | None = None
    unit_cost: int | None = None
    storage_location: str | None = None
    preferred_vendor: str | None = None
    category: str | None = None
    compatible_machine_ids: list[str] | None = None
    lead_time_days: int | None = None


def _serialize(p: SparePart) -> dict:
    available = p.stock_on_hand - (p.reserved_stock or 0)
    return {
        "id": p.id, "part_code": p.part_code, "name": p.name, "description": p.description, "unit": p.unit,
        "stock_on_hand": p.stock_on_hand, "minimum_stock": p.minimum_stock, "reserved_stock": p.reserved_stock or 0,
        "available_stock": available, "low_stock": p.stock_on_hand <= p.minimum_stock, "out_of_stock": available <= 0,
        "unit_cost": p.unit_cost, "storage_location": p.storage_location, "preferred_vendor": p.preferred_vendor,
        "category": p.category, "compatible_machine_ids": p.compatible_machine_ids or [],
        "lead_time_days": p.lead_time_days, "updated_at": p.updated_at,
    }


def _check_machines(db: Session, ids):
    if ids:
        found = {m.id for m in db.query(Machine).filter(Machine.id.in_(ids)).all()}
        missing = [i for i in ids if i not in found]
        if missing:
            raise HTTPException(404, "Unknown machine in compatible_machine_ids")


@router.get("")
def list_spare_parts(
    low_stock_only: bool = False, q: str | None = None, category: str | None = None, machine_id: str | None = None,
    db: Session = Depends(get_db), _user=Depends(ViewRoles),
):
    """Search by part number, name, category, vendor or location; filter by compatible machine."""
    query = db.query(SparePart)
    if q and q.strip():
        like = f"%{q.strip()}%"
        query = query.filter(or_(SparePart.part_code.ilike(like), SparePart.name.ilike(like),
                                 SparePart.category.ilike(like), SparePart.description.ilike(like),
                                 SparePart.preferred_vendor.ilike(like), SparePart.storage_location.ilike(like)))
    if category:
        query = query.filter(SparePart.category == category)
    rows = [_serialize(p) for p in query.order_by(SparePart.name).all()]
    if machine_id:
        rows = [r for r in rows if machine_id in r["compatible_machine_ids"]]
    if low_stock_only:
        rows = [r for r in rows if r["low_stock"]]
    return rows


@router.get("/categories")
def list_categories(db: Session = Depends(get_db), _user=Depends(ViewRoles)):
    return sorted({c for (c,) in db.query(SparePart.category).filter(SparePart.category.isnot(None)).distinct().all() if c})


@router.get("/alerts")
def stock_alerts(db: Session = Depends(get_db), _user=Depends(ViewRoles)):
    """Low stock, and low-stock parts that machines with a PM due soon depend on."""
    parts = db.query(SparePart).all()
    low = [_serialize(p) for p in parts if p.stock_on_hand <= p.minimum_stock]
    today = today_local()
    horizon = today + timedelta(days=14)
    plans = db.query(PMPlan).filter(
        PMPlan.planned_date >= today, PMPlan.planned_date <= horizon,
        PMPlan.status.notin_((PMStatus.COMPLETED, PMStatus.CANCELLED))).all()
    machines = {m.id: m for m in db.query(Machine).filter(Machine.id.in_({p.machine_id for p in plans})).all()} if plans else {}
    at_risk = []
    for part in parts:
        if part.stock_on_hand > part.minimum_stock or not part.compatible_machine_ids:
            continue
        for plan in plans:
            if plan.machine_id in part.compatible_machine_ids:
                m = machines.get(plan.machine_id)
                at_risk.append({"part_id": part.id, "part_code": part.part_code, "part_name": part.name,
                                "stock_on_hand": part.stock_on_hand, "minimum_stock": part.minimum_stock,
                                "lead_time_days": part.lead_time_days, "machine_id": plan.machine_id,
                                "machine_number": m.machine_number if m else None, "planned_date": plan.planned_date,
                                "pm_plan_id": plan.id})
    waiting = db.query(WorkOrder).filter(WorkOrder.status == WorkOrderStatus.WAITING_PARTS,
                                         WorkOrder.cancelled.isnot(True)).all()
    return {
        "low_stock": low,
        "pm_at_risk": sorted(at_risk, key=lambda r: str(r["planned_date"])),
        "work_orders_waiting_for_parts": [{"id": w.id, "display_number": f"WO-{w.number}", "title": w.title,
                                           "machine_id": w.machine_id} for w in waiting],
    }


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
    txns = (db.query(SparePartTransaction).filter(SparePartTransaction.spare_part_id == part_id)
            .order_by(SparePartTransaction.created_at.desc()).all())
    ids = {t.performed_by for t in txns if t.performed_by}
    names = {e.id: e.name for e in db.query(Employee).filter(Employee.id.in_(ids)).all()} if ids else {}
    wo_ids = {t.work_order_id for t in txns if t.work_order_id}
    wos = {w.id: w.number for w in db.query(WorkOrder).filter(WorkOrder.id.in_(wo_ids)).all()} if wo_ids else {}
    return [
        {
            "id": t.id, "change": t.change, "txn_type": txn_kind(t), "unit_cost": t.unit_cost, "reason": t.reason,
            "work_order_id": t.work_order_id,
            "work_order_number": f"WO-{wos[t.work_order_id]}" if t.work_order_id in wos else None,
            "performed_by": t.performed_by, "performed_by_name": names.get(t.performed_by), "created_at": t.created_at,
        }
        for t in txns
    ]


@router.get("/{part_id}/usage")
def part_usage(part_id: str, db: Session = Depends(get_db), _user=Depends(ViewRoles)):
    """Which work orders and breakdowns consumed this part (net of returns)."""
    if not db.query(SparePart).get(part_id):
        raise HTTPException(404, "Spare part not found")
    txns = db.query(SparePartTransaction).filter(SparePartTransaction.spare_part_id == part_id,
                                                 SparePartTransaction.work_order_id.isnot(None)).all()
    by_wo: dict = {}
    for t in txns:
        k = txn_kind(t)
        if k not in ("CONSUME", "RETURN"):
            continue
        row = by_wo.setdefault(t.work_order_id, {"quantity": 0, "cost": 0.0, "last": t.created_at, "bd": t.breakdown_event_id})
        sign = 1 if k == "CONSUME" else -1
        row["quantity"] += abs(t.change) * sign
        row["cost"] += abs(t.change) * (t.unit_cost or 0) * sign
        row["last"] = max(row["last"], t.created_at)
    wos = {w.id: w for w in db.query(WorkOrder).filter(WorkOrder.id.in_(by_wo.keys())).all()} if by_wo else {}
    machines = {m.id: m for m in db.query(Machine).filter(Machine.id.in_({w.machine_id for w in wos.values()})).all()} if wos else {}
    bds = {b.id: b for b in db.query(BreakdownEvent).filter(BreakdownEvent.id.in_({r["bd"] for r in by_wo.values() if r["bd"]})).all()} if by_wo else {}
    out = []
    for wid, r in by_wo.items():
        w = wos.get(wid)
        if not w or r["quantity"] == 0:
            continue
        m = machines.get(w.machine_id)
        out.append({"work_order_id": wid, "display_number": f"WO-{w.number}", "title": w.title,
                    "machine_number": m.machine_number if m else None,
                    "breakdown_id": r["bd"], "bd_number": bds[r["bd"]].bd_number if r["bd"] in bds else None,
                    "quantity": r["quantity"], "cost": round(r["cost"], 2), "last_movement": r["last"]})
    return sorted(out, key=lambda r: str(r["last_movement"]), reverse=True)


@router.post("")
def create_spare_part(payload: SparePartIn, db: Session = Depends(get_db), user: Employee = Depends(ManageRoles)):
    if not payload.part_code.strip() or not payload.name.strip():
        raise HTTPException(400, "Part code and name are required")
    if payload.initial_stock < 0 or payload.minimum_stock < 0 or (payload.unit_cost or 0) < 0:
        raise HTTPException(400, "Stock, minimum stock and cost cannot be negative")
    if db.query(SparePart).filter(SparePart.part_code == payload.part_code.strip()).first():
        raise HTTPException(400, "A spare part with this code already exists")
    _check_machines(db, payload.compatible_machine_ids)
    part = SparePart(
        part_code=payload.part_code.strip(), name=payload.name.strip(), description=payload.description,
        unit=payload.unit, minimum_stock=payload.minimum_stock, stock_on_hand=payload.initial_stock,
        unit_cost=payload.unit_cost, storage_location=payload.storage_location,
        preferred_vendor=payload.preferred_vendor, category=payload.category,
        compatible_machine_ids=payload.compatible_machine_ids or [], lead_time_days=payload.lead_time_days)
    db.add(part)
    db.flush()
    if payload.initial_stock:
        db.add(SparePartTransaction(spare_part_id=part.id, change=payload.initial_stock, reason="Initial stock",
                                    performed_by=user.id, txn_type="RECEIPT", unit_cost=payload.unit_cost))
    db.commit()
    record_audit(db, action="SPARE_PART_CREATED", entity_type="SparePart", entity_id=part.id,
                 actor_id=user.id, new_value={"part_code": part.part_code, "name": part.name})
    return _serialize(part)


@router.put("/{part_id}")
def update_spare_part(part_id: str, payload: SparePartUpdateIn, db: Session = Depends(get_db),
                      user: Employee = Depends(ManageRoles)):
    part = db.query(SparePart).get(part_id)
    if not part:
        raise HTTPException(404, "Spare part not found")
    requested = payload.model_dump(exclude_unset=True)
    if (requested.get("minimum_stock") or 0) < 0 or (requested.get("unit_cost") or 0) < 0:
        raise HTTPException(400, "Minimum stock and cost cannot be negative")
    _check_machines(db, requested.get("compatible_machine_ids"))
    keys = list(requested)
    old_value = {k: getattr(part, k) for k in keys}
    for field, value in requested.items():
        setattr(part, field, value)
    part.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(part)
    record_audit(db, action="SPARE_PART_UPDATED", entity_type="SparePart", entity_id=part.id, actor_id=user.id,
                 old_value=old_value, new_value={k: getattr(part, k) for k in keys})
    return _serialize(part)


@router.post("/{part_id}/adjust")
def adjust_stock(part_id: str, payload: StockAdjustIn, db: Session = Depends(get_db), user: Employee = Depends(LogRoles)):
    """
    Record a stock movement. Receipts and adjustments are for supervisors and
    above; anyone can book damaged stock. Value-based approval: an adjustment
    or write-off worth more than the `stock_adjustment_approval_value`
    setting needs a manager or admin. Stock can never go below zero.
    """
    if payload.change == 0:
        raise HTTPException(400, "Change must be non-zero")
    kind = (payload.txn_type or ("RECEIPT" if payload.change > 0 else "ADJUSTMENT")).upper()
    if kind not in ("RECEIPT", "ADJUSTMENT", "DAMAGED"):
        raise HTTPException(400, "txn_type must be RECEIPT, ADJUSTMENT or DAMAGED (use the work order for consumption/returns)")
    change = payload.change
    if kind == "RECEIPT" and change < 0:
        raise HTTPException(400, "A receipt must be a positive quantity")
    if kind == "DAMAGED":
        change = -abs(change)
    if kind in ("RECEIPT", "ADJUSTMENT") and user.role == Role.TECHNICIAN:
        raise HTTPException(403, "Only a supervisor, manager or admin can receive stock or adjust counts")
    if kind in ("ADJUSTMENT", "DAMAGED") and len((payload.reason or "").strip()) < 3:
        raise HTTPException(400, "A reason is required for adjustments and damaged stock")
    if payload.work_order_id and not db.query(WorkOrder).get(payload.work_order_id):
        raise HTTPException(404, "Work order not found")

    key = f"adj:{part_id}:{payload.request_id}"[:100] if payload.request_id else None
    if key and db.query(SparePartTransaction).filter(SparePartTransaction.idempotency_key == key).first():
        return _serialize(db.query(SparePart).get(part_id))   # repeated request - already applied

    part = db.query(SparePart).filter(SparePart.id == part_id).with_for_update().first()
    if not part:
        raise HTTPException(404, "Spare part not found")
    new_stock = part.stock_on_hand + change
    if new_stock < 0:
        raise HTTPException(400, f"Cannot reduce stock below zero (currently {part.stock_on_hand})")

    unit_cost = payload.unit_cost if (kind == "RECEIPT" and payload.unit_cost is not None) else part.unit_cost
    value = abs(change) * (unit_cost or 0)
    needs_manager = kind in ("ADJUSTMENT", "DAMAGED") and value > float(get_setting(db, "stock_adjustment_approval_value") or 0)
    if needs_manager and user.role not in (Role.MANAGER, Role.ADMIN):
        raise HTTPException(403, f"This adjustment is worth {value:.0f} - it needs approval from a manager or admin")

    old_stock = part.stock_on_hand
    part.stock_on_hand = new_stock
    if kind == "RECEIPT" and payload.unit_cost is not None:
        part.unit_cost = int(round(payload.unit_cost))   # latest purchase price; past movements keep their own price
    part.updated_at = datetime.utcnow()
    db.add(SparePartTransaction(
        spare_part_id=part.id, work_order_id=payload.work_order_id, change=change, reason=payload.reason,
        performed_by=user.id, txn_type=kind, unit_cost=unit_cost, idempotency_key=key,
        approved_by=user.id if needs_manager else None))
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        return _serialize(db.query(SparePart).get(part_id))
    record_audit(db, action="SPARE_PART_STOCK_ADJUSTED", entity_type="SparePart", entity_id=part.id, actor_id=user.id,
                 old_value={"stock_on_hand": old_stock},
                 new_value={"stock_on_hand": part.stock_on_hand, "type": kind, "value": round(value, 2),
                            "reason": payload.reason})
    return _serialize(part)
