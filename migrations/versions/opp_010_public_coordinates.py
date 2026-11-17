"""공공자료로 확인한 회사 좌표를 저장한다(C6 #222). 네이버 결과는 저장하지 않는다."""

import sqlalchemy as sa
from alembic import op

revision = "opp_010"
down_revision = "opp_009"
branch_labels = None
depends_on = None


def upgrade() -> None:
    for column in [
        sa.Column("lat", sa.Float(), nullable=True),
        sa.Column("lng", sa.Float(), nullable=True),
        sa.Column("geocoded_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("geocode_source", sa.String(16), nullable=True),
    ]:
        op.add_column("opp_customer", column)


def downgrade() -> None:
    for name in ["geocode_source", "geocoded_at", "lng", "lat"]:
        op.drop_column("opp_customer", name)
