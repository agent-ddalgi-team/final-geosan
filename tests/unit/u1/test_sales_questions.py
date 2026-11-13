"""#607: 영업 메모 대신 단계별 꼬리 질문 + 한 줄 메모. 세부 단계는 알아낸 사실로 정한다."""

import pytest
from sqlalchemy import func, select

from geosan.api.routes.records import LOST_REASON_LABELS
from geosan.records.models import Outcome, OutcomeAnswer
from geosan.rules.codes import LostReasonCode
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
    # #652: 공정·산업 확인은 "연결됨"을 지나도 답할 때까지 열려 있다(질문 파일 순서라 앞에 온다).
    assert step["openQuestions"][:4] == [
        "CONFIRM_PROCESS",
        "CONFIRM_INDUSTRY",
        "SWITCH_INTENT",
        "INTEREST_DRIVER",
    ]
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
        "closes": None,  # #643: 응답에 더한 두 칸(마무리 답이 아니면 null)
        "lostReason": None,
        "default": False,  # #691: 응답에 더한 칸(기본 보기가 아니면 false)
    }
    who = next(item for item in data["questions"] if item["questionId"] == "WHO_FIRST")
    assert [(item["answerId"], item["default"]) for item in who["answers"]] == [
        ("OURS", True),
        ("THEIRS", False),
    ]
    close = next(item for item in data["questions"] if item["questionId"] == "CLOSE_RESULT")
    assert close["showWhen"] == {"answers": {"NEXT_ACTION": ["END"]}}
    assert [(item["answerId"], item["closes"]) for item in close["answers"]] == [
        ("WON", "WON"),
        ("LOST", "LOST"),
        ("ON_HOLD", "ON_HOLD"),
    ]
    reason = next(item for item in data["questions"] if item["questionId"] == "LOST_REASON")
    assert [item["lostReason"] for item in reason["answers"]] == [
        code.value for code in LostReasonCode
    ]
    assert [item["label"] for item in reason["answers"]] == list(LOST_REASON_LABELS.values())
    tail = next(item for item in data["questions"] if item["questionId"] == "SWITCH_INTENT")
    assert tail["showWhen"] == {"answers": {"PLATING_NOW": ["OUTSOURCED"]}}


# --- #643: 꼬리 질문 답으로 보류·성사·거절까지 정해진다 ---------------------------------

END = ("NEXT_ACTION", "END")


def latest_row(opp_id):
    with session_scope() as session:
        row = session.scalar(
            select(Outcome).where(Outcome.opp_id == opp_id).order_by(Outcome.version.desc())
        )
        return row.status, row.lost_reason_code, row.reason


@pytest.mark.parametrize("closes", ["WON", "ON_HOLD"])
def test_closing_answer_saves_the_big_stage(records_env, closes):
    """Given 접촉 중 / When '끝 → 성사(보류)' 답 / Then 요청 단계 대신 그 값으로 저장된다."""
    client, opp_id = records_env
    body = contact(answers=[END, ("CLOSE_RESULT", closes)])
    assert save(client, opp_id, body)["status"] == closes
    assert latest_row(opp_id) == (closes, None, None)
    assert step_of(client, opp_id)["code"] is None
    assert card_of(client, opp_id)["records"]["outcome"]["status"] == closes


def test_closing_as_lost_saves_the_reason_code_from_the_answer(records_env):
    client, opp_id = records_env
    answers = [END, ("CLOSE_RESULT", "LOST"), ("LOST_REASON", "INCUMBENT_SUPPLIER")]
    assert save(client, opp_id, contact(answers=answers))["status"] == "LOST"
    assert latest_row(opp_id) == ("LOST", "INCUMBENT_SUPPLIER", None)
    known = [(item["questionId"], item["answer"]) for item in step_of(client, opp_id)["known"]]
    assert known[-3:] == [
        ("NEXT_ACTION", "끝"),
        ("CLOSE_RESULT", "거절"),
        ("LOST_REASON", "기존 거래처 유지"),
    ]


def test_closing_as_lost_without_a_reason_answer_writes_nothing(records_env):
    """요청의 lostReasonCode 칸으로 대신하지 않는다(답이 기준)."""
    client, opp_id = records_env
    body = contact(answers=[END, ("CLOSE_RESULT", "LOST")], status="LOST", lostReasonCode="PRICE")
    response = support.post(client, opp_id, "outcomes", body)
    assert response.status_code == 400, response.text
    assert [item["path"] for item in response.json()["error"]["fields"]] == ["lostReasonCode"]
    with session_scope() as session:
        assert session.scalar(select(func.count()).select_from(Outcome)) == 0
        assert session.scalar(select(func.count()).select_from(OutcomeAnswer)) == 0


