"""회사 대표명과 그 출처를 둔다(#980, 계약 C6, PM 결정 2026-11-28).

출처는 REGISTRY(공장등록 조회) 또는 MANUAL(담당자 입력). 기존 행은 null이다.
"""

import sqlalchemy as sa
from alembic import op

revision = "opp_013"
down_revision = "src_008"
branch_labels = None
depends_on = None


def upgrade() -> None:
    for column in [
        sa.Column("representative_name", sa.String(20), nullable=True),
        sa.Column("representative_name_source", sa.String(16), nullable=True),
    ]:
        op.add_column("opp_customer", column)


def downgrade() -> None:
    for name in ["representative_name_source", "representative_name"]:
        op.drop_column("opp_customer", name)
