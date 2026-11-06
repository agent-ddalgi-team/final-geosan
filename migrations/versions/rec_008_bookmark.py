"""관심(찜) 표 추가와 자료 옮기기 (#356, 계약 C0·C6, PM 결정 2026-11-06).

관심은 영업 단계가 아니라 따로 켜고 끄는 표시가 됐다. 그래서
① rec_bookmark 표를 만들고
② 메모·영업 기록·검토 의견이 하나라도 있던 기회를 관심으로 켜 두고(source MIGRATED)
③ 영업 단계 INTERESTED(관심) 행을 NOT_EXECUTED(미접촉)로 바꾼다.
"""

from datetime import UTC, datetime

import sqlalchemy as sa
from alembic import op

from geosan.storage.base import new_id

revision = "rec_008"
down_revision = "tg_003"
branch_labels = None
depends_on = None

_INDEX_NAME = "ix_rec_bookmark_opp_id"
_RECORD_TABLES = ("rec_note", "rec_outcome", "rec_review_opinion")


def upgrade() -> None:
    op.create_table(
        "rec_bookmark",
        sa.Column("bookmark_id", sa.String(40), primary_key=True),
        sa.Column("opp_id", sa.String(40), sa.ForeignKey("opp_opportunity.opp_id"), nullable=False),
        sa.Column("active", sa.Boolean(), nullable=False),
        sa.Column("staff_key", sa.String(64), nullable=False),
        sa.Column("source", sa.String(16), nullable=False),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.String(40), nullable=False),
        sa.Column("created_by", sa.String(64), nullable=False),
        sa.Column("session_ref", sa.String(64), nullable=True),
        sa.Column("dataset_kind", sa.String(32), nullable=True),
        sa.Column("is_virtual", sa.Boolean(), nullable=False),
    )
    op.create_index(_INDEX_NAME, "rec_bookmark", ["opp_id"])

    bind = op.get_bind()
    recorded = " UNION ".join(f"SELECT opp_id FROM {table}" for table in _RECORD_TABLES)
    opportunities = bind.execute(
        sa.text(
            "SELECT opp_id, dataset_kind, is_virtual FROM opp_opportunity "
            f"WHERE opp_id IN ({recorded}) ORDER BY opp_id"
        )
    ).all()
    # 다른 표의 created_at과 같은 글자 모양(UTC ISO, 마이크로초까지).
    now = datetime.now(UTC).isoformat(timespec="microseconds")
    insert = sa.text(
        "INSERT INTO rec_bookmark (bookmark_id, opp_id, active, staff_key, source, version, "
        "created_at, created_by, dataset_kind, is_virtual) VALUES (:bookmark_id, :opp_id, 1, "
        "'system', 'MIGRATED', 1, :created_at, 'system', :dataset_kind, :is_virtual)"
    )
    for opp_id, dataset_kind, is_virtual in opportunities:
        bind.execute(
            insert,
            {
                "bookmark_id": new_id("bookmark"),
                "opp_id": opp_id,
                "created_at": now,
                "dataset_kind": dataset_kind,
                "is_virtual": is_virtual,
            },
        )
    bind.execute(
        sa.text("UPDATE rec_outcome SET status = 'NOT_EXECUTED' WHERE status = 'INTERESTED'")
    )


def downgrade() -> None:
    # 표만 지운다. NOT_EXECUTED로 바꾼 단계 행은 INTERESTED로 복구하지 않는다
    # (어느 행이 원래 관심이었는지 남기지 않았고, 관심 단계는 계약 v3에서 없어졌다).
    op.drop_index(_INDEX_NAME, table_name="rec_bookmark")
    op.drop_table("rec_bookmark")
