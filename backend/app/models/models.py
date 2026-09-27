import enum
import uuid
from datetime import datetime

from sqlalchemy import (
    Column, String, Integer, Boolean, Date, DateTime, ForeignKey, Text,
    Enum as SAEnum, UniqueConstraint, Index, ARRAY
)
from sqlalchemy.dialects.postgresql import UUID, JSONB
from sqlalchemy.orm import relationship

from app.core.database import Base


def gen_uuid():
    return str(uuid.uuid4())


# ---------------------------------------------------------------------------
# Enums
# ---------------------------------------------------------------------------

class PMStatus(str, enum.Enum):
    PLANNED = "PLANNED"
    REMINDER_SENT = "REMINDER_SENT"
    DUE = "DUE"
    IN_PROGRESS = "IN_PROGRESS"
    COMPLETED = "COMPLETED"
    OVERDUE = "OVERDUE"
    MISSED = "MISSED"
    CANCELLED = "CANCELLED"
    # A technician marked a *critical* (`*`-flagged) machine done, but a
    # supervisor/manager/admin hasn't signed off yet. Not a normal terminal
    # state - reminders/escalations should keep treating this like an open
    # job until it flips to COMPLETED.
    PENDING_SUPERVISOR_CONFIRMATION = "PENDING_SUPERVISOR_CONFIRMATION"


class PlanSourceType(str, enum.Enum):
    EXACT_DATE = "EXACT_DATE"
    WEEK_CODE = "WEEK_CODE"
    DAY_OF_MONTH = "DAY_OF_MONTH"


class CompletionClass(str, enum.Enum):
    EARLY = "EARLY"
    ON_TIME = "ON_TIME"
    LATE = "LATE"


class NotificationType(str, enum.Enum):
    UPCOMING_REMINDER = "UPCOMING_REMINDER"
    DUE_REMINDER = "DUE_REMINDER"
    OVERDUE_REMINDER = "OVERDUE_REMINDER"
    ESCALATION = "ESCALATION"
    MONTHLY_REPORT = "MONTHLY_REPORT"


class NotificationChannel(str, enum.Enum):
    EMAIL = "EMAIL"
    WHATSAPP = "WHATSAPP"
    SMS = "SMS"


class DeliveryStatus(str, enum.Enum):
    PENDING = "PENDING"
    SENT = "SENT"
    FAILED = "FAILED"
    RETRYING = "RETRYING"


class Role(str, enum.Enum):
    ADMIN = "ADMIN"
    MANAGER = "MANAGER"
    SUPERVISOR = "SUPERVISOR"
    TECHNICIAN = "TECHNICIAN"
    VIEWER = "VIEWER"


class WorkOrderStatus(str, enum.Enum):
    OPEN = "OPEN"
    ASSIGNED = "ASSIGNED"
    IN_PROGRESS = "IN_PROGRESS"
    WAITING_PARTS = "WAITING_PARTS"
    WAITING_APPROVAL = "WAITING_APPROVAL"
    COMPLETED = "COMPLETED"
    VERIFIED = "VERIFIED"
    CLOSED = "CLOSED"


class WorkOrderPriority(str, enum.Enum):
    LOW = "LOW"
    MEDIUM = "MEDIUM"
    HIGH = "HIGH"
    CRITICAL = "CRITICAL"


# ---------------------------------------------------------------------------
# Core entities
# ---------------------------------------------------------------------------

