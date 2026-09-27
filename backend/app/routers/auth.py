from fastapi import APIRouter, Depends, HTTPException, status, Request
from fastapi.security import OAuth2PasswordRequestForm
from sqlalchemy.orm import Session
from pydantic import BaseModel

from app.core.database import get_db
from app.core.security import verify_password, create_access_token
from app.core.audit import record_audit
from app.core.rate_limit import check_login_rate_limit, record_login_attempt
from app.models.models import Employee

router = APIRouter(prefix="/api/auth", tags=["auth"])


class LoginOut(BaseModel):
    access_token: str
    token_type: str = "bearer"
    role: str
    name: str
    employee_id: str


@router.post("/login", response_model=LoginOut)
def login(request: Request, form: OAuth2PasswordRequestForm = Depends(), db: Session = Depends(get_db)):
    # Rate-limit key combines client IP and attempted email so one attacker
    # can't lock out a legitimate user by hammering their address from
    # elsewhere, while still throttling a single source trying many accounts.
    client_ip = request.client.host if request.client else "unknown"
    rate_key = f"{client_ip}:{form.username.lower()}"
    check_login_rate_limit(rate_key)
    record_login_attempt(rate_key)

    user = db.query(Employee).filter(Employee.email == form.username).first()
    if not user or not user.hashed_password or not verify_password(form.password, user.hashed_password):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Incorrect email or password")
    if not user.active:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Account is inactive")

    token = create_access_token(subject=user.id, role=user.role.value)
    record_audit(db, action="LOGIN", entity_type="Employee", entity_id=user.id, actor_id=user.id)

    return LoginOut(access_token=token, role=user.role.value, name=user.name, employee_id=user.id)
