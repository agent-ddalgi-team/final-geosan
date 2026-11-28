"""상대 담당자 연락처와 열람 기록 표(#980, 계약 C6, PM 결정 2026-11-28).

담당자가 직접 적은 연락처만 둔다. 화면에는 가려서 보이고 열 때마다 열람 기록을 남긴다.
"""

import sqlalchemy as sa
from alembic import op

revision = "rec_020"
down_revision = "opp_013"
branch_labels = None
depends_on = None

_COMMON = [
    ("created_at", sa.String(40), False),
    ("created_by", sa.String(64), False),
    ("session_ref", sa.String(64), True),
    ("dataset_kind", sa.String(32), True),
    ("is_virtual", sa.Boolean(), False),
]


def _common():
    return [sa.Column(name, kind, nullable=nullable) for name, kind, nullable in _COMMON]


def upgrade() -> None:
    op.create_table(
        "rec_contact_person",
        sa.Column("contact_id", sa.String(40), primary_key=True),
        sa.Column("opp_id", sa.String(40), sa.ForeignKey("opp_opportunity.opp_id"), nullable=False),
        sa.Column("person_name", sa.String(20), nullable=True),
        sa.Column("role", sa.String(30), nullable=True),
        sa.Column("phone", sa.String(20), nullable=True),
        sa.Column("retain_until", sa.Date(), nullable=False),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.Column("updated_at", sa.String(40), nullable=True),
        sa.Column("updated_by", sa.String(64), nullable=True),
        sa.Column("deleted_at", sa.String(40), nullable=True),
        sa.Column("deleted_by", sa.String(64), nullable=True),
        sa.Column("deleted_reason", sa.String(16), nullable=True),
        *_common(),
    )
    op.create_index("ix_rec_contact_person_opp_id", "rec_contact_person", ["opp_id"])
    op.create_table(
        "rec_contact_reveal",
        sa.Column("reveal_id", sa.String(40), primary_key=True),
        sa.Column("opp_id", sa.String(40), sa.ForeignKey("opp_opportunity.opp_id"), nullable=False),
        sa.Column("contact_id", sa.String(40), nullable=True),
        sa.Column("note_id", sa.String(40), nullable=True),
        sa.Column("staff_key", sa.String(64), nullable=False),
        *_common(),
    )
    op.create_index("ix_rec_contact_reveal_opp_id", "rec_contact_reveal", ["opp_id"])


def downgrade() -> None:
    op.drop_index("ix_rec_contact_reveal_opp_id", table_name="rec_contact_reveal")
    op.drop_table("rec_contact_reveal")
    op.drop_index("ix_rec_contact_person_opp_id", table_name="rec_contact_person")
    op.drop_table("rec_contact_person")
