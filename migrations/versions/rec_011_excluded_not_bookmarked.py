"""검토 대상 제외인 회사의 관심을 끈다 (#536, 계약 C6 v4). 표·열 변경 없음.

제외로 저장한 회사는 이제 관심 기업이 아니다. 마지막 관심 행이 켬이고 최신 검토 의견이
NOT_TARGET인 기회마다 관심 끔 행을 하나 더한다(source AUTO_RECORD, 담당자는 그 의견을 저장한 사람).
기존 행은 고치지 않는다. 되돌리면 이 파일이 더한 행(session_ref 표식)만 지운다.
"""

from datetime import UTC, datetime

import sqlalchemy as sa
from alembic import op

from geosan.storage.base import new_id

revision = "rec_011"
down_revision = "rec_010"
branch_labels = None
depends_on = None

MARKER = "migration:rec_011"


def upgrade() -> None:
    bind = op.get_bind()
    # 기회마다 마지막 관심 행과 최신 의견 행(버전, 그다음 저장 시각 순 — 화면·대시보드와 같은 순서).
    rows = bind.execute(
        sa.text(
            """
            WITH last_bookmark AS (
                SELECT opp_id, active, version, dataset_kind, is_virtual,
                       ROW_NUMBER() OVER (PARTITION BY opp_id ORDER BY version DESC) AS rn
                FROM rec_bookmark
            ),
            last_opinion AS (
                SELECT opp_id, opinion, staff_name,
                       ROW_NUMBER() OVER (
                           PARTITION BY opp_id ORDER BY version DESC, recorded_at DESC
                       ) AS rn
                FROM rec_review_opinion
            )
            SELECT b.opp_id, b.version, b.dataset_kind, b.is_virtual, o.staff_name
            FROM last_bookmark b
            JOIN last_opinion o ON o.opp_id = b.opp_id AND o.rn = 1
            WHERE b.rn = 1 AND b.active = 1 AND o.opinion = 'NOT_TARGET'
            ORDER BY b.opp_id
            """
        )
    ).all()
    # 다른 표의 created_at과 같은 글자 모양(UTC ISO, 마이크로초까지).
    now = datetime.now(UTC).isoformat(timespec="microseconds")
    insert = sa.text(
        "INSERT INTO rec_bookmark (bookmark_id, opp_id, active, staff_key, source, version, "
        "created_at, created_by, session_ref, dataset_kind, is_virtual) VALUES (:bookmark_id, "
        ":opp_id, 0, :staff, 'AUTO_RECORD', :version, :created_at, :staff, :marker, "
        ":dataset_kind, :is_virtual)"
    )
    for opp_id, version, dataset_kind, is_virtual, staff in rows:
        bind.execute(
            insert,
            {
                "bookmark_id": new_id("bookmark"),
                "opp_id": opp_id,
                "staff": staff,
                "version": version + 1,
                "created_at": now,
                "marker": MARKER,
                "dataset_kind": dataset_kind,
                "is_virtual": is_virtual,
            },
        )


def downgrade() -> None:
    op.get_bind().execute(
        sa.text("DELETE FROM rec_bookmark WHERE session_ref = :marker"), {"marker": MARKER}
    )
