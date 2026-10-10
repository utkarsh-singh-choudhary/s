from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.auth import require_roles
from app.core.audit import record_audit
from app.models.models import ChecklistTemplate, ChecklistTemplateItem, Machine, Employee, Role

router = APIRouter(prefix="/api/checklists", tags=["checklists"])

ManageRoles = require_roles(Role.ADMIN, Role.MANAGER)


class ChecklistItemIn(BaseModel):
    text: str
    required: bool = True


class ChecklistTemplateIn(BaseModel):
    name: str
    description: str | None = None
    items: list[ChecklistItemIn] = []


class ChecklistTemplateUpdateIn(BaseModel):
    name: str | None = None
    description: str | None = None
    items: list[ChecklistItemIn] | None = None
    # items, when provided, REPLACES the whole list (simplest model for a
    # template that's typically edited as a unit - add/remove/reorder all
    # happen by resubmitting the full list from the edit form). Existing
    # PMChecklistResponse rows reference items by id, not by position, so
    # replacing the list doesn't corrupt past completions - it just means a
    # deleted item's historical responses no longer map to a current item,
    # same as it would with a direct DB edit.


def _serialize(t: ChecklistTemplate) -> dict:
    return {
        "id": t.id,
        "name": t.name,
        "description": t.description,
        "active": t.active,
        "items": [{"id": i.id, "sequence": i.sequence, "text": i.text, "required": i.required} for i in t.items],
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
    template = ChecklistTemplate(name=payload.name, description=payload.description)
    db.add(template)
    db.flush()
    for idx, item in enumerate(payload.items):
        db.add(ChecklistTemplateItem(template_id=template.id, sequence=idx, text=item.text, required=item.required))
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

    old_value = {"name": template.name, "description": template.description, "item_count": len(template.items)}

    if payload.name is not None:
        template.name = payload.name
    if payload.description is not None:
        template.description = payload.description
    if payload.items is not None:
        db.query(ChecklistTemplateItem).filter(ChecklistTemplateItem.template_id == template.id).delete()
        for idx, item in enumerate(payload.items):
            db.add(ChecklistTemplateItem(template_id=template.id, sequence=idx, text=item.text, required=item.required))

    db.commit()
    db.refresh(template)

    record_audit(db, action="CHECKLIST_TEMPLATE_UPDATED", entity_type="ChecklistTemplate", entity_id=template.id,
                 actor_id=user.id, old_value=old_value,
                 new_value={"name": template.name, "description": template.description, "item_count": len(template.items)})
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
def get_template_for_machine(machine_id: str, db: Session = Depends(get_db)):
    """What the mobile 'complete PM' screen should render for this machine - empty items list if none assigned."""
    machine = db.query(Machine).get(machine_id)
    if not machine or not machine.checklist_template_id:
        return {"template_id": None, "items": []}
    template = db.query(ChecklistTemplate).get(machine.checklist_template_id)
    return {
        "template_id": template.id,
        "items": [{"id": i.id, "sequence": i.sequence, "text": i.text, "required": i.required}
                  for i in template.items],
    }
