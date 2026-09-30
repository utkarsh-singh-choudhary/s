"""add spare parts inventory and RCA five-whys

Revision ID: 0003_spare_parts_rca
Revises: 0002_work_orders
Create Date: 2026-09-23

Adds spare_parts + spare_part_transactions (Phase 2 item 14: spare-parts
inventory, consumption tracked against work orders) and a five_whys JSONB
column on work_orders (Phase 2 item 15: structured root-cause analysis).
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "0003_spare_parts_rca"
down_revision = "0002_work_orders"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("work_orders", sa.Column("five_whys", postgresql.JSONB(), nullable=True))

    op.create_table(
        "spare_parts",
        sa.Column("id", postgresql.UUID(as_uuid=False), primary_key=True),
        sa.Column("part_code", sa.String(50), nullable=False, unique=True),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("unit", sa.String(20), nullable=True),
        sa.Column("stock_on_hand", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("minimum_stock", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("reserved_stock", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("unit_cost", sa.Integer(), nullable=True),
        sa.Column("storage_location", sa.String(120), nullable=True),
        sa.Column("preferred_vendor", sa.String(120), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=True),
        sa.Column("updated_at", sa.DateTime(), nullable=True),
    )
    op.create_index("ix_sparepart_code", "spare_parts", ["part_code"], unique=True)

    op.create_table(
        "spare_part_transactions",
        sa.Column("id", postgresql.UUID(as_uuid=False), primary_key=True),
        sa.Column("spare_part_id", postgresql.UUID(as_uuid=False), sa.ForeignKey("spare_parts.id"), nullable=False),
                sa.Column("work_order_id", sa.String(), sa.ForeignKey("work_orders.id"), nullable=True),
        sa.Column("change", sa.Integer(), nullable=False),
        sa.Column("reason", sa.String(255), nullable=True),
        sa.Column("performed_by", sa.String(), sa.ForeignKey("employees.id"), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=True),
    )
    op.create_index("ix_sparepart_txn_part", "spare_part_transactions", ["spare_part_id"])


def downgrade() -> None:
    op.drop_index("ix_sparepart_txn_part", table_name="spare_part_transactions")
    op.drop_table("spare_part_transactions")
    op.drop_index("ix_sparepart_code", table_name="spare_parts")
    op.drop_table("spare_parts")
    op.drop_column("work_orders", "five_whys")
