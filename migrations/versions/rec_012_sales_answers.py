"""영업 꼬리 질문 답 표와 단계 고치기 열 추가 (#607, C6). 옛 행은 비워 둔다."""

import sqlalchemy as sa
from alembic import op

revision = "rec_012"
down_revision = "src_005"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("rec_outcome", sa.Column("step_override", sa.String(24), nullable=True))
    op.create_table(
        "rec_outcome_answer",
        sa.Column("answer_row_id", sa.String(40), primary_key=True),
        sa.Column(
            "outcome_id", sa.String(40), sa.ForeignKey("rec_outcome.outcome_id"), nullable=False
        ),
        sa.Column("opp_id", sa.String(40), nullable=False),
        sa.Column("question_id", sa.String(40), nullable=False),
        sa.Column("answer_id", sa.String(40), nullable=False),
        sa.Column("created_at", sa.String(40), nullable=False),
        sa.Column("created_by", sa.String(64), nullable=False),
        sa.Column("session_ref", sa.String(64), nullable=True),
        sa.Column("dataset_kind", sa.String(32), nullable=True),
        sa.Column("is_virtual", sa.Boolean(), nullable=False),
    )
    op.create_index("ix_rec_outcome_answer_outcome_id", "rec_outcome_answer", ["outcome_id"])
    op.create_index("ix_rec_outcome_answer_opp_id", "rec_outcome_answer", ["opp_id"])


def downgrade() -> None:
    op.drop_index("ix_rec_outcome_answer_opp_id", "rec_outcome_answer")
    op.drop_index("ix_rec_outcome_answer_outcome_id", "rec_outcome_answer")
    op.drop_table("rec_outcome_answer")
    op.drop_column("rec_outcome", "step_override")
