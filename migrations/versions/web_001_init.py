"""접속 세션과 공용 비밀번호 실패 상태 저장 (#213 PM 승인 2026-11-03)."""

import sqlalchemy as sa
from alembic import op

revision = "web_001"
down_revision = "rec_002"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "web_access_session",
        sa.Column("session_id", sa.String(64), primary_key=True),
        sa.Column("expires_at", sa.String(40), nullable=False),
        sa.Column("last_seen_at", sa.String(40), nullable=False),
        sa.Column("failure_count", sa.Integer(), nullable=False),
        sa.Column("blocked_until", sa.String(40), nullable=True),
        sa.Column("created_at", sa.String(40), nullable=False),
        sa.Column("created_by", sa.String(64), nullable=False),
        sa.Column("session_ref", sa.String(64), nullable=True),
        sa.Column("dataset_kind", sa.String(32), nullable=True),
        sa.Column("is_virtual", sa.Boolean(), nullable=False),
    )


def downgrade() -> None:
    op.drop_table("web_access_session")
