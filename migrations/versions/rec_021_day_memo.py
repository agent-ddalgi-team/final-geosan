"""달력 날짜 메모 표(#984, 계약 C6, PM 결정 2026-11-28 "팀이 함께 보도록").

어느 날짜든 200자 메모를 남긴다. 지우면 행을 지우지 않고 지운 시각·지운 사람만 채운다.
번호 rec_020은 다른 작업(#980)이 쓰기로 해서 rec_021로 둔다.
"""

import sqlalchemy as sa
from alembic import op

revision = "rec_021"
down_revision = "rec_020"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "rec_day_memo",
        sa.Column("memo_id", sa.String(40), primary_key=True),
        sa.Column("day", sa.Date(), nullable=False),
        sa.Column("text", sa.String(200), nullable=False),
        sa.Column("staff_key", sa.String(64), nullable=False),
        sa.Column("deleted_at", sa.String(40), nullable=True),
        sa.Column("deleted_by", sa.String(64), nullable=True),
        sa.Column("created_at", sa.String(40), nullable=False),
        sa.Column("created_by", sa.String(64), nullable=False),
        sa.Column("session_ref", sa.String(64), nullable=True),
        sa.Column("dataset_kind", sa.String(32), nullable=True),
        sa.Column("is_virtual", sa.Boolean(), nullable=False),
    )
    op.create_index("ix_rec_day_memo_dataset_day", "rec_day_memo", ["dataset_kind", "day"])


def downgrade() -> None:
    op.drop_index("ix_rec_day_memo_dataset_day", table_name="rec_day_memo")
    op.drop_table("rec_day_memo")
