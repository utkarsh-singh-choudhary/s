from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.auth import require_roles
from app.core.security import hash_password
from app.core.audit import record_audit
from app.models.models import Employee, Role

router = APIRouter(prefix="/api/employees", tags=["employees"])

AdminOnly = require_roles(Role.ADMIN)


class EmployeeIn(BaseModel):
    name: str
    email: str
    password: str
    role: Role = Role.TECHNICIAN
    department: str | None = None
    designation: str | None = None
    phone: str | None = None


@router.get("")
def list_employees(db: Session = Depends(get_db), _user=Depends(AdminOnly)):
    employees = db.query(Employee).order_by(Employee.name).all()
    return [
        {
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
        for e in employees
    ]


@router.post("")
def create_employee(payload: EmployeeIn, db: Session = Depends(get_db), user=Depends(AdminOnly)):
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
