"""#607: 영업 메모 대신 단계별 꼬리 질문 + 한 줄 메모. 세부 단계는 알아낸 사실로 정한다."""

import pytest
from sqlalchemy import func, select

from geosan.records.models import Outcome, OutcomeAnswer
from geosan.storage.session import session_scope
from tests.unit.u1 import test_sales_records as support

records_env = support.records_env


def contact(result="REACHED", answers=(), **extra):
    body = {
        "status": "IN_PROGRESS",
        "method": "CALL",
        "result": result,
        "attemptedAt": "2026-10-20",
        **extra,
    }
    if answers:
        body["answers"] = [{"questionId": q, "answerId": a} for q, a in answers]
    return body


def step_of(client, opp_id):
    return client.get(f"/api/v1/opportunities/{opp_id}").json()["data"]["records"]["salesStep"]


def card_of(client, opp_id):
    cards = client.get("/api/v1/opportunities").json()["data"]
    return next(row for row in cards if row["oppId"] == opp_id)


def save(client, opp_id, body):
    response = support.post(client, opp_id, "outcomes", body)
    assert response.status_code == 200, response.text
    return response.json()["data"]


def test_no_contact_has_no_step(records_env):
    client, opp_id = records_env
    assert step_of(client, opp_id) == {
        "code": None,
        "since": None,
        "overridden": False,
        "known": [],
        "openQuestions": [],
    }
    assert card_of(client, opp_id)["salesStep"] is None


def test_contacts_without_new_facts_stay_in_the_same_step(records_env):
    """Given 부재 두 번과 다른 부서 통화 / When 저장 / Then 단계는 그대로 '연결 전'."""
    client, opp_id = records_env
    save(client, opp_id, contact(result="ABSENT", attemptedAt="2026-10-15"))
    save(client, opp_id, contact(result="ABSENT", attemptedAt="2026-10-16"))
    save(client, opp_id, contact(answers=[("WHO_TALKED", "OTHER_DEPT")]))
    step = step_of(client, opp_id)
    assert (step["code"], step["since"]) == ("NOT_REACHED", "2026-10-15")
    assert "WHO_TALKED" not in step["openQuestions"]
    assert [item["answer"] for item in step["known"]] == ["다른 부서"]
    assert card_of(client, opp_id)["salesStep"] == "NOT_REACHED"


def test_answer_moves_the_step_forward_and_shows_the_tail_question(records_env):
    """Given 연결 / When '외주 줌'을 고름 / Then '수요 확인'이 되고 '바꿀 생각?' 꼬리가 열린다."""
    client, opp_id = records_env
    first = contact(attemptedAt="2026-10-18", answers=[("WHO_TALKED", "RIGHT_PERSON")])
    save(client, opp_id, first)
    assert step_of(client, opp_id)["code"] == "REACHED"
    assert "NEED_PROCESS" not in step_of(client, opp_id)["openQuestions"]
    save(
        client,
        opp_id,
        contact(answers=[("PLATING_NOW", "OUTSOURCED")]),
    )
    step = step_of(client, opp_id)
    assert (step["code"], step["since"], step["overridden"]) == (
        "DEMAND_CONFIRMED",
        "2026-10-20",
        False,
    )
    assert step["openQuestions"][:2] == ["SWITCH_INTENT", "INTEREST_DRIVER"]
    assert [item["questionId"] for item in step["known"]] == ["WHO_TALKED", "PLATING_NOW"]


def test_in_house_answer_opens_the_process_tail_only(records_env):
    client, opp_id = records_env
    save(client, opp_id, contact(answers=[("WHO_TALKED", "RIGHT_PERSON")]))
    save(client, opp_id, contact(answers=[("PLATING_NOW", "IN_HOUSE")]))
    step = step_of(client, opp_id)
    assert step["code"] == "REACHED"
    assert "NEED_PROCESS" in step["openQuestions"]


def test_big_stage_follows_the_step_forward(records_env):
    """Given 미접촉으로 보낸 접촉 / When 견적 요청 답 / Then 큰 단계가 접촉 → 견적·샘플."""
    client, opp_id = records_env
    assert save(client, opp_id, contact(status="NOT_EXECUTED"))["status"] == "IN_PROGRESS"
    body = contact(answers=[("QUOTE_REQUEST", "QUOTE")])
    assert save(client, opp_id, body)["status"] == "SAMPLE_OR_REGISTRATION_APPROVED"
    assert step_of(client, opp_id)["code"] == "MATERIAL_QUOTE"


