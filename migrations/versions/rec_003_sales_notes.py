"""영업 메모를 덧붙이는 테이블 (#209, 계약 C6)."""

import sqlalchemy as sa
from alembic import op

revision = "rec_003"
down_revision = "opp_002"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "rec_note",
        sa.Column("note_id", sa.String(40), primary_key=True),
        sa.Column("opp_id", sa.String(40), sa.ForeignKey("opp_opportunity.opp_id"), nullable=False),
        sa.Column("staff_key", sa.String(64), nullable=False),
        sa.Column("text", sa.Text(), nullable=False),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.String(40), nullable=False),
        sa.Column("created_by", sa.String(64), nullable=False),
        sa.Column("session_ref", sa.String(64), nullable=True),
        sa.Column("dataset_kind", sa.String(32), nullable=True),
        sa.Column("is_virtual", sa.Boolean(), nullable=False),
    )


def downgrade() -> None:
    op.drop_table("rec_note")
