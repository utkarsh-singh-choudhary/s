from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.auth import require_roles
from app.core.audit import record_audit
from app.models.models import (ChecklistTemplate, ChecklistTemplateItem, PMChecklistResponse,
                               WorkOrderChecklistResponse, Machine, Employee, Role)
from app.services.checklist_engine import TASK_TYPES, applicable_template, item_dict

router = APIRouter(prefix="/api/checklists", tags=["checklists"])

ManageRoles = require_roles(Role.ADMIN, Role.MANAGER)


class ChecklistItemIn(BaseModel):
    text: str
    required: bool = True
    requires_reading: bool = False
    reading_unit: str | None = None
    critical: bool = False
    evidence_on_fail: bool = False


class ChecklistTemplateIn(BaseModel):
    name: str
    description: str | None = None
    task_type: str = "PM"
    machine_type: str | None = None
    items: list[ChecklistItemIn] = []


class ChecklistTemplateUpdateIn(BaseModel):
    name: str | None = None
    description: str | None = None
    task_type: str | None = None
    machine_type: str | None = None
    items: list[ChecklistItemIn] | None = None
    # items, when provided, is the new full list. Existing items are matched
    # by text so their ids (and the PM history pointing at them) are kept;
    # removed items that have history are switched off (active=False), never
    # deleted.


def _check_task_type(v: str) -> str:
    v = (v or "PM").upper()
    if v not in TASK_TYPES:
        raise HTTPException(400, f"task_type must be one of {', '.join(TASK_TYPES)}")
    return v


def _clean_item(item: ChecklistItemIn) -> dict:
    text = (item.text or "").strip()
    if not text:
        raise HTTPException(400, "Checklist item text cannot be empty")
    return {
        "text": text,
        "required": bool(item.required or item.critical),  # a critical item is always mandatory
        "requires_reading": bool(item.requires_reading),
        "reading_unit": (item.reading_unit or "").strip() or None if item.requires_reading else None,
        "critical": bool(item.critical),
        "evidence_on_fail": bool(item.evidence_on_fail),
    }


def _serialize(t: ChecklistTemplate) -> dict:
    return {
        "id": t.id,
        "name": t.name,
        "description": t.description,
        "active": t.active,
        "task_type": t.task_type or "PM",
        "machine_type": t.machine_type,
        "version": t.version or 1,
        "items": [item_dict(i) for i in sorted(t.items, key=lambda x: x.sequence) if i.active is not False],
    }


@router.get("")
def list_templates(include_inactive: bool = False, db: Session = Depends(get_db)):
    q = db.query(ChecklistTemplate)
    if not include_inactive:
        q = q.filter(ChecklistTemplate.active.is_(True))
    return [_serialize(t) for t in q.order_by(ChecklistTemplate.name).all()]


@router.get("/{template_id}")
def get_template(template_id: str, db: Session = Depends(get_db)):
    t = db.query(ChecklistTemplate).get(template_id)
    if not t:
        raise HTTPException(404, "Checklist template not found")
    return _serialize(t)


@router.post("")
def create_template(payload: ChecklistTemplateIn, db: Session = Depends(get_db), user: Employee = Depends(ManageRoles)):
    if not payload.name.strip():
        raise HTTPException(400, "Template name is required")
    template = ChecklistTemplate(name=payload.name.strip(), description=payload.description,
                                 task_type=_check_task_type(payload.task_type),
                                 machine_type=(payload.machine_type or "").strip() or None, version=1)
    db.add(template)
    db.flush()
    for idx, item in enumerate(payload.items):
        db.add(ChecklistTemplateItem(template_id=template.id, sequence=idx, active=True, **_clean_item(item)))
    db.commit()
    db.refresh(template)
    record_audit(db, action="CHECKLIST_TEMPLATE_CREATED", entity_type="ChecklistTemplate", entity_id=template.id,
                 actor_id=user.id, new_value={"name": template.name, "item_count": len(payload.items)})
    return _serialize(template)


