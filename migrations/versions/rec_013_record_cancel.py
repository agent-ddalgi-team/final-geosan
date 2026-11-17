"""메모·영업 기록에 잘못 입력 표시 열 3개 추가 (#253, C6). 옛 행은 비워 둔다."""

import sqlalchemy as sa
from alembic import op

revision = "rec_013"
down_revision = "opp_009"
branch_labels = None
depends_on = None

TABLES = ("rec_note", "rec_outcome")


def upgrade() -> None:
    for table in TABLES:
        op.add_column(table, sa.Column("cancelled_at", sa.String(40), nullable=True))
        op.add_column(table, sa.Column("cancelled_by", sa.String(32), nullable=True))
        op.add_column(table, sa.Column("cancel_reason", sa.String(200), nullable=True))


def downgrade() -> None:
    for table in TABLES:
        op.drop_column(table, "cancel_reason")
        op.drop_column(table, "cancelled_by")
        op.drop_column(table, "cancelled_at")
