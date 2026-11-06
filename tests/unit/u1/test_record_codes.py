"""U5 기록·검토사항 코드의 약속 값과 순서 (#211)."""

import pytest

from geosan.api.schemas import ReviewItem
from geosan.rules.codes import (
    ActivityKind,
    ContactMethod,
    ContactResult,
    LostReasonCode,
    NoteKind,
    OutcomeStatus,
    ReviewItemKind,
    ReviewItemSource,
)


def test_record_codes_match_the_published_contract():
    assert list(OutcomeStatus) == [
        "NOT_EXECUTED",
        "INTERESTED",
        "IN_PROGRESS",
        "SAMPLE_OR_REGISTRATION_APPROVED",
        "ON_HOLD",
        "WON",
        "LOST",
    ]
    assert list(ContactMethod) == ["CALL", "EMAIL", "VISIT"]
    assert list(ContactResult) == ["REACHED", "ABSENT", "DECLINED"]
    assert list(LostReasonCode) == [
        "PRICE",
        "LEAD_TIME",
        "INCUMBENT_SUPPLIER",
        "NO_DEMAND",
        "QUALITY_CERT",
        "OTHER",
    ]
    assert list(ActivityKind) == [
        "CLASSIFICATION",
        "OPINION",
        "BOOKMARK",
        "APPROVAL",
        "CONTACT_ATTEMPT",
        "REPLY",
        "OUTCOME",
        "EVIDENCE_GRADE_CONFIRMED",
        "NOTE",
    ]
    assert list(NoteKind) == ["MEMO", "RESEARCH", "REPLY"]
    # 앞의 세 값은 처음 약속 그대로이고, 네 번째는 약속 요약 C1에 더해진 종류다
    # (표면처리를 직접 하는 회사 표시 #319, 2026-11-06 PM 결정, #359).
    assert list(ReviewItemKind) == [
        "QUESTION",
        "DATA_NOT_FOUND",
        "DATA_INSUFFICIENT",
        "OWN_PLATING_LINE_SUSPECTED",
    ]
    assert list(ReviewItemSource) == ["AI", "CASE_FILE", "RULE"]


@pytest.mark.parametrize("source", ["AI", "RULE"])
def test_review_item_accepts_the_own_plating_kind(source: str) -> None:
    """Given 표면처리 확인 줄 / When 검토사항 한 줄로 만듦 / Then 약속한 이름 그대로 나간다(#359).

    출처는 약속 요약대로 AI 또는 규칙이다. 줄을 실제로 만드는 일과 줄 번호 형식은
    이 검사 범위가 아니다(아래 번호는 검사용 임시 값).
    """
    item = ReviewItem(
        item_id="sample-item",
        kind="OWN_PLATING_LINE_SUSPECTED",
        source=source,
        text="표면처리를 직접 하는 회사일 수 있음",
    )
    body = item.model_dump(by_alias=True, mode="json")
    assert (body["kind"], body["source"]) == ("OWN_PLATING_LINE_SUSPECTED", source)
    assert body["checked"] is False


def test_review_item_still_rejects_unknown_kinds() -> None:
    """Given 약속에 없는 종류 / When 검토사항 한 줄로 만듦 / Then 받지 않는다."""
    with pytest.raises(ValueError):
        ReviewItem(item_id="X", kind="SOMETHING_ELSE", source="AI", text="가상 줄")
