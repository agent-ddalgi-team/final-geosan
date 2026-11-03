"""영업 단계·접촉 시도·다음 일정의 이력 (#209, 계약 C1·C6)."""

import sqlalchemy as sa
from alembic import op

revision = "rec_004"
down_revision = "rec_003"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "rec_outcome",
        sa.Column("outcome_id", sa.String(40), primary_key=True),
        sa.Column("opp_id", sa.String(40), sa.ForeignKey("opp_opportunity.opp_id"), nullable=False),
        sa.Column("status", sa.String(40), nullable=False),
        sa.Column("reply_received", sa.Boolean(), nullable=False),
        sa.Column("next_schedule_at", sa.Date(), nullable=True),
        sa.Column("next_schedule_note", sa.Text(), nullable=True),
        sa.Column("reason", sa.Text(), nullable=True),
        sa.Column("memo", sa.Text(), nullable=True),
        sa.Column("action_id", sa.String(40), nullable=True),
        sa.Column("method", sa.String(16), nullable=True),
        sa.Column("result", sa.String(16), nullable=True),
        sa.Column("attempted_at", sa.Date(), nullable=True),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.String(40), nullable=False),
        sa.Column("created_by", sa.String(64), nullable=False),
        sa.Column("session_ref", sa.String(64), nullable=True),
        sa.Column("dataset_kind", sa.String(32), nullable=True),
        sa.Column("is_virtual", sa.Boolean(), nullable=False),
    )


def downgrade() -> None:
    op.drop_table("rec_outcome")
