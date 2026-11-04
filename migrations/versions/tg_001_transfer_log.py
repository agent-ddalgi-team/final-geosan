"""OpenAI 검색 호출·거부·사용량 기록 (C4·C6, #218)."""

import sqlalchemy as sa
from alembic import op

revision = "tg_001"
down_revision = "opp_006"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "tg_transfer_log",
        sa.Column("transfer_log_id", sa.String(40), primary_key=True),
        sa.Column("occurred_at", sa.String(40), nullable=False),
        sa.Column("opp_id", sa.String(40), nullable=False),
        sa.Column("purpose", sa.String(24), nullable=False),
        sa.Column("kind", sa.String(24), nullable=False),
        sa.Column("mode", sa.String(16), nullable=False),
        sa.Column("model", sa.String(80)),
        sa.Column("security_grade", sa.String(24), nullable=False),
        sa.Column("decision", sa.String(16), nullable=False),
        sa.Column("reject_reason", sa.String(300)),
        sa.Column("requested_by", sa.String(64), nullable=False),
        sa.Column("call_count", sa.Integer(), nullable=False),
        sa.Column("input_tokens", sa.Integer()),
        sa.Column("output_tokens", sa.Integer()),
        sa.Column("web_search_calls", sa.Integer()),
        sa.Column("cost_usd", sa.Numeric(20, 10)),
        sa.Column("created_at", sa.String(40), nullable=False),
        sa.Column("created_by", sa.String(64), nullable=False),
        sa.Column("session_ref", sa.String(64)),
        sa.Column("dataset_kind", sa.String(32)),
        sa.Column("is_virtual", sa.Boolean(), nullable=False),
    )
    op.create_index("ix_tg_transfer_log_occurred_at", "tg_transfer_log", ["occurred_at"])


def downgrade() -> None:
    op.drop_table("tg_transfer_log")
