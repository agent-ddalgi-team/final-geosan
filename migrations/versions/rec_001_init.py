"""rec_ 테이블 생성: 담당자 의견 (SalesRecords 최소형, U1 뼈대)

Revision ID: rec_001
Revises: q_001
Create Date: 2026-10-21

접두사 규칙(C6): 단위마다 자기 접두사 테이블만 만들고 파일 이름은 <접두사>_<번호>_<설명>.py.
모든 마이그레이션은 downgrade를 가진다(안정성 설계 6장). 시각 열은 UTC ISO 8601 문자열(String 40)이다.
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "rec_001"
down_revision = "q_001"
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
        "rec_review_opinion",
        sa.Column("opinion_id", sa.String(length=40), nullable=False),
        sa.Column("opp_id", sa.String(length=40), nullable=False),
        sa.Column("eval_id", sa.String(length=40), nullable=False),
        sa.Column("opinion", sa.String(length=16), nullable=False),
        sa.Column("memo", sa.String(length=200), nullable=True),
        sa.Column("reason", sa.String(length=200), nullable=True),
        sa.Column("staff_name", sa.String(length=32), nullable=False),
        sa.Column("recorded_at", sa.String(length=40), nullable=False),
        sa.Column("previous_opinion_id", sa.String(length=40), nullable=True),
        sa.Column("version", sa.Integer(), nullable=False),
        *_common_columns(),
        sa.ForeignKeyConstraint(["previous_opinion_id"], ["rec_review_opinion.opinion_id"]),
        sa.PrimaryKeyConstraint("opinion_id"),
    )


def downgrade() -> None:
    op.drop_table("rec_review_opinion")
