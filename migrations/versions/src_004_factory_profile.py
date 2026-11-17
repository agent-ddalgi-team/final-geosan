"""#573 PM 승인: 팩토리온 공장조회·수질 명단 보조 자료와 회사의 공장 정보 4열."""

import sqlalchemy as sa
from alembic import op

revision = "src_004"
down_revision = "rec_011"
branch_labels = None
depends_on = None


def _common() -> list[sa.Column]:
    return [
        sa.Column("created_at", sa.String(40), nullable=False),
        sa.Column("created_by", sa.String(64), nullable=False),
        sa.Column("session_ref", sa.String(64), nullable=True),
        sa.Column("dataset_kind", sa.String(32), nullable=True),
        sa.Column("is_virtual", sa.Boolean(), nullable=False),
    ]


def _customer_columns() -> list[sa.Column]:
    return [
        sa.Column("factory_raw_materials", sa.Text(), nullable=True),
        sa.Column("factory_employee_count", sa.Integer(), nullable=True),
        sa.Column("factory_scale", sa.String(40), nullable=True),
        sa.Column("factory_profile_date", sa.Date(), nullable=True),
    ]


def upgrade() -> None:
    op.create_table(
        "src_factory_profile",
        sa.Column("profile_id", sa.String(40), primary_key=True),
        sa.Column("source_id", sa.String(80), nullable=False),
        sa.Column("file_date", sa.Date(), nullable=False),
        sa.Column("company_name", sa.String(200), nullable=False),
        sa.Column("normalized_name", sa.String(200), nullable=False),
        sa.Column("address", sa.String(300), nullable=False),
        sa.Column("normalized_address", sa.String(300), nullable=False),
        sa.Column("region", sa.String(40), nullable=False),
        sa.Column("raw_materials", sa.Text(), nullable=True),
        sa.Column("employee_count", sa.Integer(), nullable=True),
        sa.Column("industry_codes", sa.JSON(), nullable=False),
        sa.Column("industry_name", sa.String(200), nullable=True),
        sa.Column("scale", sa.String(40), nullable=True),
        sa.Column("loaded_at", sa.String(40), nullable=False),
        *_common(),
    )
    op.create_index("ix_src_factory_profile_name", "src_factory_profile", ["normalized_name"])
    op.create_table(
        "src_water_site",
        sa.Column("site_id", sa.String(40), primary_key=True),
        sa.Column("source_id", sa.String(80), nullable=False),
        sa.Column("file_date", sa.Date(), nullable=False),
        sa.Column("site_name", sa.String(200), nullable=False),
        sa.Column("normalized_name", sa.String(200), nullable=False),
        sa.Column("address", sa.String(300), nullable=False),
        sa.Column("normalized_address", sa.String(300), nullable=False),
        sa.Column("region", sa.String(40), nullable=False),
        sa.Column("agency", sa.String(200), nullable=True),
        sa.Column("treatment_types", sa.JSON(), nullable=False),
        sa.Column("loaded_at", sa.String(40), nullable=False),
        *_common(),
    )
    op.create_index("ix_src_water_site_name", "src_water_site", ["normalized_name"])
    # 표를 다시 만들지 않고 열만 더한다(다른 표가 회사를 가리키고 있어 다시 만들면 연결이 깨짐).
    for column in _customer_columns():
        op.add_column("opp_customer", column)


def downgrade() -> None:
    for column in reversed(_customer_columns()):
        op.drop_column("opp_customer", column.name)
    op.drop_index("ix_src_water_site_name", "src_water_site")
    op.drop_table("src_water_site")
    op.drop_index("ix_src_factory_profile_name", "src_factory_profile")
    op.drop_table("src_factory_profile")
