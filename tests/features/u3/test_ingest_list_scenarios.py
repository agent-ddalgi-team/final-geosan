"""실제 API·임시 DB로 수집 회차 조회 흐름을 확인한다. 외부 수집은 실행하지 않는다."""

from pytest_bdd import given, scenarios, then, when

from tests.unit.u3 import test_ingest_list_api as support

api_env = support.api_env

scenarios("u3/ingest_list.feature")


@given("기존 평가와 실제 임시 DB를 연결한 목록 API가 있다", target_fixture="context")
def ready(api_env):
    client, _, _ = api_env
    return {"client": client, "original": support.listed(client)["data"][0]}


@given("마지막 수집에서 적합도가 다른 점수 전 회사 두 곳이 들어왔다")
def candidates(context, tmp_path):
    support.save_batch(new_count=2, scanned_count=10, judged_count=10, picked_count=2)
    medium = support.add_candidate(tmp_path, "medium", fit="MEDIUM")
    high = support.add_candidate(tmp_path, "high")
    context["expected"] = [high, medium]


@when("담당자가 전체 목록을 조회하고 이번 수집만 골라 본다")
def query(context):
    context["all"] = support.listed(context["client"])
    context["latest"] = support.listed(context["client"], batch="latest")


@then("전체 목록의 기존 회사 점수와 순위는 유지된다")
def original_preserved(context):
    first = context["all"]["data"][0]
    for key in ("oppId", "evalId", "rank", "scoreS", "scoreDisplay"):
        assert first[key] == context["original"][key]


@then("이번 수집에는 새 회사만 적합도 순으로 나오고 진행 건수가 보인다")
def latest_candidates(context):
    body = context["latest"]
    assert [row["oppId"] for row in body["data"]] == context["expected"]
    assert all(row["scoreState"] == "NONE" and row["isNewInLatestBatch"] for row in body["data"])
    assert body["meta"]["latestIngest"]["scannedCount"] == 10
    assert body["meta"]["latestIngest"]["pickedCount"] == 2
