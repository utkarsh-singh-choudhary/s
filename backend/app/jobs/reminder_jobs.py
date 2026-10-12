"""
Daily job: scans PMPlan rows and sends the appropriate reminder for each,
using idempotency keys so re-running the job (e.g. after a scheduler
restart) never double-sends. Designed to be called by APScheduler once a day
(see app/jobs/scheduler.py) - each function is also independently callable
for testing.

Escalation thresholds and reminder day-offsets are read from config here for
simplicity; in the admin panel (Phase 4) these become DB-backed settings
instead of constants.
"""

import hashlib
from datetime import date, datetime, timedelta

from sqlalchemy.orm import Session

from app.models.models import PMPlan, PMActual, Machine, MachineResponsibility, Employee, PMStatus, NotificationType
from app.notifications import templates
from app.notifications.notification_service import send_pm_notification, send_cc_copy
from app.core.settings_service import get_setting, set_setting
from app.core.timeutils import today_local

# Hardcoded fallbacks only — the live values used by the job are read from
# AppSetting (admin panel) at the top of run_daily_reminder_job() below, so a
# plant manager can retune these without a code deploy.
REMINDER_DAYS_BEFORE = 7
DUE_TOMORROW_DAYS_BEFORE = 1

ESCALATION_LEVELS = [
    (1, ["PRIMARY"]),
    (3, ["PRIMARY", "SUPERVISOR"]),
    (7, ["PRIMARY", "SUPERVISOR", "MANAGER"]),
]


def _get_responsible_employees(db: Session, machine_id: str, types=("PRIMARY",)):
    q = db.query(Employee).join(MachineResponsibility).filter(
        MachineResponsibility.machine_id == machine_id,
        MachineResponsibility.responsibility_type.in_(types),
    )
    # Eligible if they can receive email OR WhatsApp - previously this
    # required email specifically, which silently dropped WhatsApp-only
    # technicians (common on the shop floor: phone but no company email).
    return [
        e for e in q.all()
        if (e.email and e.notification_email_enabled)
        or (e.phone and e.notification_whatsapp_enabled)
    ]


def run_daily_reminder_job(db: Session, today: date = None):
    today = today or today_local()
    results = {"upcoming": 0, "due_tomorrow": 0, "due_today": 0, "overdue": 0, "escalated": 0}

    # Admin-tunable — falls back to the module constants above if unset.
    reminder_days_before = get_setting(db, "reminder_days_before", REMINDER_DAYS_BEFORE)
    due_tomorrow_days_before = get_setting(db, "due_tomorrow_days_before", DUE_TOMORROW_DAYS_BEFORE)
    escalation_thresholds = get_setting(
        db, "escalation_thresholds",
        [{"days": d, "levels": levels} for d, levels in ESCALATION_LEVELS],
    )

    queue = []  # reminders are collected, then sent as ONE digest per person

    open_plans = db.query(PMPlan).filter(
        PMPlan.status.notin_([PMStatus.COMPLETED, PMStatus.CANCELLED, PMStatus.PENDING_SUPERVISOR_CONFIRMATION]),
        PMPlan.planned_date.isnot(None),
    ).all()

    for plan in open_plans:
        machine = db.query(Machine).get(plan.machine_id)
        actual = db.query(PMActual).filter(PMActual.pm_plan_id == plan.id).first()
        days_diff = (plan.planned_date - today).days

        recipients = _get_responsible_employees(db, plan.machine_id, ("PRIMARY",))

        if actual and actual.actual_date:
            continue  # already completed - nothing to remind

        if days_diff == reminder_days_before:
            _enqueue(queue, plan, machine, recipients, NotificationType.UPCOMING_REMINDER,
                    "PM Reminder - Upcoming",
                    templates.upcoming_reminder(machine.machine_name, machine.machine_number,
                                                 plan.planned_date, machine.location, days_diff),
                    today)
            results["upcoming"] += 1

        elif days_diff == due_tomorrow_days_before:
            _enqueue(queue, plan, machine, recipients, NotificationType.DUE_REMINDER,
                    "PM Due Tomorrow",
                    templates.due_tomorrow_reminder(machine.machine_name, machine.machine_number, plan.planned_date),
                    today)
            results["due_tomorrow"] += 1

        elif days_diff == 0:
            _enqueue(queue, plan, machine, recipients, NotificationType.DUE_REMINDER,
                    "PM Due Today",
                    templates.due_today_not_updated(machine.machine_name, machine.machine_number, plan.planned_date),
                    today)
            plan.status = PMStatus.DUE
            results["due_today"] += 1

        elif days_diff < 0:
            days_overdue = -days_diff
            plan.status = PMStatus.OVERDUE
            _enqueue(queue, plan, machine, recipients, NotificationType.OVERDUE_REMINDER,
                    "OVERDUE Preventive Maintenance",
                    templates.overdue_reminder(machine.machine_name, machine.machine_number,
                                                plan.planned_date, days_overdue),
                    today)
            results["overdue"] += 1

            for entry in escalation_thresholds:
                threshold, levels = entry["days"], entry["levels"]
                if days_overdue == threshold:
                    esc_recipients = _get_responsible_employees(db, plan.machine_id, tuple(levels))
                    _enqueue(queue, plan, machine, esc_recipients, NotificationType.ESCALATION,
                            f"PM Escalation - {days_overdue} days overdue",
                            templates.escalation_notice(machine.machine_name, machine.machine_number,
                                                         plan.planned_date, days_overdue, len(levels)),
                            today)
                    results["escalated"] += 1

    _flush_queue(db, queue, today)
    db.commit()
    # Remember when the job last ran so a catch-up after a sleep/restart knows
    # whether today's run already happened.
    set_setting(db, "last_reminder_run",
                {"date": today.isoformat(), "at": datetime.utcnow().isoformat() + "Z", "results": results})
    return results