@pytest.mark.parametrize("status", ["ON_HOLD", "WON", "LOST"])
def test_closed_stages_are_never_changed_and_hide_the_step(records_env, status):
    client, opp_id = records_env
    extra = {"lostReasonCode": "PRICE"} if status == "LOST" else {}
    body = contact(status=status, answers=[("QUOTE_REQUEST", "QUOTE")], **extra)
    assert save(client, opp_id, body)["status"] == status
    step = step_of(client, opp_id)
    assert step["code"] is None and step["openQuestions"] == []
    assert [item["answerId"] for item in step["known"]] == ["QUOTE"]


def test_step_override_goes_back_and_new_facts_move_forward_again(records_env):
    client, opp_id = records_env
    save(client, opp_id, contact(answers=[("PLATING_NOW", "OUTSOURCED")]))
    save(client, opp_id, {"status": "IN_PROGRESS", "stepOverride": "REACHED"})
    step = step_of(client, opp_id)
    assert (step["code"], step["overridden"]) == ("REACHED", True)
    save(client, opp_id, contact(answers=[("QUOTE_REQUEST", "MATERIAL")]))
    step = step_of(client, opp_id)
    assert (step["code"], step["overridden"]) == ("MATERIAL_QUOTE", False)


def test_latest_answer_wins_and_every_answer_is_kept(records_env):
    client, opp_id = records_env
    save(client, opp_id, contact(answers=[("INTEREST", "LOW")]))
    save(client, opp_id, contact(answers=[("INTEREST", "HIGH")]))
    known = step_of(client, opp_id)["known"]
    assert [(item["questionId"], item["answer"]) for item in known] == [("INTEREST", "높음")]
    with session_scope() as session:
        assert session.scalar(select(func.count()).select_from(OutcomeAnswer)) == 2


@pytest.mark.parametrize(
    "body",
    [
        contact(result="ABSENT", answers=[("INTEREST", "HIGH")]),
        {"status": "IN_PROGRESS", "answers": [{"questionId": "INTEREST", "answerId": "HIGH"}]},
    ],
)
def test_answers_need_a_reached_contact(records_env, body):
    client, opp_id = records_env
    response = support.post(client, opp_id, "outcomes", body)
    assert response.status_code == 400, response.text
    assert response.json()["error"]["fields"][0]["path"] == "answers"
    with session_scope() as session:
        assert session.scalar(select(func.count()).select_from(Outcome)) == 0


@pytest.mark.parametrize(
    "answers",
    [
        [("NOPE", "HIGH")],
        [("INTEREST", "NOPE")],
        [("INTEREST", "HIGH"), ("INTEREST", "LOW")],
    ],
)
def test_unknown_or_repeated_answers_are_rejected(records_env, answers):
    client, opp_id = records_env
    response = support.post(client, opp_id, "outcomes", contact(answers=answers))
    assert response.status_code == 400, response.text
    paths = [item["path"] for item in response.json()["error"]["fields"]]
    assert paths == [f"answers[{len(answers) - 1}]"]
    with session_scope() as session:
        assert session.scalar(select(func.count()).select_from(OutcomeAnswer)) == 0


def test_one_line_memo_has_a_length_limit_and_contact_check(records_env):
    client, opp_id = records_env
    save(client, opp_id, contact(memo="다음 달 새 라인이 들어온다고 함"))
    too_long = support.post(client, opp_id, "outcomes", contact(memo="가" * 101))
    assert too_long.status_code == 400
    assert too_long.json()["error"]["fields"][0]["path"] == "memo"
    phone = support.post(client, opp_id, "outcomes", contact(memo="010-1234-5678로 연락"))
    assert phone.status_code == 400


def test_old_requests_without_answers_still_work(records_env):
    client, opp_id = records_env
    assert save(client, opp_id, {"status": "ON_HOLD"})["status"] == "ON_HOLD"
    assert save(client, opp_id, contact())["status"] == "IN_PROGRESS"


def test_sales_questions_route_returns_the_file(records_env):
    client, _ = records_env
    response = client.get("/api/v1/sales-questions")
    assert response.status_code == 200, response.text
    data = response.json()["data"]
    assert [step["code"] for step in data["steps"]] == [
        "NOT_REACHED",
        "REACHED",
        "DEMAND_CONFIRMED",
        "MATERIAL_QUOTE",
        "VISIT_SAMPLE",
    ]
    plating = next(item for item in data["questions"] if item["questionId"] == "PLATING_NOW")
    assert plating["answers"][1] == {
        "answerId": "OUTSOURCED",
        "label": "외주 줌",
        "reaches": "DEMAND_CONFIRMED",
    }
    tail = next(item for item in data["questions"] if item["questionId"] == "SWITCH_INTENT")
    assert tail["showWhen"] == {"answers": {"PLATING_NOW": ["OUTSOURCED"]}}
