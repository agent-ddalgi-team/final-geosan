"""후보 찾기 소스 표 추가: 공장 행, AI 판단 메모, 단지 조회·웹 검색 기록 (#221·#327, 계약 C5·C6).

대표자 이름·팩스·전화번호·사람 연락처 열은 만들지 않는다(CON-11).
"""

import sqlalchemy as sa
from alembic import op

revision = "src_001"
down_revision = "opp_008"
branch_labels = None
depends_on = None

_TABLES = (
    "src_web_candidate",
    "src_web_search_run",
    "src_complex_fetch",
    "src_candidate_judgment",
    "src_factory_row",
    "src_ingestion_run",
    "src_source_contract",
)


def _common_columns() -> list[sa.Column]:
    return [
        sa.Column("created_at", sa.String(40), nullable=False),
        sa.Column("created_by", sa.String(64), nullable=False),
        sa.Column("session_ref", sa.String(64)),
        sa.Column("dataset_kind", sa.String(32)),
        sa.Column("is_virtual", sa.Boolean(), nullable=False),
    ]


def upgrade() -> None:
    op.create_table(
        "src_source_contract",
        sa.Column("source_id", sa.String(80), primary_key=True),
        sa.Column("source_name", sa.String(200), nullable=False),
        sa.Column("allowed_use", sa.Text(), nullable=False),
        sa.Column("allowed_storage", sa.Text(), nullable=False),
        sa.Column("terms_ref", sa.Text()),
        sa.Column("confirmed_by", sa.String(64)),
        sa.Column("confirmed_at", sa.Date()),
        *_common_columns(),
    )
    op.create_table(
        "src_ingestion_run",
        sa.Column("run_id", sa.String(40), primary_key=True),
        sa.Column("batch_id", sa.String(40)),
        sa.Column("source_id", sa.String(80), nullable=False),
        sa.Column("raw_count", sa.Integer(), nullable=False),
        sa.Column("customer_count", sa.Integer(), nullable=False),
        sa.Column("opp_count", sa.Integer(), nullable=False),
        sa.Column("filter_summary", sa.JSON()),
        sa.Column("skipped_rows", sa.JSON(), nullable=False),
        sa.Column("status", sa.String(16), nullable=False),
        *_common_columns(),
    )
    op.create_index("ix_src_ingestion_run_batch_id", "src_ingestion_run", ["batch_id"])
    op.create_table(
        "src_factory_row",
        sa.Column("row_id", sa.String(40), primary_key=True),
        sa.Column("source_id", sa.String(80), nullable=False),
        sa.Column("file_date", sa.Date()),
        sa.Column("company_name", sa.String(200), nullable=False),
        sa.Column("complex_name", sa.String(200)),
        sa.Column("product", sa.Text(), nullable=False),
        sa.Column("address", sa.String(300), nullable=False),
        sa.Column("region", sa.String(40), nullable=False),
        sa.Column("product_hash", sa.String(64), nullable=False),
        sa.Column("industry_name", sa.String(200)),
        sa.Column("factory_manage_no", sa.String(40)),
        sa.Column("loaded_at", sa.String(40), nullable=False),
        sa.Column("fetched_at", sa.String(40)),
        sa.Column("missing_since", sa.Date()),
        *_common_columns(),
    )
    op.create_index("ix_src_factory_row_region", "src_factory_row", ["source_id", "region"])
    op.create_index("ix_src_factory_row_company", "src_factory_row", ["company_name"])
    op.create_table(
        "src_candidate_judgment",
        sa.Column("judgment_id", sa.String(40), primary_key=True),
        sa.Column("row_id", sa.String(40), sa.ForeignKey("src_factory_row.row_id"), nullable=False),
        sa.Column("criteria_version", sa.String(64), nullable=False),
        sa.Column("product_hash", sa.String(64), nullable=False),
        sa.Column("is_manufacturer", sa.Boolean(), nullable=False),
        sa.Column("process_codes", sa.JSON(), nullable=False),
        sa.Column("industries", sa.JSON(), nullable=False),
        sa.Column("reason", sa.Text()),
        sa.Column("fit_level", sa.String(8)),
        sa.Column("own_plating_line_suspected", sa.Boolean(), nullable=False),
        sa.Column("own_plating_line_basis", sa.Text()),
        sa.Column("judged_at", sa.String(40), nullable=False),
        sa.Column("model", sa.String(80), nullable=False),
        *_common_columns(),
    )
    op.create_index("ix_src_candidate_judgment_row_id", "src_candidate_judgment", ["row_id"])
    op.create_table(
        "src_complex_fetch",
        sa.Column("fetch_id", sa.String(40), primary_key=True),
        sa.Column("complex_name", sa.String(200), nullable=False),
        sa.Column("fetched_at", sa.String(40), nullable=False),
        sa.Column("expires_at", sa.String(40), nullable=False),
        sa.Column("row_count", sa.Integer(), nullable=False),
        sa.Column("status", sa.String(16), nullable=False),
        *_common_columns(),
    )
    op.create_index("ix_src_complex_fetch_complex_name", "src_complex_fetch", ["complex_name"])
    op.create_table(
        "src_web_search_run",
        sa.Column("run_id", sa.String(40), primary_key=True),
        sa.Column("criteria", sa.JSON(), nullable=False),
        sa.Column("criteria_hash", sa.String(64), nullable=False),
        sa.Column("searched_at", sa.String(40), nullable=False),
        sa.Column("expires_at", sa.String(40), nullable=False),
        sa.Column("result_count", sa.Integer(), nullable=False),
        sa.Column("dropped_count", sa.Integer(), nullable=False),
        sa.Column("requested_by", sa.String(64), nullable=False),
        *_common_columns(),
    )
    op.create_index("ix_src_web_search_run_criteria_hash", "src_web_search_run", ["criteria_hash"])
    op.create_table(
        "src_web_candidate",
        sa.Column("candidate_id", sa.String(40), primary_key=True),
        sa.Column(
            "run_id", sa.String(40), sa.ForeignKey("src_web_search_run.run_id"), nullable=False
        ),
        sa.Column("company_name", sa.String(200), nullable=False),
        sa.Column("address", sa.String(300)),
        sa.Column("source_url", sa.Text(), nullable=False),
        sa.Column("source_domain", sa.String(200), nullable=False),
        sa.Column("registry_status", sa.String(16), nullable=False),
        sa.Column("homepage_url", sa.Text()),
        sa.Column("dropped_reason", sa.String(40)),
        *_common_columns(),
    )
    op.create_index("ix_src_web_candidate_run_id", "src_web_candidate", ["run_id"])


def downgrade() -> None:
    for table in _TABLES:
        op.drop_table(table)
