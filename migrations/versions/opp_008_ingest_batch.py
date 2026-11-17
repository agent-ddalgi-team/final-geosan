"""후보 찾기 회차·확인 필요 후보 표와 회사·공정 연결의 찾기 칸 추가 (#221·#327, 계약 C6).

기존 회사는 찾은 길 CASE_FILE, 기존 공정 연결은 사례 파일·확정으로 채운다.
"""

import sqlalchemy as sa
from alembic import op

revision = "opp_008"
down_revision = "opp_007"
branch_labels = None
depends_on = None

_CUSTOMER_COLUMN_NAMES = (
    "ingest_batch_id",
    "ingested_at",
    "discovery_source",
    "discovery_source_url",
    "registry_status",
    "fit_level",
    "pick_reason",
    "own_plating_line_suspected",
    "own_plating_line_basis",
    "own_plating_line_source",
)
_LINK_COLUMN_NAMES = ("source", "state", "confirmed_by", "evidence_ref")


def _customer_columns() -> list[sa.Column]:
    return [
        sa.Column("ingest_batch_id", sa.String(40)),
        sa.Column("ingested_at", sa.String(40)),
        sa.Column("discovery_source", sa.String(16), nullable=False, server_default="CASE_FILE"),
        sa.Column("discovery_source_url", sa.Text()),
        sa.Column("registry_status", sa.String(16)),
        sa.Column("fit_level", sa.String(8)),
        sa.Column("pick_reason", sa.Text()),
        sa.Column(
            "own_plating_line_suspected", sa.Boolean(), nullable=False, server_default=sa.text("0")
        ),
        sa.Column("own_plating_line_basis", sa.Text()),
        sa.Column("own_plating_line_source", sa.String(16)),
    ]


def _link_columns() -> list[sa.Column]:
    return [
        sa.Column("source", sa.String(16), nullable=False, server_default="CASE_FILE"),
        sa.Column("state", sa.String(16), nullable=False, server_default="CONFIRMED"),
        sa.Column("confirmed_by", sa.String(64)),
        sa.Column("evidence_ref", sa.Text()),
    ]


def _common_columns() -> list[sa.Column]:
    return [
        sa.Column("created_at", sa.String(40), nullable=False),
        sa.Column("created_by", sa.String(64), nullable=False),
        sa.Column("session_ref", sa.String(64)),
        sa.Column("dataset_kind", sa.String(32)),
        sa.Column("is_virtual", sa.Boolean(), nullable=False),
    ]


def upgrade() -> None:
    for column in _customer_columns():
        op.add_column("opp_customer", column)
    for column in _link_columns():
        op.add_column("opp_process_link", column)
    op.create_table(
        "opp_ingest_batch",
        sa.Column("batch_id", sa.String(40), primary_key=True),
        sa.Column("source_id", sa.String(80), nullable=False),
        sa.Column("requested_by", sa.String(64), nullable=False),
        sa.Column("started_at", sa.String(40), nullable=False),
        sa.Column("finished_at", sa.String(40)),
        sa.Column("status", sa.String(16), nullable=False),
        sa.Column("failure_reason", sa.Text()),
        sa.Column("criteria", sa.JSON()),
        sa.Column("max_candidates", sa.Integer()),
        sa.Column("rejudge", sa.Boolean(), nullable=False),
        sa.Column("new_count", sa.Integer(), nullable=False),
        sa.Column("merge_candidate_count", sa.Integer(), nullable=False),
        sa.Column("skipped_count", sa.Integer(), nullable=False),
        sa.Column("research_done_count", sa.Integer(), nullable=False),
        sa.Column("scanned_count", sa.Integer(), nullable=False),
        sa.Column("judged_count", sa.Integer(), nullable=False),
        sa.Column("picked_count", sa.Integer(), nullable=False),
        sa.Column("judge_pending_count", sa.Integer(), nullable=False),
        sa.Column("web_search_used", sa.Boolean(), nullable=False),
        sa.Column("web_candidate_count", sa.Integer(), nullable=False),
        sa.Column("web_dropped_count", sa.Integer(), nullable=False),
        sa.Column("web_from_cache", sa.Boolean(), nullable=False),
        sa.Column("web_skipped_reason", sa.String(16)),
        sa.Column("complex_list_skipped_reason", sa.String(16)),
        *_common_columns(),
    )
    # 실행 중인 회차는 하나만: 두 번째 [찾기]는 DB에서 막힌다(C1 409 INGEST_RUNNING).
    op.create_index(
        "uq_opp_ingest_batch_running",
        "opp_ingest_batch",
        ["status"],
        unique=True,
        sqlite_where=sa.text("status = 'RUNNING'"),
    )
    op.create_table(
        "opp_merge_candidate",
        sa.Column("merge_candidate_id", sa.String(40), primary_key=True),
        sa.Column(
            "customer_id_a",
            sa.String(40),
            sa.ForeignKey("opp_customer.customer_id"),
            nullable=False,
        ),
        sa.Column(
            "customer_id_b",
            sa.String(40),
            sa.ForeignKey("opp_customer.customer_id"),
            nullable=False,
        ),
        sa.Column("match_basis", sa.Text(), nullable=False),
        sa.Column("status", sa.String(16), nullable=False),
        sa.Column("batch_id", sa.String(40)),
        sa.Column("decided_by", sa.String(64)),
        sa.Column("decided_at", sa.String(40)),
        *_common_columns(),
    )


def downgrade() -> None:
    op.drop_table("opp_merge_candidate")
    op.drop_index("uq_opp_ingest_batch_running", table_name="opp_ingest_batch")
    op.drop_table("opp_ingest_batch")
    for name in reversed(_LINK_COLUMN_NAMES):
        op.drop_column("opp_process_link", name)
    for name in reversed(_CUSTOMER_COLUMN_NAMES):
        op.drop_column("opp_customer", name)
