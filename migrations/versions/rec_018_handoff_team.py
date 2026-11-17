"""전달 사항을 역할 묶음으로 받기(#853, 계약 C6, PM 결정 2026-11-17): 메모 표에 받는 묶음 칸을 더한다.

종류 HANDOFF 행 가운데 묶음(예: 영업)으로 보낸 것만 채운다. 그때 to_staff_key는 비워 둔다.
옛 행·다른 종류는 비워 둔다(바꾸는 행 없음).
"""

import sqlalchemy as sa
from alembic import op

revision = "rec_018"
down_revision = "rec_017"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("rec_note") as batch:
        batch.add_column(sa.Column("to_team", sa.String(32), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("rec_note") as batch:
        batch.drop_column("to_team")
