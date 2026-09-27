"""
Asset health score (Future-Ready item 28) - a single 0-100 view of a
machine's condition, built from things we already track. Deliberately not a
black box: every input is returned alongside the score so a supervisor can
see *why* a machine dropped, not just that it did.

This is a transparent statistical scorecard, not a predictive model - in
line with the "start transparent, add ML later" approach for item 8
(predictive maintenance): a rules-based score you can explain beats an
opaque one you can't, especially as the first version of this feature.
"""

from dataclasses import dataclass
from datetime import datetime, timedelta

from sqlalchemy.orm import Session

from app.models.models import Machine, PMPlan, PMActual, BreakdownEvent, PMChecklistResponse, ChecklistTemplateItem, PMStatus

LOOKBACK_DAYS = 90
PM_COMPLIANCE_LOOKBACK_DAYS = 180


@dataclass
class HealthScoreFactor:
    key: str
    label: str
    score: float | None  # 0-100, None if there isn't enough data yet
    detail: str


def _clamp(value: float, lo: float = 0, hi: float = 100) -> float:
    return max(lo, min(hi, value))


def compute_health_score(db: Session, machine: Machine) -> dict:
    now = datetime.utcnow()
    lookback_start = now - timedelta(days=LOOKBACK_DAYS)
    compliance_start = now - timedelta(days=PM_COMPLIANCE_LOOKBACK_DAYS)

    factors: list[HealthScoreFactor] = []

    # 1. PM compliance - planned vs completed, recent window.
    recent_plans = (
        db.query(PMPlan)
        .filter(PMPlan.machine_id == machine.id, PMPlan.created_at >= compliance_start)
        .all()
    )
    if recent_plans:
        completed = sum(1 for p in recent_plans if p.status == PMStatus.COMPLETED)
        compliance_pct = _clamp(100 * completed / len(recent_plans))
        factors.append(HealthScoreFactor(
            "pm_compliance", "PM compliance", compliance_pct,
            f"{completed} of {len(recent_plans)} planned PMs completed",
        ))
    else:
        factors.append(HealthScoreFactor("pm_compliance", "PM compliance", None, "No PM plans on file yet"))

    # 2. Failure trend - breakdown frequency in the lookback window.
    recent_breakdowns = (
        db.query(BreakdownEvent)
        .filter(BreakdownEvent.machine_id == machine.id, BreakdownEvent.breakdown_at >= lookback_start)
        .all()
    )
    failure_score = _clamp(100 - len(recent_breakdowns) * 15)
    factors.append(HealthScoreFactor(
        "failure_trend", "Failure trend", failure_score,
        f"{len(recent_breakdowns)} failure{'s' if len(recent_breakdowns) != 1 else ''} in the last {LOOKBACK_DAYS} days",
    ))

    # 3. Downtime - total repair hours in the lookback window.
    downtime_hours = sum(
        (e.resumed_at - e.breakdown_at).total_seconds() / 3600
        for e in recent_breakdowns
        if e.resumed_at is not None
    )
    downtime_score = _clamp(100 - downtime_hours * 2)
    factors.append(HealthScoreFactor(
        "downtime", "Downtime", downtime_score,
        f"{downtime_hours:.1f} hrs down in the last {LOOKBACK_DAYS} days",
    ))

    # 4. Checklist quality - required items actually checked, on recent completions.
    recent_actuals = (
        db.query(PMActual)
        .join(PMPlan, PMActual.pm_plan_id == PMPlan.id)
        .filter(PMPlan.machine_id == machine.id, PMActual.actual_date >= lookback_start.date())
        .all()
    )
    actual_ids = [a.id for a in recent_actuals]
    if actual_ids:
        responses = (
            db.query(PMChecklistResponse, ChecklistTemplateItem.required)
            .join(ChecklistTemplateItem, PMChecklistResponse.checklist_template_item_id == ChecklistTemplateItem.id)
            .filter(PMChecklistResponse.pm_actual_id.in_(actual_ids))
            .all()
        )
        required = [resp for resp, is_required in responses if is_required]
        if required:
            checked = sum(1 for r in required if r.checked)
            checklist_score = _clamp(100 * checked / len(required))
            factors.append(HealthScoreFactor(
                "checklist_quality", "Checklist quality", checklist_score,
                f"{checked} of {len(required)} required checklist items checked on recent PMs",
            ))
        else:
            factors.append(HealthScoreFactor("checklist_quality", "Checklist quality", None, "No checklist template in use"))
    else:
        factors.append(HealthScoreFactor("checklist_quality", "Checklist quality", None, "No completed PMs in the lookback window"))

    # 5. Criticality - not a measurement, a standard: critical machines are
    # held to a stricter bar, so any open breakdown costs them more here.
    open_breakdowns = sum(1 for e in recent_breakdowns if e.resumed_at is None)
    if machine.critical:
        criticality_score = _clamp(100 - open_breakdowns * 30)
        detail = f"Critical asset — {open_breakdowns} currently open breakdown(s)" if open_breakdowns else "Critical asset — currently no open breakdowns"
    else:
        criticality_score = 100.0
        detail = "Non-critical asset"
    factors.append(HealthScoreFactor("criticality", "Criticality standard", criticality_score, detail))

    scored = [f for f in factors if f.score is not None]
    overall = round(sum(f.score for f in scored) / len(scored), 1) if scored else None

    return {
        "machine_id": machine.id,
        "machine_number": machine.machine_number,
        "machine_name": machine.machine_name,
        "overall_score": overall,
        "band": _band(overall),
        "factors": [
            {"key": f.key, "label": f.label, "score": round(f.score, 1) if f.score is not None else None, "detail": f.detail}
            for f in factors
        ],
    }


def _band(score: float | None) -> str:
    if score is None:
        return "UNKNOWN"
    if score >= 85:
        return "HEALTHY"
    if score >= 65:
        return "WATCH"
    if score >= 40:
        return "AT_RISK"
    return "CRITICAL"
