"""
DB-backed admin settings, with hardcoded fallbacks so the system behaves
identically to before this existed if nothing has been configured yet.

Usage:
    from app.core.settings_service import get_setting
    reminder_days = get_setting(db, "reminder_days_before", default=7)

Keys that the admin panel exposes (see app/routers/admin_settings.py):
    reminder_days_before        int   - days before due date to send "upcoming" reminder
    due_tomorrow_days_before    int   - days before due date to send "due tomorrow" reminder
    escalation_thresholds       list[{"days": int, "levels": [str]}] - overdue escalation ladder
    week_band_size_days         int   - locked week->date convention band width (default 7)
    week_start_offset_days      int   - day-of-month the W1 band starts on (default 1)
    reminder_cc_emails          list[str] - extra addresses that get a copy of every reminder
"""
from typing import Any

from sqlalchemy.orm import Session

from app.models.models import AppSetting

DEFAULTS: dict[str, Any] = {
    "reminder_days_before": 7,
    "due_tomorrow_days_before": 1,
    "escalation_thresholds": [
        {"days": 1, "levels": ["PRIMARY"]},
        {"days": 3, "levels": ["PRIMARY", "SUPERVISOR"]},
        {"days": 7, "levels": ["PRIMARY", "SUPERVISOR", "MANAGER"]},
    ],
    "week_band_size_days": 7,
    "week_start_offset_days": 1,
    "labor_hour_cost": 300,
    "downtime_minute_cost": 20,
    "reminder_cc_emails": [],
    "currency": "INR",
    "stock_adjustment_approval_value": 10000,   # stock adjustments worth more than this need a manager
    "cost_approval_manager_threshold": 50000,   # external/other costs above this need a manager to approve
    "recurrence_window_days": 30,               # same machine failing again within this many days = repeat breakdown
    "mtbf_min_failures": 3,                     # fewer failures than this = not enough data for MTBF
    "alert_emails_critical_breakdown": True,    # email managers/admins when a HIGH/CRITICAL breakdown is reported
}

DESCRIPTIONS: dict[str, str] = {
    "reminder_days_before": "Days before the planned date to send the first 'upcoming' reminder.",
    "due_tomorrow_days_before": "Days before the planned date to send the 'due tomorrow' reminder.",
    "escalation_thresholds": "Overdue escalation ladder: list of {days, levels[]} — who gets notified at each threshold.",
    "week_band_size_days": "Locked business rule: width (in days) of each W1-W5 band when converting week codes to calendar dates.",
    "week_start_offset_days": "Day-of-month that band W1 starts on (normally 1).",
    "labor_hour_cost": "Cost per labor hour (currency units) used to estimate work-order labor cost.",
    "downtime_minute_cost": "Cost per minute of production downtime (currency units) used to estimate downtime cost.",
    "currency": "Currency code shown with every cost (INR, USD, ...).",
    "stock_adjustment_approval_value": "Stock adjustments worth more than this (quantity x unit cost) need a manager or admin.",
    "cost_approval_manager_threshold": "External services / other costs above this amount need a manager or admin to approve.",
    "recurrence_window_days": "A breakdown on the same machine within this many days of the previous one counts as a repeat.",
    "mtbf_min_failures": "Minimum number of failures before MTBF is shown (below this there is not enough data).",
    "alert_emails_critical_breakdown": "Email managers and admins as soon as a HIGH or CRITICAL breakdown is reported.",
    "reminder_cc_emails": "Extra email addresses (plant head, shared inbox, etc.) that receive a copy of every PM reminder and escalation, even if they are not employees.",
}


def get_setting(db: Session, key: str, default: Any = None) -> Any:
    row = db.query(AppSetting).filter(AppSetting.key == key).first()
    if row is not None:
        return row.value
    if default is not None:
        return default
    return DEFAULTS.get(key)


def get_all_settings(db: Session) -> dict[str, Any]:
    stored = {row.key: row.value for row in db.query(AppSetting).all()}
    merged = dict(DEFAULTS)
    merged.update(stored)
    return merged


def set_setting(db: Session, key: str, value: Any, updated_by: str = None) -> AppSetting:
    row = db.query(AppSetting).filter(AppSetting.key == key).first()
    if row is None:
        row = AppSetting(key=key, description=DESCRIPTIONS.get(key))
        db.add(row)
    row.value = value
    row.updated_by = updated_by
    db.commit()
    db.refresh(row)
    return row
