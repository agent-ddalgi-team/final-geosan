"""단지 조회 기록에 "이 조회가 받은 공장 행 번호 목록" 칸 추가 (#405, 계약 C5, PM 결정 2026-11-08).

같은 공장을 다른 단지명 조회가 또 받으면 행의 받은 시각이 덮여, 시각만으로는 앞 조회가 받은
행을 다시 찾을 수 없었다. 조회마다 받은 행 번호를 들고 있으면 각 조회의 결과가 그대로 남는다.
기존 기록은 빈 목록으로 채우고, 건수는 있는데 목록이 빈 기록은 다시 쓰지 않는다(빈 성공으로
보이지 않게).
"""

import sqlalchemy as sa
from alembic import op

revision = "src_002"
down_revision = "rec_008"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("src_complex_fetch") as batch:
        batch.add_column(sa.Column("row_ids", sa.JSON(), nullable=False, server_default="[]"))


def downgrade() -> None:
    with op.batch_alter_table("src_complex_fetch") as batch:
        batch.drop_column("row_ids")
