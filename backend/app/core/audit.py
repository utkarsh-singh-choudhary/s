"""
Central place to write AuditLog rows. Call this from any endpoint/job that
performs a meaningful state change, so "who changed this and when" is always
answerable (per spec section 18).

Each row is signed with an HMAC (key = JWT_SECRET). Anyone who edits an audit
row directly in the database cannot produce a valid signature, so
`verify_signature` / GET /api/audit-logs/verify can show tampering.
"""

import hashlib
import hmac
import json
from datetime import datetime

from sqlalchemy.orm import Session

from app.core.config import settings
from app.models.models import AuditLog, gen_uuid


def _canon(value) -> str:
    return json.dumps(value, sort_keys=True, default=str, separators=(",", ":"))


def sign_fields(id_, actor_id, action, entity_type, entity_id, old_value, new_value, ip_address, created_at) -> str:
    ts = created_at.replace(microsecond=0).isoformat() if created_at else ""
    payload = "|".join([
        str(id_), str(actor_id or ""), str(action or ""), str(entity_type or ""), str(entity_id or ""),
        hashlib.sha256(_canon(old_value).encode()).hexdigest(),
        hashlib.sha256(_canon(new_value).encode()).hexdigest(),
        str(ip_address or ""), ts,
    ])
    return hmac.new(settings.JWT_SECRET.encode(), payload.encode(), hashlib.sha256).hexdigest()


def verify_signature(log: AuditLog) -> bool | None:
    """True = intact, False = changed after it was written, None = old row written before signing existed."""
    if not log.signature:
        return None
    expected = sign_fields(log.id, log.actor_id, log.action, log.entity_type, log.entity_id,
                           log.old_value, log.new_value, log.ip_address, log.created_at)
    return hmac.compare_digest(expected, log.signature)


def record_audit(
    db: Session,
    action: str,
    entity_type: str = None,
    entity_id: str = None,
    actor_id: str = None,
    old_value: dict = None,
    new_value: dict = None,
    ip_address: str = None,
    commit: bool = True,
):
    log_id = gen_uuid()
    created_at = datetime.utcnow()
    entity_id = str(entity_id) if entity_id else None
    log = AuditLog(
        id=log_id,
        actor_id=actor_id,
        action=action,
        entity_type=entity_type,
        entity_id=entity_id,
        old_value=old_value,
        new_value=new_value,
        ip_address=ip_address,
        created_at=created_at,
        signature=sign_fields(log_id, actor_id, action, entity_type, entity_id, old_value, new_value, ip_address, created_at),
    )
    db.add(log)
    if commit:
        db.commit()
    return log
