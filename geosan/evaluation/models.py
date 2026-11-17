"""EvaluationLedger 테이블 (eval_, entities.md). 이 파일의 열은 PM 세션만 고친다.

평가는 UPDATE 없이 새 행(BR7.2). 묶음(EvaluationBatch)은 기준일·규칙 버전·해시·코드 버전·
거산 값 묶음을 기록해 재현성을 보장한다(FR4.12). 8항목 판정 입력(ItemJudgmentInput)과
기한 체크(ReadinessCheck)는 평가가 읽는 입력이라 이 부품이 소유한다.
"""

from __future__ import annotations

from datetime import date, datetime
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

from geosan.storage.base import Base, CommonColumns, Supersedable, UtcDateTime


class EvaluationBatch(CommonColumns, Base):
    """평가 묶음 (FR4.12, FR4.14). U1은 profile NEW만 만든다. scope FULL/PARTIAL(BR10.1)."""

    __tablename__ = "eval_batch"

    batch_id: Mapped[str] = mapped_column(String(40), primary_key=True)
    profile: Mapped[str] = mapped_column(String(16), nullable=False)
    scope: Mapped[str] = mapped_column(String(16), nullable=False)
    base_date: Mapped[date] = mapped_column(Date, nullable=False)
    rule_version: Mapped[str] = mapped_column(String(40), nullable=False)
    rule_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    code_version: Mapped[str] = mapped_column(String(80), nullable=False)
    llm_mode: Mapped[str] = mapped_column(String(16), nullable=False, default="NONE")
    model_id: Mapped[str | None] = mapped_column(String(80))
    population_spec: Mapped[Any] = mapped_column(JSON, nullable=False)
    status: Mapped[str] = mapped_column(String(16), nullable=False)
    sort_rule: Mapped[str] = mapped_column(String(60), nullable=False)


class EvaluationRun(CommonColumns, Base):
    """기회 하나의 평가 결과. 값이 바뀌면 새 행, 이전 행은 SUPERSEDED로 보존 (FR4.12)."""

    __tablename__ = "eval_run"

    eval_id: Mapped[str] = mapped_column(String(40), primary_key=True)
    batch_id: Mapped[str] = mapped_column(
        String(40), ForeignKey("eval_batch.batch_id"), nullable=False
    )
    opp_id: Mapped[str] = mapped_column(String(40), nullable=False)
    profile: Mapped[str] = mapped_column(String(16), nullable=False)
    profile_change_reason: Mapped[str | None] = mapped_column(Text)
    run_status: Mapped[str] = mapped_column(String(16), nullable=False)
    input_snapshot: Mapped[Any] = mapped_column(JSON, nullable=False)
    snapshot_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    capability_version: Mapped[str] = mapped_column(String(64), nullable=False)
    filter_state: Mapped[str] = mapped_column(String(16), nullable=False)
    exclusion_scope: Mapped[str | None] = mapped_column(String(16))
    core_evidence_met: Mapped[str] = mapped_column(String(16), nullable=False)
    operational_ready: Mapped[bool] = mapped_column(Boolean, nullable=False)
    timing_requirements: Mapped[Any] = mapped_column(JSON, nullable=False)
    research_ready: Mapped[bool] = mapped_column(Boolean, nullable=False)
    score_e: Mapped[int] = mapped_column(Integer, nullable=False)
    score_f: Mapped[int] = mapped_column(Integer, nullable=False)
    score_t: Mapped[int] = mapped_column(Integer, nullable=False)
    score_p: Mapped[int] = mapped_column(Integer, nullable=False)
    score_r: Mapped[int] = mapped_column(Integer, nullable=False)
    score_s: Mapped[float | None] = mapped_column(Float)
    completion_c: Mapped[float] = mapped_column(Float, nullable=False)
    classification_code: Mapped[str] = mapped_column(String(24), nullable=False)
    core_evidence_recheck_flag: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    direct_confirmed_weight: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    valid_until: Mapped[date | None] = mapped_column(Date)
    original_rank: Mapped[int | None] = mapped_column(Integer)
    previous_eval_id: Mapped[str | None] = mapped_column(String(40), ForeignKey("eval_run.eval_id"))
    reason: Mapped[str] = mapped_column(Text, nullable=False)
    blocker_text: Mapped[str] = mapped_column(Text, nullable=False)
    blocks_approval: Mapped[bool] = mapped_column(Boolean, nullable=False)
    score_display: Mapped[str] = mapped_column(String(20), nullable=False)
    next_action: Mapped[str] = mapped_column(Text, nullable=False)


class ItemJudgment(CommonColumns, Base):
    """평가 하나의 항목 판정. (평가, 항목) 쌍당 하나이며 미확보도 행을 남긴다 (FR4.4)."""

    __tablename__ = "eval_item_judgment"
    __table_args__ = (UniqueConstraint("eval_id", "item_code", name="uq_eval_item_judgment"),)

    judgment_id: Mapped[str] = mapped_column(String(40), primary_key=True)
    eval_id: Mapped[str] = mapped_column(String(40), ForeignKey("eval_run.eval_id"), nullable=False)
    item_code: Mapped[str] = mapped_column(String(24), nullable=False)
    fact_judged: Mapped[str | None] = mapped_column(Text)
    summary: Mapped[str | None] = mapped_column(Text)  # 상세용 쉬운 요약 (#139, rec_002)
    reasoning: Mapped[str | None] = mapped_column(Text)
    weight: Mapped[int] = mapped_column(Integer, nullable=False)
    state: Mapped[str] = mapped_column(String(16), nullable=False)
    match_rate: Mapped[float | None] = mapped_column(Float)
    certainty: Mapped[float | None] = mapped_column(Float)
    decay: Mapped[float | None] = mapped_column(Float)
    score: Mapped[int | None] = mapped_column(Integer)
    used_capability_ids: Mapped[list[str]] = mapped_column(JSON, nullable=False, default=list)


