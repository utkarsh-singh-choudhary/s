from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import Response
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.auth import require_roles
from app.core.audit import record_audit
from app.core.qrcode_gen import generate_machine_qr_png, machine_deep_link
from app.models.models import Machine, Employee, Role
from app.schemas.schemas import MachineOut
from app.reports.health_score import compute_health_score

router = APIRouter(prefix="/api/machines", tags=["machines"])

# Machines are shared operational master data - creating/editing/archiving
# one affects every PM plan, work order, and report built on top of it, so
# this is gated the same way other master-data changes are (import_router
# uses the same ADMIN+MANAGER pairing).
ManageMachines = require_roles(Role.ADMIN, Role.MANAGER)


class MachineIn(BaseModel):
    machine_number: str
    machine_name: str
    manufacturer: str | None = None
    specification: str | None = None
    location: str | None = None
    remarks: str | None = None
    critical: bool = False
    checklist_template_id: str | None = None


class MachineUpdate(BaseModel):
    machine_number: str | None = None
    machine_name: str | None = None
    manufacturer: str | None = None
    specification: str | None = None
    location: str | None = None
    remarks: str | None = None
    critical: bool | None = None
    checklist_template_id: str | None = None


@router.get("", response_model=list[MachineOut])
def list_machines(db: Session = Depends(get_db), active_only: bool = True):
    q = db.query(Machine)
    if active_only:
        q = q.filter(Machine.active.is_(True))
    return q.order_by(Machine.machine_number).all()


@router.post("", response_model=MachineOut)
def create_machine(
    payload: MachineIn,
    db: Session = Depends(get_db),
    user: Employee = Depends(ManageMachines),
):
    dupe = db.query(Machine).filter(
        Machine.machine_number.ilike(payload.machine_number), Machine.active.is_(True)
    ).first()
    if dupe:
        raise HTTPException(409, f"An active machine with number '{payload.machine_number}' already exists")

    machine = Machine(
        machine_number=payload.machine_number,
        machine_name=payload.machine_name,
        manufacturer=payload.manufacturer,
        specification=payload.specification,
        location=payload.location,
        remarks=payload.remarks,
        critical=payload.critical,
        checklist_template_id=payload.checklist_template_id,
    )
    db.add(machine)
    db.commit()
    db.refresh(machine)

    record_audit(db, action="MACHINE_CREATED", entity_type="Machine", entity_id=machine.id,
                 actor_id=user.id, new_value={"machine_number": machine.machine_number, "machine_name": machine.machine_name})
    return machine


@router.get("/{machine_id}", response_model=MachineOut)
def get_machine(machine_id: str, db: Session = Depends(get_db)):
    machine = db.query(Machine).get(machine_id)
    if not machine:
        raise HTTPException(404, "Machine not found")
    return machine


@router.put("/{machine_id}", response_model=MachineOut)
def update_machine(
    machine_id: str,
    payload: MachineUpdate,
    db: Session = Depends(get_db),
    user: Employee = Depends(ManageMachines),
):
    machine = db.query(Machine).get(machine_id)
    if not machine:
        raise HTTPException(404, "Machine not found")

    requested = payload.model_dump(exclude_unset=True)

    if "machine_number" in requested and requested["machine_number"] != machine.machine_number:
        dupe = db.query(Machine).filter(
            Machine.machine_number.ilike(requested["machine_number"]),
            Machine.active.is_(True),
            Machine.id != machine.id,
        ).first()
        if dupe:
            raise HTTPException(409, f"An active machine with number '{requested['machine_number']}' already exists")

    old_value = {
        "machine_number": machine.machine_number, "machine_name": machine.machine_name,
        "location": machine.location, "critical": machine.critical,
        "checklist_template_id": machine.checklist_template_id,
    }

    for field, value in requested.items():
        setattr(machine, field, value)

    db.commit()
    db.refresh(machine)

    new_value = {
        "machine_number": machine.machine_number, "machine_name": machine.machine_name,
        "location": machine.location, "critical": machine.critical,
        "checklist_template_id": machine.checklist_template_id,
    }
    record_audit(db, action="MACHINE_UPDATED", entity_type="Machine", entity_id=machine.id,
                 actor_id=user.id, old_value=old_value, new_value=new_value)
    return machine


@router.post("/{machine_id}/archive", response_model=MachineOut)
def archive_machine(machine_id: str, db: Session = Depends(get_db), user: Employee = Depends(ManageMachines)):
    """
    Soft-delete: a machine with PM history, work orders, or breakdown
    records can't be hard-deleted without orphaning that history, so this
    just hides it from the active list (active=False) - matching the
    active_only filter list_machines already applies. Nothing referencing
    this machine is touched.
    """
    machine = db.query(Machine).get(machine_id)
    if not machine:
        raise HTTPException(404, "Machine not found")

    old_active = machine.active
    machine.active = False
    db.commit()
    db.refresh(machine)

    record_audit(db, action="MACHINE_ARCHIVED", entity_type="Machine", entity_id=machine.id,
                 actor_id=user.id, old_value={"active": old_active}, new_value={"active": False})
    return machine


@router.post("/{machine_id}/restore", response_model=MachineOut)
def restore_machine(machine_id: str, db: Session = Depends(get_db), user: Employee = Depends(ManageMachines)):
    machine = db.query(Machine).get(machine_id)
    if not machine:
        raise HTTPException(404, "Machine not found")

    old_active = machine.active
    machine.active = True
    db.commit()
    db.refresh(machine)

    record_audit(db, action="MACHINE_RESTORED", entity_type="Machine", entity_id=machine.id,
                 actor_id=user.id, old_value={"active": old_active}, new_value={"active": True})
    return machine


@router.get("/{machine_id}/health-score")
def get_machine_health_score(machine_id: str, db: Session = Depends(get_db)):
    machine = db.query(Machine).get(machine_id)
    if not machine:
        raise HTTPException(404, "Machine not found")
    return compute_health_score(db, machine)


@router.get("/{machine_id}/qrcode")
def get_machine_qrcode(machine_id: str, db: Session = Depends(get_db)):
    """
    PNG QR code for this machine, to print and stick on the physical
    machine. Scanning it opens `{APP_URL}/m/{machine_id}` on whatever
    device scanned it - the frontend's responsive mobile view.
    """
    machine = db.query(Machine).get(machine_id)
    if not machine:
        return Response(status_code=404)
    png_bytes = generate_machine_qr_png(machine_id)
    return Response(content=png_bytes, media_type="image/png")


@router.get("/qrcodes/batch")
def get_machine_qrcode_links(db: Session = Depends(get_db), active_only: bool = True):
    """
    Bulk listing of machine_id -> deep link + qrcode image URL, for a
    frontend "print all labels" page (one QR-per-machine sheet) rather
    than fetching one image at a time.
    """
    q = db.query(Machine)
    if active_only:
        q = q.filter(Machine.active.is_(True))
    machines = q.order_by(Machine.machine_number).all()
    return [
        {
            "machine_id": m.id,
            "machine_number": m.machine_number,
            "machine_name": m.machine_name,
            "deep_link": machine_deep_link(m.id),
            "qrcode_url": f"/api/machines/{m.id}/qrcode",
        }
        for m in machines
    ]
