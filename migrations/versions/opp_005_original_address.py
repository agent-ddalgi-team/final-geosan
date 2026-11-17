"""고객 원본 주소 보존 (#209, PM 확인 2026-11-03).

비교용 주소에서 원문을 추측하지 않는다. 기존 행은 사례 재투입 전까지 NULL로 둔다.
"""

import sqlalchemy as sa
from alembic import op

revision = "opp_005"
down_revision = "merge_001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("opp_customer", sa.Column("address", sa.String(300), nullable=True))


def downgrade() -> None:
    op.drop_column("opp_customer", "address")
