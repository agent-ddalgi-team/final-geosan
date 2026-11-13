"""메모에 검토사항 자료 줄 번호 칸 추가 (#259, C6). 옛 행은 비워 둔다."""

import sqlalchemy as sa
from alembic import op

revision = "rec_014"
down_revision = "merge_002"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("rec_note", sa.Column("item_id", sa.String(64), nullable=True))


def downgrade() -> None:
    op.drop_column("rec_note", "item_id")
