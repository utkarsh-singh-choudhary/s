"""
Machine-to-machine trigger for the daily reminder job.

Why this exists: the in-process scheduler (APScheduler) only fires while the
backend process is awake. On hosts that put idle services to sleep (e.g.
Render's free tier) the 8:00 AM run can be missed. An external scheduler
calling this endpoint once a day both wakes the service and runs the job.
The job is idempotent per plan/type/date, so extra calls never double-send.
"""
import hmac

from fastapi import APIRouter, Depends, Header, HTTPException
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.database import get_db
from app.jobs.reminder_jobs import run_daily_reminder_job

router = APIRouter(prefix="/api/internal", tags=["internal"])


@router.post("/run-daily-reminders")
def run_daily_reminders(x_cron_secret: str = Header(default=""), db: Session = Depends(get_db)):
    if not settings.CRON_SECRET:
        raise HTTPException(404, "Not found")
    if not hmac.compare_digest(x_cron_secret.encode(), settings.CRON_SECRET.encode()):
        raise HTTPException(403, "Forbidden")
    if not settings.NOTIFICATIONS_ENABLED:
        return {"success": False, "error": "Notifications are globally disabled."}
    return {"success": True, "results": run_daily_reminder_job(db)}
