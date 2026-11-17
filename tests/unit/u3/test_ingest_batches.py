"""#317: 실제 임시 DB의 회차 예약·동시 요청·실패 되돌림. 찾기 실행은 하지 않는다."""

from concurrent.futures import ThreadPoolExecutor
from threading import Barrier

import pytest
from sqlalchemy import event, func, select
from sqlalchemy.exc import OperationalError

from geosan.api.ingest_batches import reserve_ingest_batch
from geosan.api.ingest_conditions import IngestRequest
from geosan.capability.models import Process
from geosan.config.errors import AppError, ForbiddenError, InputError
from geosan.opportunity.models import IngestBatch
from geosan.storage.base import utcnow
from geosan.storage.session import session_scope


@pytest.fixture
def batch_db(tmp_db):
    with session_scope() as session:
        session.add(
            Process(
                process_id="process-ingest-virtual",
                code="ANODIZING",
                name="가상 아노다이징",
                review_status="REVIEWED",
                dataset_kind="VIRTUAL_REVIEWED",
                is_virtual=True,
            )
        )
    return tmp_db


def request(**overrides):
    return IngestRequest.model_validate({"processCodes": ["ANODIZING"], **overrides})


def reserve(session, body=None, *, staff="park-lee"):
    return reserve_ingest_batch(session, body or request(), staff_key=staff)


def batches():
    with session_scope() as session:
        return list(session.scalars(select(IngestBatch).order_by(IngestBatch.started_at)))


def test_reservation_preserves_conditions_and_settings_without_starting_search(batch_db):
    """선택 조건을 저장하되 조사 완료로 꾸미지 않고 RUNNING·0건으로만 남긴다."""
    body = request(regions=["충남"], industries=["자동차 부품"])
    before = body.model_dump()
    with session_scope() as session:
        row = reserve(session, body)
        identifier = row.batch_id
        assert row.max_candidates is not None
    (saved,) = batches()
    assert saved.batch_id == identifier
    assert saved.source_id == body.source_id
    assert saved.requested_by == saved.created_by == "park-lee"
    assert saved.criteria == {
        "processCodes": ["ANODIZING"],
        "regions": ["충남"],
        "industries": ["자동차 부품"],
    }
    assert saved.dataset_kind == "VIRTUAL_REVIEWED" and saved.is_virtual
    assert saved.status == "RUNNING" and saved.finished_at is None
    assert saved.failure_reason is None and saved.rejudge is False
    assert saved.started_at.utcoffset().total_seconds() == 0
    assert (
        saved.scanned_count,
        saved.judged_count,
        saved.new_count,
        saved.research_done_count,
    ) == (0, 0, 0, 0)
    assert body.model_dump() == before


@pytest.mark.parametrize("staff", [None, "viewer", "unknown"])
def test_unavailable_staff_cannot_leave_a_running_batch(batch_db, staff):
    with pytest.raises(ForbiddenError), session_scope() as session:
        reserve(session, staff=staff)
    assert batches() == []


@pytest.mark.parametrize("overrides", [{"regions": ["설정 밖"]}, {"max": 999999}])
def test_invalid_conditions_leave_no_batch(batch_db, overrides):
    with pytest.raises(InputError), session_scope() as session:
        reserve(session, request(**overrides))
    assert batches() == []


def test_process_from_another_dataset_is_not_accepted(batch_db):
    with session_scope() as session:
        session.add(
            Process(
                process_id="process-ingest-brochure",
                code="ZINC_PLATING",
                name="가상 공정",
                review_status="REVIEWED",
                dataset_kind="BROCHURE",
                is_virtual=False,
            )
        )
    with pytest.raises(InputError), session_scope() as session:
        reserve(session, request(processCodes=["ZINC_PLATING"]))
    assert batches() == []


def test_running_batch_blocks_a_second_request_without_changing_the_first(batch_db):
    with session_scope() as session:
        first = reserve(session)
        identifier = first.batch_id
    with pytest.raises(AppError) as caught, session_scope() as session:
        reserve(session)
    assert caught.value.status == 409 and caught.value.kind == "INGEST_RUNNING"
    (saved,) = batches()
    assert saved.batch_id == identifier and saved.status == "RUNNING"


def test_running_batch_in_another_dataset_also_blocks_the_request(batch_db):
    with session_scope() as session:
        session.add(
            IngestBatch(
                batch_id="batch-other-dataset",
                source_id="kicox-factory-csv",
                requested_by="park-lee",
                status="RUNNING",
                started_at=utcnow(),
                dataset_kind="BROCHURE",
                is_virtual=False,
            )
        )
    with pytest.raises(AppError) as caught, session_scope() as session:
        reserve(session)
    assert caught.value.kind == "INGEST_RUNNING"
    assert len(batches()) == 1


@pytest.mark.parametrize("status", ["DONE", "FAILED"])
def test_finished_batch_is_preserved_and_allows_a_new_reservation(batch_db, status):
    with session_scope() as session:
        old = reserve(session)
        old.status, old.finished_at = status, utcnow()
    with session_scope() as session:
        new = reserve(session)
    saved = batches()
    assert len(saved) == 2 and saved[0].batch_id == old.batch_id
    assert saved[0].status == status and saved[1].batch_id == new.batch_id
    assert saved[1].status == "RUNNING"


def test_callers_rollback_removes_reservation_and_does_not_commit_early(batch_db):
    with pytest.raises(RuntimeError, match="요청 중단"), session_scope() as session:
        reserve(session)
        with session_scope() as reader:
            assert reader.scalar(select(func.count()).select_from(IngestBatch)) == 0
        raise RuntimeError("요청 중단")
    assert batches() == []
    with session_scope() as session:
        reserve(session)
    assert len(batches()) == 1


def test_database_failure_is_not_reported_as_a_running_or_successful_request(batch_db):
    def fail_insert(connection, cursor, statement, parameters, context, executemany):
        if statement.startswith("INSERT INTO opp_ingest_batch"):
            raise OperationalError(statement, parameters, RuntimeError("가상 저장 실패"))

    with pytest.raises(OperationalError), session_scope() as session:
        connection = session.connection()
        event.listen(connection, "before_cursor_execute", fail_insert)
        reserve(session)
    assert batches() == []


def test_two_simultaneous_requests_save_exactly_one_running_batch(batch_db):
    gate = Barrier(2)

    def try_reserving():
        gate.wait(timeout=10)
        try:
            with session_scope() as session:
                return reserve(session).batch_id
        except AppError as error:
            assert error.status == 409 and error.kind == "INGEST_RUNNING"
            return None

    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(lambda _: try_reserving(), range(2)))
    assert sum(identifier is not None for identifier in results) == 1
    (saved,) = batches()
    assert saved.batch_id in results and saved.status == "RUNNING"
