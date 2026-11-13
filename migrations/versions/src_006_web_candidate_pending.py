"""#688(#314·#639 PM 결정): 웹 후보에 등록 전 홈페이지 찾기 결과 2열을 더한다.

등록 확인 상태의 "조회 대기"(PENDING)는 기존 글자 열에 값만 더하므로 열 변경이 없다.
"""

import sqlalchemy as sa
from alembic import op

revision = "src_006"
down_revision = "rec_014"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # 표를 다시 만들지 않고 열만 더한다(판단 기록이 웹 후보를 가리키고 있다).
    op.add_column("src_web_candidate", sa.Column("homepage_confidence", sa.Float(), nullable=True))
    op.add_column("src_web_candidate", sa.Column("homepage_reason", sa.Text(), nullable=True))


def downgrade() -> None:
    op.drop_column("src_web_candidate", "homepage_reason")
    op.drop_column("src_web_candidate", "homepage_confidence")
