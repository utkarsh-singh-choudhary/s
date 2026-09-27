import os
import shutil
import uuid

from fastapi import APIRouter, Depends, UploadFile, File, Form
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.auth import require_roles
from app.core.audit import record_audit
from app.models.models import Employee, Role
from app.importer.import_service import run_import

router = APIRouter(prefix="/api/import", tags=["import"])

UPLOAD_DIR = "/tmp/pm_uploads"
os.makedirs(UPLOAD_DIR, exist_ok=True)

ImportRoles = require_roles(Role.ADMIN, Role.MANAGER)


@router.post("/excel/upload")
async def upload_excel(file: UploadFile = File(...), user: Employee = Depends(ImportRoles), db: Session = Depends(get_db)):
    """Step 1: upload the file, get back a server-side path to use in preview/commit."""
    dest_name = f"{uuid.uuid4()}_{file.filename}"
    dest_path = os.path.join(UPLOAD_DIR, dest_name)
    with open(dest_path, "wb") as f:
        shutil.copyfileobj(file.file, f)
    record_audit(db, action="EXCEL_UPLOADED", entity_type="ImportBatch", actor_id=user.id,
                 new_value={"filename": file.filename})
    return {"file_path": dest_path, "original_filename": file.filename}


@router.post("/excel/preview")
def preview_excel(
    file_path: str = Form(...),
    original_filename: str = Form(...),
    sheet_name: str = Form(...),
    financial_year: str = Form(...),
    db: Session = Depends(get_db),
    user: Employee = Depends(ImportRoles),
):
    """Step 4-5: parse + diff against DB, WITHOUT writing anything."""
    with open(file_path, "rb") as f:
        file_bytes = f.read()
    return run_import(
        db=db, file_path=file_path, file_bytes=file_bytes,
        original_filename=original_filename, sheet_name=sheet_name,
        financial_year=financial_year, preview=True,
    )


@router.post("/excel/bulk-commit")
def bulk_commit_excel(
    file_path: str = Form(...),
    original_filename: str = Form(...),
    sheets: str = Form(...),  # JSON list like [{"sheet_name": "PM Plan-23-24", "financial_year": "23-24"}, ...]
    db: Session = Depends(get_db),
    user: Employee = Depends(ImportRoles),
):
    """
    Import several years' sheets from the same workbook in one call (e.g.
    PM Plan-23-24 / 24-25 / 25-26 / 26-27), so historical Plan-vs-Actual
    variance can be computed across years instead of just the current one.
    Each sheet still goes through the exact same single-sheet diff/commit
    logic as `/excel/commit` - this just loops it and returns one summary
    per sheet, plus which ones failed, rather than requiring N separate
    calls from the client.
    """
    import json
    sheet_specs = json.loads(sheets)
    with open(file_path, "rb") as f:
        file_bytes = f.read()

    results = []
    for spec in sheet_specs:
        sheet_name = spec["sheet_name"]
        financial_year = spec["financial_year"]
        try:
            result = run_import(
                db=db, file_path=file_path, file_bytes=file_bytes,
                original_filename=original_filename, sheet_name=sheet_name,
                financial_year=financial_year, uploaded_by=user.id, preview=False,
            )
            record_audit(db, action="EXCEL_SYNCHRONIZED", entity_type="ImportBatch",
                         entity_id=result.get("import_batch_id"), actor_id=user.id,
                         new_value={k: v for k, v in result.items() if k != "preview_rows"})
            results.append({"sheet_name": sheet_name, "financial_year": financial_year,
                             "success": True, "summary": result})
        except Exception as e:
            # One bad sheet (wrong name, unexpected layout) shouldn't abort
            # the sheets already committed before it - each sheet's writes
            # are already committed inside run_import, so we just record
            # the failure and move on to the next sheet.
            results.append({"sheet_name": sheet_name, "financial_year": financial_year,
                             "success": False, "error": str(e)})

    return {"results": results}


@router.post("/excel/commit")
def commit_excel(
    file_path: str = Form(...),
    original_filename: str = Form(...),
    sheet_name: str = Form(...),
    financial_year: str = Form(...),
    db: Session = Depends(get_db),
    user: Employee = Depends(ImportRoles),
):
    """Step 6-7: commit the previously previewed import."""
    with open(file_path, "rb") as f:
        file_bytes = f.read()
    result = run_import(
        db=db, file_path=file_path, file_bytes=file_bytes,
        original_filename=original_filename, sheet_name=sheet_name,
        financial_year=financial_year, uploaded_by=user.id, preview=False,
    )
    record_audit(db, action="EXCEL_SYNCHRONIZED", entity_type="ImportBatch",
                 entity_id=result.get("import_batch_id"), actor_id=user.id,
                 new_value={k: v for k, v in result.items() if k != "preview_rows"})
    return result
