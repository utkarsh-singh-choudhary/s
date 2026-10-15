"""
Test setup: runs the real FastAPI app against an in-memory SQLite database
(no Postgres needed), so `pytest` works on any machine and in CI.
"""
import os
import sys
import types
from datetime import date, datetime, timedelta

os.environ.setdefault("DATABASE_URL", "sqlite://")
os.environ.setdefault("ENV", "test")
os.environ.setdefault("JWT_SECRET", "test-secret-test-secret-test-secret-123456")
sys.modules.setdefault("psycopg2", types.ModuleType("psycopg2"))

import pytest
from sqlalchemy import create_engine
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.ext.compiler import compiles
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool


@compiles(JSONB, "sqlite")
def _jsonb(type_, compiler, **kw):
    return "JSON"


@compiles(UUID, "sqlite")
def _uuid(type_, compiler, **kw):
    return "VARCHAR(36)"


from fastapi.testclient import TestClient  # noqa: E402

from app.core.database import Base, get_db  # noqa: E402
from app.core.security import create_access_token, hash_password  # noqa: E402
from app.main import app  # noqa: E402
from app.models.models import Employee, Machine, Role, SparePart  # noqa: E402


@pytest.fixture()
def db_engine():
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(engine)
    yield engine
    engine.dispose()


@pytest.fixture()
def Session(db_engine):
    return sessionmaker(bind=db_engine, autoflush=False, expire_on_commit=False)


@pytest.fixture()
def db(Session):
    s = Session()
    yield s
    s.close()


@pytest.fixture()
def client(Session):
    def _get_db():
        s = Session()
        try:
            yield s
        finally:
            s.close()

    app.dependency_overrides[get_db] = _get_db
    with TestClient(app) as c:
        yield c
    app.dependency_overrides.clear()


def _make_user(db, name, role, rate=None):
    u = Employee(name=name, email=f"{name.lower().replace(' ', '.')}@test.local", role=role,
                 hashed_password=hash_password("x"), active=True, hourly_rate=rate)
    db.add(u)
    db.commit()
    return u


@pytest.fixture()
def users(db):
    return {
        "admin": _make_user(db, "Ann Admin", Role.ADMIN),
        "manager": _make_user(db, "Mo Manager", Role.MANAGER),
        "supervisor": _make_user(db, "Sue Supervisor", Role.SUPERVISOR),
        "tech": _make_user(db, "Tom Tech", Role.TECHNICIAN, rate=200),
        "tech2": _make_user(db, "Tina Tech", Role.TECHNICIAN, rate=300),
        "viewer": _make_user(db, "Vic Viewer", Role.VIEWER),
    }


@pytest.fixture()
def auth(users):
    def h(role):
        u = users[role]
        return {"Authorization": f"Bearer {create_access_token(u.id, u.role.value)}"}
    return h


@pytest.fixture()
def machine(db):
    m = Machine(machine_number="M-001", machine_name="Press 1", critical=True, active=True, machine_type="Press")
    db.add(m)
    db.commit()
    return m


@pytest.fixture()
def machine2(db):
    m = Machine(machine_number="M-002", machine_name="Lathe 1", critical=False, active=True, machine_type="Lathe")
    db.add(m)
    db.commit()
    return m


@pytest.fixture()
def part(db):
    p = SparePart(part_code="BRG-1", name="Bearing", stock_on_hand=10, minimum_stock=3, unit_cost=100)
    db.add(p)
    db.commit()
    return p
