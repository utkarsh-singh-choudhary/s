from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.auth import require_roles, get_current_user
from app.core.security import hash_password
from app.core.audit import record_audit
from app.models.models import Employee, Role

router = APIRouter(prefix="/api/employees", tags=["employees"])

AdminOnly = require_roles(Role.ADMIN)

# Fields that only an Admin may change. Anyone editing their own record may
# only touch the fields outside this set (name, phone, notification prefs).
ADMIN_ONLY_FIELDS = {"email", "department", "designation", "role"}

MAX_BULK_STATUS = 200


class EmployeeIn(BaseModel):
    name: str
    email: str
    password: str
    role: Role = Role.TECHNICIAN
    department: str | None = None
    designation: str | None = None
    phone: str | None = None


class EmployeeUpdate(BaseModel):
    name: str | None = None
    email: str | None = None
    phone: str | None = None
    department: str | None = None
    designation: str | None = None
    role: Role | None = None
    notification_email_enabled: bool | None = None
    notification_whatsapp_enabled: bool | None = None


class BulkStatusIn(BaseModel):
    employee_ids: list[str]
    active: bool


def _serialize(e: Employee) -> dict:
    return {
        "id": e.id,
        "employee_code": e.employee_code,
        "name": e.name,
        "email": e.email,
        "phone": e.phone,
        "department": e.department,
        "designation": e.designation,
        "role": e.role,
        "active": e.active,
        "notification_email_enabled": e.notification_email_enabled,
        "notification_whatsapp_enabled": e.notification_whatsapp_enabled,
    }


@router.get("")
def list_employees(db: Session = Depends(get_db), _user=Depends(AdminOnly)):
    employees = db.query(Employee).order_by(Employee.name).all()
    return [_serialize(e) for e in employees]


@router.get("/me")
def get_my_profile(user: Employee = Depends(get_current_user)):
    """Any authenticated employee (not just admins) can see their own record -
    the list endpoint above is admin-only, so without this a technician had no
    way to see their own notification settings or profile."""
    return _serialize(user)


@router.post("")
def create_employee(payload: EmployeeIn, db: Session = Depends(get_db), user=Depends(AdminOnly)):
    existing = db.query(Employee).filter(Employee.email == payload.email).first()
    if existing:
        raise HTTPException(status.HTTP_409_CONFLICT, "An employee with this email already exists")

    emp = Employee(
        name=payload.name,
        email=payload.email,
        hashed_password=hash_password(payload.password),
        role=payload.role,
        department=payload.department,
        designation=payload.designation,
        phone=payload.phone,
    )
    db.add(emp)
    db.commit()
    record_audit(db, action="EMPLOYEE_CREATED", entity_type="Employee", entity_id=emp.id,
                 actor_id=user.id, new_value={"email": emp.email, "role": emp.role.value})
    return {"id": emp.id, "name": emp.name, "email": emp.email, "role": emp.role}


@router.put("/{employee_id}")
def update_employee(
    employee_id: str,
    payload: EmployeeUpdate,
    db: Session = Depends(get_db),
    user: Employee = Depends(get_current_user),
):
    emp = db.query(Employee).get(employee_id)
    if not emp:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Employee not found")

    is_admin = user.role == Role.ADMIN
    is_self = user.id == emp.id

    if not is_admin and not is_self:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Insufficient permissions for this action")

    requested = payload.model_dump(exclude_unset=True)

    if not is_admin:
        disallowed = ADMIN_ONLY_FIELDS & requested.keys()
        if disallowed:
            raise HTTPException(
                status.HTTP_403_FORBIDDEN,
                f"Only an admin can change: {', '.join(sorted(disallowed))}",
            )

    if "email" in requested and requested["email"] != emp.email:
        dupe = db.query(Employee).filter(
            Employee.email == requested["email"], Employee.id != emp.id
        ).first()
        if dupe:
            raise HTTPException(status.HTTP_409_CONFLICT, "Email already in use by another employee")

    old_value = {
        "name": emp.name, "email": emp.email, "phone": emp.phone,
        "department": emp.department, "designation": emp.designation,
        "role": emp.role.value if emp.role else None,
        "notification_email_enabled": emp.notification_email_enabled,
        "notification_whatsapp_enabled": emp.notification_whatsapp_enabled,
    }

    for field, value in requested.items():
        setattr(emp, field, value)

    db.commit()
    db.refresh(emp)

    new_value = {
        "name": emp.name, "email": emp.email, "phone": emp.phone,
        "department": emp.department, "designation": emp.designation,
        "role": emp.role.value if emp.role else None,
        "notification_email_enabled": emp.notification_email_enabled,
        "notification_whatsapp_enabled": emp.notification_whatsapp_enabled,
    }
    record_audit(db, action="EMPLOYEE_UPDATED", entity_type="Employee", entity_id=emp.id,
                 actor_id=user.id, old_value=old_value, new_value=new_value)

    return _serialize(emp)


@router.post("/{employee_id}/deactivate")
def deactivate_employee(employee_id: str, db: Session = Depends(get_db), user: Employee = Depends(AdminOnly)):
    emp = db.query(Employee).get(employee_id)
    if not emp:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Employee not found")
    if emp.id == user.id:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "You cannot deactivate your own account")

    old_active = emp.active
    emp.active = False
    db.commit()
    record_audit(db, action="EMPLOYEE_DEACTIVATED", entity_type="Employee", entity_id=emp.id,
                 actor_id=user.id, old_value={"active": old_active}, new_value={"active": False})
    return {"id": emp.id, "active": emp.active}


@router.post("/{employee_id}/activate")
def activate_employee(employee_id: str, db: Session = Depends(get_db), user: Employee = Depends(AdminOnly)):
    emp = db.query(Employee).get(employee_id)
    if not emp:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Employee not found")

    old_active = emp.active
    emp.active = True
    db.commit()
    record_audit(db, action="EMPLOYEE_ACTIVATED", entity_type="Employee", entity_id=emp.id,
                 actor_id=user.id, old_value={"active": old_active}, new_value={"active": True})
    return {"id": emp.id, "active": emp.active}


@router.post("/bulk-status")
def bulk_set_employee_status(
    payload: BulkStatusIn,
    db: Session = Depends(get_db),
    user: Employee = Depends(AdminOnly),
):
    requested_ids = list(dict.fromkeys(payload.employee_ids))[:MAX_BULK_STATUS]
    updated: list[str] = []
    skipped: list[dict] = []

    for employee_id in requested_ids:
        emp = db.query(Employee).get(employee_id)
        if not emp:
            skipped.append({"id": employee_id, "reason": "not_found"})
            continue
        if emp.id == user.id and not payload.active:
            skipped.append({"id": employee_id, "reason": "cannot_deactivate_self"})
            continue
        if emp.active == payload.active:
            skipped.append({"id": employee_id, "reason": "already_in_target_state"})
            continue

        old_active = emp.active
        emp.active = payload.active
        record_audit(
            db,
            action="EMPLOYEE_ACTIVATED" if payload.active else "EMPLOYEE_DEACTIVATED",
            entity_type="Employee",
            entity_id=emp.id,
            actor_id=user.id,
            old_value={"active": old_active},
            new_value={"active": payload.active},
            commit=False,
        )
        updated.append(employee_id)

    db.commit()
    return {"requested": len(requested_ids), "updated": updated, "skipped": skipped}
