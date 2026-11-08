"""기록 당시 본 평가 번호 추가 (#450·#451, C6). 기존 행은 비워 둔다."""

import sqlalchemy as sa
from alembic import op

revision = "rec_009"
down_revision = "src_002"
branch_labels = None
depends_on = None


def upgrade() -> None:
    for table in ("rec_outcome", "rec_note"):
        op.add_column(table, sa.Column("eval_id", sa.String(40), nullable=True))


def downgrade() -> None:
    for table in ("rec_note", "rec_outcome"):
        op.drop_column(table, "eval_id")
