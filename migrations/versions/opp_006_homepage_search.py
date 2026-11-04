"""홈페이지 검색 결과를 보존한다. 이전 고객은 조사 전(NULL)으로 둔다 (#218·C9)."""

import sqlalchemy as sa
from alembic import op

revision = "opp_006"
down_revision = "rec_006"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("opp_customer", sa.Column("homepage_url", sa.Text()))
    op.add_column("opp_customer", sa.Column("homepage_status", sa.String(24)))
    op.add_column("opp_customer", sa.Column("homepage_source", sa.String(16)))
    op.add_column("opp_customer", sa.Column("homepage_confidence", sa.Float()))
    op.add_column("opp_customer", sa.Column("homepage_reason", sa.Text()))
    op.add_column("opp_customer", sa.Column("homepage_fetched_at", sa.String(40)))


def downgrade() -> None:
    for column in (
        "homepage_fetched_at",
        "homepage_reason",
        "homepage_confidence",
        "homepage_source",
        "homepage_status",
        "homepage_url",
    ):
        op.drop_column("opp_customer", column)
