"""add work orders

Revision ID: 0002_work_orders
Revises: 0001_initial
Create Date: 2026-09-23

Adds the work_orders table (Phase 2 item 13: Work Orders) - the tracked
repair job that bridges a reported problem (a breakdown, or a PM checklist
finding) to completion, assignment and sign-off, separate from planned PM.
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "0002_work_orders"
down_revision = "0001_initial"
branch_labels = None
depends_on = None

work_order_status = postgresql.ENUM(
    "OPEN", "ASSIGNED", "IN_PROGRESS", "WAITING_PARTS", "WAITING_APPROVAL",
    "COMPLETED", "VERIFIED", "CLOSED", name="workorderstatus",
)
work_order_priority = postgresql.ENUM("LOW", "MEDIUM", "HIGH", "CRITICAL", name="workorderpriority")


def upgrade() -> None:
    bind = op.get_bind()
    work_order_status.create(bind, checkfirst=True)
    work_order_priority.create(bind, checkfirst=True)

    op.create_table(
        "work_orders",
        sa.Column("id", postgresql.UUID(as_uuid=False), primary_key=True),
        sa.Column("number", sa.Integer(), nullable=False),
        sa.Column("machine_id", postgresql.UUID(as_uuid=False), sa.ForeignKey("machines.id"), nullable=False),
        sa.Column("breakdown_event_id", postgresql.UUID(as_uuid=False), sa.ForeignKey("breakdown_events.id"), nullable=True),
        sa.Column("pm_plan_id", postgresql.UUID(as_uuid=False), sa.ForeignKey("pm_plans.id"), nullable=True),
        sa.Column("title", sa.String(255), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("priority", work_order_priority, nullable=True),
        sa.Column("status", work_order_status, nullable=True),
        sa.Column("reported_by", postgresql.UUID(as_uuid=False), sa.ForeignKey("employees.id"), nullable=True),
        sa.Column("assigned_to", postgresql.UUID(as_uuid=False), sa.ForeignKey("employees.id"), nullable=True),
        sa.Column("due_date", sa.Date(), nullable=True),
        sa.Column("root_cause", sa.Text(), nullable=True),
        sa.Column("action_taken", sa.Text(), nullable=True),
        sa.Column("parts_used", sa.Text(), nullable=True),
        sa.Column("labor_hours", sa.Integer(), nullable=True),
        sa.Column("downtime_minutes", sa.Integer(), nullable=True),
        sa.Column("closed_at", sa.DateTime(), nullable=True),
        sa.Column("verified_by", postgresql.UUID(as_uuid=False), sa.ForeignKey("employees.id"), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=True),
        sa.Column("updated_at", sa.DateTime(), nullable=True),
    )
    op.create_index("ix_workorder_number", "work_orders", ["number"], unique=True)
    op.create_index("ix_workorder_machine", "work_orders", ["machine_id"])
    op.create_index("ix_workorder_status", "work_orders", ["status"])


def downgrade() -> None:
    op.drop_index("ix_workorder_status", table_name="work_orders")
    op.drop_index("ix_workorder_machine", table_name="work_orders")
    op.drop_index("ix_workorder_number", table_name="work_orders")
    op.drop_table("work_orders")

    bind = op.get_bind()
    work_order_priority.drop(bind, checkfirst=True)
    work_order_status.drop(bind, checkfirst=True)
