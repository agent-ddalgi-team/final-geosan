"""팩토리온 회사 전화번호와 공장등록 조회 대표자명을 둔다(#980, 계약 C6, PM 결정 2026-11-28).

기존 행은 null이다. 다음 팩토리온 불러오기·공장등록 조회 때 채운다.
"""

import sqlalchemy as sa
from alembic import op

revision = "src_008"
down_revision = "rec_019"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("src_factory_profile", sa.Column("main_phone", sa.String(20), nullable=True))
    op.add_column(
        "src_factory_row", sa.Column("representative_name", sa.String(20), nullable=True)
    )


def downgrade() -> None:
    op.drop_column("src_factory_row", "representative_name")
    op.drop_column("src_factory_profile", "main_phone")
