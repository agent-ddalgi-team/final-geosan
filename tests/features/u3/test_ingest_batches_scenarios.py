"""#317 회차 예약의 실제 SQLite 검사. HTTP·AI·후보 수집 실행 검사는 아니다."""

from pytest_bdd import given, scenarios, then, when

from geosan.config.errors import AppError
from geosan.storage.session import session_scope
from tests.unit.u3 import test_ingest_batches as support

batch_db = support.batch_db

scenarios("u3/ingest_batches.feature")


@given("찾기 회차가 없고 현재 묶음에 아노다이징 공정이 있다")
def prepared(batch_db):
    assert support.batches() == []


@when("담당자가 아노다이징 찾기 회차를 예약한다", target_fixture="batch_id")
def reserved():
    with session_scope() as session:
        return support.reserve(session).batch_id


@then("선택 조건과 담당자가 저장되고 회차는 실행 중으로 남는다")
def stored(batch_id):
    (saved,) = support.batches()
    assert saved.batch_id == batch_id
    assert saved.criteria["processCodes"] == ["ANODIZING"]
    assert saved.requested_by == "park-lee"
    assert saved.status == "RUNNING" and saved.finished_at is None
    assert saved.scanned_count == saved.judged_count == saved.new_count == 0


@when("담당자가 같은 조건으로 다시 회차를 예약한다", target_fixture="failure")
def duplicate():
    try:
        with session_scope() as session:
            support.reserve(session)
    except AppError as error:
        return error


@then("지금 가져오는 중이라는 오류와 함께 첫 회차 하나만 남는다")
def prevented_duplicate(batch_id, failure):
    assert failure.status == 409 and failure.kind == "INGEST_RUNNING"
    (saved,) = support.batches()
    assert saved.batch_id == batch_id


@when("보기 전용 사용자가 찾기 회차를 예약한다", target_fixture="failure")
def viewer():
    try:
        with session_scope() as session:
            support.reserve(session, staff="viewer")
    except AppError as error:
        return error


@then("권한 오류가 나고 회차는 저장되지 않는다")
def denied(failure):
    assert failure.status == 403
    assert support.batches() == []


@when("담당자가 회차를 예약한 트랜잭션이 실패한다", target_fixture="failure")
def rolled_back():
    try:
        with session_scope() as session:
            support.reserve(session)
            raise RuntimeError("가상 요청 실패")
    except RuntimeError as error:
        return error


@then("실패가 그대로 전달되고 회차는 저장되지 않는다")
def preserved_failure(failure):
    assert str(failure) == "가상 요청 실패"
    assert support.batches() == []
