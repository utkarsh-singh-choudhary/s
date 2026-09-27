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
}

DESCRIPTIONS: dict[str, str] = {
    "reminder_days_before": "Days before the planned date to send the first 'upcoming' reminder.",
    "due_tomorrow_days_before": "Days before the planned date to send the 'due tomorrow' reminder.",
    "escalation_thresholds": "Overdue escalation ladder: list of {days, levels[]} — who gets notified at each threshold.",
    "week_band_size_days": "Locked business rule: width (in days) of each W1-W5 band when converting week codes to calendar dates.",
    "week_start_offset_days": "Day-of-month that band W1 starts on (normally 1).",
    "labor_hour_cost": "Cost per labor hour (currency units) used to estimate work-order labor cost.",
    "downtime_minute_cost": "Cost per minute of production downtime (currency units) used to estimate downtime cost.",
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
