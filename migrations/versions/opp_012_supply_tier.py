"""공급망 위치(2·3차 가공 / 1차 완성품·조립)를 저장한다(C1 #860, PM 결정 2026-11-19·20).

회사 표에 위치·근거·출처를 더한다. 기존 행은 null(판단 전)이다.
"""

import sqlalchemy as sa
from alembic import op

revision = "opp_012"
down_revision = "rec_018"
branch_labels = None
depends_on = None


def upgrade() -> None:
    for column in [
        sa.Column("supply_tier", sa.String(16), nullable=True),
        sa.Column("supply_tier_basis", sa.Text(), nullable=True),
        sa.Column("supply_tier_source", sa.String(16), nullable=True),
    ]:
        op.add_column("opp_customer", column)


def downgrade() -> None:
    for name in ["supply_tier_source", "supply_tier_basis", "supply_tier"]:
        op.drop_column("opp_customer", name)
