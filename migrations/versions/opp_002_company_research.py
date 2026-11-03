"""공개 대표번호와 기업 요약 열 추가 (#209, 2026-11-03 PM 계약 C6).

기존 고객은 조사 시각을 추측하지 않고 null로 둔다.
"""

import sqlalchemy as sa
from alembic import op

revision = "opp_002"
down_revision = "rec_002"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("opp_customer") as batch:
        batch.add_column(sa.Column("main_phone", sa.Text(), nullable=True))
        batch.add_column(sa.Column("main_phone_source", sa.String(16), nullable=True))
        batch.add_column(sa.Column("summary_line", sa.Text(), nullable=True))
        batch.add_column(sa.Column("highlights", sa.JSON(), nullable=True))
        batch.add_column(sa.Column("researched_at", sa.String(40), nullable=True))
        batch.add_column(sa.Column("research_source", sa.String(16), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("opp_customer") as batch:
        for column in ("research_source", "researched_at", "highlights", "summary_line",
                       "main_phone_source", "main_phone"):
            batch.drop_column(column)
