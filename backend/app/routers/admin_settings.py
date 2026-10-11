import re
from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.core.config import settings as app_settings
from app.core.database import get_db
from app.core.auth import require_roles
from app.core.audit import record_audit
from app.core.settings_service import get_all_settings, get_setting, set_setting, DESCRIPTIONS, DEFAULTS
from app.models.models import Employee, Role, PMPlan, PMStatus, Machine, MachineResponsibility
from app.notifications.base import EmailMessage
from app.notifications.notification_service import get_active_email_provider
from app.jobs.reminder_jobs import run_daily_reminder_job, get_cc_emails, _get_responsible_employees

router = APIRouter(prefix="/api/admin/settings", tags=["admin"])

AdminOnly = require_roles(Role.ADMIN)


class SettingUpdate(BaseModel):
    value: Any


EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
MAX_CC_EMAILS = 20


def _clean_cc_emails(value: Any) -> list:
    if isinstance(value, str):
        value = [v for v in re.split(r"[,;\s]+", value) if v]
    if not isinstance(value, list):
        raise HTTPException(400, "reminder_cc_emails must be a list of email addresses")
    out, bad = [], []
    for item in value:
        addr = str(item).strip().lower()
        if not addr:
            continue
        if not EMAIL_RE.match(addr):
            bad.append(str(item))
        elif addr not in out:
            out.append(addr)
    if bad:
        raise HTTPException(400, f"Invalid email address(es): {', '.join(bad)}")
    if len(out) > MAX_CC_EMAILS:
        raise HTTPException(400, f"At most {MAX_CC_EMAILS} CC addresses are allowed")
    return out


class TestEmailIn(BaseModel):
    to: str


@router.get("")
def list_settings(db: Session = Depends(get_db), _user: Employee = Depends(AdminOnly)):
    """Returns every tunable setting with its current (or default) value and description."""
    current = get_all_settings(db)
    return [
        {"key": key, "value": current.get(key, default), "default": default, "description": DESCRIPTIONS.get(key)}
        for key, default in DEFAULTS.items()
    ]


@router.put("/{key}")
def update_setting(key: str, payload: SettingUpdate, db: Session = Depends(get_db), user: Employee = Depends(AdminOnly)):
    if key not in DEFAULTS:
        return {"error": f"Unknown setting key '{key}'. Known keys: {list(DEFAULTS.keys())}"}

    value = payload.value
    if key == "reminder_cc_emails":
        value = _clean_cc_emails(value)

    old = get_all_settings(db).get(key)
    row = set_setting(db, key, value, updated_by=user.id)

    record_audit(
        db, action="SETTING_UPDATED", entity_type="AppSetting", entity_id=key,
        actor_id=user.id, old_value={"value": old}, new_value={"value": row.value},
    )
    return {"key": row.key, "value": row.value, "description": row.description}


@router.post("/test-email")
def send_test_email(payload: TestEmailIn, db: Session = Depends(get_db), user: Employee = Depends(AdminOnly)):
    if not app_settings.NOTIFICATIONS_ENABLED:
        return {"success": False, "error": "Notifications are globally disabled (NOTIFICATIONS_ENABLED=false)."}

    provider = get_active_email_provider()
    result = provider.send(EmailMessage(
        to=payload.to,
        subject="Test email from Preventive Maintenance system",
        body=f"This is a test email sent by {user.name} via the '{provider.name}' notification provider.",
    ))
    record_audit(db, action="TEST_EMAIL_SENT", entity_type="AppSetting", entity_id="test-email",
                 actor_id=user.id, new_value={"to": payload.to, "provider": provider.name, "success": result["success"]})
    return {"success": result["success"], "provider": provider.name, "error": result.get("error")}


@router.get("/reminder-readiness")
def reminder_readiness(db: Session = Depends(get_db), _user: Employee = Depends(AdminOnly)):
    """
    Shows whether automatic reminders can actually reach someone: is a mail
    provider configured, who the extra CC addresses are, and which machines
    with an open PM plan have nobody who can be notified.
    """
    provider = app_settings.EMAIL_PROVIDER
    if provider == "smtp_generic":
        provider_ok = bool(app_settings.SMTP_HOST and app_settings.SMTP_USERNAME
                           and app_settings.SMTP_PASSWORD and app_settings.EMAIL_FROM)
    elif provider == "gmail":
        provider_ok = bool(app_settings.GMAIL_CLIENT_ID and app_settings.GMAIL_CLIENT_SECRET
                           and app_settings.GMAIL_REFRESH_TOKEN and app_settings.GMAIL_SENDER_ADDRESS)
    elif provider == "m365":
        provider_ok = bool(app_settings.MS365_TENANT_ID and app_settings.MS365_CLIENT_ID
                           and app_settings.MS365_CLIENT_SECRET and app_settings.MS365_SENDER_ADDRESS)
    else:
        provider_ok = False

    active_employees = db.query(Employee).filter(Employee.active.is_(True)).all()
    with_email = [e for e in active_employees if e.email and e.notification_email_enabled]

    open_plans = db.query(PMPlan).filter(
        PMPlan.status.notin_([PMStatus.COMPLETED, PMStatus.CANCELLED, PMStatus.PENDING_SUPERVISOR_CONFIRMATION]),
        PMPlan.planned_date.isnot(None),
    ).all()
    machine_ids = sorted({p.machine_id for p in open_plans})
    unreachable = []
    for mid in machine_ids:
        if not _get_responsible_employees(db, mid, ("PRIMARY",)):
            m = db.query(Machine).get(mid)
            unreachable.append({
                "machine_id": mid,
                "machine_number": getattr(m, "machine_number", None),
                "machine_name": getattr(m, "machine_name", None),
            })

    return {
        "notifications_enabled": app_settings.NOTIFICATIONS_ENABLED,
        "email_provider": provider,
        "email_provider_configured": provider_ok,
        "active_employees": len(active_employees),
        "employees_reachable_by_email": len(with_email),
        "open_plan_machines": len(machine_ids),
        "machines_without_recipient": len(unreachable),
        "machines_without_recipient_list": unreachable[:50],
        "cc_emails": get_cc_emails(db),
        "last_reminder_run": get_setting(db, "last_reminder_run", {}) or None,
        "external_trigger_enabled": bool(app_settings.CRON_SECRET),
    }


@router.post("/run-reminders-now")
def run_reminders_now(db: Session = Depends(get_db), user: Employee = Depends(AdminOnly)):
    """
    Runs the daily reminder job immediately. Safe to press repeatedly: every
    notification is idempotent per plan/type/date, so nothing is sent twice.
    """
    if not app_settings.NOTIFICATIONS_ENABLED:
        raise HTTPException(400, "Notifications are globally disabled (NOTIFICATIONS_ENABLED=false).")
    results = run_daily_reminder_job(db)
    record_audit(db, action="REMINDERS_RUN_MANUALLY", entity_type="AppSetting", entity_id="run-reminders-now",
                 actor_id=user.id, new_value=results)
    return {"success": True, "results": results}
