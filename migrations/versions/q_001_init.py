"""q_ 테이블 생성: 확인 질문·질문-기회 연결·조사 요건 (ConfirmationDesk 최소형, U1 뼈대)

Revision ID: q_001
Revises: eval_001
Create Date: 2026-10-21

접두사 규칙(C6): 단위마다 자기 접두사 테이블만 만들고 파일 이름은 <접두사>_<번호>_<설명>.py.
모든 마이그레이션은 downgrade를 가진다(안정성 설계 6장). 시각 열은 UTC ISO 8601 문자열(String 40)이다.
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "q_001"
down_revision = "eval_001"
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
        "q_question",
        sa.Column("question_id", sa.String(length=40), nullable=False),
        sa.Column("target_kind", sa.String(length=16), nullable=False),
        sa.Column("target_id", sa.String(length=40), nullable=False),
        sa.Column("question_text", sa.Text(), nullable=False),
        sa.Column("current_value", sa.String(length=200), nullable=True),
        sa.Column("answer_format", sa.String(length=16), nullable=False),
        sa.Column("status", sa.String(length=16), nullable=False),
        sa.Column("source_eval_id", sa.String(length=40), nullable=True),
        sa.Column("is_user_added", sa.Boolean(), nullable=False),
        *_common_columns(),
        sa.PrimaryKeyConstraint("question_id"),
        sa.UniqueConstraint("target_kind", "target_id", name="uq_q_question_target"),
    )
    op.create_table(
        "q_question_opportunity_link",
        sa.Column("question_link_id", sa.String(length=40), nullable=False),
        sa.Column("question_id", sa.String(length=40), nullable=False),
        sa.Column("opp_id", sa.String(length=40), nullable=False),
        sa.Column("effect_if_answered", sa.Text(), nullable=False),
        sa.Column("linked_at", sa.String(length=40), nullable=False),
        *_common_columns(),
        sa.ForeignKeyConstraint(["question_id"], ["q_question.question_id"]),
        sa.PrimaryKeyConstraint("question_link_id"),
        sa.UniqueConstraint("question_id", "opp_id", name="uq_q_question_opp"),
    )
    op.create_table(
        "q_research_task",
        sa.Column("task_id", sa.String(length=40), nullable=False),
        sa.Column("opp_id", sa.String(length=40), nullable=False),
        sa.Column("eval_id", sa.String(length=40), nullable=True),
        sa.Column("question_set", sa.JSON(), nullable=True),
        sa.Column("allowed_channel", sa.String(length=120), nullable=True),
        sa.Column("owner", sa.String(length=32), nullable=True),
        sa.Column("can_change_class", sa.Boolean(), nullable=True),
        sa.Column("estimated_hours", sa.Float(), nullable=True),
        sa.Column("max_hours", sa.Float(), nullable=True),
        sa.Column("status", sa.String(length=16), nullable=False),
        sa.Column("recheck_at", sa.Date(), nullable=True),
        sa.Column("superseded_at", sa.String(length=40), nullable=True),
        *_common_columns(),
        sa.PrimaryKeyConstraint("task_id"),
    )


def downgrade() -> None:
    op.drop_table("q_research_task")
    op.drop_table("q_question_opportunity_link")
    op.drop_table("q_question")
