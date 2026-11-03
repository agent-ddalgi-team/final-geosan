"""경계 파일: 고치려면 PM에게 먼저 말한다(계약 C0).

공통 코드표. DB·API·화면·파일이 같은 영문 코드를 쓴다(FR4.10, BR6.3).
쉬운 말 문구는 여기 없고 규칙 설정 `classificationLabels`에서 읽는다(설정 한 곳에서 바꿈).
세 트랙(규칙 엔진·투입/API·화면)은 이 파일을 고치지 않고 쓴다. 뒤 단위는 값을 "추가만" 한다.
"""

from __future__ import annotations

from dataclasses import dataclass
from enum import StrEnum


class ClassificationCode(StrEnum):
    """11분기 분류 코드 (BR6.1 순서)."""

    FILTER_EXCLUDED = "FILTER_EXCLUDED"
    FILTER_PENDING = "FILTER_PENDING"
    OPS_PENDING = "OPS_PENDING"
    NOT_EVALUATED = "NOT_EVALUATED"
    CONTACT_URGENT = "CONTACT_URGENT"
    CONTACT_PLANNED = "CONTACT_PLANNED"
    CONTACT_REVIEW = "CONTACT_REVIEW"
    RESEARCH = "RESEARCH"
    CONDITIONAL_WAIT = "CONDITIONAL_WAIT"
    WATCH = "WATCH"
    LOW = "LOW"


class DatasetKind(StrEnum):
    VIRTUAL_REVIEWED = "VIRTUAL_REVIEWED"
    BROCHURE = "BROCHURE"
    COMPANY_CONFIRMED = "COMPANY_CONFIRMED"


class ReviewStatus(StrEnum):
    """미확보 / 검수 대기 / 검수 완료 / 재확인."""

    UNAVAILABLE = "UNAVAILABLE"
    PENDING = "PENDING"
    REVIEWED = "REVIEWED"
    RECHECK = "RECHECK"


class RelationStatus(StrEnum):
    NEW_CONFIRMED = "NEW_CONFIRMED"
    EXISTING_CONFIRMED = "EXISTING_CONFIRMED"
    UNCONFIRMED = "UNCONFIRMED"


class Purpose(StrEnum):
    NEW_PROPOSAL = "NEW_PROPOSAL"
    FOLLOW_UP_PROPOSAL = "FOLLOW_UP_PROPOSAL"
    REORDER_CHECK = "REORDER_CHECK"


class InteractionKind(StrEnum):
    TRADE = "TRADE"
    QUOTE = "QUOTE"
    CONSULT = "CONSULT"
    PROPOSAL = "PROPOSAL"
    MEMO = "MEMO"


class PathKind(StrEnum):
    PROCESS_DEMAND = "PROCESS_DEMAND"
    CERTIFICATION = "CERTIFICATION"
    HISTORY = "HISTORY"


class ReqKind(StrEnum):
    CERTIFICATION = "CERTIFICATION"
    APPROVAL = "APPROVAL"
    TECHNICAL = "TECHNICAL"
    QUANTITY_DELIVERY = "QUANTITY_DELIVERY"


class ReqLevel(StrEnum):
    REQUIRED = "REQUIRED"
    PREFERRED = "PREFERRED"
    NOT_REQUIRED = "NOT_REQUIRED"
    UNKNOWN = "UNKNOWN"


class NeededStage(StrEnum):
    NOW = "NOW"
    LATER = "LATER"
    UNKNOWN = "UNKNOWN"


class ScopeKind(StrEnum):
    OPPORTUNITY = "OPPORTUNITY"
    PROCESS_LINK = "PROCESS_LINK"


class SignalKind(StrEnum):
    EXPANSION = "EXPANSION"
    NEW_ORDER = "NEW_ORDER"
    BID = "BID"
    HIRING = "HIRING"
    REORDER_CYCLE = "REORDER_CYCLE"
    NEXT_CONTACT = "NEXT_CONTACT"


class SignalRelation(StrEnum):
    """직접 관련 1.0 / 간접 관련 0.5 (일치도 단계, 더하는 변경 2026-10-21)."""

    DIRECT = "DIRECT"
    INDIRECT = "INDIRECT"


class ProgressStatus(StrEnum):
    OPEN = "OPEN"
    CLOSED = "CLOSED"
    CANCELLED = "CANCELLED"
    DONE = "DONE"


class Certainty(StrEnum):
    """확인 / 강한 추정 / 약한 추정 / 미확인."""

    CONFIRMED = "CONFIRMED"
    STRONG = "STRONG"
    WEAK = "WEAK"
    UNKNOWN = "UNKNOWN"


