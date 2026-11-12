"""후보 찾기 회차에 접수 때 예상 금액 칸을 더한다(C6 #549). 옛 회차는 비워 둔다."""

import sqlalchemy as sa
from alembic import op

revision = "opp_009"
down_revision = "rec_012"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("opp_ingest_batch", sa.Column("estimated_usd", sa.Float(), nullable=True))


def downgrade() -> None:
    # 표를 다시 만들지 않고 열만 지운다(실행 중 회차 하나만 허용하는 색인을 그대로 둔다).
    op.drop_column("opp_ingest_batch", "estimated_usd")
