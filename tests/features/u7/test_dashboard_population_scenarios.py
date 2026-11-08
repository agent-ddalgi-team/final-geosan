"""#465: 실제 임시 DB·API로 관심 기업 집계 시나리오를 확인한다. 외부 AI 호출 없음."""

from pytest_bdd import given, scenarios, then, when

from geosan.evaluation.ledger import latest_full_batch
from geosan.storage.session import session_scope
from tests.unit.u7 import test_dashboard_population as support
from tests.unit.u7.test_bookmark import give_opinion, set_bookmark
from tests.unit.u7.test_dashboard import ZERO_COUNTS

candidate_env = support.candidate_env
scenarios("u7/dashboard_population.feature")


@given("부분 평가의 평가 전 기록만 있는 가상 후보가 있다", target_fixture="candidate")
def ready(candidate_env):
    return candidate_env


@when("그 후보를 관심으로 켠다")
def bookmark(candidate):
    client, opp_id = candidate
    assert set_bookmark(client, opp_id, True).status_code == 200


@then("전체 평가 없이 관심 기업 1곳과 의견 미선택 1곳으로 센다")
def counted_without_full_evaluation(candidate):
    client, _ = candidate
    assert support.dashboard_body(client)["data"]["counts"] == {
        **ZERO_COUNTS,
        "BOOKMARKED": 1,
        "NO_OPINION": 1,
    }
    with session_scope() as session:
        assert latest_full_batch(session, dataset_kind="VIRTUAL_REVIEWED") is None


@when("그 후보의 의견을 추가 확인 필요로 저장한다")
def opinion(candidate):
    client, opp_id = candidate
    give_opinion(client, opp_id, "NEED_CHECK")


@then("관심 기업 1곳과 추가 확인 필요 1곳으로 센다")
def opinion_count(candidate):
    client, _ = candidate
    assert support.dashboard_body(client)["data"]["counts"] == {
        **ZERO_COUNTS,
        "BOOKMARKED": 1,
        "NEED_CHECK": 1,
    }


@given("프로그램이 그 후보에 가상 일정과 자료 조사 이력을 남겼다")
def records(candidate):
    _, opp_id = candidate
    support.add_program_records(opp_id)


@then("관심이 꺼져 있는 동안 건수와 일정 및 최근 기록이 비어 있다")
def empty_without_bookmark(candidate):
    client, _ = candidate
    support.assert_empty(support.dashboard_body(client))


@then("후보의 일정과 최근 기록이 함께 반영되고 메모 본문은 나오지 않는다")
def same_population(candidate):
    client, opp_id = candidate
    body = support.dashboard_body(client)
    assert body["data"]["counts"]["BOOKMARKED"] == 1
    assert body["data"]["counts"]["SCHEDULE_DUE"] == 1
    assert [row["oppId"] for row in body["data"]["schedule"]] == [opp_id]
    assert len(body["data"]["recentActivity"]) == 2
    assert {row["oppId"] for row in body["data"]["recentActivity"]} == {opp_id}
    assert "대시보드에 보내지 않을 가상 메모" not in str(body)
