"""CMMS upgrade: breakdown lifecycle + RCA, work-order lifecycle, labour/costs,
versioned checklists with results/readings, evidence files, audit signatures.

Revision ID: 0006_cmms_lifecycle
Revises: 0005_pm_attachments
Create Date: 2026-10-14

Every step checks whether the column/table is already there, so the migration
is safe to re-run on a database that was partly upgraded.
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "0006_cmms_lifecycle"
down_revision = "0005_pm_attachments"
branch_labels = None
depends_on = None

UUID = postgresql.UUID(as_uuid=False)


def _ref(table):
    """Column type for a foreign key to table.id - matches whatever the live database uses (uuid or varchar)."""
    try:
        for c in sa.inspect(op.get_bind()).get_columns(table):
            if c["name"] == "id":
                return UUID if isinstance(c["type"], postgresql.UUID) else sa.String()
    except Exception:
        pass
    return UUID
JSONB = postgresql.JSONB()


def _cols(table):
    return {c["name"] for c in sa.inspect(op.get_bind()).get_columns(table)}


def _tables():
    return set(sa.inspect(op.get_bind()).get_table_names())


def add(table, column):
    if column.name not in _cols(table):
        op.add_column(table, column)


def upgrade() -> None:
    S = sa.String
    B = sa.Boolean

    # machines / employees
    add("machines", sa.Column("machine_type", S(100)))
    add("employees", sa.Column("hourly_rate", sa.Float()))

    # checklists
    add("checklist_templates", sa.Column("task_type", S(20), nullable=False, server_default="PM"))
    add("checklist_templates", sa.Column("machine_type", S(100)))
    add("checklist_templates", sa.Column("version", sa.Integer(), nullable=False, server_default="1"))
    add("checklist_template_items", sa.Column("requires_reading", B(), server_default=sa.text("false")))
    add("checklist_template_items", sa.Column("reading_unit", S(30)))
    add("checklist_template_items", sa.Column("critical", B(), server_default=sa.text("false")))
    add("checklist_template_items", sa.Column("evidence_on_fail", B(), server_default=sa.text("false")))
    add("pm_checklist_responses", sa.Column("result", S(10)))
    add("pm_checklist_responses", sa.Column("reading", S(100)))
    add("pm_checklist_responses", sa.Column("template_version", sa.Integer()))
    op.execute("UPDATE pm_checklist_responses SET result = CASE WHEN checked THEN 'PASS' ELSE 'FAIL' END WHERE result IS NULL")
    op.execute("UPDATE pm_checklist_responses SET template_version = 1 WHERE template_version IS NULL")

    # breakdowns
    add("breakdown_events", sa.Column("bd_number", S(20)))
    add("breakdown_events", sa.Column("reported_at", sa.DateTime()))
    add("breakdown_events", sa.Column("failure_category", S(30)))
    add("breakdown_events", sa.Column("failure_mode", S(120)))
    add("breakdown_events", sa.Column("severity", S(10), server_default="MEDIUM"))
    add("breakdown_events", sa.Column("production_impact", S(30)))
    add("breakdown_events", sa.Column("temporary_action", sa.Text()))
    add("breakdown_events", sa.Column("corrective_action", sa.Text()))
    add("breakdown_events", sa.Column("root_cause", sa.Text()))
    add("breakdown_events", sa.Column("status", S(30), server_default="REPORTED"))
    add("breakdown_events", sa.Column("rca_status", S(20), server_default="NOT_STARTED"))
    add("breakdown_events", sa.Column("rca_data", JSONB))
    add("breakdown_events", sa.Column("verified_by", _ref("employees"), sa.ForeignKey("employees.id")))
    add("breakdown_events", sa.Column("verified_at", sa.DateTime()))
    add("breakdown_events", sa.Column("closed_at", sa.DateTime()))
    add("breakdown_events", sa.Column("closed_by", _ref("employees"), sa.ForeignKey("employees.id")))

    bind = op.get_bind()
    op.execute("UPDATE breakdown_events SET reported_at = created_at WHERE reported_at IS NULL")
    op.execute("UPDATE breakdown_events SET severity = 'MEDIUM' WHERE severity IS NULL")
    op.execute("UPDATE breakdown_events SET rca_status = 'NOT_STARTED' WHERE rca_status IS NULL")
    op.execute("UPDATE breakdown_events SET corrective_action = action_taken WHERE corrective_action IS NULL AND action_taken IS NOT NULL")
    op.execute("UPDATE breakdown_events SET root_cause = cause WHERE root_cause IS NULL AND cause IS NOT NULL")
    op.execute("UPDATE breakdown_events SET status = CASE WHEN resumed_at IS NOT NULL THEN 'CLOSED' ELSE 'REPORTED' END WHERE status IS NULL OR status = 'REPORTED'")
    op.execute("UPDATE breakdown_events SET closed_at = resumed_at WHERE status = 'CLOSED' AND closed_at IS NULL")
    # Give existing incidents their BD-YYYY-NNNNN numbers, oldest first.
    rows = bind.execute(sa.text(
        "SELECT id, breakdown_at FROM breakdown_events WHERE bd_number IS NULL ORDER BY breakdown_at, created_at")).fetchall()
    seq = {}
    for rid, at in rows:
        year = at.year
        seq[year] = seq.get(year, 0) + 1
        existing = bind.execute(sa.text(
            "SELECT COUNT(*) FROM breakdown_events WHERE bd_number LIKE :p"), {"p": f"BD-{year}-%"}).scalar() or 0
        bind.execute(sa.text("UPDATE breakdown_events SET bd_number = :n WHERE id = :i"),
                     {"n": f"BD-{year}-{existing + 1:05d}", "i": rid})
    insp = sa.inspect(bind)
    if "ix_breakdown_events_bd_number" not in {i["name"] for i in insp.get_indexes("breakdown_events")}:
        op.create_index("ix_breakdown_events_bd_number", "breakdown_events", ["bd_number"], unique=True)
    if "ix_breakdown_events_status" not in {i["name"] for i in insp.get_indexes("breakdown_events")}:
        op.create_index("ix_breakdown_events_status", "breakdown_events", ["status"])

    # work orders
    add("work_orders", sa.Column("source", S(30)))
    add("work_orders", sa.Column("failure_category", S(30)))
    add("work_orders", sa.Column("supervisor_id", _ref("employees"), sa.ForeignKey("employees.id")))
    add("work_orders", sa.Column("planned_start", sa.DateTime()))
    add("work_orders", sa.Column("safety_risk", S(10)))
    add("work_orders", sa.Column("permit_required", B(), server_default=sa.text("false")))
    add("work_orders", sa.Column("loto_required", B(), server_default=sa.text("false")))
    add("work_orders", sa.Column("safety_confirmed", B(), server_default=sa.text("false")))
    add("work_orders", sa.Column("estimated_hours", sa.Float()))
    add("work_orders", sa.Column("estimated_cost", sa.Float()))
    add("work_orders", sa.Column("waiting_reason", S(20)))
    add("work_orders", sa.Column("diagnosis", sa.Text()))
    add("work_orders", sa.Column("resolution_code", S(30)))
    add("work_orders", sa.Column("repair_summary", sa.Text()))
    add("work_orders", sa.Column("started_at", sa.DateTime()))
    add("work_orders", sa.Column("completed_at", sa.DateTime()))
    add("work_orders", sa.Column("completed_by", _ref("employees"), sa.ForeignKey("employees.id")))
    add("work_orders", sa.Column("restored_at", sa.DateTime()))
    add("work_orders", sa.Column("cancelled", B(), server_default=sa.text("false")))
    add("work_orders", sa.Column("cancel_reason", sa.Text()))
    add("work_orders", sa.Column("reopen_count", sa.Integer(), server_default="0"))
    add("work_orders", sa.Column("parent_work_order_id", _ref("work_orders"), sa.ForeignKey("work_orders.id")))
    op.execute("UPDATE work_orders SET source = CASE WHEN breakdown_event_id IS NOT NULL THEN 'BREAKDOWN' "
               "WHEN pm_plan_id IS NOT NULL THEN 'PM' ELSE 'OPERATOR_REQUEST' END WHERE source IS NULL")
    op.execute("UPDATE work_orders SET cancelled = false WHERE cancelled IS NULL")
    op.execute("UPDATE work_orders SET reopen_count = 0 WHERE reopen_count IS NULL")
    op.execute("UPDATE work_orders SET permit_required = false WHERE permit_required IS NULL")
    op.execute("UPDATE work_orders SET loto_required = false WHERE loto_required IS NULL")
    op.execute("UPDATE work_orders SET safety_confirmed = false WHERE safety_confirmed IS NULL")
    op.execute("UPDATE work_orders SET diagnosis = root_cause WHERE diagnosis IS NULL AND root_cause IS NOT NULL")

    # spare parts
    add("spare_parts", sa.Column("category", S(80)))
    add("spare_parts", sa.Column("compatible_machine_ids", JSONB))
    add("spare_parts", sa.Column("lead_time_days", sa.Integer()))
    add("spare_part_transactions", sa.Column("txn_type", S(20)))
    add("spare_part_transactions", sa.Column("unit_cost", sa.Float()))
    add("spare_part_transactions", sa.Column("breakdown_event_id", _ref("breakdown_events"), sa.ForeignKey("breakdown_events.id")))
    add("spare_part_transactions", sa.Column("idempotency_key", S(100)))
    add("spare_part_transactions", sa.Column("approved_by", _ref("employees"), sa.ForeignKey("employees.id")))
    op.execute("UPDATE spare_part_transactions SET txn_type = CASE "
               "WHEN change > 0 THEN 'RECEIPT' WHEN work_order_id IS NOT NULL THEN 'CONSUME' ELSE 'ADJUSTMENT' END "
               "WHERE txn_type IS NULL")
    # Old consumption rows never recorded a price; use the part's current price once, as the best available figure.
    op.execute("UPDATE spare_part_transactions t SET unit_cost = p.unit_cost FROM spare_parts p "
               "WHERE t.spare_part_id = p.id AND t.unit_cost IS NULL AND p.unit_cost IS NOT NULL")
    insp = sa.inspect(bind)
    if "uq_spt_idempotency_key" not in {c["name"] for c in insp.get_unique_constraints("spare_part_transactions")}:
        op.create_unique_constraint("uq_spt_idempotency_key", "spare_part_transactions", ["idempotency_key"])

    # audit signatures
    add("audit_logs", sa.Column("signature", S(64)))

    tables = _tables()
    if "corrective_actions" not in tables:
        op.create_table(
            "corrective_actions",
            sa.Column("id", UUID, primary_key=True),
            sa.Column("breakdown_event_id", _ref("breakdown_events"), sa.ForeignKey("breakdown_events.id"), nullable=False),
            sa.Column("kind", S(12), nullable=False, server_default="CORRECTIVE"),
            sa.Column("description", sa.Text(), nullable=False),
            sa.Column("owner_id", _ref("employees"), sa.ForeignKey("employees.id")),
            sa.Column("target_date", sa.Date()),
            sa.Column("status", S(12), nullable=False, server_default="OPEN"),
            sa.Column("completed_at", sa.DateTime()),
            sa.Column("effectiveness", S(14), server_default="PENDING"),
            sa.Column("effectiveness_note", sa.Text()),
            sa.Column("created_by", _ref("employees"), sa.ForeignKey("employees.id")),
            sa.Column("created_at", sa.DateTime()),
        )
        op.create_index("ix_corrective_actions_breakdown", "corrective_actions", ["breakdown_event_id"])
    if "work_order_logs" not in tables:
        op.create_table(
            "work_order_logs",
            sa.Column("id", UUID, primary_key=True),
            sa.Column("work_order_id", _ref("work_orders"), sa.ForeignKey("work_orders.id"), nullable=False),
            sa.Column("event", S(30), nullable=False),
            sa.Column("from_status", S(30)), sa.Column("to_status", S(30)),
            sa.Column("reason", S(40)), sa.Column("note", sa.Text()),
            sa.Column("by_id", _ref("employees"), sa.ForeignKey("employees.id")),
            sa.Column("logged_at", sa.DateTime()),
        )
        op.create_index("ix_work_order_logs_wo", "work_order_logs", ["work_order_id"])
    if "work_order_labour" not in tables:
        op.create_table(
            "work_order_labour",
            sa.Column("id", UUID, primary_key=True),
            sa.Column("work_order_id", _ref("work_orders"), sa.ForeignKey("work_orders.id"), nullable=False),
            sa.Column("technician_id", _ref("employees"), sa.ForeignKey("employees.id"), nullable=False),
            sa.Column("started_at", sa.DateTime()), sa.Column("ended_at", sa.DateTime()),
            sa.Column("hours", sa.Float(), nullable=False),
            sa.Column("hourly_rate", sa.Float(), nullable=False),
            sa.Column("note", sa.Text()),
            sa.Column("created_by", _ref("employees"), sa.ForeignKey("employees.id")),
            sa.Column("created_at", sa.DateTime()),
        )
        op.create_index("ix_work_order_labour_wo", "work_order_labour", ["work_order_id"])
    if "work_order_costs" not in tables:
        op.create_table(
            "work_order_costs",
            sa.Column("id", UUID, primary_key=True),
            sa.Column("work_order_id", _ref("work_orders"), sa.ForeignKey("work_orders.id"), nullable=False),
            sa.Column("category", S(20), nullable=False),
            sa.Column("description", S(255), nullable=False),
            sa.Column("amount", sa.Float(), nullable=False),
            sa.Column("tax_amount", sa.Float()),
            sa.Column("currency", S(8)),
            sa.Column("vendor", S(150)), sa.Column("invoice_ref", S(100)),
            sa.Column("recorded_by", _ref("employees"), sa.ForeignKey("employees.id")),
            sa.Column("recorded_at", sa.DateTime()),
            sa.Column("approved_by", _ref("employees"), sa.ForeignKey("employees.id")),
            sa.Column("approved_at", sa.DateTime()),
        )
        op.create_index("ix_work_order_costs_wo", "work_order_costs", ["work_order_id"])
    if "work_order_checklist_responses" not in tables:
        op.create_table(
            "work_order_checklist_responses",
            sa.Column("id", UUID, primary_key=True),
            sa.Column("work_order_id", _ref("work_orders"), sa.ForeignKey("work_orders.id"), nullable=False),
            sa.Column("checklist_template_item_id", _ref("checklist_template_items"), sa.ForeignKey("checklist_template_items.id"), nullable=False),
            sa.Column("result", S(10), nullable=False),
            sa.Column("reading", S(100)), sa.Column("note", sa.Text()),
            sa.Column("item_text", S(500)), sa.Column("item_required", B()),
            sa.Column("template_version", sa.Integer()),
            sa.Column("performed_by", _ref("employees"), sa.ForeignKey("employees.id")),
            sa.Column("performed_at", sa.DateTime()),
            sa.UniqueConstraint("work_order_id", "checklist_template_item_id", name="uq_wo_checklist_item"),
        )
        op.create_index("ix_wo_checklist_wo", "work_order_checklist_responses", ["work_order_id"])
    if "evidence_files" not in tables:
        op.create_table(
            "evidence_files",
            sa.Column("id", UUID, primary_key=True),
            sa.Column("entity_type", S(30), nullable=False),
            sa.Column("entity_id", UUID, nullable=False),
            sa.Column("label", S(120)),
            sa.Column("filename", S(255), nullable=False),
            sa.Column("content_type", S(100), nullable=False),
            sa.Column("size_bytes", sa.Integer(), nullable=False),
            sa.Column("data", sa.LargeBinary(), nullable=False),
            sa.Column("uploaded_by", _ref("employees"), sa.ForeignKey("employees.id")),
            sa.Column("created_at", sa.DateTime()),
        )
        op.create_index("ix_evidence_entity", "evidence_files", ["entity_type", "entity_id"])

    # helpful search indexes
    insp = sa.inspect(bind)
    def idx(table, name, cols):
        if name not in {i["name"] for i in insp.get_indexes(table)}:
            op.create_index(name, table, cols)
    idx("pm_actuals", "ix_pm_actuals_actual_date", ["actual_date"])
    idx("breakdown_events", "ix_breakdown_events_breakdown_at", ["breakdown_at"])
    idx("work_orders", "ix_work_orders_created_at", ["created_at"])


def downgrade() -> None:
    for t in ("evidence_files", "work_order_checklist_responses", "work_order_costs",
              "work_order_labour", "work_order_logs", "corrective_actions"):
        op.drop_table(t)
