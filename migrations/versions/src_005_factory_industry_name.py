"""#617 PM 결정: 회사의 공장 정보에 공장 등록 업종명 1열을 더한다."""

import sqlalchemy as sa
from alembic import op

revision = "src_005"
down_revision = "src_004"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # 표를 다시 만들지 않고 열만 더한다(다른 표가 회사를 가리키고 있어 다시 만들면 연결이 깨짐).
    # 값은 공장조회 파일을 다음에 불러올 때 다른 공장 정보와 함께 채워진다.
    op.add_column("opp_customer", sa.Column("factory_industry_name", sa.String(200), nullable=True))


def downgrade() -> None:
    op.drop_column("opp_customer", "factory_industry_name")
