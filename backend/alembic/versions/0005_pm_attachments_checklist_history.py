"""PM attachments table + checklist history protection

Revision ID: 0005_pm_attachments
Revises: 0004_employee_email_unique
Create Date: 2026-10-13

- pm_attachments: photos/PDFs stored in the database so completed-PM evidence
  survives redeploys and can be viewed at any time.
- checklist_template_items.active: items with history are switched off, not
  deleted, when a template is edited.
- pm_checklist_responses.item_text / item_required: snapshot of the item at
  completion time.
Guards make this safe to re-run on a database that already has some of it.
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "0005_pm_attachments"
down_revision = "0004_employee_email_unique"
branch_labels = None
depends_on = None




def _ref(table):
    """Column type for a foreign key to table.id - matches whatever the live database uses (uuid or varchar)."""
    try:
        for c in sa.inspect(op.get_bind()).get_columns(table):
            if c["name"] == "id":
                return postgresql.UUID(as_uuid=False) if isinstance(c["type"], postgresql.UUID) else sa.String()
    except Exception:
        pass
    return postgresql.UUID(as_uuid=False)


def _cols(insp, table):
    return {c["name"] for c in insp.get_columns(table)}


def upgrade() -> None:
    insp = sa.inspect(op.get_bind())

    if "pm_attachments" not in insp.get_table_names():
        op.create_table(
            "pm_attachments",
            sa.Column("id", postgresql.UUID(as_uuid=False), primary_key=True),
            sa.Column("pm_plan_id", _ref("pm_plans"), sa.ForeignKey("pm_plans.id"), nullable=False),
            sa.Column("filename", sa.String(255), nullable=False),
            sa.Column("content_type", sa.String(100), nullable=False),
            sa.Column("size_bytes", sa.Integer(), nullable=False),
            sa.Column("data", sa.LargeBinary(), nullable=False),
            sa.Column("uploaded_by", _ref("employees"), sa.ForeignKey("employees.id"), nullable=True),
            sa.Column("created_at", sa.DateTime(), nullable=True),
        )
        op.create_index("ix_pm_attachments_pm_plan_id", "pm_attachments", ["pm_plan_id"])

    if "active" not in _cols(insp, "checklist_template_items"):
        op.add_column("checklist_template_items",
                      sa.Column("active", sa.Boolean(), nullable=False, server_default=sa.text("true")))

    resp_cols = _cols(insp, "pm_checklist_responses")
    if "item_text" not in resp_cols:
        op.add_column("pm_checklist_responses", sa.Column("item_text", sa.String(500), nullable=True))
    if "item_required" not in resp_cols:
        op.add_column("pm_checklist_responses", sa.Column("item_required", sa.Boolean(), nullable=True))
    # Backfill the snapshot for existing history from the current item text.
    op.execute(
        "UPDATE pm_checklist_responses r SET item_text = i.text, item_required = i.required "
        "FROM checklist_template_items i WHERE r.checklist_template_item_id = i.id AND r.item_text IS NULL"
    )


def downgrade() -> None:
    op.drop_column("pm_checklist_responses", "item_required")
    op.drop_column("pm_checklist_responses", "item_text")
    op.drop_column("checklist_template_items", "active")
    op.drop_index("ix_pm_attachments_pm_plan_id", table_name="pm_attachments")
    op.drop_table("pm_attachments")
