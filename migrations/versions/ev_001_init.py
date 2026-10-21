"""ev_ 테이블 생성: 근거 자료 (EvidenceExtraction 최소형, U1 뼈대)

Revision ID: ev_001
Revises: opp_001
Create Date: 2026-10-21

접두사 규칙(C6): 단위마다 자기 접두사 테이블만 만들고 파일 이름은 <접두사>_<번호>_<설명>.py.
모든 마이그레이션은 downgrade를 가진다(안정성 설계 6장). 시각 열은 UTC ISO 8601 문자열(String 40)이다.
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "ev_001"
down_revision = "opp_001"
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
        "ev_evidence",
        sa.Column("evidence_id", sa.String(length=40), nullable=False),
        sa.Column("opp_id", sa.String(length=40), nullable=False),
        sa.Column("source_grade", sa.String(length=4), nullable=False),
        sa.Column("source_ref", sa.String(length=500), nullable=False),
        sa.Column("source_version", sa.String(length=120), nullable=True),
        sa.Column("origin_key", sa.String(length=200), nullable=True),
        sa.Column("quote", sa.Text(), nullable=False),
        sa.Column("subject", sa.String(length=16), nullable=False),
        sa.Column("occurred_at", sa.Date(), nullable=True),
        sa.Column("confirmed_at", sa.Date(), nullable=True),
        sa.Column("security_grade", sa.String(length=24), nullable=False),
        sa.Column("external_ai_allowed", sa.Boolean(), nullable=False),
        sa.Column("presentation_allowed", sa.Boolean(), nullable=False),
        sa.Column("extraction_method", sa.String(length=16), nullable=False),
        sa.Column("extracted_by", sa.String(length=64), nullable=False),
        sa.Column("extracted_at", sa.String(length=40), nullable=False),
        sa.Column("certainty_proposed", sa.String(length=16), nullable=True),
        sa.Column("certainty_confirmed", sa.String(length=16), nullable=True),
        sa.Column("is_llm_proposed", sa.Boolean(), nullable=False),
        sa.Column("superseded_at", sa.String(length=40), nullable=True),
        *_common_columns(),
        sa.PrimaryKeyConstraint("evidence_id"),
    )


def downgrade() -> None:
    op.drop_table("ev_evidence")
