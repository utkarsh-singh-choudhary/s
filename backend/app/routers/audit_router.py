from datetime import date, datetime, time

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.auth import require_roles
from app.models.models import AuditLog, Employee, Role

router = APIRouter(prefix="/api/audit-logs", tags=["audit"])

MAX_LIMIT = 500


def _serialize(log: AuditLog, names: dict) -> dict:
    return {
        "id": log.id,
        "actor_id": log.actor_id,
        "actor_name": names.get(log.actor_id),
        "action": log.action,
        "entity_type": log.entity_type,
        "entity_id": log.entity_id,
        "old_value": log.old_value,
        "new_value": log.new_value,
        "ip_address": log.ip_address,
        "created_at": log.created_at,
    }


@router.get("")
def list_audit_logs(
    db: Session = Depends(get_db),
    limit: int = 100,
    entity_type: str | None = None,
    action: str | None = None,
    actor_id: str | None = None,
    date_from: date | None = None,
    date_to: date | None = None,
    _user=Depends(require_roles(Role.ADMIN, Role.MANAGER)),
):
    limit = min(limit, MAX_LIMIT)
    q = db.query(AuditLog)
    if entity_type:
        q = q.filter(AuditLog.entity_type == entity_type)
    if action:
        q = q.filter(AuditLog.action.ilike(f"%{action}%"))
    if actor_id:
        q = q.filter(AuditLog.actor_id == actor_id)
    if date_from:
        q = q.filter(AuditLog.created_at >= datetime.combine(date_from, time.min))
    if date_to:
        q = q.filter(AuditLog.created_at <= datetime.combine(date_to, time.max))
    logs = q.order_by(AuditLog.created_at.desc()).limit(limit).all()

    actor_ids = {l.actor_id for l in logs if l.actor_id}
    names = {e.id: e.name for e in db.query(Employee).filter(Employee.id.in_(actor_ids)).all()} if actor_ids else {}
    return [_serialize(l, names) for l in logs]


@router.get("/entity-types")
def list_entity_types(db: Session = Depends(get_db), _user=Depends(require_roles(Role.ADMIN, Role.MANAGER))):
    rows = db.query(AuditLog.entity_type).filter(AuditLog.entity_type.isnot(None)).distinct().all()
    return sorted({r[0] for r in rows})
