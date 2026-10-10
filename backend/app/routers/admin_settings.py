from typing import Any

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.core.config import settings as app_settings
from app.core.database import get_db
from app.core.auth import require_roles
from app.core.audit import record_audit
from app.core.settings_service import get_all_settings, set_setting, DESCRIPTIONS, DEFAULTS
from app.models.models import Employee, Role
from app.notifications.base import EmailMessage
from app.notifications.notification_service import get_active_email_provider

router = APIRouter(prefix="/api/admin/settings", tags=["admin"])

AdminOnly = require_roles(Role.ADMIN)


class SettingUpdate(BaseModel):
    value: Any


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

    old = get_all_settings(db).get(key)
    row = set_setting(db, key, payload.value, updated_by=user.id)

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
