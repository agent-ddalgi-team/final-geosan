"""대표번호 출처와 담당자 확인 열 (#209, PM 계약 C6)."""

import sqlalchemy as sa
from alembic import op

revision = "opp_003"
down_revision = "rec_004"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("opp_customer") as batch:
        batch.add_column(sa.Column("main_phone_source_url", sa.Text(), nullable=True))
        batch.add_column(sa.Column("main_phone_confirmed_at", sa.String(40), nullable=True))
        batch.add_column(sa.Column("main_phone_confirmed_by", sa.String(64), nullable=True))


def downgrade() -> None:
    # 참조 중인 고객 테이블을 복사·삭제하지 않고 추가한 열만 되돌린다.
    op.drop_column("opp_customer", "main_phone_confirmed_by")
    op.drop_column("opp_customer", "main_phone_confirmed_at")
    op.drop_column("opp_customer", "main_phone_source_url")