class RequirementCheck(CommonColumns, Base):
    """평가 하나의 요구별 판정. 무엇과 대조했는지와 사유·기준일을 남긴다 (FR3.2)."""

    __tablename__ = "eval_requirement_check"

    check_id: Mapped[str] = mapped_column(String(40), primary_key=True)
    req_id: Mapped[str] = mapped_column(String(40), nullable=False)
    eval_id: Mapped[str] = mapped_column(String(40), ForeignKey("eval_run.eval_id"), nullable=False)
    result: Mapped[str] = mapped_column(String(16), nullable=False)
    display_result: Mapped[str] = mapped_column(String(24), nullable=False)
    stage_judged: Mapped[str] = mapped_column(String(16), nullable=False)
    scope_judged: Mapped[str] = mapped_column(String(16), nullable=False)
    reason: Mapped[str] = mapped_column(Text, nullable=False)
    compared_value: Mapped[Any | None] = mapped_column(JSON)
    base_date: Mapped[date] = mapped_column(Date, nullable=False)
    qual_id: Mapped[str | None] = mapped_column(String(40))
    link_id: Mapped[str | None] = mapped_column(String(40))
    evidence_id: Mapped[str | None] = mapped_column(String(40))
    follow_up_condition: Mapped[str | None] = mapped_column(Text)


class JudgmentEvidence(CommonColumns, Base):
    """항목 판정 ↔ 근거 연결. 같은 쌍 중복 금지."""

    __tablename__ = "eval_judgment_evidence"
    __table_args__ = (
        UniqueConstraint("judgment_id", "evidence_id", name="uq_eval_judgment_evidence"),
    )

    judgment_evidence_id: Mapped[str] = mapped_column(String(40), primary_key=True)
    judgment_id: Mapped[str] = mapped_column(
        String(40), ForeignKey("eval_item_judgment.judgment_id"), nullable=False
    )
    evidence_id: Mapped[str] = mapped_column(String(40), nullable=False)
    relation_type: Mapped[str] = mapped_column(String(16), nullable=False)
    apply_reason: Mapped[str | None] = mapped_column(Text)


class ItemJudgmentInput(Supersedable, CommonColumns, Base):
    """사례 파일의 8항목 판정 입력. 기회당 8행이 모두 있어야 평가할 수 있다 (FR10.3, BR4.1)."""

    __tablename__ = "eval_item_input"
    __table_args__ = (
        UniqueConstraint("opp_id", "item_code", "version", name="uq_eval_item_input_version"),
    )

    item_input_id: Mapped[str] = mapped_column(String(40), primary_key=True)
    opp_id: Mapped[str] = mapped_column(String(40), nullable=False)
    item_code: Mapped[str] = mapped_column(String(24), nullable=False)
    state: Mapped[str] = mapped_column(String(16), nullable=False)
    match_rate_step: Mapped[str | None] = mapped_column(String(60))
    match_rate: Mapped[float | None] = mapped_column(Float)
    fact_judged: Mapped[str | None] = mapped_column(Text)
    summary: Mapped[str | None] = mapped_column(Text)  # 상세용 쉬운 요약 (#139, rec_002)
    evidence_ids: Mapped[list[str]] = mapped_column(JSON, nullable=False, default=list)
    signal_ids: Mapped[list[str]] = mapped_column(JSON, nullable=False, default=list)
    used_capability_refs: Mapped[Any] = mapped_column(JSON, nullable=False, default=list)
    proposed_by: Mapped[str] = mapped_column(String(16), nullable=False, default="FILE")
    entered_by: Mapped[str] = mapped_column(String(64), nullable=False)
    entered_at: Mapped[datetime] = mapped_column(UtcDateTime, nullable=False)
    version: Mapped[int] = mapped_column(Integer, nullable=False, default=1)


class ReadinessCheck(Supersedable, CommonColumns, Base):
    """시점 우선 요건 ③ '기한 내 대응 가능' 담당자 체크 (FR4.7, Q1).

    현재 체크 = resetAt이 비어 있는 가장 최근 행.
    """

    __tablename__ = "eval_readiness_check"

    readiness_check_id: Mapped[str] = mapped_column(String(40), primary_key=True)
    opp_id: Mapped[str] = mapped_column(String(40), nullable=False)
    checked: Mapped[bool] = mapped_column(Boolean, nullable=False)
    staff_name: Mapped[str] = mapped_column(String(32), nullable=False)
    checked_at: Mapped[datetime] = mapped_column(UtcDateTime, nullable=False)
    eval_id_at_check: Mapped[str | None] = mapped_column(String(40), ForeignKey("eval_run.eval_id"))
    reset_reason: Mapped[str | None] = mapped_column(Text)
    reset_at: Mapped[datetime | None] = mapped_column(UtcDateTime)
