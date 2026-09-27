import os
import uuid
from datetime import date, datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.database import get_db
from app.core.auth import get_current_user, require_roles
from app.core.audit import record_audit
from app.models.models import PMPlan, PMActual, PMStatus, CompletionClass, Employee, Role, Machine, ChecklistTemplateItem, PMChecklistResponse
from app.schemas.schemas import PMPlanOut, PMCompleteIn
from app.core.timeutils import today_local

router = APIRouter(prefix="/api/pm", tags=["pm"])

# Proof-of-work attachments (photo of the completed job, filled checklist, etc.
# — spec section 13). ATTACHMENT_DIR is configurable (settings.ATTACHMENT_DIR,
# env ATTACHMENT_DIR) and defaults to a persistent path, NOT /tmp - a
# container recreate wipes /tmp, and these files are audit evidence of
# completed maintenance. Mount a volume at this path (see docker-compose.yml)
# or swap this for an S3/Azure Blob client; the path stored on
# PMActual.attachment_path is all downstream code depends on.
ATTACHMENT_DIR = settings.ATTACHMENT_DIR
os.makedirs(ATTACHMENT_DIR, exist_ok=True)
ALLOWED_ATTACHMENT_EXT = {".jpg", ".jpeg", ".png", ".pdf", ".heic", ".webp"}
MAX_ATTACHMENT_BYTES = 15 * 1024 * 1024  # 15 MB


@router.get("", response_model=list[PMPlanOut])
def list_pm(db: Session = Depends(get_db), status: str | None = None, machine_id: str | None = None):
    q = db.query(PMPlan)
    if status:
        q = q.filter(PMPlan.status == status)
    if machine_id:
        q = q.filter(PMPlan.machine_id == machine_id)
    return q.order_by(PMPlan.planned_date).all()


@router.get("/upcoming", response_model=list[PMPlanOut])
def upcoming(db: Session = Depends(get_db), days: int = 14):
    today = today_local()
    return db.query(PMPlan).filter(
        PMPlan.planned_date >= today,
        PMPlan.planned_date <= today.fromordinal(today.toordinal() + days),
        PMPlan.status.notin_([PMStatus.COMPLETED, PMStatus.CANCELLED, PMStatus.PENDING_SUPERVISOR_CONFIRMATION]),
    ).order_by(PMPlan.planned_date).all()


@router.get("/overdue", response_model=list[PMPlanOut])
def overdue(db: Session = Depends(get_db)):
    today = today_local()
    return db.query(PMPlan).filter(
        PMPlan.planned_date < today,
        PMPlan.status.notin_([PMStatus.COMPLETED, PMStatus.CANCELLED, PMStatus.PENDING_SUPERVISOR_CONFIRMATION]),
    ).order_by(PMPlan.planned_date).all()


@router.get("/mine", response_model=list[PMPlanOut])
def list_my_pm(db: Session = Depends(get_db), user: Employee = Depends(get_current_user)):
    """
    PM plans on machines this technician is responsible for (Future-Ready
    item 5: technician view). Returns everything not yet completed/cancelled
    plus anything completed in the last 3 days, so a shift can still see what
    it just finished without pulling the whole history.
    """
    from app.models.models import MachineResponsibility

    machine_ids = [
        r.machine_id
        for r in db.query(MachineResponsibility).filter(MachineResponsibility.employee_id == user.id).all()
    ]
    if not machine_ids:
        return []

    cutoff = today_local() - timedelta(days=3)
    q = db.query(PMPlan).filter(
        PMPlan.machine_id.in_(machine_ids),
        (PMPlan.status != PMStatus.COMPLETED) | (PMPlan.planned_date >= cutoff),
        PMPlan.status != PMStatus.CANCELLED,
    )
    return q.order_by(PMPlan.planned_date.asc()).all()


@router.get("/{pm_id}", response_model=PMPlanOut)
def get_pm(pm_id: str, db: Session = Depends(get_db)):
    plan = db.query(PMPlan).get(pm_id)
    if not plan:
        raise HTTPException(404, "PM plan not found")
    return plan


