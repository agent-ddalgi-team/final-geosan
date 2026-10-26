"""카드 추천 이유 한 문장과 항목별 쉬운 요약 칸 추가 (#139, 더하는 변경 2026-10-26 PM)

Revision ID: rec_002
Revises: rec_001
Create Date: 2026-10-26

- opp_opportunity.card_reason: 추천 목록 카드의 추천 이유 한 문장(사례 파일 opportunity.cardReason)
- eval_item_input.summary / eval_item_judgment.summary: 상세 화면용 쉬운 요약(사례 파일 itemInputs[].summary)
세 열 모두 비어 있어도 되며(null), 기존 행은 null로 남는다. downgrade는 세 열을 지운다(SQLite라 batch 모드).
다른 접두사 표를 고치지만 열 추가뿐이고 PM이 통합 담당으로 올린다.
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "rec_002"
down_revision = "rec_001"
branch_labels = None
depends_on = None

_COLUMNS = [
    ("opp_opportunity", "card_reason"),
    ("eval_item_input", "summary"),
    ("eval_item_judgment", "summary"),
]


def upgrade() -> None:
    for table, column in _COLUMNS:
        with op.batch_alter_table(table) as batch:
            batch.add_column(sa.Column(column, sa.Text(), nullable=True))


def downgrade() -> None:
    for table, column in reversed(_COLUMNS):
        with op.batch_alter_table(table) as batch:
            batch.drop_column(column)
