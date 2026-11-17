"""미확정 AI 사용량을 정산한 시각·처리자 보존 (#218, PM 2026-11-04)."""

import sqlalchemy as sa
from alembic import op

revision = "tg_002"
down_revision = "q_002"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("tg_transfer_log", sa.Column("reconciled_at", sa.String(40), nullable=True))
    op.add_column("tg_transfer_log", sa.Column("reconciled_by", sa.String(64), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("tg_transfer_log") as batch:
        batch.drop_column("reconciled_by")
        batch.drop_column("reconciled_at")