def test_other_reason_needs_the_reason_text_as_before(records_env):
    client, opp_id = records_env
    answers = [END, ("CLOSE_RESULT", "LOST"), ("LOST_REASON", "OTHER")]
    missing = support.post(client, opp_id, "outcomes", contact(answers=answers))
    assert missing.status_code == 400, missing.text
    assert [item["path"] for item in missing.json()["error"]["fields"]] == ["reason"]
    body = contact(answers=answers, reason="내년 예산이 없다고 함(가상)")
    assert save(client, opp_id, body)["status"] == "LOST"
    assert latest_row(opp_id) == ("LOST", "OTHER", "내년 예산이 없다고 함(가상)")


def test_closing_answer_wins_over_a_lost_request_and_drops_its_reason(records_env):
    """Given 이미 거절(가격) / When 다시 접촉해 '끝 → 성사' / Then 성사, 거절 이유는 저장 안 함."""
    client, opp_id = records_env
    save(client, opp_id, {"status": "LOST", "lostReasonCode": "PRICE", "reason": "단가(가상)"})
    body = contact(
        status="LOST",
        lostReasonCode="PRICE",
        reason="단가(가상)",
        answers=[END, ("CLOSE_RESULT", "WON")],
    )
    assert save(client, opp_id, body)["status"] == "WON"
    assert latest_row(opp_id) == ("WON", None, None)


def test_declined_contact_takes_all_step_answers_only(records_env):
    client, opp_id = records_env
    answers = [END, ("CLOSE_RESULT", "LOST"), ("LOST_REASON", "NO_DEMAND")]
    body = contact(result="DECLINED", status="NOT_EXECUTED", answers=answers)
    assert save(client, opp_id, body)["status"] == "LOST"
    assert latest_row(opp_id)[:2] == ("LOST", "NO_DEMAND")
    other = contact(result="DECLINED", answers=[("INTEREST", "NONE"), ("NEXT_ACTION", "RECONTACT")])
    response = support.post(client, opp_id, "outcomes", other)
    assert response.status_code == 400, response.text
    assert [item["path"] for item in response.json()["error"]["fields"]] == ["answers[0]"]


def test_declined_contact_without_a_closing_answer_keeps_the_stage(records_env):
    """접촉 결과 '거절'만으로는 단계를 거절로 바꾸지 않는다(끝은 담당자가 고를 때만)."""
    client, opp_id = records_env
    body = contact(result="DECLINED", answers=[("NEXT_ACTION", "RECONTACT")])
    assert save(client, opp_id, body)["status"] == "IN_PROGRESS"
    assert step_of(client, opp_id)["code"] == "NOT_REACHED"


@pytest.mark.parametrize(
    ("answers", "path"),
    [
        ([("CLOSE_RESULT", "WON")], "answers[0]"),  # "끝"을 고르지 않음
        ([("NEXT_ACTION", "RECONTACT"), ("CLOSE_RESULT", "WON")], "answers[1]"),
        ([END, ("CLOSE_RESULT", "WON"), ("LOST_REASON", "PRICE")], "answers[2]"),
        ([("LOST_REASON", "PRICE")], "answers[0]"),
    ],
)
def test_closing_answers_need_the_answers_they_follow(records_env, answers, path):
    client, opp_id = records_env
    response = support.post(client, opp_id, "outcomes", contact(answers=answers))
    assert response.status_code == 400, response.text
    assert [item["path"] for item in response.json()["error"]["fields"]] == [path]
    with session_scope() as session:
        assert session.scalar(select(func.count()).select_from(Outcome)) == 0


def test_stage_requests_and_plain_contacts_work_as_before(records_env):
    """closes 답이 없으면 지금 동작 그대로: 직접 고른 단계, 앞으로만, 끝난 회사에 다시 접촉."""
    client, opp_id = records_env
    assert save(client, opp_id, contact(answers=[END]))["status"] == "IN_PROGRESS"
    lost = {"status": "LOST", "lostReasonCode": "LEAD_TIME"}
    assert save(client, opp_id, lost)["status"] == "LOST"
    again = contact(status="LOST", lostReasonCode="LEAD_TIME", answers=[("INTEREST", "LOW")])
    assert save(client, opp_id, again)["status"] == "LOST"
    assert latest_row(opp_id)[:2] == ("LOST", "LEAD_TIME")
    assert save(client, opp_id, {"status": "IN_PROGRESS"})["status"] == "IN_PROGRESS"