class Machine(Base):
    __tablename__ = "machines"

    id = Column(UUID(as_uuid=False), primary_key=True, default=gen_uuid)
    machine_number = Column(String(100), nullable=False, index=True)
    machine_name = Column(String(255), nullable=False)
    manufacturer = Column(String(255))
    specification = Column(String(500))
    location = Column(String(255))
    remarks = Column(Text)
    critical = Column(Boolean, default=False)
    active = Column(Boolean, default=True)

    # Which PM checklist to fill out when this machine's job is completed
    # (e.g. "Power Press PM" -> 6 sub-steps). Nullable: machines with no
    # template just keep the old plain done/not-done flow.
    checklist_template_id = Column(UUID(as_uuid=False), ForeignKey("checklist_templates.id"), nullable=True)

    # Set when this machine's (name, number) is a near-duplicate - same
    # alphanumeric content as another machine, differing only by whitespace
    # or punctuation (e.g. "AC-01" vs "AC 01" vs "AC.01") - of an existing
    # Machine row detected at import time. NOT set when an actual letter or
    # digit differs, since that's a different physical machine, not a typo.
    # Left for a human to confirm/dismiss; never auto-merged.
    potential_duplicate_of_id = Column(UUID(as_uuid=False), ForeignKey("machines.id"), nullable=True)
    duplicate_review_status = Column(String(20), nullable=True)  # None | "PENDING" | "CONFIRMED" | "DISMISSED"

    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    responsibilities = relationship("MachineResponsibility", back_populates="machine")
    pm_plans = relationship("PMPlan", back_populates="machine")
    potential_duplicate_of = relationship("Machine", remote_side=[id])
    checklist_template = relationship("ChecklistTemplate")

    __table_args__ = (
        UniqueConstraint("machine_number", "location", name="uq_machine_number_location"),
    )


