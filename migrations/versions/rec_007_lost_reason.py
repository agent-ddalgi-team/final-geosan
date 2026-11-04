"""거절 이유 코드 한 열 추가 (#250, PM 계약 C6). 기존 기록은 null로 보존한다."""

import sqlalchemy as sa
from alembic import op

revision = "rec_007"
down_revision = "tg_001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("rec_outcome", sa.Column("lost_reason_code", sa.String(32), nullable=True))


def downgrade() -> None:
    op.drop_column("rec_outcome", "lost_reason_code")
