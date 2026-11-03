"""U5 기록·검토사항 코드의 약속 값과 순서 (#211)."""

from geosan.rules.codes import (
    ActivityKind,
    ContactMethod,
    ContactResult,
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
    assert list(NoteKind) == ["MEMO", "RESEARCH"]
    assert list(ReviewItemKind) == ["QUESTION", "DATA_NOT_FOUND", "DATA_INSUFFICIENT"]
    assert list(ReviewItemSource) == ["AI", "CASE_FILE", "RULE"]
