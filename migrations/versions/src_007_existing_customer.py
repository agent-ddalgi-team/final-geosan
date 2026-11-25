"""#932 PM 결정 2026-11-26: 기존 고객 참고 자료 표(확장 기능, 기본 꺼짐).

연락처·담당자·금액 열은 없다. 파일을 넣을 때마다 통째로 바꾼다(이력 없음).
"""

import sqlalchemy as sa
from alembic import op

revision = "src_007"
down_revision = "opp_012"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "src_existing_customer",
        sa.Column("existing_customer_id", sa.String(40), primary_key=True),
        sa.Column("file_date", sa.Date(), nullable=False),
        sa.Column("company_name", sa.String(200), nullable=False),
        sa.Column("normalized_name", sa.String(200), nullable=False),
        sa.Column("process_codes", sa.JSON(), nullable=False),
        sa.Column("materials", sa.JSON(), nullable=False),
        sa.Column("industries", sa.JSON(), nullable=False),
        sa.Column("region", sa.String(80), nullable=True),
        sa.Column("certifications", sa.JSON(), nullable=False),
        sa.Column("since", sa.String(7), nullable=True),
        sa.Column("loaded_at", sa.String(40), nullable=False),
        sa.Column("created_at", sa.String(40), nullable=False),
        sa.Column("created_by", sa.String(64), nullable=False),
        sa.Column("session_ref", sa.String(64), nullable=True),
        sa.Column("dataset_kind", sa.String(32), nullable=True),
        sa.Column("is_virtual", sa.Boolean(), nullable=False),
    )
    op.create_index(
        "ix_src_existing_customer_name", "src_existing_customer", ["normalized_name"]
    )


def downgrade() -> None:
    op.drop_index("ix_src_existing_customer_name", "src_existing_customer")
    op.drop_table("src_existing_customer")
