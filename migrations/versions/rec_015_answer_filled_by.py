"""꼬리 질문 답에 누가 채웠는지 칸 추가 (#742, C6). 옛 행은 비워 둔다.

영업 코치가 채운 답을 담당자가 그대로 저장했는지(AI_CONFIRMED) 직접 골랐는지(STAFF)를 남겨
나중에 "AI가 채운 답을 얼마나 고쳤나"를 센다. 더하는 변경이며 기존 행은 거꾸로 채우지 않는다.
"""

import sqlalchemy as sa
from alembic import op

revision = "rec_015"
down_revision = "src_006"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("rec_outcome_answer", sa.Column("filled_by", sa.String(16), nullable=True))


def downgrade() -> None:
    op.drop_column("rec_outcome_answer", "filled_by")
