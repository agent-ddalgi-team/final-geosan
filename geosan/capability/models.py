"""CapabilityCatalog 테이블 (cap_, entities.md). 이 파일의 열은 PM 세션만 고친다.

거산 값은 묶음(dataset_kind)별로 따로 존재한다. 재투입 식별 키: Process (dataset_kind, code),
Qualification (dataset_kind, official_name, number), ProcessCapability (process_id, cap_kind, name).
검수 상태의 원본은 가장 최근 FieldEvidence 행이고 각 엔티티의 review_status는 조회용 사본이다.
"""

from __future__ import annotations

from datetime import date
from typing import Any

from sqlalchemy import (
    JSON,
    Boolean,
    Date,
    Float,
    ForeignKey,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column

from geosan.storage.base import Base, CommonColumns


class Process(CommonColumns, Base):
    """거산 공정 9종 중 하나 (FR1.1)."""

    __tablename__ = "cap_process"
    __table_args__ = (UniqueConstraint("dataset_kind", "code", name="uq_cap_process_dataset_code"),)

    process_id: Mapped[str] = mapped_column(String(40), primary_key=True)
    code: Mapped[str] = mapped_column(String(32), nullable=False)
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    category: Mapped[str | None] = mapped_column(String(60))
    material_codes: Mapped[list[str]] = mapped_column(JSON, nullable=False, default=list)
    performance_tags: Mapped[list[str]] = mapped_column(JSON, nullable=False, default=list)
    registry_status: Mapped[str] = mapped_column(
        String(24), nullable=False, default="BROCHURE_NAME"
    )
    review_status: Mapped[str] = mapped_column(String(16), nullable=False)
    assumption_note: Mapped[str | None] = mapped_column(Text)


class ProcessCapability(CommonColumns, Base):
    """공정의 역량 항목(사양·시험·설비). 숫자 사양은 최소·최대·단위로 나눈다 (FR1.2)."""

    __tablename__ = "cap_process_capability"
    __table_args__ = (
        UniqueConstraint("process_id", "cap_kind", "name", name="uq_cap_capability_key"),
    )

    capability_id: Mapped[str] = mapped_column(String(40), primary_key=True)
    process_id: Mapped[str] = mapped_column(
        String(40), ForeignKey("cap_process.process_id"), nullable=False
    )
    cap_kind: Mapped[str] = mapped_column(String(16), nullable=False)
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    display_value: Mapped[str | None] = mapped_column(String(200))
    numeric_min: Mapped[float | None] = mapped_column(Float)
    numeric_max: Mapped[float | None] = mapped_column(Float)
    unit: Mapped[str | None] = mapped_column(String(20))
    standard_ref: Mapped[str | None] = mapped_column(String(120))
    scope_note: Mapped[str | None] = mapped_column(Text)
    is_descriptive_only: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    review_status: Mapped[str] = mapped_column(String(16), nullable=False)


class DeliveryRecord(CommonColumns, Base):
    """공정별 납품 실적(산업·부품 종류·기간). 고객 실명 없음 (FR1.2)."""

    __tablename__ = "cap_delivery_record"

    record_id: Mapped[str] = mapped_column(String(40), primary_key=True)
    process_id: Mapped[str] = mapped_column(
        String(40), ForeignKey("cap_process.process_id"), nullable=False
    )
    industry: Mapped[str] = mapped_column(String(120), nullable=False)
    part_type: Mapped[str | None] = mapped_column(String(120))
    period: Mapped[str | None] = mapped_column(String(60))
    allowed_basis: Mapped[str | None] = mapped_column(Text)
    review_status: Mapped[str] = mapped_column(String(16), nullable=False)


class Qualification(CommonColumns, Base):
    """인증·승인 (FR1.4)."""

    __tablename__ = "cap_qualification"
    __table_args__ = (
        UniqueConstraint(
            "dataset_kind", "official_name", "number", name="uq_cap_qualification_key"
        ),
    )

    qual_id: Mapped[str] = mapped_column(String(40), primary_key=True)
    kind: Mapped[str] = mapped_column(String(16), nullable=False)
    official_name: Mapped[str] = mapped_column(String(120), nullable=False)
    number: Mapped[str | None] = mapped_column(String(80))
    edition: Mapped[str | None] = mapped_column(String(40))
    holder: Mapped[str] = mapped_column(String(120), nullable=False)
    site: Mapped[str | None] = mapped_column(String(120))
    valid_from: Mapped[date | None] = mapped_column(Date)
    valid_to: Mapped[date | None] = mapped_column(Date)
    source_version: Mapped[str | None] = mapped_column(String(120))
    review_status: Mapped[str] = mapped_column(String(16), nullable=False)


class QualificationScope(CommonColumns, Base):
    """자격의 적용 범위 한 줄. 공정 ID가 비어 있어도 '모든 공정'으로 읽지 않는다 (FR1.4, FR1.6)."""

    __tablename__ = "cap_qualification_scope"

    scope_id: Mapped[str] = mapped_column(String(40), primary_key=True)
    qual_id: Mapped[str] = mapped_column(
        String(40), ForeignKey("cap_qualification.qual_id"), nullable=False
    )
    scope_kind: Mapped[str] = mapped_column(String(16), nullable=False)
    process_id: Mapped[str | None] = mapped_column(String(40), ForeignKey("cap_process.process_id"))
    customer_id: Mapped[str | None] = mapped_column(String(40))
    opp_id: Mapped[str | None] = mapped_column(String(40))
    product_scope: Mapped[str | None] = mapped_column(String(200))
    applicability: Mapped[str] = mapped_column(String(16), nullable=False)
    basis: Mapped[str | None] = mapped_column(Text)
    review_status: Mapped[str] = mapped_column(String(16), nullable=False)


class QualificationStatus(CommonColumns, Base):
    """자격 상태 이력. 갱신마다 새 행, 현재 상태 = 가장 최근 행 (FR1.4, FR1.7, FR3.8)."""

    __tablename__ = "cap_qualification_status"

    status_id: Mapped[str] = mapped_column(String(40), primary_key=True)
    qual_id: Mapped[str] = mapped_column(
        String(40), ForeignKey("cap_qualification.qual_id"), nullable=False
    )
    status: Mapped[str] = mapped_column(String(16), nullable=False)
    occurred_at: Mapped[date | None] = mapped_column(Date)
    confirmed_at: Mapped[date | None] = mapped_column(Date)
    confirmed_by: Mapped[str | None] = mapped_column(String(80))
    reason: Mapped[str | None] = mapped_column(Text)
    evidence_id: Mapped[str | None] = mapped_column(String(40))


class FieldEvidence(CommonColumns, Base):
    """거산 값 하나의 검수 기록(검수자·검수일·근거·값 스냅샷). 값이 바뀌면 새 행 (FR1.3, FR1.5)."""

    __tablename__ = "cap_field_evidence"
    __table_args__ = (
        UniqueConstraint(
            "target_table",
            "target_id",
            "target_field",
            "data_version",
            name="uq_cap_field_evidence_version",
        ),
    )

    field_evidence_id: Mapped[str] = mapped_column(String(40), primary_key=True)
    target_table: Mapped[str] = mapped_column(String(40), nullable=False)
    target_id: Mapped[str] = mapped_column(String(40), nullable=False)
    target_field: Mapped[str] = mapped_column(String(40), nullable=False)
    value_snapshot: Mapped[Any] = mapped_column(JSON, nullable=False)
    data_version: Mapped[int] = mapped_column(Integer, nullable=False)
    review_status: Mapped[str] = mapped_column(String(16), nullable=False)
    reviewer: Mapped[str | None] = mapped_column(String(80))
    reviewed_at: Mapped[date | None] = mapped_column(Date)
    basis: Mapped[str | None] = mapped_column(Text)
    evidence_id: Mapped[str | None] = mapped_column(String(40))
