"""검토사항 체크·해제 이력 추가 (#227, 계약 C6·PM 결정 2026-11-03)."""

import sqlalchemy as sa
from alembic import op

revision = "rec_006"
down_revision = "opp_005"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "rec_review_check",
        sa.Column("review_check_id", sa.String(40), primary_key=True),
        sa.Column("opp_id", sa.String(40), sa.ForeignKey("opp_opportunity.opp_id"), nullable=False),
        sa.Column("item_id", sa.Text(), nullable=False),
        sa.Column("checked", sa.Boolean(), nullable=False),
        sa.Column("staff_key", sa.String(64), nullable=False),
        sa.Column("eval_id", sa.String(40), sa.ForeignKey("eval_run.eval_id"), nullable=False),
        sa.Column("created_at", sa.String(40), nullable=False),
        sa.Column("created_by", sa.String(64), nullable=False),
        sa.Column("session_ref", sa.String(64), nullable=True),
        sa.Column("dataset_kind", sa.String(32), nullable=True),
        sa.Column("is_virtual", sa.Boolean(), nullable=False),
    )


def downgrade() -> None:
    op.drop_table("rec_review_check")
