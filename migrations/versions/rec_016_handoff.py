"""전달 사항(#771, 계약 C6, PM 결정 2026-11-15·16): 메모 표에 받는 사람과 확인 칸을 더한다.

종류 HANDOFF 행만 채운다. 받는 사람이 [확인했어요]를 누르면 확인 시각·사람이 채워진다.
"""

import sqlalchemy as sa
from alembic import op

revision = "rec_016"
down_revision = "web_002"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("rec_note") as batch:
        batch.add_column(sa.Column("to_staff_key", sa.String(64), nullable=True))
        batch.add_column(sa.Column("confirmed_at", sa.String(40), nullable=True))
        batch.add_column(sa.Column("confirmed_by", sa.String(64), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("rec_note") as batch:
        batch.drop_column("confirmed_by")
        batch.drop_column("confirmed_at")
        batch.drop_column("to_staff_key")
