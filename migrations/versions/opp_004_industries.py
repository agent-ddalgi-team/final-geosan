"""사례 파일 산업군 보관 (#209, PM 계약 C6·C7)."""

import sqlalchemy as sa
from alembic import op

revision = "opp_004"
down_revision = "rec_005"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("opp_customer", sa.Column("industries", sa.JSON(), nullable=True))
    op.add_column("opp_customer", sa.Column("industries_source", sa.String(16), nullable=True))
    op.add_column(
        "opp_customer", sa.Column("industries_confirmed_at", sa.String(40), nullable=True)
    )


def downgrade() -> None:
    op.drop_column("opp_customer", "industries_confirmed_at")
    op.drop_column("opp_customer", "industries_source")
    op.drop_column("opp_customer", "industries")
