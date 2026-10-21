"""opp_ 테이블 생성: 고객·기회·접촉 이력·발견 경로·공정 연결·요구·신호 (OpportunityRegistry, U1 뼈대)

Revision ID: opp_001
Revises: cap_001
Create Date: 2026-10-21

접두사 규칙(C6): 단위마다 자기 접두사 테이블만 만들고 파일 이름은 <접두사>_<번호>_<설명>.py.
모든 마이그레이션은 downgrade를 가진다(안정성 설계 6장). 시각 열은 UTC ISO 8601 문자열(String 40)이다.
고객 테이블에는 연락처 열이 없다(CON-11). 자식 행은 superseded_at으로 교체한다(BR1.7).
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "opp_001"
down_revision = "cap_001"
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


def _superseded() -> sa.Column:
    return sa.Column("superseded_at", sa.String(length=40), nullable=True)


def upgrade() -> None:
    op.create_table(
        "opp_customer",
        sa.Column("customer_id", sa.String(length=40), nullable=False),
        sa.Column("name", sa.String(length=200), nullable=False),
        sa.Column("normalized_name", sa.String(length=200), nullable=False),
        sa.Column("biz_number", sa.String(length=10), nullable=True),
        sa.Column("normalized_address", sa.String(length=300), nullable=True),
        sa.Column("identity_basis", sa.Text(), nullable=True),
        sa.Column("relation_status", sa.String(length=24), nullable=False),
        sa.Column("relation_confirmed_at", sa.Date(), nullable=True),
        sa.Column("company_filter_status", sa.String(length=16), nullable=False),
        sa.Column("company_filter_reason", sa.Text(), nullable=True),
        sa.Column("security_grade", sa.String(length=24), nullable=False),
        *_common_columns(),
        sa.PrimaryKeyConstraint("customer_id"),
        sa.UniqueConstraint("biz_number"),
    )
    op.create_table(
        "opp_opportunity",
        sa.Column("opp_id", sa.String(length=40), nullable=False),
        sa.Column("customer_id", sa.String(length=40), nullable=False),
        sa.Column("case_id", sa.String(length=80), nullable=True),
        sa.Column("base_date", sa.Date(), nullable=True),
        sa.Column("item", sa.String(length=200), nullable=False),
        sa.Column("project", sa.String(length=300), nullable=True),
        sa.Column("distinction_basis", sa.Text(), nullable=True),
        sa.Column("purpose", sa.String(length=24), nullable=False),
        sa.Column("owner", sa.String(length=32), nullable=True),
        sa.Column("progress_status", sa.String(length=32), nullable=True),
        sa.Column("review_condition", sa.Text(), nullable=True),
        sa.Column("review_owner", sa.String(length=32), nullable=True),
        sa.Column("review_due_at", sa.Date(), nullable=True),
        sa.Column("merge_history", sa.JSON(), nullable=True),
        *_common_columns(),
        sa.ForeignKeyConstraint(["customer_id"], ["opp_customer.customer_id"]),
        sa.PrimaryKeyConstraint("opp_id"),
        sa.UniqueConstraint("case_id"),
    )
    op.create_table(
        "opp_interaction",
        sa.Column("interaction_id", sa.String(length=40), nullable=False),
        sa.Column("customer_id", sa.String(length=40), nullable=False),
        sa.Column("opp_id", sa.String(length=40), nullable=True),
        sa.Column("kind", sa.String(length=16), nullable=False),
        sa.Column("occurred_at", sa.Date(), nullable=True),
        sa.Column("allowed_summary", sa.Text(), nullable=True),
        sa.Column("apply_scope", sa.String(length=120), nullable=True),
        sa.Column("certainty", sa.String(length=16), nullable=False),
        sa.Column("confirmed_at", sa.Date(), nullable=True),
        sa.Column("entered_by", sa.String(length=64), nullable=False),
        sa.Column("security_grade", sa.String(length=24), nullable=False),
        sa.Column("external_ai_allowed", sa.Boolean(), nullable=False),
        sa.Column("past_process_item", sa.String(length=200), nullable=True),
        sa.Column("order_count", sa.Integer(), nullable=True),
        sa.Column("sample_approved", sa.Boolean(), nullable=True),
        sa.Column("requirement_met", sa.String(length=60), nullable=True),
        sa.Column("loss_reason", sa.Text(), nullable=True),
        sa.Column("loss_resolved", sa.Boolean(), nullable=True),
        sa.Column("last_delivery_at", sa.Date(), nullable=True),
        sa.Column("order_cycle", sa.String(length=60), nullable=True),
        _superseded(),
        *_common_columns(),
        sa.ForeignKeyConstraint(["customer_id"], ["opp_customer.customer_id"]),
        sa.ForeignKeyConstraint(["opp_id"], ["opp_opportunity.opp_id"]),
        sa.PrimaryKeyConstraint("interaction_id"),
    )
    op.create_table(
        "opp_discovery_path",
        sa.Column("path_id", sa.String(length=40), nullable=False),
        sa.Column("opp_id", sa.String(length=40), nullable=False),
        sa.Column("path_kind", sa.String(length=24), nullable=False),
        sa.Column("source_id", sa.String(length=80), nullable=True),
        sa.Column("origin_key", sa.String(length=200), nullable=True),
        sa.Column("discovered_at", sa.Date(), nullable=True),
        sa.Column("evidence_id", sa.String(length=40), nullable=True),
        _superseded(),
        *_common_columns(),
        sa.ForeignKeyConstraint(["opp_id"], ["opp_opportunity.opp_id"]),
        sa.PrimaryKeyConstraint("path_id"),
    )
    op.create_table(
        "opp_process_link",
        sa.Column("link_id", sa.String(length=40), nullable=False),
        sa.Column("opp_id", sa.String(length=40), nullable=False),
        sa.Column("process_code", sa.String(length=32), nullable=False),
        sa.Column("applied_material", sa.String(length=40), nullable=True),
        sa.Column("current_result", sa.String(length=16), nullable=True),
        sa.Column("current_reason", sa.Text(), nullable=True),
        sa.Column("confirmed_at", sa.String(length=40), nullable=True),
        sa.Column("source_eval_id", sa.String(length=40), nullable=True),
        _superseded(),
        *_common_columns(),
        sa.ForeignKeyConstraint(["opp_id"], ["opp_opportunity.opp_id"]),
        sa.PrimaryKeyConstraint("link_id"),
    )
    op.create_table(
        "opp_requirement",
        sa.Column("req_id", sa.String(length=40), nullable=False),
        sa.Column("opp_id", sa.String(length=40), nullable=False),
        sa.Column("link_id", sa.String(length=40), nullable=True),
        sa.Column("req_kind", sa.String(length=24), nullable=False),
        sa.Column("name", sa.String(length=200), nullable=False),
        sa.Column("content", sa.Text(), nullable=True),
        sa.Column("req_level", sa.String(length=16), nullable=False),
        sa.Column("scope_kind", sa.String(length=16), nullable=False),
        sa.Column("required_value", sa.Float(), nullable=True),
        sa.Column("unit", sa.String(length=20), nullable=True),
        sa.Column("edition", sa.String(length=40), nullable=True),
        sa.Column("holder", sa.String(length=120), nullable=True),
        sa.Column("site", sa.String(length=120), nullable=True),
        sa.Column("certainty", sa.String(length=16), nullable=False),
        sa.Column("needed_stage", sa.String(length=16), nullable=False),
        sa.Column("due_at", sa.Date(), nullable=True),
        sa.Column("question", sa.Text(), nullable=True),
        sa.Column("basis", sa.Text(), nullable=True),
        sa.Column("evidence_id", sa.String(length=40), nullable=True),
        sa.Column("proposed_by", sa.String(length=16), nullable=False),
        sa.Column("staff_confirmed_state", sa.String(length=60), nullable=True),
        _superseded(),
        *_common_columns(),
        sa.ForeignKeyConstraint(["link_id"], ["opp_process_link.link_id"]),
        sa.ForeignKeyConstraint(["opp_id"], ["opp_opportunity.opp_id"]),
        sa.PrimaryKeyConstraint("req_id"),
    )
    op.create_table(
        "opp_signal",
        sa.Column("signal_id", sa.String(length=40), nullable=False),
        sa.Column("opp_id", sa.String(length=40), nullable=False),
        sa.Column("signal_kind", sa.String(length=24), nullable=False),
        sa.Column("occurred_at", sa.Date(), nullable=True),
        sa.Column("announced_at", sa.Date(), nullable=True),
        sa.Column("scheduled_at", sa.Date(), nullable=True),
        sa.Column("confirmed_at", sa.Date(), nullable=True),
        sa.Column("deadline_at", sa.Date(), nullable=True),
        sa.Column("timezone", sa.String(length=40), nullable=False),
        sa.Column("progress_status", sa.String(length=16), nullable=True),
        sa.Column("next_check_at", sa.Date(), nullable=True),
        sa.Column("agreed_window", sa.JSON(), nullable=True),
        sa.Column("certainty", sa.String(length=16), nullable=False),
        sa.Column("relation", sa.String(length=16), nullable=False),
        sa.Column("entered_by", sa.String(length=64), nullable=False),
        sa.Column("evidence_id", sa.String(length=40), nullable=True),
        _superseded(),
        *_common_columns(),
        sa.ForeignKeyConstraint(["opp_id"], ["opp_opportunity.opp_id"]),
        sa.PrimaryKeyConstraint("signal_id"),
    )


def downgrade() -> None:
    op.drop_table("opp_signal")
    op.drop_table("opp_requirement")
    op.drop_table("opp_process_link")
    op.drop_table("opp_discovery_path")
    op.drop_table("opp_interaction")
    op.drop_table("opp_opportunity")
    op.drop_table("opp_customer")
