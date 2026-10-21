"""cap_ 테이블 생성: 공정·역량 항목·실적·자격·범위·상태 이력·검수 기록 (CapabilityCatalog, U1 뼈대)

Revision ID: cap_001
Revises: cfg_001
Create Date: 2026-10-21

접두사 규칙(C6): 단위마다 자기 접두사 테이블만 만들고 파일 이름은 <접두사>_<번호>_<설명>.py.
모든 마이그레이션은 downgrade를 가진다(안정성 설계 6장). 시각 열은 UTC ISO 8601 문자열(String 40)이다.
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "cap_001"
down_revision = "cfg_001"
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
        "cap_process",
        sa.Column("process_id", sa.String(length=40), nullable=False),
        sa.Column("code", sa.String(length=32), nullable=False),
        sa.Column("name", sa.String(length=120), nullable=False),
        sa.Column("category", sa.String(length=60), nullable=True),
        sa.Column("material_codes", sa.JSON(), nullable=False),
        sa.Column("performance_tags", sa.JSON(), nullable=False),
        sa.Column("registry_status", sa.String(length=24), nullable=False),
        sa.Column("review_status", sa.String(length=16), nullable=False),
        sa.Column("assumption_note", sa.Text(), nullable=True),
        *_common_columns(),
        sa.PrimaryKeyConstraint("process_id"),
        sa.UniqueConstraint("dataset_kind", "code", name="uq_cap_process_dataset_code"),
    )
    op.create_table(
        "cap_process_capability",
        sa.Column("capability_id", sa.String(length=40), nullable=False),
        sa.Column("process_id", sa.String(length=40), nullable=False),
        sa.Column("cap_kind", sa.String(length=16), nullable=False),
        sa.Column("name", sa.String(length=120), nullable=False),
        sa.Column("display_value", sa.String(length=200), nullable=True),
        sa.Column("numeric_min", sa.Float(), nullable=True),
        sa.Column("numeric_max", sa.Float(), nullable=True),
        sa.Column("unit", sa.String(length=20), nullable=True),
        sa.Column("standard_ref", sa.String(length=120), nullable=True),
        sa.Column("scope_note", sa.Text(), nullable=True),
        sa.Column("is_descriptive_only", sa.Boolean(), nullable=False),
        sa.Column("review_status", sa.String(length=16), nullable=False),
        *_common_columns(),
        sa.ForeignKeyConstraint(["process_id"], ["cap_process.process_id"]),
        sa.PrimaryKeyConstraint("capability_id"),
        sa.UniqueConstraint("process_id", "cap_kind", "name", name="uq_cap_capability_key"),
    )
    op.create_table(
        "cap_delivery_record",
        sa.Column("record_id", sa.String(length=40), nullable=False),
        sa.Column("process_id", sa.String(length=40), nullable=False),
        sa.Column("industry", sa.String(length=120), nullable=False),
        sa.Column("part_type", sa.String(length=120), nullable=True),
        sa.Column("period", sa.String(length=60), nullable=True),
        sa.Column("allowed_basis", sa.Text(), nullable=True),
        sa.Column("review_status", sa.String(length=16), nullable=False),
        *_common_columns(),
        sa.ForeignKeyConstraint(["process_id"], ["cap_process.process_id"]),
        sa.PrimaryKeyConstraint("record_id"),
    )
    op.create_table(
        "cap_qualification",
        sa.Column("qual_id", sa.String(length=40), nullable=False),
        sa.Column("kind", sa.String(length=16), nullable=False),
        sa.Column("official_name", sa.String(length=120), nullable=False),
        sa.Column("number", sa.String(length=80), nullable=True),
        sa.Column("edition", sa.String(length=40), nullable=True),
        sa.Column("holder", sa.String(length=120), nullable=False),
        sa.Column("site", sa.String(length=120), nullable=True),
        sa.Column("valid_from", sa.Date(), nullable=True),
        sa.Column("valid_to", sa.Date(), nullable=True),
        sa.Column("source_version", sa.String(length=120), nullable=True),
        sa.Column("review_status", sa.String(length=16), nullable=False),
        *_common_columns(),
        sa.PrimaryKeyConstraint("qual_id"),
        sa.UniqueConstraint(
            "dataset_kind", "official_name", "number", name="uq_cap_qualification_key"
        ),
    )
    op.create_table(
        "cap_qualification_scope",
        sa.Column("scope_id", sa.String(length=40), nullable=False),
        sa.Column("qual_id", sa.String(length=40), nullable=False),
        sa.Column("scope_kind", sa.String(length=16), nullable=False),
        sa.Column("process_id", sa.String(length=40), nullable=True),
        sa.Column("customer_id", sa.String(length=40), nullable=True),
        sa.Column("opp_id", sa.String(length=40), nullable=True),
        sa.Column("product_scope", sa.String(length=200), nullable=True),
        sa.Column("applicability", sa.String(length=16), nullable=False),
        sa.Column("basis", sa.Text(), nullable=True),
        sa.Column("review_status", sa.String(length=16), nullable=False),
        *_common_columns(),
        sa.ForeignKeyConstraint(["process_id"], ["cap_process.process_id"]),
        sa.ForeignKeyConstraint(["qual_id"], ["cap_qualification.qual_id"]),
        sa.PrimaryKeyConstraint("scope_id"),
    )
    op.create_table(
        "cap_qualification_status",
        sa.Column("status_id", sa.String(length=40), nullable=False),
        sa.Column("qual_id", sa.String(length=40), nullable=False),
        sa.Column("status", sa.String(length=16), nullable=False),
        sa.Column("occurred_at", sa.Date(), nullable=True),
        sa.Column("confirmed_at", sa.Date(), nullable=True),
        sa.Column("confirmed_by", sa.String(length=80), nullable=True),
        sa.Column("reason", sa.Text(), nullable=True),
        sa.Column("evidence_id", sa.String(length=40), nullable=True),
        *_common_columns(),
        sa.ForeignKeyConstraint(["qual_id"], ["cap_qualification.qual_id"]),
        sa.PrimaryKeyConstraint("status_id"),
    )
    op.create_table(
        "cap_field_evidence",
        sa.Column("field_evidence_id", sa.String(length=40), nullable=False),
        sa.Column("target_table", sa.String(length=40), nullable=False),
        sa.Column("target_id", sa.String(length=40), nullable=False),
        sa.Column("target_field", sa.String(length=40), nullable=False),
        sa.Column("value_snapshot", sa.JSON(), nullable=False),
        sa.Column("data_version", sa.Integer(), nullable=False),
        sa.Column("review_status", sa.String(length=16), nullable=False),
        sa.Column("reviewer", sa.String(length=80), nullable=True),
        sa.Column("reviewed_at", sa.Date(), nullable=True),
        sa.Column("basis", sa.Text(), nullable=True),
        sa.Column("evidence_id", sa.String(length=40), nullable=True),
        *_common_columns(),
        sa.PrimaryKeyConstraint("field_evidence_id"),
        sa.UniqueConstraint(
            "target_table",
            "target_id",
            "target_field",
            "data_version",
            name="uq_cap_field_evidence_version",
        ),
    )


def downgrade() -> None:
    op.drop_table("cap_field_evidence")
    op.drop_table("cap_qualification_status")
    op.drop_table("cap_qualification_scope")
    op.drop_table("cap_qualification")
    op.drop_table("cap_delivery_record")
    op.drop_table("cap_process_capability")
    op.drop_table("cap_process")
