"""AI 사용 기록에 회차 번호 칸 추가: 영업기회가 생기기 전의 후보 판단 비용도 같은 표에 남긴다.

(#221·#327, 계약 C4·C6, PM 결정 2026-11-06) 후보 찾기의 AI 고르기는 회사가 목록에 들어오기 전에
돌아서 영업기회 번호가 없다. 그래서 opp_id를 비울 수 있게 하고 batch_id(회차 번호)를 더한다.
둘 중 하나는 꼭 있어야 한다. 월 호출·비용 한도는 지금처럼 이 표 하나에서 합산한다.
"""

import sqlalchemy as sa
from alembic import op

revision = "tg_003"
down_revision = "src_001"
branch_labels = None
depends_on = None

_CHECK_NAME = "ck_tg_transfer_log_ref"
_CHECK_SQL = "opp_id IS NOT NULL OR batch_id IS NOT NULL"
_INDEX_NAME = "ix_tg_transfer_log_batch_id"


def upgrade() -> None:
    with op.batch_alter_table("tg_transfer_log") as batch:
        batch.alter_column("opp_id", existing_type=sa.String(40), nullable=True)
        batch.add_column(sa.Column("batch_id", sa.String(40), nullable=True))
        batch.create_check_constraint(_CHECK_NAME, _CHECK_SQL)
        batch.create_index(_INDEX_NAME, ["batch_id"])


def downgrade() -> None:
    # 회차로만 남긴 비용 기록은 옛 표 모양(opp_id 필수)에 담을 수 없다. 지우지 않고 멈춘다.
    orphan_count = (
        op.get_bind()
        .execute(sa.text("SELECT COUNT(*) FROM tg_transfer_log WHERE opp_id IS NULL"))
        .scalar_one()
    )
    if orphan_count:
        raise RuntimeError(
            f"후보 찾기 AI 사용 기록 {orphan_count}건이 있어 tg_003을 되돌릴 수 없습니다. "
            "비용 기록은 지우지 않습니다. 백업에서 복원하세요."
        )
    with op.batch_alter_table("tg_transfer_log") as batch:
        batch.drop_index(_INDEX_NAME)
        batch.drop_constraint(_CHECK_NAME, type_="check")
        batch.drop_column("batch_id")
        batch.alter_column("opp_id", existing_type=sa.String(40), nullable=False)
