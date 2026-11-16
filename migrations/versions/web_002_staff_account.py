"""담당자 계정 표와 세션의 계정 칸 (#754, 계약 C6, PM 결정 2026-11-15).

계정이 하나라도 있으면 사람마다 아이디·비밀번호로 로그인하고, 세션 행에 로그인한 계정을 적는다.
비밀번호는 원문을 저장하지 않고 scrypt 해시만 둔다. 표시 이름은 담당자가 첫 로그인 때 적는다.
"""

import sqlalchemy as sa
from alembic import op

revision = "web_002"
down_revision = "rec_015"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "web_staff_account",
        sa.Column("staff_key", sa.String(32), primary_key=True),
        sa.Column("display_name", sa.String(40), nullable=True),
        sa.Column("role", sa.String(16), nullable=False),
        sa.Column("password_hash", sa.String(200), nullable=False),
        sa.Column("setup_required", sa.Boolean(), nullable=False),
        sa.Column("disabled_at", sa.String(40), nullable=True),
        sa.Column("created_at", sa.String(40), nullable=False),
        sa.Column("created_by", sa.String(64), nullable=False),
        sa.Column("session_ref", sa.String(64), nullable=True),
        sa.Column("dataset_kind", sa.String(32), nullable=True),
        sa.Column("is_virtual", sa.Boolean(), nullable=False),
        sa.CheckConstraint("role IN ('STAFF', 'VIEWER')", name="ck_web_staff_account_role"),
    )
    with op.batch_alter_table("web_access_session") as batch:
        batch.add_column(sa.Column("staff_key", sa.String(32), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("web_access_session") as batch:
        batch.drop_column("staff_key")
    op.drop_table("web_staff_account")
