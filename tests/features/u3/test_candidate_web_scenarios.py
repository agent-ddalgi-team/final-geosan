"""#493 Given/When/Then: 외부 응답만 대체하고 실제 저장·한도 부품을 사용한다."""

from datetime import UTC, datetime, timedelta

from pytest_bdd import given, scenarios, then, when

from geosan.opportunity import candidate_web as web
from geosan.opportunity.candidate_web_results import can_reuse_search
from tests.fakes.web_candidate_search import BATCH, candidate, logs, prepare, response, settings

scenarios("u3/candidate_web.feature")


@given("웹 후보 검색을 켠 가상 회차가 있다", target_fixture="context")
def ready(tmp_db, app_settings_path, monkeypatch):
    prepare(app_settings_path)
    monkeypatch.setenv("OPENAI_API_KEY", "synthetic")
    context = {"calls": [], "response": response()}

    def send(body, key, timeout):
        context["calls"].append(body)
        return context["response"]

    monkeypatch.setattr(web, "_post_response", send)
    return context


@given("검색 제공처가 정상 후보와 차단 사이트와 출처 없는 후보를 돌려준다")
def responses(context):
    context["response"] = response(
        [candidate(), candidate(sourceUrl="https://jobkorea.co.kr/1"), candidate(sourceUrl=None)]
    )


@given("오늘 웹 후보 검색 허용 횟수가 없다")
def no_budget():
    settings(dailySearchLimit=0)


@when("고른 조건으로 후보 웹 검색 부품을 실행한다")
def search(context):
    context["result"] = web.search_candidates(BATCH)


@then("정상 후보 한 곳만 남고 제외 건수는 둘이다")
def selected(context):
    assert [r.company_name for r in context["result"].candidates] == ["가상볼트"]
    assert context["result"].dropped_count == 2


@then("실제 전송 기록에 회차와 사용량만 남는다")
def accounted(context):
    (row,) = logs()
    assert row.batch_id == BATCH and row.call_count == 1 and row.web_search_calls == 1
    assert "가상볼트" not in repr(row.__dict__)
    assert len(context["calls"]) == 1


@then("외부 요청 없이 하루 한도 사유를 반환한다")
def skipped(context):
    assert context["result"].skipped_reason == "DAILY_LIMIT" and not context["calls"]
    assert logs()[0].call_count == 0


@given("같은 조건으로 검색한 결과의 보관 기간이 15일이다", target_fixture="cache")
def cache():
    start = datetime(2026, 11, 9, tzinfo=UTC)
    return dict(
        stored_hash="same",
        current_hash="same",
        searched_at=start,
        expires_at=start + timedelta(days=15),
        cache_days=15,
    )


@when("보관 만료 직전과 만료 시각의 재사용 가능 여부를 확인한다", target_fixture="decisions")
def decisions(cache):
    return [
        can_reuse_search(**cache, now=cache["expires_at"] + timedelta(microseconds=delta))
        for delta in (-1, 0)
    ]


@then("만료 직전만 재사용할 수 있다")
def expiry(decisions):
    assert decisions == [True, False]
