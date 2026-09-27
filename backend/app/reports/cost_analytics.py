"""
Maintenance cost analytics (Future-Ready item 16/17) - turns the labor
hours, downtime minutes and consumed parts that work orders and PM
completions already capture into money, so the numbers mean something to
management, not only to technicians.

Costs are estimated, not invoiced - built from a configurable labor-hour
rate and downtime-minute rate (see app/core/settings_service.py) plus each
spare part's unit_cost. Good enough for "preventive vs corrective, which
machines cost the most" questions; not a substitute for real accounting.
"""

from datetime import date, datetime, timedelta

from sqlalchemy.orm import Session

from app.core.settings_service import get_setting
from app.models.models import WorkOrder, PMPlan, PMActual, SparePartTransaction, SparePart, Machine


def compute_cost_report(db: Session, start_date: date | None = None, end_date: date | None = None) -> dict:
    end_date = end_date or date.today()
    start_date = start_date or (end_date - timedelta(days=90))

    labor_rate = float(get_setting(db, "labor_hour_cost", 300))
    downtime_rate = float(get_setting(db, "downtime_minute_cost", 20))

    # Corrective side: work orders touched in the window.
    work_orders = (
        db.query(WorkOrder)
        .filter(WorkOrder.created_at >= datetime.combine(start_date, datetime.min.time()))
        .filter(WorkOrder.created_at <= datetime.combine(end_date, datetime.max.time()))
        .all()
    )
    corrective_labor_cost = sum((wo.labor_hours or 0) * labor_rate for wo in work_orders)
    corrective_downtime_cost = sum((wo.downtime_minutes or 0) * downtime_rate for wo in work_orders)

    wo_ids = [wo.id for wo in work_orders]
    parts_cost = 0.0
    if wo_ids:
        txns = (
            db.query(SparePartTransaction, SparePart.unit_cost)
            .join(SparePart, SparePartTransaction.spare_part_id == SparePart.id)
            .filter(SparePartTransaction.work_order_id.in_(wo_ids), SparePartTransaction.change < 0)
            .all()
        )
        parts_cost = sum(-txn.change * (unit_cost or 0) for txn, unit_cost in txns)

    corrective_total = corrective_labor_cost + corrective_downtime_cost + parts_cost

    # Preventive side: completed PMs in the window, using their logged downtime.
    pm_actuals = (
        db.query(PMActual)
        .join(PMPlan, PMActual.pm_plan_id == PMPlan.id)
        .filter(PMActual.actual_date >= start_date, PMActual.actual_date <= end_date)
        .all()
    )
    preventive_downtime_cost = sum((a.downtime_minutes or 0) * downtime_rate for a in pm_actuals)
    preventive_total = preventive_downtime_cost  # no separate PM labor tracking yet

    # Per-machine rollup (corrective only, since that's where the granular cost data lives).
    machine_rows: dict[str, dict] = {}
    for wo in work_orders:
        row = machine_rows.setdefault(wo.machine_id, {"machine_id": wo.machine_id, "work_orders": 0, "labor_cost": 0.0, "downtime_cost": 0.0, "parts_cost": 0.0})
        row["work_orders"] += 1
        row["labor_cost"] += (wo.labor_hours or 0) * labor_rate
        row["downtime_cost"] += (wo.downtime_minutes or 0) * downtime_rate
    if wo_ids:
        by_machine_parts: dict[str, float] = {}
        wo_machine = {wo.id: wo.machine_id for wo in work_orders}
        txns = (
            db.query(SparePartTransaction, SparePart.unit_cost)
            .join(SparePart, SparePartTransaction.spare_part_id == SparePart.id)
            .filter(SparePartTransaction.work_order_id.in_(wo_ids), SparePartTransaction.change < 0)
            .all()
        )
        for txn, unit_cost in txns:
            mid = wo_machine.get(txn.work_order_id)
            if mid:
                by_machine_parts[mid] = by_machine_parts.get(mid, 0) + (-txn.change * (unit_cost or 0))
        for mid, cost in by_machine_parts.items():
            machine_rows.setdefault(mid, {"machine_id": mid, "work_orders": 0, "labor_cost": 0.0, "downtime_cost": 0.0, "parts_cost": 0.0})
            machine_rows[mid]["parts_cost"] += cost

    machines = {m.id: m for m in db.query(Machine).filter(Machine.id.in_(machine_rows.keys())).all()} if machine_rows else {}
    machine_list = []
    for mid, row in machine_rows.items():
        m = machines.get(mid)
        total = row["labor_cost"] + row["downtime_cost"] + row["parts_cost"]
        machine_list.append({
            "machine_id": mid,
            "machine_number": m.machine_number if m else None,
            "machine_name": m.machine_name if m else None,
            "work_orders": row["work_orders"],
            "labor_cost": round(row["labor_cost"], 2),
            "downtime_cost": round(row["downtime_cost"], 2),
            "parts_cost": round(row["parts_cost"], 2),
            "total_cost": round(total, 2),
        })
    machine_list.sort(key=lambda r: r["total_cost"], reverse=True)

    return {
        "start_date": start_date.isoformat(),
        "end_date": end_date.isoformat(),
        "labor_hour_cost": labor_rate,
        "downtime_minute_cost": downtime_rate,
        "preventive": {
            "downtime_cost": round(preventive_downtime_cost, 2),
            "total_cost": round(preventive_total, 2),
            "pm_count": len(pm_actuals),
        },
        "corrective": {
            "labor_cost": round(corrective_labor_cost, 2),
            "downtime_cost": round(corrective_downtime_cost, 2),
            "parts_cost": round(parts_cost, 2),
            "total_cost": round(corrective_total, 2),
            "work_order_count": len(work_orders),
        },
        "grand_total": round(preventive_total + corrective_total, 2),
        "by_machine": machine_list,
    }
