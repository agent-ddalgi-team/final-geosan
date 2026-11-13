"""회사 공공좌표와 영업 기록의 잘못 입력 표시 이관을 모두 보존한다 (#651).

Revision ID: merge_002
Revises: opp_010, rec_013
Create Date: 2026-11-13 13:00:31.525893

접두사 규칙(C6): 단위마다 자기 접두사 테이블만 만들고 파일 이름은 <접두사>_<번호>_<설명>.py.
모든 마이그레이션은 downgrade를 가진다(안정성 설계 6장).
"""

from __future__ import annotations


revision = "merge_002"
down_revision = ("opp_010", "rec_013")
branch_labels = None
depends_on = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
