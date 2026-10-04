"""add unique constraint on employees.email

Revision ID: 0004_employee_email_unique
Revises: 0003_spare_parts_rca
Create Date: 2026-10-01

Email doubles as the login identity, so two employees sharing one email
silently breaks authentication (whichever row the query happens to return
first wins). This closes that gap at the database level.
"""
from alembic import op

revision = "0004_employee_email_unique"
down_revision = "0003_spare_parts_rca"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_unique_constraint("uq_employees_email", "employees", ["email"])


def downgrade() -> None:
    op.drop_constraint("uq_employees_email", "employees", type_="unique")
