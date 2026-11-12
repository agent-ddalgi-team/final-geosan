"""SourceIngestion 테이블 (src_, 계약 C5·C6, #221·#327). 이 파일의 열은 PM 세션만 고친다.

공공자료에서 읽어 둔 공장 행, AI가 행마다 내린 판단 메모, 단지 조회·웹 검색 기록을 둔다.
대표자 이름·팩스·전화번호·사람 연락처 열은 없다(CON-11). 판단 메모는 영구 정답이 아니라
"언제, 어떤 생산품 글과 기준을 보고 내린 판단"이다.
"""

from __future__ import annotations

from datetime import date, datetime
from typing import Any

from sqlalchemy import (
    JSON,
    Boolean,
    CheckConstraint,
    Date,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
)
from sqlalchemy.orm import Mapped, mapped_column

from geosan.storage.base import Base, CommonColumns, UtcDateTime


class SourceContract(CommonColumns, Base):
    """소스 이용 확인표. confirmed_at이 없는 소스는 수집을 시작하지 않는다(C5)."""

    __tablename__ = "src_source_contract"

    source_id: Mapped[str] = mapped_column(String(80), primary_key=True)
    source_name: Mapped[str] = mapped_column(String(200), nullable=False)
    allowed_use: Mapped[str] = mapped_column(Text, nullable=False)
    allowed_storage: Mapped[str] = mapped_column(Text, nullable=False)
    terms_ref: Mapped[str | None] = mapped_column(Text)
    confirmed_by: Mapped[str | None] = mapped_column(String(64))
    confirmed_at: Mapped[date | None] = mapped_column(Date)


class IngestionRun(CommonColumns, Base):
    """소스 하나를 읽은 집계(C5 summary). 건너뛴 행은 번호와 사유만 남긴다."""

    __tablename__ = "src_ingestion_run"

    run_id: Mapped[str] = mapped_column(String(40), primary_key=True)
    batch_id: Mapped[str | None] = mapped_column(String(40), index=True)
    source_id: Mapped[str] = mapped_column(String(80), nullable=False)
    raw_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    customer_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    opp_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    filter_summary: Mapped[Any | None] = mapped_column(JSON)
    skipped_rows: Mapped[Any] = mapped_column(JSON, nullable=False, default=list)
    status: Mapped[str] = mapped_column(String(16), nullable=False)


class SourceFactoryRow(CommonColumns, Base):
    """읽어 둔 공장 행. 파일 행은 file_date, 조회 행은 fetched_at을 채운다. 행은 지우지 않는다."""

    __tablename__ = "src_factory_row"
    __table_args__ = (
        Index("ix_src_factory_row_region", "source_id", "region"),
        Index("ix_src_factory_row_company", "company_name"),
    )

    row_id: Mapped[str] = mapped_column(String(40), primary_key=True)
    source_id: Mapped[str] = mapped_column(String(80), nullable=False)
    file_date: Mapped[date | None] = mapped_column(Date)
    company_name: Mapped[str] = mapped_column(String(200), nullable=False)
    complex_name: Mapped[str | None] = mapped_column(String(200))
    product: Mapped[str] = mapped_column(Text, nullable=False, default="")
    address: Mapped[str] = mapped_column(String(300), nullable=False)
    region: Mapped[str] = mapped_column(String(40), nullable=False)
    product_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    industry_name: Mapped[str | None] = mapped_column(String(200))
    factory_manage_no: Mapped[str | None] = mapped_column(String(40))
    loaded_at: Mapped[datetime] = mapped_column(UtcDateTime, nullable=False)
    fetched_at: Mapped[datetime | None] = mapped_column(UtcDateTime)
    missing_since: Mapped[date | None] = mapped_column(Date)


class CandidateJudgment(CommonColumns, Base):
    """AI 고르기 메모. product_hash나 criteria_version이 달라지면 낡은 판단으로 본다(C6)."""

    __tablename__ = "src_candidate_judgment"
    __table_args__ = (
        CheckConstraint(
            "(row_id IS NOT NULL AND web_candidate_id IS NULL) OR "
            "(row_id IS NULL AND web_candidate_id IS NOT NULL)",
            name="ck_src_candidate_judgment_source",
        ),
    )

    judgment_id: Mapped[str] = mapped_column(String(40), primary_key=True)
    row_id: Mapped[str | None] = mapped_column(
        String(40), ForeignKey("src_factory_row.row_id"), index=True
    )
    web_candidate_id: Mapped[str | None] = mapped_column(
        String(40), ForeignKey("src_web_candidate.candidate_id"), index=True
    )
    criteria_version: Mapped[str] = mapped_column(String(64), nullable=False)
    product_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    is_manufacturer: Mapped[bool] = mapped_column(Boolean, nullable=False)
    process_codes: Mapped[list[str]] = mapped_column(JSON, nullable=False, default=list)
    industries: Mapped[list[str]] = mapped_column(JSON, nullable=False, default=list)
    reason: Mapped[str | None] = mapped_column(Text)
    fit_level: Mapped[str | None] = mapped_column(String(8))
    own_plating_line_suspected: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    own_plating_line_basis: Mapped[str | None] = mapped_column(Text)
    judged_at: Mapped[datetime] = mapped_column(UtcDateTime, nullable=False)
    model: Mapped[str] = mapped_column(String(80), nullable=False)


