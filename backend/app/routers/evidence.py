"""Photos / PDFs attached to breakdowns and work orders (stored in the database, checked by content)."""

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from fastapi.responses import Response
from sqlalchemy.orm import Session

from app.core.audit import record_audit
from app.core.auth import get_current_user, require_roles
from app.core.database import get_db
from app.core.files import ALLOWED_EXT, MAX_FILE_BYTES, MAX_FILES_PER_ENTITY, safe_filename, sniff_content_type
import os

from app.models.models import BreakdownEvent, Employee, EvidenceFile, Role, WorkOrder, WorkOrderStatus

router = APIRouter(prefix="/api/evidence", tags=["evidence"])

UploadRoles = require_roles(Role.TECHNICIAN, Role.SUPERVISOR, Role.MANAGER, Role.ADMIN)
ENTITIES = {"breakdown": BreakdownEvent, "work_order": WorkOrder}


def _entity(db: Session, entity_type: str, entity_id: str):
    model = ENTITIES.get(entity_type)
    if not model:
        raise HTTPException(404, "Unknown record type")
    obj = db.query(model).get(entity_id)
    if not obj:
        raise HTTPException(404, "Record not found")
    return obj


def _closed(entity_type: str, obj) -> bool:
    if entity_type == "breakdown":
        return obj.status == "CLOSED"
    return bool(obj.cancelled) or obj.status in (WorkOrderStatus.CLOSED,)


def _meta(f: EvidenceFile, names: dict) -> dict:
    return {"id": f.id, "filename": f.filename, "content_type": f.content_type, "size_bytes": f.size_bytes,
            "label": f.label, "uploaded_by_name": names.get(f.uploaded_by), "created_at": f.created_at}


@router.get("/{entity_type}/{entity_id}")
def list_files(entity_type: str, entity_id: str, db: Session = Depends(get_db), _user: Employee = Depends(get_current_user)):
    _entity(db, entity_type, entity_id)
    rows = db.query(EvidenceFile).filter(EvidenceFile.entity_type == entity_type, EvidenceFile.entity_id == entity_id) \
        .order_by(EvidenceFile.created_at).all()
    ids = {r.uploaded_by for r in rows if r.uploaded_by}
    names = {e.id: e.name for e in db.query(Employee).filter(Employee.id.in_(ids)).all()} if ids else {}
    return [_meta(r, names) for r in rows]


@router.post("/{entity_type}/{entity_id}")
async def upload_files(
    entity_type: str, entity_id: str, files: list[UploadFile] = File(...), label: str | None = Form(None),
    db: Session = Depends(get_db), user: Employee = Depends(UploadRoles),
):
    obj = _entity(db, entity_type, entity_id)
    if _closed(entity_type, obj):
        raise HTTPException(400, "This record is closed - evidence can no longer be added")
    files = [f for f in files if f.filename]
    if not files:
        raise HTTPException(400, "No files received")
    existing = db.query(EvidenceFile).filter(EvidenceFile.entity_type == entity_type, EvidenceFile.entity_id == entity_id).count()
    if existing + len(files) > MAX_FILES_PER_ENTITY:
        raise HTTPException(400, f"At most {MAX_FILES_PER_ENTITY} files per record")
    saved = []
    for f in files:
        ext = os.path.splitext(f.filename)[1].lower()
        if ext not in ALLOWED_EXT:
            raise HTTPException(400, f"Unsupported file type '{ext}'. Allowed: {sorted(ALLOWED_EXT)}")
        data = await f.read()
        if not data:
            raise HTTPException(400, f"'{f.filename}' is empty")
        if len(data) > MAX_FILE_BYTES:
            raise HTTPException(400, f"'{f.filename}' is larger than 15 MB")
        ctype = sniff_content_type(data)
        if not ctype:
            raise HTTPException(400, f"'{f.filename}' is not a valid photo or PDF")
        row = EvidenceFile(entity_type=entity_type, entity_id=entity_id, label=(label or None), filename=safe_filename(f.filename),
                           content_type=ctype, size_bytes=len(data), data=data, uploaded_by=user.id)
        db.add(row)
        saved.append(row)
    db.commit()
    record_audit(db, action="EVIDENCE_ADDED", entity_type=obj.__class__.__name__, entity_id=entity_id, actor_id=user.id,
                 new_value={"files": [s.filename for s in saved]})
    return {"success": True, "added": len(saved)}


@router.get("/{entity_type}/{entity_id}/{file_id}/file")
def get_file(entity_type: str, entity_id: str, file_id: str, download: bool = False,
             db: Session = Depends(get_db), _user: Employee = Depends(get_current_user)):
    f = db.query(EvidenceFile).filter(EvidenceFile.id == file_id, EvidenceFile.entity_type == entity_type,
                                      EvidenceFile.entity_id == entity_id).first()
    if not f:
        raise HTTPException(404, "File not found")
    return Response(content=f.data, media_type=f.content_type, headers={
        "Content-Disposition": f'{"attachment" if download else "inline"}; filename="{safe_filename(f.filename)}"',
        "X-Content-Type-Options": "nosniff", "Cache-Control": "private, max-age=3600"})


@router.delete("/{entity_type}/{entity_id}/{file_id}")
def delete_file(entity_type: str, entity_id: str, file_id: str, db: Session = Depends(get_db),
                user: Employee = Depends(UploadRoles)):
    obj = _entity(db, entity_type, entity_id)
    f = db.query(EvidenceFile).filter(EvidenceFile.id == file_id, EvidenceFile.entity_type == entity_type,
                                      EvidenceFile.entity_id == entity_id).first()
    if not f:
        raise HTTPException(404, "File not found")
    if user.role not in (Role.MANAGER, Role.ADMIN) and not (f.uploaded_by == user.id and not _closed(entity_type, obj)):
        raise HTTPException(403, "Only a manager or admin (or the uploader, while the record is open) can delete evidence")
    name = f.filename
    db.delete(f)
    db.commit()
    record_audit(db, action="EVIDENCE_DELETED", entity_type=obj.__class__.__name__, entity_id=entity_id, actor_id=user.id,
                 old_value={"filename": name})
    return {"success": True}