class SecurityGrade(StrEnum):
    PUBLIC = "PUBLIC"
    EXTERNAL_AI_OK = "EXTERNAL_AI_OK"
    INTERNAL_ONLY = "INTERNAL_ONLY"
    FORBIDDEN = "FORBIDDEN"
    UNKNOWN = "UNKNOWN"


class SourceGrade(StrEnum):
    A = "A"
    B = "B"
    C = "C"
    D = "D"


class EvidenceSubject(StrEnum):
    PRODUCT = "PRODUCT"
    MATERIAL = "MATERIAL"
    PURPOSE = "PURPOSE"
    SIGNAL = "SIGNAL"
    REQUIREMENT = "REQUIREMENT"
    OTHER = "OTHER"


class ItemCode(StrEnum):
    """신규 프로필 8항목 (부록 A.1). 배점은 코드가 아니라 규칙 설정에서 읽는다."""

    NEW_PRODUCT = "NEW_PRODUCT"
    NEW_MATERIAL = "NEW_MATERIAL"
    NEW_RECORD = "NEW_RECORD"
    NEW_PERF = "NEW_PERF"
    SIG_EXPAND = "SIG_EXPAND"
    SIG_ORDER = "SIG_ORDER"
    SIG_BID = "SIG_BID"
    SIG_HIRE = "SIG_HIRE"


class ItemState(StrEnum):
    """항목 상태 7가지 (BR4.5). 앞 여섯은 판정 완료, UNAVAILABLE만 점수 NULL."""

    CONFIRMED = "CONFIRMED"
    STRONG = "STRONG"
    WEAK = "WEAK"
    MISMATCH = "MISMATCH"
    NO_BONUS = "NO_BONUS"
    NO_SIGNAL = "NO_SIGNAL"
    UNAVAILABLE = "UNAVAILABLE"


class CheckResult(StrEnum):
    """규칙 엔진의 요구 판정 (BR3.1)."""

    PASS = "PASS"
    UNKNOWN = "UNKNOWN"
    EXCLUDED = "EXCLUDED"


class CheckDisplay(StrEnum):
    """화면 표시값 (BR3.3 변환 규칙)."""

    PASS = "PASS"
    LATER_STAGE = "LATER_STAGE"
    QUESTION_NEEDED = "QUESTION_NEEDED"
    PENDING_BLOCKS = "PENDING_BLOCKS"
    EXCLUDED = "EXCLUDED"


class FilterState(StrEnum):
    PASS = "PASS"
    PENDING = "PENDING"
    EXCLUDED = "EXCLUDED"


class ExclusionScope(StrEnum):
    COMPANY = "COMPANY"
    OPPORTUNITY = "OPPORTUNITY"
    LINK = "LINK"


class CoreEvidenceMet(StrEnum):
    MET = "MET"
    RECHECK = "RECHECK"


class SortGroup(StrEnum):
    URGENT = "URGENT"
    PLANNED = "PLANNED"
    REVIEW = "REVIEW"
    OTHER = "OTHER"


class Profile(StrEnum):
    NEW = "NEW"
    RECONTACT = "RECONTACT"


class Opinion(StrEnum):
    WORTH_REVIEW = "WORTH_REVIEW"
    NEED_CHECK = "NEED_CHECK"
    NOT_TARGET = "NOT_TARGET"


class OutcomeStatus(StrEnum):
    NOT_EXECUTED = "NOT_EXECUTED"
    INTERESTED = "INTERESTED"
    IN_PROGRESS = "IN_PROGRESS"
    SAMPLE_OR_REGISTRATION_APPROVED = "SAMPLE_OR_REGISTRATION_APPROVED"
    ON_HOLD = "ON_HOLD"
    WON = "WON"
    LOST = "LOST"


class ContactMethod(StrEnum):
    CALL = "CALL"
    EMAIL = "EMAIL"
    VISIT = "VISIT"


class ContactResult(StrEnum):
    REACHED = "REACHED"
    ABSENT = "ABSENT"
    DECLINED = "DECLINED"


class ActivityKind(StrEnum):
    CLASSIFICATION = "CLASSIFICATION"
    OPINION = "OPINION"
    BOOKMARK = "BOOKMARK"
    APPROVAL = "APPROVAL"
    CONTACT_ATTEMPT = "CONTACT_ATTEMPT"
    REPLY = "REPLY"
    OUTCOME = "OUTCOME"
    EVIDENCE_GRADE_CONFIRMED = "EVIDENCE_GRADE_CONFIRMED"
    NOTE = "NOTE"


class NoteKind(StrEnum):
    MEMO = "MEMO"
    RESEARCH = "RESEARCH"


class ReviewItemKind(StrEnum):
    QUESTION = "QUESTION"
    DATA_NOT_FOUND = "DATA_NOT_FOUND"
    DATA_INSUFFICIENT = "DATA_INSUFFICIENT"


