from fastapi.testclient import TestClient
from pytest_bdd import given, scenarios, then, when

from geosan.api.app import create_app
from geosan.workflows import flow_evaluate, flow_extract
from tests.unit.u1 import test_partial_ranking as support
from tests.unit.u2 import test_extraction as extraction_support

ranking_env = support.ranking_env
search_env = support.search_env
extract_env = support.extract_env

scenarios("u4/partial_ranking.feature")


@given("신규 가상 회사 세 곳이 전체 평가되어 있다", target_fixture="population")
def new_companies(ranking_env):
    client, opp_ids = ranking_env
    order = [row["oppId"] for row in support.cards(client)]
    return client, order, support.current_runs(opp_ids)


@given("홈페이지를 조사할 가상 회사 세 곳이 전체 평가되어 있다", target_fixture="population")
def research_companies(extract_env, tmp_path):
    case, _ = extract_env
    opp_ids = [case.opp_id] + [support.add_case(tmp_path, f"scenario-{i}") for i in range(2)]
    assert flow_evaluate.run_evaluation().ok
    with TestClient(create_app()) as client:
        order = [row["oppId"] for row in support.cards(client)]
        yield client, order, support.current_runs(opp_ids)


@when("첫 회사의 거래 관계를 거래 중으로 저장한다", target_fixture="updated")
def existing_customer(population):
    client, order, _ = population
    target, _ = support.move_first_to_existing(client)
    return target, order[1:] + [target]


@when("마지막 회사의 홈페이지를 가짜 외부 응답으로 조사하고 재평가한다", target_fixture="updated")
def research_customer(population, extract_env):
    _, order, _ = population
    target = order[-1]
    result = flow_extract.run_extract(target, extraction_support.URL)
    assert result.ok and result.affected_opp_ids == [target]
    assert len(result.new_eval_ids) == 1 and extract_env[1].call_count == 1
    return target, order


@then("그 회사는 마지막에 보이고 전체 순위는 끊기지 않는다")
def continuous_ranks(population, updated):
    client, _, _ = population
    target, expected = updated
    support.assert_list_ranks(client, expected)
    assert expected[-1] == target


@then("다른 회사의 점수와 평가 번호는 그대로다")
def unchanged_peers(population, updated):
    _, order, before = population
    target, _ = updated
    after = support.current_runs(order)
    assert before[target]["eval_id"] != after[target]["eval_id"]
    for opp_id in order:
        if opp_id != target:
            assert {k: v for k, v in before[opp_id].items() if k != "original_rank"} == {
                k: v for k, v in after[opp_id].items() if k != "original_rank"
            }
