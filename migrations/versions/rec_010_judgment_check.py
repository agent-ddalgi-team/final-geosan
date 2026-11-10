"""접촉 때 AI 판단이 맞았나 추가 (#531, C6). 기존 행은 비워 둔다."""

import sqlalchemy as sa
from alembic import op

revision = "rec_010"
down_revision = "src_003"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("rec_outcome", sa.Column("judgment_check", sa.String(16), nullable=True))


def downgrade() -> None:
    op.drop_column("rec_outcome", "judgment_check")
