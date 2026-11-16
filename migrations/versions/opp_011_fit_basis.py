"""적합도 기준(생산품/홈페이지)과 처음 적합도를 저장한다(C6 #793). 기존 행은 null(생산품 기준)."""

import sqlalchemy as sa
from alembic import op

revision = "opp_011"
down_revision = "rec_016"
branch_labels = None
depends_on = None


def upgrade() -> None:
    for column in [
        sa.Column("fit_basis", sa.String(16), nullable=True),
        sa.Column("previous_fit_level", sa.String(8), nullable=True),
    ]:
        op.add_column("opp_customer", column)


def downgrade() -> None:
    for name in ["previous_fit_level", "fit_basis"]:
        op.drop_column("opp_customer", name)