class ReviewItemSource(StrEnum):
    AI = "AI"
    CASE_FILE = "CASE_FILE"
    RULE = "RULE"


class QuestionStatus(StrEnum):
    WAITING = "WAITING"
    REQUESTED = "REQUESTED"
    REPLIED = "REPLIED"
    APPLIED = "APPLIED"


class QuestionTargetKind(StrEnum):
    QUALIFICATION = "QUALIFICATION"
    PROCESS = "PROCESS"
    CAPABILITY = "CAPABILITY"
    FIELD = "FIELD"
    REQUIREMENT = "REQUIREMENT"
    OPPORTUNITY = "OPPORTUNITY"


class QualificationStatusCode(StrEnum):
    ACTIVE = "ACTIVE"
    SUSPENDED = "SUSPENDED"
    CANCELLED = "CANCELLED"
    EXPIRED = "EXPIRED"
    UNCONFIRMED = "UNCONFIRMED"


class Applicability(StrEnum):
    APPLIES = "APPLIES"
    NOT_APPLIES = "NOT_APPLIES"
    UNKNOWN = "UNKNOWN"


class CapKind(StrEnum):
    SPEC = "SPEC"
    TEST = "TEST"
    EQUIPMENT = "EQUIPMENT"


class QualificationKind(StrEnum):
    CERTIFICATION = "CERTIFICATION"
    APPROVAL = "APPROVAL"


class ProcessCode(StrEnum):
    """거산 공정 9종 (FR1.1). 영문 코드는 팀 제안이며 이름은 역량 파일의 name에서 온다."""

    ZINC_PLATING = "ZINC_PLATING"  # 아연도금(전기아연도금)
    ANODIZING = "ANODIZING"  # 아노다이징
    BLACK_OXIDE = "BLACK_OXIDE"  # 흑착색(알카리흑착) — 같은 공정 여부 거산 확인 전(가정 A11)
    CHROMATE = "CHROMATE"  # 크로메이트
    ELECTROPOLISHING = "ELECTROPOLISHING"  # 전해연마
    CHROME_PLATING = "CHROME_PLATING"  # 크롬도금
    ELECTROLESS_NICKEL = "ELECTROLESS_NICKEL"  # 무전해니켈
    PHOSPHATE_COATING = "PHOSPHATE_COATING"  # 인산염피막
    PASSIVATION = "PASSIVATION"  # 부동태


VIEWER_STAFF_KEY = "viewer"
"""예약 담당자 키(보기 전용). 기록 요청은 403 (BR9.3)."""


@dataclass(frozen=True)
class ClassificationEntry:
    """11분기 코드표 한 줄 (entities.md ClassificationCode).

    easyLabel(쉬운 말)은 규칙 설정 classificationLabels에서 따로 읽는다.
    """

    code: ClassificationCode
    order: int
    rule_label: str
    blocks_approval: bool
    is_contact_candidate: bool


CLASSIFICATION_TABLE: tuple[ClassificationEntry, ...] = (
    ClassificationEntry(ClassificationCode.FILTER_EXCLUDED, 1, "필터 제외", False, False),
    ClassificationEntry(
        ClassificationCode.FILTER_PENDING, 2, "필터 미확인(확인 대기)", False, False
    ),
    ClassificationEntry(ClassificationCode.OPS_PENDING, 3, "운영 전제 미확정", False, False),
    ClassificationEntry(ClassificationCode.NOT_EVALUATED, 4, "초기 평가 대기", False, False),
    ClassificationEntry(ClassificationCode.CONTACT_URGENT, 5, "시점 우선 접촉", False, True),
    ClassificationEntry(ClassificationCode.CONTACT_PLANNED, 6, "계획형 접촉", False, True),
    ClassificationEntry(ClassificationCode.CONTACT_REVIEW, 7, "검토 후 접촉", False, True),
    ClassificationEntry(ClassificationCode.RESEARCH, 8, "추가조사", False, False),
    ClassificationEntry(ClassificationCode.CONDITIONAL_WAIT, 9, "조건부 대기", False, False),
    ClassificationEntry(ClassificationCode.WATCH, 10, "관찰", False, False),
    ClassificationEntry(ClassificationCode.LOW, 11, "후순위", False, False),
)
"""BR6.1 순서대로. 분류는 추천 강도 표시용이며 승인 가능 여부는 사실 조건으로 정한다(#211)."""

CLASSIFICATION_BY_CODE: dict[ClassificationCode, ClassificationEntry] = {
    entry.code: entry for entry in CLASSIFICATION_TABLE
}


def classification_entry(code: ClassificationCode | str) -> ClassificationEntry:
    """코드표 한 줄을 돌려준다. 코드표 밖 값은 KeyError(조용히 넘기지 않는다)."""
    return CLASSIFICATION_BY_CODE[ClassificationCode(code)]
