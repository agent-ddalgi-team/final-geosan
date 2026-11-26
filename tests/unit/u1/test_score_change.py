"""#942 되먹임 ①: 기록으로 다시 평가되면 상세에 "지난 평가와 달라진 것"이 보인다.

실제 임시 DB·실제 API로 본다. 외부 호출 없음. 가상 사례만 쓴다(거산 실제 사양 아님).
"""

import json

from geosan.api import score_change as score_change_module
from geosan.workflows.flow_evaluate import run_evaluation
from tests.unit.u1 import test_process_fix as process_fix
from tests.unit.u1.test_call_signals import QUOTE, call, call_env, detail  # noqa: F401

confirm_env = process_fix.confirm_env


def test_no_change_line_before_any_reevaluation(call_env):  # noqa: F811
    """Given 처음 평가만 된 회사 / When 상세를 연다 / Then 달라진 것이 없다(null)."""
    client, free, _ = call_env
    assert detail(client, free)["scoreChange"] is None


def test_call_answer_shows_what_changed_and_the_contact(call_env):  # noqa: F811
    """Given 공고가 없는 가상 회사 / When 통화에서 "견적 요청" 저장
    Then 점수·항목·그 통화가 보인다."""
    client, free, _ = call_env
    before = detail(client, free)
    call(client, free, QUOTE, memo="샘플 먼저 요청")
    after = detail(client, free)
    change = after["scoreChange"]
    assert change["sinceEvalId"] == before["evalId"]
    assert change["scoreBefore"] == before["scores"]["E"]
    assert change["scoreAfter"] == after["scores"]["E"] > change["scoreBefore"]
    assert change["classificationBefore"] == before["header"]["classificationCode"]
    assert change["ruleVersionChanged"] is False
    bid = next(row for row in change["items"] if row["itemCode"] == "SIG_BID")
    assert bid["after"] == 7 and bid["before"] != 7
    assert bid["label"] == "구매·외주 의향"
    assert bid["factJudged"] == "통화에서 확인(10/20) · 견적 요청"
    # 점수가 그대로인 항목은 넣지 않는다.
    assert all(row["before"] != row["after"] for row in change["items"])
    contact = next(row for row in change["records"] if row["kind"] == "CONTACT_ATTEMPT")
    assert contact["method"] == "CALL" and contact["attemptedAt"] == "2026-10-20"
    assert contact["summary"] == "견적 요청"
    # 영업 메모 원문은 이 줄에 실리지 않는다.
    assert "샘플" not in json.dumps(change, ensure_ascii=False)


def test_same_score_reevaluation_keeps_the_last_real_change(call_env):  # noqa: F811
    """Given 견적 요청으로 바뀐 회사 / When 같은 값으로 한 번 더 평가
    Then 그 앞의 변화가 그대로 보인다."""
    client, free, _ = call_env
    call(client, free, QUOTE)
    first = detail(client, free)
    assert run_evaluation(opp_ids=[free]).ok
    again = detail(client, free)
    assert again["evalId"] != first["evalId"]
    assert again["scoreChange"] == first["scoreChange"]


def test_walk_limit_stops_looking_back(call_env, monkeypatch):  # noqa: F811
    """Given 같은 점수의 재평가가 한도만큼 이어짐 / When 상세 / Then 더 거슬러 가지 않고 null."""
    client, free, _ = call_env
    call(client, free, QUOTE)
    assert run_evaluation(opp_ids=[free]).ok
    monkeypatch.setattr(score_change_module, "MAX_WALK", 1)
    assert detail(client, free)["scoreChange"] is None


def test_process_answer_in_the_same_call_shows_the_program_change_line(call_env):  # noqa: F811
    """Given 공고가 없는 가상 회사 / When 한 통화에서 "견적 요청" + 맡길 공정(아연도금)을 고름
    Then 그 사이 기록에 프로그램이 남긴 공정 줄과 그 통화가 함께 보인다
    (공정 고르기는 통화 줄의 보기 이름에서 뺀다)."""
    client, free, _ = call_env
    call(client, free, QUOTE, ("CONFIRM_PROCESS", "ZINC_PLATING"))
    records = detail(client, free)["scoreChange"]["records"]
    assert [row["kind"] for row in records] == ["CONTACT_ATTEMPT", "CHANGE"]
    assert records[0]["summary"] == "견적 요청"
    assert "아연도금" in records[1]["summary"]


def test_process_fix_without_score_change_shows_nothing(confirm_env):
    """Given 사례 파일 공정 회사 / When 공정을 고쳤는데 점수·분류·항목이 그대로
    Then 다시 평가는 됐어도 달라진 것은 null(공정 줄은 활동 이력에만)."""
    client, _, mixed = confirm_env
    assert process_fix.save(client, mixed, ["ZINC_PLATING"]).status_code == 200
    data = client.get(f"/api/v1/opportunities/{mixed}").json()["data"]
    assert data["previousEvalId"] is not None
    assert data["scoreChange"] is None
