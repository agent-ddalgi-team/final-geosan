"""eval_ 테이블 생성: 평가 묶음·평가·항목 판정·요구 판정·근거 연결·8항목 입력·기한 체크 (EvaluationLedger, U1 뼈대)

Revision ID: eval_001
Revises: ev_001
Create Date: 2026-10-21

접두사 규칙(C6): 단위마다 자기 접두사 테이블만 만들고 파일 이름은 <접두사>_<번호>_<설명>.py.
모든 마이그레이션은 downgrade를 가진다(안정성 설계 6장). 시각 열은 UTC ISO 8601 문자열(String 40)이다.
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "eval_001"
down_revision = "ev_001"
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
        "eval_batch",
        sa.Column("batch_id", sa.String(length=40), nullable=False),
        sa.Column("profile", sa.String(length=16), nullable=False),
        sa.Column("scope", sa.String(length=16), nullable=False),
        sa.Column("base_date", sa.Date(), nullable=False),
        sa.Column("rule_version", sa.String(length=40), nullable=False),
        sa.Column("rule_hash", sa.String(length=64), nullable=False),
        sa.Column("code_version", sa.String(length=80), nullable=False),
        sa.Column("llm_mode", sa.String(length=16), nullable=False),
        sa.Column("model_id", sa.String(length=80), nullable=True),
        sa.Column("population_spec", sa.JSON(), nullable=False),
        sa.Column("status", sa.String(length=16), nullable=False),
        sa.Column("sort_rule", sa.String(length=60), nullable=False),
        *_common_columns(),
        sa.PrimaryKeyConstraint("batch_id"),
    )
    op.create_table(
        "eval_run",
        sa.Column("eval_id", sa.String(length=40), nullable=False),
        sa.Column("batch_id", sa.String(length=40), nullable=False),
        sa.Column("opp_id", sa.String(length=40), nullable=False),
        sa.Column("profile", sa.String(length=16), nullable=False),
        sa.Column("profile_change_reason", sa.Text(), nullable=True),
        sa.Column("run_status", sa.String(length=16), nullable=False),
        sa.Column("input_snapshot", sa.JSON(), nullable=False),
        sa.Column("snapshot_hash", sa.String(length=64), nullable=False),
        sa.Column("capability_version", sa.String(length=64), nullable=False),
        sa.Column("filter_state", sa.String(length=16), nullable=False),
        sa.Column("exclusion_scope", sa.String(length=16), nullable=True),
        sa.Column("core_evidence_met", sa.String(length=16), nullable=False),
        sa.Column("operational_ready", sa.Boolean(), nullable=False),
        sa.Column("timing_requirements", sa.JSON(), nullable=False),
        sa.Column("research_ready", sa.Boolean(), nullable=False),
        sa.Column("score_e", sa.Integer(), nullable=False),
        sa.Column("score_f", sa.Integer(), nullable=False),
        sa.Column("score_t", sa.Integer(), nullable=False),
        sa.Column("score_p", sa.Integer(), nullable=False),
        sa.Column("score_r", sa.Integer(), nullable=False),
        sa.Column("score_s", sa.Float(), nullable=True),
        sa.Column("completion_c", sa.Float(), nullable=False),
        sa.Column("classification_code", sa.String(length=24), nullable=False),
        sa.Column("core_evidence_recheck_flag", sa.Boolean(), nullable=False),
        sa.Column("direct_confirmed_weight", sa.Integer(), nullable=False),
        sa.Column("valid_until", sa.Date(), nullable=True),
        sa.Column("original_rank", sa.Integer(), nullable=True),
        sa.Column("previous_eval_id", sa.String(length=40), nullable=True),
        sa.Column("reason", sa.Text(), nullable=False),
        sa.Column("blocker_text", sa.Text(), nullable=False),
        sa.Column("blocks_approval", sa.Boolean(), nullable=False),
        sa.Column("score_display", sa.String(length=20), nullable=False),
        sa.Column("next_action", sa.Text(), nullable=False),
        *_common_columns(),
        sa.ForeignKeyConstraint(["batch_id"], ["eval_batch.batch_id"]),
        sa.ForeignKeyConstraint(["previous_eval_id"], ["eval_run.eval_id"]),
        sa.PrimaryKeyConstraint("eval_id"),
    )
    op.create_table(
        "eval_item_judgment",
        sa.Column("judgment_id", sa.String(length=40), nullable=False),
        sa.Column("eval_id", sa.String(length=40), nullable=False),
        sa.Column("item_code", sa.String(length=24), nullable=False),
        sa.Column("fact_judged", sa.Text(), nullable=True),
        sa.Column("reasoning", sa.Text(), nullable=True),
        sa.Column("weight", sa.Integer(), nullable=False),
        sa.Column("state", sa.String(length=16), nullable=False),
        sa.Column("match_rate", sa.Float(), nullable=True),
        sa.Column("certainty", sa.Float(), nullable=True),
        sa.Column("decay", sa.Float(), nullable=True),
        sa.Column("score", sa.Integer(), nullable=True),
        sa.Column("used_capability_ids", sa.JSON(), nullable=False),
        *_common_columns(),
        sa.ForeignKeyConstraint(["eval_id"], ["eval_run.eval_id"]),
        sa.PrimaryKeyConstraint("judgment_id"),
        sa.UniqueConstraint("eval_id", "item_code", name="uq_eval_item_judgment"),
    )
    op.create_table(
        "eval_requirement_check",
        sa.Column("check_id", sa.String(length=40), nullable=False),
        sa.Column("req_id", sa.String(length=40), nullable=False),
        sa.Column("eval_id", sa.String(length=40), nullable=False),
        sa.Column("result", sa.String(length=16), nullable=False),
        sa.Column("display_result", sa.String(length=24), nullable=False),
        sa.Column("stage_judged", sa.String(length=16), nullable=False),
        sa.Column("scope_judged", sa.String(length=16), nullable=False),
        sa.Column("reason", sa.Text(), nullable=False),
        sa.Column("compared_value", sa.JSON(), nullable=True),
        sa.Column("base_date", sa.Date(), nullable=False),
        sa.Column("qual_id", sa.String(length=40), nullable=True),
        sa.Column("link_id", sa.String(length=40), nullable=True),
        sa.Column("evidence_id", sa.String(length=40), nullable=True),
        sa.Column("follow_up_condition", sa.Text(), nullable=True),
        *_common_columns(),
        sa.ForeignKeyConstraint(["eval_id"], ["eval_run.eval_id"]),
        sa.PrimaryKeyConstraint("check_id"),
    )
    op.create_table(
        "eval_judgment_evidence",
        sa.Column("judgment_evidence_id", sa.String(length=40), nullable=False),
        sa.Column("judgment_id", sa.String(length=40), nullable=False),
        sa.Column("evidence_id", sa.String(length=40), nullable=False),
        sa.Column("relation_type", sa.String(length=16), nullable=False),
        sa.Column("apply_reason", sa.Text(), nullable=True),
        *_common_columns(),
        sa.ForeignKeyConstraint(["judgment_id"], ["eval_item_judgment.judgment_id"]),
        sa.PrimaryKeyConstraint("judgment_evidence_id"),
        sa.UniqueConstraint("judgment_id", "evidence_id", name="uq_eval_judgment_evidence"),
    )
    op.create_table(
        "eval_item_input",
        sa.Column("item_input_id", sa.String(length=40), nullable=False),
        sa.Column("opp_id", sa.String(length=40), nullable=False),
        sa.Column("item_code", sa.String(length=24), nullable=False),
        sa.Column("state", sa.String(length=16), nullable=False),
        sa.Column("match_rate_step", sa.String(length=60), nullable=True),
        sa.Column("match_rate", sa.Float(), nullable=True),
        sa.Column("fact_judged", sa.Text(), nullable=True),
        sa.Column("evidence_ids", sa.JSON(), nullable=False),
        sa.Column("signal_ids", sa.JSON(), nullable=False),
        sa.Column("used_capability_refs", sa.JSON(), nullable=False),
        sa.Column("proposed_by", sa.String(length=16), nullable=False),
        sa.Column("entered_by", sa.String(length=64), nullable=False),
        sa.Column("entered_at", sa.String(length=40), nullable=False),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.Column("superseded_at", sa.String(length=40), nullable=True),
        *_common_columns(),
        sa.PrimaryKeyConstraint("item_input_id"),
        sa.UniqueConstraint("opp_id", "item_code", "version", name="uq_eval_item_input_version"),
    )
    op.create_table(
        "eval_readiness_check",
        sa.Column("readiness_check_id", sa.String(length=40), nullable=False),
        sa.Column("opp_id", sa.String(length=40), nullable=False),
        sa.Column("checked", sa.Boolean(), nullable=False),
        sa.Column("staff_name", sa.String(length=32), nullable=False),
        sa.Column("checked_at", sa.String(length=40), nullable=False),
        sa.Column("eval_id_at_check", sa.String(length=40), nullable=True),
        sa.Column("reset_reason", sa.Text(), nullable=True),
        sa.Column("reset_at", sa.String(length=40), nullable=True),
        sa.Column("superseded_at", sa.String(length=40), nullable=True),
        *_common_columns(),
        sa.ForeignKeyConstraint(["eval_id_at_check"], ["eval_run.eval_id"]),
        sa.PrimaryKeyConstraint("readiness_check_id"),
    )


def downgrade() -> None:
    op.drop_table("eval_readiness_check")
    op.drop_table("eval_item_input")
    op.drop_table("eval_judgment_evidence")
    op.drop_table("eval_requirement_check")
    op.drop_table("eval_item_judgment")
    op.drop_table("eval_run")
    op.drop_table("eval_batch")