class ChecklistTemplate(Base):
    """
    A reusable set of PM sub-steps for a class of machine (e.g. "Power
    Press PM", "Compressor PM"). One template can be assigned to many
    machines via Machine.checklist_template_id.
    """
    __tablename__ = "checklist_templates"

    id = Column(UUID(as_uuid=False), primary_key=True, default=gen_uuid)
    name = Column(String(150), nullable=False)
    description = Column(String(500))
    active = Column(Boolean, default=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    items = relationship("ChecklistTemplateItem", back_populates="template",
                          order_by="ChecklistTemplateItem.sequence")


class ChecklistTemplateItem(Base):
    """One sub-step within a ChecklistTemplate, e.g. 'Check die clearance'."""
    __tablename__ = "checklist_template_items"

    id = Column(UUID(as_uuid=False), primary_key=True, default=gen_uuid)
    template_id = Column(UUID(as_uuid=False), ForeignKey("checklist_templates.id"), nullable=False)
    sequence = Column(Integer, nullable=False, default=0)
    text = Column(String(500), nullable=False)
    required = Column(Boolean, default=True)  # if True, must be checked before COMPLETED

    template = relationship("ChecklistTemplate", back_populates="items")


class PMChecklistResponse(Base):
    """
    One sub-step's checked/unchecked result for a specific PMActual - the
    granular data behind a single "done" tick, so compliance can be
    measured per sub-step, not just per PM job.
    """
    __tablename__ = "pm_checklist_responses"

    id = Column(UUID(as_uuid=False), primary_key=True, default=gen_uuid)
    pm_actual_id = Column(UUID(as_uuid=False), ForeignKey("pm_actuals.id"), nullable=False, index=True)
    checklist_template_item_id = Column(UUID(as_uuid=False), ForeignKey("checklist_template_items.id"), nullable=False)
    checked = Column(Boolean, default=False)
    note = Column(Text)

    __table_args__ = (
        UniqueConstraint("pm_actual_id", "checklist_template_item_id", name="uq_checklist_response_actual_item"),
    )


class Employee(Base):
    __tablename__ = "employees"

    id = Column(UUID(as_uuid=False), primary_key=True, default=gen_uuid)
    employee_code = Column(String(50), unique=True)
    name = Column(String(255), nullable=False)
    email = Column(String(255))
    phone = Column(String(50))
    department = Column(String(150))
    designation = Column(String(150))
    role = Column(SAEnum(Role), default=Role.TECHNICIAN)
    notification_email_enabled = Column(Boolean, default=True)
    notification_whatsapp_enabled = Column(Boolean, default=False)
    active = Column(Boolean, default=True)

    # auth (Phase 4 RBAC)
    hashed_password = Column(String(255))

    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class MachineResponsibility(Base):
    __tablename__ = "machine_responsibilities"

    id = Column(UUID(as_uuid=False), primary_key=True, default=gen_uuid)
    machine_id = Column(UUID(as_uuid=False), ForeignKey("machines.id"), nullable=False)
    employee_id = Column(UUID(as_uuid=False), ForeignKey("employees.id"), nullable=False)
    responsibility_type = Column(String(50), default="PRIMARY")  # PRIMARY / SUPERVISOR / BACKUP
    effective_from = Column(Date)
    effective_to = Column(Date)

    machine = relationship("Machine", back_populates="responsibilities")
    employee = relationship("Employee")


class PMPlan(Base):
    __tablename__ = "pm_plans"

    id = Column(UUID(as_uuid=False), primary_key=True, default=gen_uuid)
    machine_id = Column(UUID(as_uuid=False), ForeignKey("machines.id"), nullable=False, index=True)

    planned_date = Column(Date, index=True)          # resolved calendar date (always computed)
    planned_week = Column(String(5))                 # raw W1..W5 if source was week-based
    plan_source_type = Column(SAEnum(PlanSourceType), nullable=False)
    plan_source_raw_value = Column(String(50))        # original cell text, e.g. "W1", "19", "8.04.2023"

    month = Column(String(20), nullable=False)         # e.g. "April"
    financial_year = Column(String(10), nullable=False)  # e.g. "26-27"

    status = Column(SAEnum(PMStatus), default=PMStatus.PLANNED, index=True)
    assigned_to = Column(UUID(as_uuid=False), ForeignKey("employees.id"), nullable=True)

    # traceability back to Excel
    source_file = Column(String(500))
    source_sheet = Column(String(150))
    source_cell = Column(String(20))
    import_batch_id = Column(UUID(as_uuid=False), ForeignKey("import_batches.id"))
    imported_at = Column(DateTime, default=datetime.utcnow)

    low_confidence_actual = Column(Boolean, default=False)  # P==A copy-forward flag from source sheet

    # Import-time data-quality flags. Kept as a JSON list of short reason
    # strings (e.g. "remarks_looks_like_year", "date_outside_financial_year")
    # rather than booleans so the review-queue UI can show *why* without a
    # schema change every time a new check is added.
    needs_review = Column(Boolean, default=False, index=True)
    review_reasons = Column(JSONB, default=list)

    # Supervisor sign-off for critical-machine completions (see PMStatus.
    # PENDING_SUPERVISOR_CONFIRMATION). Left null for non-critical machines.
    completed_by_technician_id = Column(UUID(as_uuid=False), ForeignKey("employees.id"), nullable=True)
    confirmed_by_supervisor_id = Column(UUID(as_uuid=False), ForeignKey("employees.id"), nullable=True)
    confirmed_at = Column(DateTime, nullable=True)

    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    machine = relationship("Machine", back_populates="pm_plans")
    actual = relationship("PMActual", back_populates="pm_plan", uselist=False)

    __table_args__ = (
        # prevents importing the exact same plan row twice
        UniqueConstraint("machine_id", "month", "financial_year", "source_sheet",
                          name="uq_pmplan_machine_month_fy_sheet"),
        Index("ix_pmplan_status_date", "status", "planned_date"),
    )


class PMActual(Base):
    __tablename__ = "pm_actuals"

    id = Column(UUID(as_uuid=False), primary_key=True, default=gen_uuid)
    pm_plan_id = Column(UUID(as_uuid=False), ForeignKey("pm_plans.id"), nullable=False, unique=True)
    actual_date = Column(Date)
    completed_by = Column(UUID(as_uuid=False), ForeignKey("employees.id"))
    remarks = Column(Text)
    delay_reason = Column(Text)
    downtime_minutes = Column(Integer)
    delay_days = Column(Integer)
    completion_class = Column(SAEnum(CompletionClass))
    attachment_path = Column(String(500))

    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    pm_plan = relationship("PMPlan", back_populates="actual")
    checklist_responses = relationship("PMChecklistResponse", backref="pm_actual")


class BreakdownEvent(Base):
    """
    A corrective-maintenance / breakdown event, separate from planned PM
    (Future-Ready item C.3). Deliberately minimal - just what's needed to
    compute MTBF (mean time between failures) and MTTR (mean time to
    repair) per machine: when it broke, when it was back up, and whether
    it was even repairable (a scrap/replace event shouldn't count toward
    MTTR the same way a repair does).
    """
    __tablename__ = "breakdown_events"

    id = Column(UUID(as_uuid=False), primary_key=True, default=gen_uuid)
    machine_id = Column(UUID(as_uuid=False), ForeignKey("machines.id"), nullable=False, index=True)

    breakdown_at = Column(DateTime, nullable=False)
    resumed_at = Column(DateTime, nullable=True)  # null while still down
    reported_by = Column(UUID(as_uuid=False), ForeignKey("employees.id"), nullable=True)
    repaired_by = Column(UUID(as_uuid=False), ForeignKey("employees.id"), nullable=True)
    cause = Column(Text)
    action_taken = Column(Text)
    resulted_in_scrap_or_replace = Column(Boolean, default=False)  # excluded from MTTR if True

    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    machine = relationship("Machine")


class WorkOrder(Base):
    """
    Corrective-maintenance work order — the bridge between a reported
    problem (a breakdown, or an issue raised from a PM checklist) and a
    tracked repair job, separate from planned PM (Future-Ready item 13:
    Work Orders). Deliberately references BreakdownEvent and PMPlan loosely
    (nullable FKs) rather than requiring one, since a work order can also
    be raised standalone (e.g. an inspection finding with no breakdown yet).
    """
    __tablename__ = "work_orders"

    id = Column(UUID(as_uuid=False), primary_key=True, default=gen_uuid)
    number = Column(Integer, nullable=False, unique=True, index=True)  # human-friendly WO-10482 style sequence

    machine_id = Column(UUID(as_uuid=False), ForeignKey("machines.id"), nullable=False, index=True)
    breakdown_event_id = Column(UUID(as_uuid=False), ForeignKey("breakdown_events.id"), nullable=True)
    pm_plan_id = Column(UUID(as_uuid=False), ForeignKey("pm_plans.id"), nullable=True)

    title = Column(String(255), nullable=False)
    description = Column(Text)
    priority = Column(SAEnum(WorkOrderPriority), default=WorkOrderPriority.MEDIUM)
    status = Column(SAEnum(WorkOrderStatus), default=WorkOrderStatus.OPEN, index=True)

    reported_by = Column(UUID(as_uuid=False), ForeignKey("employees.id"), nullable=True)
    assigned_to = Column(UUID(as_uuid=False), ForeignKey("employees.id"), nullable=True)

    due_date = Column(Date, nullable=True)

    root_cause = Column(Text)
    five_whys = Column(JSONB, nullable=True)  # ordered list of {"question": str, "answer": str} - Phase 2 item 15: RCA
    action_taken = Column(Text)
    parts_used = Column(Text)
    labor_hours = Column(Integer)  # whole hours; keep simple, no fractional-hour tracking yet
    downtime_minutes = Column(Integer)

    closed_at = Column(DateTime, nullable=True)
    verified_by = Column(UUID(as_uuid=False), ForeignKey("employees.id"), nullable=True)

    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    machine = relationship("Machine")
    breakdown_event = relationship("BreakdownEvent")
    pm_plan = relationship("PMPlan")


class SparePart(Base):
    """
    Spare-parts inventory (Future-Ready item 14). Kept intentionally simple —
    a single on-hand quantity per part, no bin/warehouse breakdown — since
    that's what the shop floor actually tracks today; multi-location stock
    can be layered on later without touching consumption/work-order wiring.
    """
    __tablename__ = "spare_parts"

    id = Column(UUID(as_uuid=False), primary_key=True, default=gen_uuid)
    part_code = Column(String(50), unique=True, nullable=False, index=True)
    name = Column(String(255), nullable=False)
    description = Column(Text)
    unit = Column(String(20), default="pcs")  # pcs | ltr | kg | mtr ...

    stock_on_hand = Column(Integer, default=0, nullable=False)
    minimum_stock = Column(Integer, default=0, nullable=False)
    reserved_stock = Column(Integer, default=0, nullable=False)

    unit_cost = Column(Integer, nullable=True)  # cost per unit, in whole currency units (e.g. rupees)
    storage_location = Column(String(120))
    preferred_vendor = Column(String(120))

    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class SparePartTransaction(Base):
    """Immutable ledger of every stock movement, so stock_on_hand is always reconstructable/auditable."""
    __tablename__ = "spare_part_transactions"

    id = Column(UUID(as_uuid=False), primary_key=True, default=gen_uuid)
    spare_part_id = Column(UUID(as_uuid=False), ForeignKey("spare_parts.id"), nullable=False, index=True)
    work_order_id = Column(UUID(as_uuid=False), ForeignKey("work_orders.id"), nullable=True)
    change = Column(Integer, nullable=False)  # positive = stock in (receipt), negative = stock out (consumption)
    reason = Column(String(255))
    performed_by = Column(UUID(as_uuid=False), ForeignKey("employees.id"), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    spare_part = relationship("SparePart")
    work_order = relationship("WorkOrder")


class NotificationLog(Base):
    __tablename__ = "notification_logs"

    id = Column(UUID(as_uuid=False), primary_key=True, default=gen_uuid)
    pm_plan_id = Column(UUID(as_uuid=False), ForeignKey("pm_plans.id"), nullable=False)
    recipient_id = Column(UUID(as_uuid=False), ForeignKey("employees.id"))
    notification_type = Column(SAEnum(NotificationType), nullable=False)
    channel = Column(SAEnum(NotificationChannel), default=NotificationChannel.EMAIL)
    provider = Column(String(50))  # m365 | gmail | smtp_generic | whatsapp | sms
    idempotency_key = Column(String(255), nullable=False)  # pm_id + type + scheduled_date
    sent_at = Column(DateTime)
    delivery_status = Column(SAEnum(DeliveryStatus), default=DeliveryStatus.PENDING)
    retry_count = Column(Integer, default=0)
    error_message = Column(Text)

    created_at = Column(DateTime, default=datetime.utcnow)

    __table_args__ = (
        UniqueConstraint("idempotency_key", name="uq_notification_idempotency"),
    )


class AuditLog(Base):
    __tablename__ = "audit_logs"

    id = Column(UUID(as_uuid=False), primary_key=True, default=gen_uuid)
    actor_id = Column(UUID(as_uuid=False), ForeignKey("employees.id"), nullable=True)
    action = Column(String(100), nullable=False)     # e.g. "PM_COMPLETED", "EXCEL_IMPORTED"
    entity_type = Column(String(100))
    entity_id = Column(String(100))
    old_value = Column(JSONB)
    new_value = Column(JSONB)
    ip_address = Column(String(64))
    created_at = Column(DateTime, default=datetime.utcnow, index=True)


class ImportBatch(Base):
    __tablename__ = "import_batches"

    id = Column(UUID(as_uuid=False), primary_key=True, default=gen_uuid)
    original_filename = Column(String(500), nullable=False)
    file_hash = Column(String(128), nullable=False)
    version = Column(Integer, default=1)
    uploaded_by = Column(UUID(as_uuid=False), ForeignKey("employees.id"))
    uploaded_at = Column(DateTime, default=datetime.utcnow)

    machines_created = Column(Integer, default=0)
    machines_updated = Column(Integer, default=0)
    pm_plans_created = Column(Integer, default=0)
    pm_plans_updated = Column(Integer, default=0)
    pm_plans_removed = Column(Integer, default=0)
    duplicates_skipped = Column(Integer, default=0)
    warnings = Column(JSONB, default=list)
    errors = Column(JSONB, default=list)

    status = Column(String(30), default="COMPLETED")  # PREVIEW | COMPLETED | FAILED


class AppSetting(Base):
    """
    Admin-tunable settings (reminder day-offsets, escalation thresholds, the
    week->calendar-date convention, report recipients, etc). Backend code
    reads these via app.core.settings_service.get_setting(...), which falls
    back to the hardcoded default if a key isn't present yet, so this table
    never needs to be fully populated for the system to work.
    """
    __tablename__ = "app_settings"

    key = Column(String(100), primary_key=True)
    value = Column(JSONB, nullable=False)
    description = Column(String(500))
    updated_by = Column(UUID(as_uuid=False), ForeignKey("employees.id"))
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
