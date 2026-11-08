"""#437 BDD: 가상 HTTP 응답과 실제 임시 SQLite. 운영 DB·AI는 사용하지 않는다."""

from pytest_bdd import given, scenarios, then, when
from sqlalchemy import select

from geosan.opportunity.complex_collection import collect_complex_rows
from geosan.opportunity.complex_store import store_complex_rows
from geosan.opportunity.models import IngestBatch
from geosan.opportunity.source_models import ComplexFetch, SourceFactoryRow
from geosan.storage.base import utcnow
from geosan.storage.session import session_scope
from tests.unit.u3.conftest import ingest_batch as ingest_batch
from tests.unit.u3.test_complex_source import ROWS, configure, responses, xml
from tests.unit.u3.test_complex_source import registry as registry

scenarios("u3/complex_store.feature")


def records(model):
    with session_scope() as session:
        return session.scalars(select(model)).all()


def run(context):
    result = store_complex_rows(context["batch"], collect_complex_rows(context["batch"], ()))
    context.setdefault("results", []).append(result)
    return result


@given("충남과 대전 공개 공장을 돌려주는 가상 제공처가 있다", target_fixture="context")
def regions(registry, monkeypatch):
    configure(extraNames=["가상단지"])
    body = xml([ROWS[0], ("대전공장", "대전 유성구 가상길 1", "D1")])
    return {"batch": registry, "calls": responses(monkeypatch, body, body)}


@given("첫 두 행 뒤에 하루 한도 오류가 생기는 가상 제공처가 있다", target_fixture="context")
def partial(registry, monkeypatch):
    configure(extraNames=["가상단지"])
    calls = responses(
        monkeypatch, xml(ROWS[:2], total=3), xml([], page=2, code="22"), xml(ROWS[:2])
    )
    return {"batch": registry, "calls": calls}


@given("공장 없음으로 성공하는 가상 제공처가 있다", target_fixture="context")
def empty(registry, monkeypatch):
    configure(extraNames=["가상단지"])
    return {"batch": registry, "calls": responses(monkeypatch, xml([]))}


@when("충남을 골라 조회하고 저장한 뒤 대전을 골라 다시 실행한다")
def change_region(context):
    run(context)
    context["expiry"] = records(ComplexFetch)[0].expires_at
    with session_scope() as session:
        session.get(IngestBatch, context["batch"]).criteria = {"regions": ["대전"]}
    run(context)


@when("조회를 저장한 뒤 보관 기간이 끝나고 다시 실행한다")
def expire(context):
    run(context)
    with session_scope() as session:
        session.scalars(select(ComplexFetch)).one().expires_at = utcnow()
    run(context)


@when("부분 조회를 저장한 뒤 다시 실행한다")
@when("같은 단지를 두 번 조회하고 저장한다")
def twice(context):
    run(context)
    run(context)


@then("외부 요청은 한 번이고 두 지역 원문은 모두 보존된다")
def all_regions(context):
    assert len(context["calls"]) == 1
    assert {row.region for row in records(SourceFactoryRow)} == {"충남", "대전"}
    assert records(ComplexFetch)[0].row_count == 2


@then("두 번째 결과에는 대전 공장만 있고 만료 시각은 늘어나지 않는다")
def selected(context):
    result = context["results"][-1]
    with session_scope() as session:
        assert [session.get(SourceFactoryRow, value).region for value in result.row_ids] == ["대전"]
    assert result.reused_count == 1 and result.fetched_count == 0
    assert records(ComplexFetch)[0].expires_at == context["expiry"]


@then("외부 요청이 두 번이고 새 성공 조회 기록이 남는다")
def renewed(context):
    assert len(context["calls"]) == 2
    assert [row.status for row in records(ComplexFetch)] == ["OK", "OK"]
    assert context["results"][-1].fetched_count == 1


@then("받은 두 행은 보존되고 실패 기록 뒤에 새 성공 기록이 남는다")
def incomplete(context):
    assert len(context["calls"]) == 3 and len(records(SourceFactoryRow)) == 2
    assert [row.status for row in records(ComplexFetch)] == ["FAILED", "OK"]
    assert context["results"][0].skipped_reason == "DAILY_LIMIT"
    assert context["results"][-1].skipped_reason is None


@then("외부 요청은 한 번이고 성공한 빈 조회 기록 하나만 남는다")
def no_rows(context):
    assert len(context["calls"]) == 1 and records(SourceFactoryRow) == []
    (fetch,) = records(ComplexFetch)
    assert fetch.status == "OK" and fetch.row_count == 0 and fetch.row_ids == []
    assert all(result.skipped_reason is None for result in context["results"])
