from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import Response
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.qrcode_gen import generate_machine_qr_png, machine_deep_link
from app.models.models import Machine
from app.schemas.schemas import MachineOut
from app.reports.health_score import compute_health_score

router = APIRouter(prefix="/api/machines", tags=["machines"])


@router.get("", response_model=list[MachineOut])
def list_machines(db: Session = Depends(get_db), active_only: bool = True):
    q = db.query(Machine)
    if active_only:
        q = q.filter(Machine.active.is_(True))
    return q.order_by(Machine.machine_number).all()


@router.get("/{machine_id}", response_model=MachineOut)
def get_machine(machine_id: str, db: Session = Depends(get_db)):
    return db.query(Machine).get(machine_id)


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
