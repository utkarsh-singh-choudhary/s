from apscheduler.schedulers.background import BackgroundScheduler
from apscheduler.triggers.cron import CronTrigger
from sqlalchemy import text
import pytz

from app.core.config import settings
from app.core.database import SessionLocal, engine
from app.jobs.reminder_jobs import run_daily_reminder_job
from app.jobs.monthly_report_job import run_monthly_report_job

tz = pytz.timezone(settings.TIMEZONE)
scheduler = BackgroundScheduler(timezone=tz)

# Arbitrary fixed lock keys (pg_advisory_lock takes a bigint) - one per job.
# Picked as hashes of the job name so they're stable and collision-unlikely;
# the actual values don't matter, only that they're constant across instances.
_LOCK_KEY_DAILY_REMINDER = 8123001
_LOCK_KEY_MONTHLY_REPORT = 8123002


def _run_with_advisory_lock(lock_key: int, job_name: str, fn) -> None:
    """
    Guards a scheduled job with a Postgres advisory lock so that if this
    backend is ever scaled to multiple instances, only one of them actually
    executes the job at a time - APScheduler itself has no cross-instance
    coordination, so without this every instance would fire its own copy of
    the same reminder/report job simultaneously (duplicate emails, duplicate
    reports). Cheap and DB-native: no extra infrastructure (Redis, a
    dedicated scheduler service) required for this to be correct.
    If the lock is already held (another instance got there first, or a
    previous run of this same job is still in flight), this instance simply
    skips the run rather than blocking or erroring.
    """
    conn = engine.connect()
    try:
        got_lock = conn.execute(text("SELECT pg_try_advisory_lock(:k)"), {"k": lock_key}).scalar()
        if not got_lock:
            return
        try:
            fn()
        finally:
            conn.execute(text("SELECT pg_advisory_unlock(:k)"), {"k": lock_key})
    finally:
        conn.close()


def _daily_reminder_job():
    def run():
        db = SessionLocal()
        try:
            run_daily_reminder_job(db)
        finally:
            db.close()

    _run_with_advisory_lock(_LOCK_KEY_DAILY_REMINDER, "daily_pm_reminders", run)


def _monthly_report_job():
    def run():
        db = SessionLocal()
        try:
            run_monthly_report_job(db)
        finally:
            db.close()

    _run_with_advisory_lock(_LOCK_KEY_MONTHLY_REPORT, "monthly_pm_report", run)


def start_scheduler():
    # Daily at 08:00 Asia/Kolkata - covers upcoming/due/overdue/escalation.
    scheduler.add_job(
        _daily_reminder_job,
        CronTrigger(hour=8, minute=0),
        id="daily_pm_reminders",
        replace_existing=True,
        misfire_grace_time=3600,
    )
    # Monthly: 1st day of the month at 09:00 Asia/Kolkata, reports on the month just ended.
    scheduler.add_job(
        _monthly_report_job,
        CronTrigger(day=1, hour=9, minute=0),
        id="monthly_pm_report",
        replace_existing=True,
        misfire_grace_time=3600,
    )
    scheduler.start()
    return scheduler