@router.post("/{pm_id}/complete")
async def complete_pm(
    pm_id: str,
    actual_date: date = Form(...),
    completed_by: str | None = Form(None),
    remarks: str | None = Form(None),
    delay_reason: str | None = Form(None),
    downtime_minutes: int | None = Form(None),
    checklist_responses: str | None = Form(None),  # JSON: [{"item_id": "...", "checked": true, "note": "..."}]
    attachment: UploadFile | None = File(None),
    db: Session = Depends(get_db),
    user: Employee = Depends(require_roles(Role.TECHNICIAN, Role.SUPERVISOR, Role.MANAGER, Role.ADMIN)),
):
    """
    Marks a PM plan complete. Accepts multipart/form-data so a proof-of-work
    photo or scanned checklist can be attached in the same call (spec section
    13) — `attachment` is optional; JSON-only clients can simply omit it.

    If the machine has a checklist template assigned (Future-Ready item
    C.4: checklist-per-PM-type instead of a single done/not-done), every
    `required` item on that template must be checked or this call is
    rejected with 400 - a technician can't tick "PM complete" while
    skipping a mandatory sub-step, which is the whole point of moving off
    a single done/not-done flag.
    """
    import json as _json

    plan = db.query(PMPlan).get(pm_id)
    if not plan:
        raise HTTPException(404, "PM plan not found")

    machine = db.query(Machine).get(plan.machine_id)
    responses = _json.loads(checklist_responses) if checklist_responses else []
    if machine and machine.checklist_template_id:
        template_items = db.query(ChecklistTemplateItem).filter(
            ChecklistTemplateItem.template_id == machine.checklist_template_id
        ).all()
        checked_item_ids = {r["item_id"] for r in responses if r.get("checked")}
        missing_required = [i.text for i in template_items if i.required and i.id not in checked_item_ids]
        if missing_required:
            raise HTTPException(
                400,
                f"Cannot mark complete - required checklist item(s) not checked: {', '.join(missing_required)}",
            )

    old_status = plan.status.value if plan.status else None
    actual = db.query(PMActual).filter(PMActual.pm_plan_id == pm_id).first()
    is_new = actual is None
    if not actual:
        actual = PMActual(pm_plan_id=pm_id)
        db.add(actual)

    actual.actual_date = actual_date
    actual.completed_by = completed_by or user.id
    actual.remarks = remarks
    actual.delay_reason = delay_reason
    actual.downtime_minutes = downtime_minutes
    db.flush()  # need actual.id before saving checklist responses

    if not is_new:
        db.query(PMChecklistResponse).filter(PMChecklistResponse.pm_actual_id == actual.id).delete()
    for r in responses:
        db.add(PMChecklistResponse(
            pm_actual_id=actual.id, checklist_template_item_id=r["item_id"],
            checked=bool(r.get("checked")), note=r.get("note"),
        ))

    if attachment is not None and attachment.filename:
        ext = os.path.splitext(attachment.filename)[1].lower()
        if ext not in ALLOWED_ATTACHMENT_EXT:
            raise HTTPException(400, f"Unsupported attachment type '{ext}'. Allowed: {sorted(ALLOWED_ATTACHMENT_EXT)}")
        contents = await attachment.read()
        if len(contents) > MAX_ATTACHMENT_BYTES:
            raise HTTPException(400, "Attachment exceeds 15 MB limit.")
        stored_name = f"{pm_id}_{uuid.uuid4().hex[:8]}{ext}"
        stored_path = os.path.join(ATTACHMENT_DIR, stored_name)
        with open(stored_path, "wb") as f:
            f.write(contents)
        actual.attachment_path = stored_path

    if plan.planned_date:
        delay = (actual_date - plan.planned_date).days
        actual.delay_days = delay
        actual.completion_class = (
            CompletionClass.ON_TIME if delay <= 0 else CompletionClass.LATE
        ) if delay >= 0 else CompletionClass.EARLY

    # Critical machines (`*`-flagged) need a second set of eyes: a technician
    # self-reporting completion only gets the job to PENDING_SUPERVISOR_
    # CONFIRMATION, not COMPLETED - closes the "self-reported completion"
    # accuracy gap the customer flagged. A supervisor/manager/admin acting
    # here (e.g. confirming on a technician's behalf) can complete directly,
    # since that already is the second set of eyes.
    machine = db.query(Machine).get(plan.machine_id)
    requires_sign_off = bool(machine and machine.critical and user.role == Role.TECHNICIAN)

    plan.status = PMStatus.PENDING_SUPERVISOR_CONFIRMATION if requires_sign_off else PMStatus.COMPLETED
    plan.completed_by_technician_id = user.id
    if not requires_sign_off:
        plan.confirmed_by_supervisor_id = user.id
        plan.confirmed_at = datetime.utcnow()
    db.commit()

    record_audit(
        db,
        action="PM_CREATED" if is_new else "PM_MODIFIED",
        entity_type="PMPlan",
        entity_id=pm_id,
        actor_id=user.id,
        old_value={"status": old_status},
        new_value={"status": plan.status.value, "actual_date": str(actual_date),
                   "completion_class": actual.completion_class.value if actual.completion_class else None,
                   "has_attachment": bool(actual.attachment_path)},
    )

    return {
        "success": True, "pm_id": pm_id,
        "status": plan.status.value,
        "completion_class": actual.completion_class,
        "has_attachment": bool(actual.attachment_path),
        "awaiting_supervisor_confirmation": requires_sign_off,
    }


@router.post("/{pm_id}/confirm")
def confirm_pm(
    pm_id: str,
    db: Session = Depends(get_db),
    user: Employee = Depends(require_roles(Role.SUPERVISOR, Role.MANAGER, Role.ADMIN)),
):
    """
    Supervisor sign-off step for critical-machine completions. Only moves a
    plan from PENDING_SUPERVISOR_CONFIRMATION -> COMPLETED; a supervisor
    can't rubber-stamp a job that was never marked done by a technician.
    """
    plan = db.query(PMPlan).get(pm_id)
    if not plan:
        raise HTTPException(404, "PM plan not found")
    if plan.status != PMStatus.PENDING_SUPERVISOR_CONFIRMATION:
        raise HTTPException(400, f"PM plan is not awaiting confirmation (status={plan.status.value}).")

    plan.status = PMStatus.COMPLETED
    plan.confirmed_by_supervisor_id = user.id
    plan.confirmed_at = datetime.utcnow()
    db.commit()

    record_audit(
        db, action="PM_MODIFIED", entity_type="PMPlan", entity_id=pm_id, actor_id=user.id,
        old_value={"status": "PENDING_SUPERVISOR_CONFIRMATION"},
        new_value={"status": "COMPLETED", "confirmed_by_supervisor_id": user.id},
    )
    return {"success": True, "pm_id": pm_id, "status": "COMPLETED"}


@router.get("/{pm_id}/attachment")
def get_attachment(
    pm_id: str,
    db: Session = Depends(get_db),
    _user: Employee = Depends(get_current_user),
):
    actual = db.query(PMActual).filter(PMActual.pm_plan_id == pm_id).first()
    if not actual or not actual.attachment_path or not os.path.exists(actual.attachment_path):
        raise HTTPException(404, "No attachment for this PM completion")
    return FileResponse(actual.attachment_path)
