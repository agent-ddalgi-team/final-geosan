"""로그인·영업 기록 두 갈래 연결 (#209, PM 확인 2026-11-03).

Revision ID: merge_001
Revises: opp_004, web_001
Create Date: 2026-11-03 21:26:29.257902

접두사 규칙(C6): 단위마다 자기 접두사 테이블만 만들고 파일 이름은 <접두사>_<번호>_<설명>.py.
모든 마이그레이션은 downgrade를 가진다(안정성 설계 6장).
"""

from __future__ import annotations


revision = "merge_001"
down_revision = ("opp_004", "web_001")
branch_labels = None
depends_on = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
