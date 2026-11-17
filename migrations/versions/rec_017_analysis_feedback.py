"""AI 분석 피드백 저장본(#824, 계약 C6, PM 결정 2026-11-16·17 #802 #821).

받을 때마다 새 행. 회사 이름·메모 글·연락처는 저장하지 않는다(숫자 표만 보고 쓴 글).
"""

import sqlalchemy as sa
from alembic import op

revision = "rec_017"
down_revision = "opp_011"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "rec_analysis_feedback",
        sa.Column("feedback_id", sa.String(40), primary_key=True),
        sa.Column("period_from", sa.Date(), nullable=True),
        sa.Column("period_to", sa.Date(), nullable=True),
        sa.Column("input_hash", sa.String(64), nullable=False),
        sa.Column("prompt_version", sa.String(120), nullable=False),
        sa.Column("model", sa.String(80), nullable=True),
        sa.Column("response", sa.JSON(), nullable=False),
        sa.Column("cost_usd", sa.Numeric(20, 10), nullable=True),
        sa.Column("transfer_log_id", sa.String(40), nullable=True),
        sa.Column("created_at", sa.String(40), nullable=False),
        sa.Column("created_by", sa.String(64), nullable=False),
        sa.Column("session_ref", sa.String(64), nullable=True),
        sa.Column("dataset_kind", sa.String(32), nullable=True),
        sa.Column("is_virtual", sa.Boolean(), nullable=False),
    )
    op.create_index(
        "ix_rec_analysis_feedback_period",
        "rec_analysis_feedback",
        ["dataset_kind", "period_from", "period_to"],
    )


def downgrade() -> None:
    op.drop_index("ix_rec_analysis_feedback_period", table_name="rec_analysis_feedback")
    op.drop_table("rec_analysis_feedback")