class ComplexFetch(CommonColumns, Base):
    """단지별 입주 목록을 언제 받았나. expires_at까지는 다시 부르지 않는다(C5, #323·#405)."""

    __tablename__ = "src_complex_fetch"

    fetch_id: Mapped[str] = mapped_column(String(40), primary_key=True)
    complex_name: Mapped[str] = mapped_column(String(200), nullable=False, index=True)
    fetched_at: Mapped[datetime] = mapped_column(UtcDateTime, nullable=False)
    expires_at: Mapped[datetime] = mapped_column(UtcDateTime, nullable=False)
    row_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    status: Mapped[str] = mapped_column(String(16), nullable=False)
    # 이 조회가 받은 공장 행(src_factory_row.row_id) 목록(#405, PM 결정 2026-11-08).
    # 같은 공장을 다른 조회가 또 받아도 각 조회의 목록은 그대로 남는다. 다시 쓸 때는
    # status OK이고 expires_at 전인 조회의 이 목록만 읽는다.
    # row_count > 0인데 목록이 비어 있는 옛 기록은 다시 쓰지 않는다.
    row_ids: Mapped[list[str]] = mapped_column(JSON, nullable=False, default=list)


class WebSearchRun(CommonColumns, Base):
    """후보 찾기 웹 검색 한 번. 같은 조건은 expires_at까지 결과를 다시 쓴다(C9, #314)."""

    __tablename__ = "src_web_search_run"

    run_id: Mapped[str] = mapped_column(String(40), primary_key=True)
    criteria: Mapped[Any] = mapped_column(JSON, nullable=False)
    criteria_hash: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    searched_at: Mapped[datetime] = mapped_column(UtcDateTime, nullable=False)
    expires_at: Mapped[datetime] = mapped_column(UtcDateTime, nullable=False)
    result_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    dropped_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    requested_by: Mapped[str] = mapped_column(String(64), nullable=False)


class WebCandidate(CommonColumns, Base):
    """웹 검색이 찾은 회사 한 곳. 출처 주소가 꼭 있다. 사람 이름·연락처 열은 없다(C6)."""

    __tablename__ = "src_web_candidate"

    candidate_id: Mapped[str] = mapped_column(String(40), primary_key=True)
    run_id: Mapped[str] = mapped_column(
        String(40), ForeignKey("src_web_search_run.run_id"), nullable=False, index=True
    )
    company_name: Mapped[str] = mapped_column(String(200), nullable=False)
    address: Mapped[str | None] = mapped_column(String(300))
    source_url: Mapped[str] = mapped_column(Text, nullable=False)
    source_domain: Mapped[str] = mapped_column(String(200), nullable=False)
    registry_status: Mapped[str] = mapped_column(String(16), nullable=False)
    homepage_url: Mapped[str | None] = mapped_column(Text)
    dropped_reason: Mapped[str | None] = mapped_column(String(40))
    snippet: Mapped[str | None] = mapped_column(Text)


class FactoryProfile(CommonColumns, Base):
    """팩토리온 공장조회 행(C5 factoryon-xlsx, #573). 목록 회사에 붙이는 보조 자료다.

    후보 목록의 출발점이 아니다. 새 파일을 넣으면 이 소스의 행을 통째로 바꾼다.
    종업원 수는 공장 등록 때 적은 값이라 언제나 추정으로 보인다. 전화·홈페이지 열은 없다.
    """

    __tablename__ = "src_factory_profile"
    __table_args__ = (Index("ix_src_factory_profile_name", "normalized_name"),)

    profile_id: Mapped[str] = mapped_column(String(40), primary_key=True)
    source_id: Mapped[str] = mapped_column(String(80), nullable=False)
    file_date: Mapped[date] = mapped_column(Date, nullable=False)
    company_name: Mapped[str] = mapped_column(String(200), nullable=False)
    normalized_name: Mapped[str] = mapped_column(String(200), nullable=False)
    address: Mapped[str] = mapped_column(String(300), nullable=False)
    normalized_address: Mapped[str] = mapped_column(String(300), nullable=False)
    region: Mapped[str] = mapped_column(String(40), nullable=False)
    raw_materials: Mapped[str | None] = mapped_column(Text)
    employee_count: Mapped[int | None] = mapped_column(Integer)
    industry_codes: Mapped[list[str]] = mapped_column(JSON, nullable=False, default=list)
    industry_name: Mapped[str | None] = mapped_column(String(200))
    scale: Mapped[str | None] = mapped_column(String(40))
    loaded_at: Mapped[datetime] = mapped_column(UtcDateTime, nullable=False)


class WaterSite(CommonColumns, Base):
    """특정수질유해물질 배출 사업장(C5 nier-water-csv, #573). 같은 사업장은 한 행으로 합친다."""

    __tablename__ = "src_water_site"
    __table_args__ = (Index("ix_src_water_site_name", "normalized_name"),)

    site_id: Mapped[str] = mapped_column(String(40), primary_key=True)
    source_id: Mapped[str] = mapped_column(String(80), nullable=False)
    file_date: Mapped[date] = mapped_column(Date, nullable=False)
    site_name: Mapped[str] = mapped_column(String(200), nullable=False)
    normalized_name: Mapped[str] = mapped_column(String(200), nullable=False)
    address: Mapped[str] = mapped_column(String(300), nullable=False)
    normalized_address: Mapped[str] = mapped_column(String(300), nullable=False)
    region: Mapped[str] = mapped_column(String(40), nullable=False)
    agency: Mapped[str | None] = mapped_column(String(200))
    treatment_types: Mapped[list[str]] = mapped_column(JSON, nullable=False, default=list)
    loaded_at: Mapped[datetime] = mapped_column(UtcDateTime, nullable=False)
