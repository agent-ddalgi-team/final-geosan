"""검수 이력과 조회용 상태를 실제 SQLite에서 함께 검증한다 (#212)."""

from datetime import date
from pathlib import Path

import pytest
from sqlalchemy import select

from geosan.capability.importer import import_capability
from geosan.capability.models import (
    DeliveryRecord,
    FieldEvidence,
    Process,
    ProcessCapability,
    Qualification,
    QualificationScope,
)
from geosan.capability.review import transition_review
from geosan.config.errors import InputError
from geosan.rules.codes import ReviewStatus
from geosan.storage.session import session_scope

BROCHURE = Path(__file__).resolve().parents[2] / "data" / "capability-brochure.json"
REVIEW = dict(reviewer="가상 검수자", basis="가상 방문 확인", reviewed_at=date(2026, 10, 29))


def history(session, target):
    key = next(iter(target.__table__.primary_key.columns)).name
    return list(
        session.scalars(
            select(FieldEvidence)
            .where(
                FieldEvidence.target_table == target.__tablename__,
                FieldEvidence.target_id == getattr(target, key),
                FieldEvidence.target_field == "reviewStatus",
            )
            .order_by(FieldEvidence.data_version)
        )
    )


@pytest.mark.parametrize(
    "model", [Process, ProcessCapability, DeliveryRecord, Qualification, QualificationScope]
)
def test_review_and_reimport_keep_proof_then_allow_recheck(tmp_db, model):
    """Given 소개서 검수 대기 / When 확인·재투입·재확인 / Then 이력과 실제 상태가 일치한다."""
    import_capability(BROCHURE)
    with session_scope() as session:
        target = session.scalars(select(model).where(model.review_status == "PENDING")).first()
        assert target is not None
        original = history(session, target)[0]
        target_id = original.target_id
        transition_review(session, target, ReviewStatus.REVIEWED, **REVIEW)
        transition_review(session, target, ReviewStatus.REVIEWED, **REVIEW)
        first, confirmed = history(session, target)
        assert first.review_status == "PENDING" and first.data_version == 1
        assert confirmed.review_status == target.review_status == "REVIEWED"
        assert confirmed.value_snapshot == {**first.value_snapshot, "review_status": "REVIEWED"}

    result = import_capability(BROCHURE)
    assert result.warnings
    with session_scope() as session:
        target = session.get(model, target_id)
        assert target.review_status == "REVIEWED"
        transition_review(session, target, ReviewStatus.RECHECK, **REVIEW)
        rows = history(session, target)
        assert [row.data_version for row in rows] == [1, 2, 3, 4]
        assert [row.review_status for row in rows] == ["PENDING", "REVIEWED", "REVIEWED", "RECHECK"]
        assert all(
            (row.reviewer, row.reviewed_at, row.basis)
            == (REVIEW["reviewer"], REVIEW["reviewed_at"], REVIEW["basis"])
            for row in rows[1:]
        )
        assert target.review_status == "RECHECK"


def test_caller_failure_rolls_back_review(tmp_db):
    import_capability(BROCHURE)
    with pytest.raises(RuntimeError, match="후속 평가 실패"), session_scope() as session:
        process = session.scalars(select(Process)).first()
        process_id = process.process_id
        transition_review(session, process, ReviewStatus.REVIEWED, **REVIEW)
        raise RuntimeError("후속 평가 실패")
    with session_scope() as session:
        process = session.get(Process, process_id)
        assert process.review_status == "PENDING" and len(history(session, process)) == 1


@pytest.mark.parametrize(
    ("status", "overrides"),
    [
        (ReviewStatus.PENDING, {}),
        (ReviewStatus.RECHECK, {}),
        (ReviewStatus.REVIEWED, {"basis": " "}),
        (ReviewStatus.REVIEWED, {"reviewer": ""}),
    ],
)
def test_invalid_transition_keeps_original(tmp_db, status, overrides):
    import_capability(BROCHURE)
    with session_scope() as session:
        target = session.scalars(select(Process)).first()
        with pytest.raises(InputError):
            transition_review(session, target, status, **{**REVIEW, **overrides})
        assert target.review_status == "PENDING" and len(history(session, target)) == 1
