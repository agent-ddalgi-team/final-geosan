"""담당자 거래 관계 입력과 변경 이력 추가(C6, PM 승인 #265)."""

import sqlalchemy as sa
from alembic import op

revision = "opp_007"
down_revision = "tg_002"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("opp_customer", sa.Column("relation_confirmed_by", sa.String(64)))
    op.create_table(
        "opp_relation_history",
        sa.Column("relation_history_id", sa.String(40), primary_key=True),
        sa.Column(
            "customer_id", sa.String(40), sa.ForeignKey("opp_customer.customer_id"), nullable=False
        ),
        sa.Column("opp_id", sa.String(40), sa.ForeignKey("opp_opportunity.opp_id"), nullable=False),
        sa.Column("from_status", sa.String(24), nullable=False),
        sa.Column("to_status", sa.String(24), nullable=False),
        sa.Column("staff_key", sa.String(64), nullable=False),
        sa.Column("changed_at", sa.String(40), nullable=False),
        sa.Column("created_at", sa.String(40), nullable=False),
        sa.Column("created_by", sa.String(64), nullable=False),
        sa.Column("session_ref", sa.String(64)),
        sa.Column("dataset_kind", sa.String(32)),
        sa.Column("is_virtual", sa.Boolean(), nullable=False),
    )


def downgrade() -> None:
    op.drop_table("opp_relation_history")
    op.drop_column("opp_customer", "relation_confirmed_by")