def get_cc_emails(db: Session) -> list:
    """Clean, de-duplicated list of extra reminder addresses from admin settings."""
    raw = get_setting(db, "reminder_cc_emails", []) or []
    if not isinstance(raw, list):
        return []
    seen, out = set(), []
    for item in raw:
        if not isinstance(item, str):
            continue
        addr = item.strip().lower()
        if "@" in addr and addr not in seen:
            seen.add(addr)
            out.append(addr)
    return out


MAX_ITEMS_PER_DIGEST = 30


def _enqueue(queue, plan, machine, recipients, notif_type, subject, body, today):
    queue.append({
        "plan": plan, "machine": machine, "recipients": recipients,
        "type": notif_type, "subject": subject, "body": body,
    })


def _digest_key(prefix: str, notif_type, subject: str, today, who: str) -> str:
    sub_hash = hashlib.md5(subject.encode()).hexdigest()[:8]
    return f"{prefix}:{who}:{notif_type.value}:{sub_hash}:{today.isoformat()}"


def _build_digest(items, subject, today):
    """One email/message listing every machine instead of one message per machine."""
    items = sorted(items, key=lambda i: (i["plan"].planned_date or today, i["machine"].machine_number or ""))
    if len(items) == 1:
        return subject, items[0]["body"]
    shown = items[:MAX_ITEMS_PER_DIGEST]
    parts = [f"{len(items)} machines need attention:"]
    parts += [i["body"] for i in shown]
    if len(items) > len(shown):
        parts.append(f"...and {len(items) - len(shown)} more. Open the PM dashboard to see the full list.")
    return f"{subject} ({len(items)} machines)", "\n\n----------\n\n".join(parts)


def _flush_queue(db, queue, today):
    """
    Sends at most ONE message per person per reminder kind per day (and one
    copy per CC address). Sending one email per overdue plan would send
    hundreds of emails a day and exhaust mail quotas (Gmail allows ~100).
    """
    if not queue:
        return

    # Group by (kind, subject) so "Due Tomorrow" and "Due Today" stay separate emails.
    by_person = {}
    by_kind = {}
    for item in queue:
        kind = (item["type"], item["subject"])
        by_kind.setdefault(kind, {})[item["plan"].id] = item
        for emp in item["recipients"]:
            by_person.setdefault((emp.id, kind), {"emp": emp, "items": {}})["items"][item["plan"].id] = item

    for (emp_id, kind), grp in by_person.items():
        notif_type, base_subject = kind
        items = list(grp["items"].values())
        subject, body = _build_digest(items, base_subject, today)
        emp = grp["emp"]
        send_pm_notification(
            db=db,
            pm_plan_id=items[0]["plan"].id,
            recipient_email=emp.email,
            recipient_id=emp.id,
            notification_type=notif_type,
            subject=subject,
            body=body,
            scheduled_date=today,
            employee=emp,
            idempotency_key_override=None if len(items) == 1 else _digest_key("digest", notif_type, base_subject, today, emp.id),
        )

    cc_emails = get_cc_emails(db)
    if not cc_emails:
        return
    for (notif_type, base_subject), plan_items in by_kind.items():
        items = list(plan_items.values())
        subject, body = _build_digest(items, base_subject, today)
        names = sorted({e.name for i in items for e in i["recipients"]})
        for cc_email in cc_emails:
            send_cc_copy(
                db=db,
                pm_plan_id=items[0]["plan"].id,
                cc_email=cc_email,
                notification_type=notif_type,
                subject=subject,
                body=body,
                scheduled_date=today,
                sent_to_names=names,
                idempotency_key_override=None if len(items) == 1 else _digest_key("cc-digest", notif_type, base_subject, today, cc_email.lower()),
            )
