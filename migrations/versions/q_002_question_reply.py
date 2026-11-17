"""질문 최신 답 3열 추가. 기존 질문·연결·메모는 보존한다 (#248, PM 계약 C6)."""

import sqlalchemy as sa
from alembic import op

revision = "q_002"
down_revision = "tg_001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("q_question", sa.Column("reply_text", sa.Text(), nullable=True))
    op.add_column("q_question", sa.Column("replied_at", sa.Date(), nullable=True))
    op.add_column("q_question", sa.Column("replied_by", sa.String(32), nullable=True))


def downgrade() -> None:
    # 직접 열을 빼면 질문 표를 다시 만들지 않아 기존 외래키 연결을 보존한다.
    op.drop_column("q_question", "replied_by")
    op.drop_column("q_question", "replied_at")
    op.drop_column("q_question", "reply_text")
