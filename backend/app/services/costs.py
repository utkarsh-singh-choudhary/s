"""
Cost calculation from recorded transactions only.

    Total repair cost = Parts + Labour + External services + Consumables + Other

- Parts: net consumed quantity x the unit cost recorded WHEN the stock moved.
  Old movements that never stored a price fall back to the part's price once;
  new ones always store it, so history is not repriced by later price changes.
- Labour: hours x the hourly rate stored on each labour entry (snapshot).
- External services / consumables / other: only costs a supervisor or manager
  has APPROVED count towards the actual cost; unapproved ones are shown as
  "pending approval".
- Estimated cost (WorkOrder.estimated_cost) is kept separate and never mixed in.
- Downtime cost is reported beside the repair cost, not inside it.
"""

from datetime import datetime

from sqlalchemy.orm import Session

from app.core.settings_service import get_setting
from app.models.models import (
    BreakdownEvent, SparePart, SparePartTransaction, WorkOrder, WorkOrderCost, WorkOrderLabourEntry,
)

CONSUME_TYPES = {"CONSUME"}
RETURN_TYPES = {"RETURN"}


def txn_kind(t: SparePartTransaction) -> str:
    """Classify a ledger row (old rows have no txn_type)."""
    if t.txn_type:
        return t.txn_type
    if t.work_order_id:
        return "CONSUME" if t.change < 0 else "RETURN"
    return "RECEIPT" if t.change > 0 else "ADJUSTMENT"


def _txn_cost(t: SparePartTransaction, part_prices: dict) -> float:
    unit = t.unit_cost if t.unit_cost is not None else (part_prices.get(t.spare_part_id) or 0)
    return abs(t.change) * unit


def parts_for_work_orders(db: Session, wo_ids: list[str], breakdown_ids: list[str] | None = None) -> list[dict]:
    """Net parts lines (consumed minus returned) per WO / breakdown, with cost."""
    q = db.query(SparePartTransaction)
    conds = []
    if wo_ids:
        conds.append(SparePartTransaction.work_order_id.in_(wo_ids))
    if breakdown_ids:
        conds.append(SparePartTransaction.breakdown_event_id.in_(breakdown_ids))
    if not conds:
        return []
    from sqlalchemy import or_
    txns = q.filter(or_(*conds)).order_by(SparePartTransaction.created_at).all()
    parts = {p.id: p for p in db.query(SparePart).filter(SparePart.id.in_({t.spare_part_id for t in txns})).all()} if txns else {}
    prices = {pid: p.unit_cost for pid, p in parts.items()}
    lines = []
    for t in txns:
        kind = txn_kind(t)
        if kind not in CONSUME_TYPES | RETURN_TYPES:
            continue
        sign = 1 if kind == "CONSUME" else -1
        p = parts.get(t.spare_part_id)
        lines.append({
            "id": t.id, "spare_part_id": t.spare_part_id, "part_code": p.part_code if p else None,
            "part_name": p.name if p else None, "kind": kind,
            "quantity": abs(t.change) * sign,  # negative for returns
            "unit_cost": t.unit_cost if t.unit_cost is not None else prices.get(t.spare_part_id),
            "cost": round(_txn_cost(t, prices) * sign, 2),
            "work_order_id": t.work_order_id, "breakdown_event_id": t.breakdown_event_id,
            "reason": t.reason, "created_at": t.created_at,
        })
    return lines


def work_order_cost(db: Session, wo: WorkOrder) -> dict:
    currency = get_setting(db, "currency") or "INR"
    parts_lines = parts_for_work_orders(db, [wo.id])
    parts_cost = round(sum(l["cost"] for l in parts_lines), 2)

    labour = db.query(WorkOrderLabourEntry).filter(WorkOrderLabourEntry.work_order_id == wo.id).all()
    labour_hours = round(sum(l.hours for l in labour), 2)
    labour_cost = round(sum(l.hours * l.hourly_rate for l in labour), 2)

    costs = db.query(WorkOrderCost).filter(WorkOrderCost.work_order_id == wo.id).all()
    by_cat = {"EXTERNAL_SERVICE": 0.0, "CONSUMABLE": 0.0, "OTHER": 0.0}
    pending = 0.0
    for c in costs:
        total = (c.amount or 0) + (c.tax_amount or 0)
        if c.approved_at:
            by_cat[c.category] = by_cat.get(c.category, 0.0) + total
        else:
            pending += total

    actual = parts_cost + labour_cost + sum(by_cat.values())
    return {
        "currency": currency,
        "parts": parts_cost,
        "labour": labour_cost,
        "labour_hours": labour_hours,
        "external_services": round(by_cat["EXTERNAL_SERVICE"], 2),
        "consumables": round(by_cat["CONSUMABLE"], 2),
        "other": round(by_cat["OTHER"], 2),
        "pending_approval": round(pending, 2),
        "actual_total": round(actual, 2),
        "estimated_total": wo.estimated_cost,
    }


def breakdown_cost(db: Session, bd: BreakdownEvent) -> dict:
    """Roll up every work order linked to the incident, plus parts booked straight to it."""
    wos = db.query(WorkOrder).filter(WorkOrder.breakdown_event_id == bd.id, WorkOrder.cancelled.isnot(True)).all()
    total = {"parts": 0.0, "labour": 0.0, "labour_hours": 0.0, "external_services": 0.0, "consumables": 0.0,
             "other": 0.0, "pending_approval": 0.0, "actual_total": 0.0}
    for wo in wos:
        c = work_order_cost(db, wo)
        for k in total:
            total[k] += c[k]
    # parts booked directly on the breakdown (no work order)
    direct = [l for l in parts_for_work_orders(db, [], [bd.id]) if not l["work_order_id"]]
    direct_cost = sum(l["cost"] for l in direct)
    total["parts"] += direct_cost
    total["actual_total"] += direct_cost

    end = bd.resumed_at or datetime.utcnow()
    downtime_min = max(0, int((end - bd.breakdown_at).total_seconds() // 60)) if bd.breakdown_at else 0
    rate = float(get_setting(db, "downtime_minute_cost") or 0)
    out = {k: round(v, 2) for k, v in total.items()}
    out.update({
        "currency": get_setting(db, "currency") or "INR",
        "downtime_minutes": downtime_min,
        "downtime_open": bd.resumed_at is None,
        "downtime_cost": round(downtime_min * rate, 2),
        "work_order_count": len(wos),
    })
    return out


def downtime_minutes(bd: BreakdownEvent, now: datetime | None = None) -> int | None:
    if not bd.breakdown_at:
        return None
    end = bd.resumed_at or (now or datetime.utcnow())
    return max(0, int((end - bd.breakdown_at).total_seconds() // 60))
