from fastapi import APIRouter, Depends
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.jobs.scheduler import scheduler

router = APIRouter(tags=["health"])


@router.get("/health")
def health(db: Session = Depends(get_db)):
    checks = {"api": "healthy"}
    try:
        db.execute(text("SELECT 1"))
        checks["database"] = "healthy"
    except Exception as e:
        checks["database"] = f"unhealthy: {e}"
    checks["scheduler"] = "running" if scheduler.running else "stopped"
    return checks


@router.get("/ready")
def ready():
    return {"status": "ready"}