@router.put("/{template_id}")
def update_template(
    template_id: str,
    payload: ChecklistTemplateUpdateIn,
    db: Session = Depends(get_db),
    user: Employee = Depends(ManageRoles),
):
    template = db.query(ChecklistTemplate).get(template_id)
    if not template:
        raise HTTPException(404, "Checklist template not found")

    old_value = {"name": template.name, "description": template.description, "version": template.version,
                 "task_type": template.task_type, "machine_type": template.machine_type,
                 "item_count": len([i for i in template.items if i.active is not False])}

    if payload.name is not None:
        template.name = payload.name
    if payload.description is not None:
        template.description = payload.description
    if payload.task_type is not None:
        template.task_type = _check_task_type(payload.task_type)
    if payload.machine_type is not None:
        template.machine_type = payload.machine_type.strip() or None
    if payload.items is not None:
        existing = [i for i in template.items if i.active is not False]
        before = sorted([(i.sequence, i.text, bool(i.required), bool(i.requires_reading), i.reading_unit or "",
                          bool(i.critical), bool(i.evidence_on_fail)) for i in existing])
        by_text: dict[str, list] = {}
        for i in existing:
            by_text.setdefault(i.text.strip().lower(), []).append(i)
        kept_ids = set()
        for idx, item in enumerate(payload.items):
            data = _clean_item(item)
            bucket = by_text.get(data["text"].lower())
            if bucket:
                row = bucket.pop(0)
                row.sequence = idx
                for k, v in data.items():
                    setattr(row, k, v)
                kept_ids.add(row.id)
            else:
                db.add(ChecklistTemplateItem(template_id=template.id, sequence=idx, active=True, **data))
        for row in existing:
            if row.id in kept_ids:
                continue
            has_history = (
                db.query(PMChecklistResponse).filter(PMChecklistResponse.checklist_template_item_id == row.id).first()
                or db.query(WorkOrderChecklistResponse).filter(
                    WorkOrderChecklistResponse.checklist_template_item_id == row.id).first()
            ) is not None
            if has_history:
                row.active = False
            else:
                db.delete(row)
        after = sorted([(idx, _clean_item(it)["text"], _clean_item(it)["required"], _clean_item(it)["requires_reading"],
                         _clean_item(it)["reading_unit"] or "", _clean_item(it)["critical"],
                         _clean_item(it)["evidence_on_fail"]) for idx, it in enumerate(payload.items)])
        if before != after:
            # Items changed: new version. Past answers keep the item text and
            # version they were recorded against (snapshotted at completion).
            template.version = (template.version or 1) + 1

    db.commit()
    db.refresh(template)

    record_audit(db, action="CHECKLIST_TEMPLATE_UPDATED", entity_type="ChecklistTemplate", entity_id=template.id,
                 actor_id=user.id, old_value=old_value,
                 new_value={"name": template.name, "description": template.description, "version": template.version,
                            "task_type": template.task_type, "machine_type": template.machine_type,
                            "item_count": len([i for i in template.items if i.active is not False])})
    return _serialize(template)


@router.post("/{template_id}/deactivate")
def deactivate_template(template_id: str, db: Session = Depends(get_db), user: Employee = Depends(ManageRoles)):
    """
    Soft-delete: machines currently assigned to this template, and past
    PMChecklistResponse rows, keep working exactly as before - this only
    hides the template from the create/assign pickers (the active_only
    filter list_templates already applies by default).
    """
    template = db.query(ChecklistTemplate).get(template_id)
    if not template:
        raise HTTPException(404, "Checklist template not found")

    old_active = template.active
    template.active = False
    db.commit()
    record_audit(db, action="CHECKLIST_TEMPLATE_DEACTIVATED", entity_type="ChecklistTemplate", entity_id=template.id,
                 actor_id=user.id, old_value={"active": old_active}, new_value={"active": False})
    return _serialize(template)


@router.post("/{template_id}/restore")
def restore_template(template_id: str, db: Session = Depends(get_db), user: Employee = Depends(ManageRoles)):
    template = db.query(ChecklistTemplate).get(template_id)
    if not template:
        raise HTTPException(404, "Checklist template not found")

    old_active = template.active
    template.active = True
    db.commit()
    record_audit(db, action="CHECKLIST_TEMPLATE_RESTORED", entity_type="ChecklistTemplate", entity_id=template.id,
                 actor_id=user.id, old_value={"active": old_active}, new_value={"active": True})
    return _serialize(template)


@router.post("/{template_id}/assign/{machine_id}")
def assign_template_to_machine(
    template_id: str, machine_id: str,
    db: Session = Depends(get_db), user: Employee = Depends(ManageRoles),
):
    machine = db.query(Machine).get(machine_id)
    if not machine:
        raise HTTPException(404, "Machine not found")
    if not db.query(ChecklistTemplate).get(template_id):
        raise HTTPException(404, "Checklist template not found")
    old_template_id = machine.checklist_template_id
    machine.checklist_template_id = template_id
    db.commit()
    record_audit(db, action="CHECKLIST_TEMPLATE_ASSIGNED", entity_type="Machine", entity_id=machine.id,
                 actor_id=user.id, old_value={"checklist_template_id": old_template_id},
                 new_value={"checklist_template_id": template_id})
    return {"machine_id": machine_id, "checklist_template_id": template_id}


@router.get("/for-machine/{machine_id}")
def get_template_for_machine(machine_id: str, task_type: str = "PM", db: Session = Depends(get_db)):
    """What the 'complete' screen should render for this machine and job type - empty items list if none applies."""
    machine = db.query(Machine).get(machine_id)
    task_type = _check_task_type(task_type)
    template = applicable_template(db, machine, task_type)
    if not template:
        return {"template_id": None, "version": None, "task_type": task_type, "items": []}
    return {
        "template_id": template.id, "name": template.name, "version": template.version or 1,
        "task_type": template.task_type,
        "items": [item_dict(i) for i in sorted(template.items, key=lambda x: x.sequence) if i.active is not False],
    }
