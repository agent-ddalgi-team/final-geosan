"""cfg_ 테이블 생성: 규칙 설정 버전, 앱 설정 사본 (ConfigRegistry, U1 뼈대)

Revision ID: cfg_001
Revises:
Create Date: 2026-10-21

접두사 규칙(C6): 단위마다 자기 접두사 테이블만 만들고 파일 이름은 <접두사>_<번호>_<설명>.py.
모든 마이그레이션은 downgrade를 가진다(안정성 설계 6장). 시각 열은 UTC ISO 8601 문자열(String 40)이다.
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "cfg_001"
down_revision = None
branch_labels = None
depends_on = None


def _common_columns() -> list[sa.Column]:
    return [
        sa.Column("created_at", sa.String(length=40), nullable=False),
        sa.Column("created_by", sa.String(length=64), nullable=False),
        sa.Column("session_ref", sa.String(length=64), nullable=True),
        sa.Column("dataset_kind", sa.String(length=32), nullable=True),
        sa.Column("is_virtual", sa.Boolean(), nullable=False),
    ]


def upgrade() -> None:
    op.create_table(
        "cfg_rule_config_version",
        sa.Column("rule_version", sa.String(length=40), nullable=False),
        sa.Column("rule_hash", sa.String(length=64), nullable=False),
        sa.Column("status", sa.String(length=16), nullable=False),
        sa.Column("change_reason", sa.Text(), nullable=True),
        sa.Column("fixed_at", sa.String(length=40), nullable=True),
        sa.Column("company_approval_status", sa.String(length=24), nullable=False),
        sa.Column("file_path", sa.String(length=512), nullable=False),
        *_common_columns(),
        sa.PrimaryKeyConstraint("rule_version"),
        sa.UniqueConstraint("rule_hash"),
    )
    op.create_table(
        "cfg_app_setting",
        sa.Column("setting_key", sa.String(length=64), nullable=False),
        sa.Column("value", sa.JSON(), nullable=False),
        sa.Column("updated_at", sa.String(length=40), nullable=False),
        sa.Column("updated_by", sa.String(length=64), nullable=False),
        *_common_columns(),
        sa.PrimaryKeyConstraint("setting_key"),
    )


def downgrade() -> None:
    op.drop_table("cfg_app_setting")
    op.drop_table("cfg_rule_config_version")
