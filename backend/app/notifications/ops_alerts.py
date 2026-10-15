"""One-off operational alerts (not tied to a PM plan): e.g. a critical breakdown was just reported."""

from sqlalchemy.orm import Session

from app.core.audit import record_audit
from app.core.config import settings
from app.models.models import Employee, Role
from app.notifications.base import EmailMessage
from app.notifications.notification_service import get_active_email_provider


def send_ops_alert(db: Session, subject: str, body: str, roles=(Role.ADMIN, Role.MANAGER),
                   entity_type: str = None, entity_id: str = None) -> dict:
    """Best effort: never raises, never blocks the request. Failures are written to the audit log."""
    result = {"sent": 0, "failed": 0, "skipped_reason": None}
    try:
        if not settings.NOTIFICATIONS_ENABLED:
            result["skipped_reason"] = "notifications disabled"
            return result
        people = db.query(Employee).filter(
            Employee.active.is_(True), Employee.role.in_(list(roles)), Employee.email.isnot(None),
            Employee.notification_email_enabled.is_(True)).all()
        if not people:
            result["skipped_reason"] = "no manager/admin with an email address"
            return result
        provider = get_active_email_provider()
        for p in people:
            r = provider.send(EmailMessage(to=p.email, subject=subject, body=body))
            if r.get("success"):
                result["sent"] += 1
            else:
                result["failed"] += 1
        if result["failed"]:
            record_audit(db, action="ALERT_EMAIL_FAILED", entity_type=entity_type, entity_id=entity_id,
                         new_value={"subject": subject, "failed": result["failed"]})
    except Exception as exc:  # noqa: BLE001 - an alert must never break the workflow that triggered it
        result["skipped_reason"] = f"error: {exc}"
    return result
