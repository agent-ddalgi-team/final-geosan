"""기존 메모를 유지하며 자료 조사 종류 추가 (#209, PM 계약 C6)."""

import sqlalchemy as sa
from alembic import op

revision = "rec_005"
down_revision = "opp_003"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("rec_note") as batch:
        batch.add_column(sa.Column("kind", sa.String(16), nullable=False, server_default="MEMO"))


def downgrade() -> None:
    with op.batch_alter_table("rec_note") as batch:
        batch.drop_column("kind")
