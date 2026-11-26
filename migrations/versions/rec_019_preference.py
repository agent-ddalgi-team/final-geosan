"""담당자 선호 승인 표(#943, 계약 C6, PM 결정 2026-11-26 되먹임 ③).

관리자가 승인한 선호(공정 × 산업군 또는 거리)를 남긴다. 승인·끄기마다 행을 지우지 않는다.
"""

import sqlalchemy as sa
from alembic import op

revision = "rec_019"
down_revision = "src_007"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "rec_preference",
        sa.Column("pref_id", sa.String(40), primary_key=True),
        sa.Column("kind", sa.String(24), nullable=False),
        sa.Column("process_code", sa.String(32), nullable=True),
        sa.Column("industry", sa.String(80), nullable=True),
        sa.Column("distance_km", sa.Numeric(10, 3), nullable=True),
        sa.Column("approved_by", sa.String(64), nullable=False),
        sa.Column("approved_at", sa.String(40), nullable=False),
        sa.Column("expires_at", sa.String(40), nullable=False),
        sa.Column("basis", sa.JSON(), nullable=False),
        sa.Column("revoked_at", sa.String(40), nullable=True),
        sa.Column("revoked_by", sa.String(64), nullable=True),
        sa.Column("created_at", sa.String(40), nullable=False),
        sa.Column("created_by", sa.String(64), nullable=False),
        sa.Column("session_ref", sa.String(64), nullable=True),
        sa.Column("dataset_kind", sa.String(32), nullable=True),
        sa.Column("is_virtual", sa.Boolean(), nullable=False),
    )
    op.create_index("ix_rec_preference_dataset", "rec_preference", ["dataset_kind"])


def downgrade() -> None:
    op.drop_index("ix_rec_preference_dataset", table_name="rec_preference")
    op.drop_table("rec_preference")
