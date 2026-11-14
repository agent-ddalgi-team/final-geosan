"""#499·#488 PM 승인: 공개 검색 요약과 웹 후보 판단 연결. 기존 공장 판단은 보존한다."""

import sqlalchemy as sa
from alembic import op

revision = "src_003"
down_revision = "rec_009"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("src_web_candidate", sa.Column("snippet", sa.Text(), nullable=True))
    with op.batch_alter_table("src_candidate_judgment") as batch:
        batch.alter_column("row_id", existing_type=sa.String(40), nullable=True)
        batch.add_column(sa.Column("web_candidate_id", sa.String(40), nullable=True))
        batch.create_foreign_key(
            "fk_src_candidate_judgment_web_candidate",
            "src_web_candidate",
            ["web_candidate_id"],
            ["candidate_id"],
        )
        batch.create_index("ix_src_candidate_judgment_web_candidate_id", ["web_candidate_id"])
        batch.create_check_constraint(
            "ck_src_candidate_judgment_source",
            "(row_id IS NOT NULL AND web_candidate_id IS NULL) OR "
            "(row_id IS NULL AND web_candidate_id IS NOT NULL)",
        )


def downgrade() -> None:
    connection = op.get_bind()
    if connection.scalar(
        sa.text("SELECT count(*) FROM src_candidate_judgment WHERE web_candidate_id IS NOT NULL")
    ) or connection.scalar(
        sa.text("SELECT count(*) FROM src_web_candidate WHERE snippet IS NOT NULL")
    ):
        raise RuntimeError(
            "웹 후보 요약·판단이 있어 데이터 손실 없이 이전 저장 형식으로 내릴 수 없습니다."
        )
    with op.batch_alter_table("src_candidate_judgment") as batch:
        batch.drop_constraint("ck_src_candidate_judgment_source", type_="check")
        batch.drop_constraint("fk_src_candidate_judgment_web_candidate", type_="foreignkey")
        batch.drop_index("ix_src_candidate_judgment_web_candidate_id")
        batch.drop_column("web_candidate_id")
        batch.alter_column("row_id", existing_type=sa.String(40), nullable=False)
    with op.batch_alter_table("src_web_candidate") as batch:
        batch.drop_column("snippet")
