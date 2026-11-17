"""C4 OUTPUT_EXPORT: 파일(엑셀·질문 목록)로 내보내기 전에 항목의 종류와 보안 등급을 본다.

하나라도 걸리면 전체 거부다(걸러서 다시 내보내지 않는다). 영업 메모(NOTE)·질문 답·활동 이력은
허용 종류가 아니라서 여기를 통과하지 못한다. 연락처 지우기(scrub_contacts)는 파일을 만드는 쪽이
따로 한다. 전송 기록(TransferLog) 한 줄은 아직 남기지 않는다: 지금 표는 회사 하나 또는 찾기 회차
하나에만 줄을 달 수 있어 목록 내보내기를 적을 자리가 없다(#217 보고, PM 결정 필요).
"""

from collections.abc import Iterable
from dataclasses import dataclass, field

from geosan.rules.codes import SecurityGrade

ALLOWED_KINDS = frozenset(
    {
        "PUBLIC_TEXT",
        "EVIDENCE",
        "OPPORTUNITY_INFO",
        "QUESTION",
        "CAPABILITY_VALUE",
        "RECONTACT_INPUT",
        "INTERNAL_HISTORY",
        "CUSTOMER_RELATION",
    }
)
_REJECTED_GRADES = {SecurityGrade.FORBIDDEN.value, SecurityGrade.UNKNOWN.value}
_KNOWN_GRADES = {grade.value for grade in SecurityGrade}


@dataclass(frozen=True, slots=True)
class ExportItem:
    """내보낼 항목 하나. 종류와 등급은 그 자료를 가진 부품의 속성에서 온다(본문은 받지 않는다)."""

    ref_id: str
    kind: str | None
    security_grade: str | None


@dataclass(frozen=True, slots=True)
class ExportDecision:
    allowed: bool
    rejected_items: list[dict[str, str]] = field(default_factory=list)


def check_output_export(items: Iterable[ExportItem]) -> ExportDecision:
    """거부 사유가 있는 항목을 모두 모은다. 하나라도 있으면 allowed=False다."""
    rejected = []
    for item in items:
        if not item.kind:
            reason = "항목 종류가 없습니다."
        elif item.kind not in ALLOWED_KINDS:
            reason = "파일로 내보낼 수 없는 종류입니다."
        elif item.security_grade not in _KNOWN_GRADES or item.security_grade in _REJECTED_GRADES:
            reason = "보안 등급이 금지이거나 확인되지 않았습니다."
        else:
            continue
        rejected.append({"refId": item.ref_id, "reason": reason})
    return ExportDecision(allowed=not rejected, rejected_items=rejected)
