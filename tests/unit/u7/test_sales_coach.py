"""#742: 영업 코치(메모 [보내기] → 꼬리 질문 채우기·빠진 필수 질문·피드백). 외부 AI는 가짜 응답이다.

실제 임시 DB·실제 API로 본다. 실제 AI는 부르지 않는다(가짜 어댑터가 받은 글을 붙잡아 무엇이
나갔는지 본다). 가상 사례만 쓴다(거산 실제 사양 아님). 메모의 사람 이름·전화는 모두 지어낸 것이다.
"""

import json
from datetime import timedelta

import pytest
from sqlalchemy import select

from geosan.api.coach import missing_required, step_after
from geosan.config.sales_questions import SalesQuestions, check_sales_questions_file
from geosan.evidence.transfer import KST
from geosan.opportunity.models import Customer, Opportunity
from geosan.records.models import Note, OutcomeAnswer
from geosan.rules.codes import SalesStep
from geosan.storage.base import utcnow
from geosan.storage.session import session_scope
from tests.conftest import EXAMPLES_DIR
from tests.unit.u7 import test_sales_assistant as support
from tests.unit.u7.test_peers import note

dashboard_env = support.dashboard_env
assistant_env = support.assistant_env
record = support.record
STAFF = support.STAFF

# 이전 접촉(10/21): 이름이 직함과 함께 나와 회사 단위로 알아 둔다. 이번 메모에는 성만 나온다.
FIRST_MEMO = "생산관리팀 김철수 과장 통화. 아연도금 외주 주고있다고"
OLD_NOTE = "홍길동 대리가 납기 걱정을 함 010-0000-0000"
MEMO = "김철수 과장 통화. 소개서 받아봤다고 함. 견적 요청함. 금요일에 다시 전화"
PLANTED = ("김철수", "철수", "홍길동", "010-0000-0000", "park-lee")


def day(offset):
    return (utcnow().astimezone(KST).date() + timedelta(days=offset)).isoformat()


def reading(
    answers=(), action=None, date=None, feedback=(), summary="견적 요청을 받음", next_call=()
):
    return json.dumps(
        {
            "answers": [
                {"questionId": qid, "answerIds": list(ids), "quote": quote}
                for qid, ids, quote in answers
            ],
            "nextSchedule": {"actionId": action, "date": date},
            "feedback": list(feedback),
            "nextCall": list(next_call),
            "summary": summary,
        },
        ensure_ascii=False,
    )


def coach(client, opp_id, memo=MEMO, headers=STAFF, **extra):
    return client.post(
        f"/api/v1/opportunities/{opp_id}/assistant/coach",
        json={"memo": memo, "method": "CALL", **extra},
        headers=headers,
    )


def seed_first_contact(client, opp_id):
    """10/21 통화: 담당 부서와 연결, 외주를 준다(→ 수요 확인). 따로 적은 메모 하나."""
    record(
        client,
        opp_id,
        {
            "status": "IN_PROGRESS",
            "method": "CALL",
            "result": "REACHED",
            "attemptedAt": "2026-10-21",
            "memo": FIRST_MEMO,
            "answers": [
                {"questionId": "WHO_TALKED", "answerId": "RIGHT_PERSON"},
                {"questionId": "PLATING_NOW", "answerId": "OUTSOURCED"},
            ],
        },
    )
    note(client, opp_id, OLD_NOTE)


FULL_READING = reading(
    answers=[
        ("QUOTE_REQUEST", ["QUOTE"], "견적 요청함"),
        ("NEXT_ACTION", ["RECONTACT"], "금요일에 다시 전화"),
        # 버릴 것: 사람이 고르는 질문, 없는 질문, 하나만 고르는 질문에 둘, 보기 밖, 이전과 같은 답
        ("INTEREST", ["HIGH"], "견적 요청함"),
        ("NO_SUCH_QUESTION", ["X"], "견적 요청함"),
        ("REPLY", ["CAME", "NOT_YET"], "소개서 받아봤다고 함"),
        ("SENT_ITEM", ["FAX"], "소개서 받아봤다고 함"),
        ("PLATING_NOW", ["OUTSOURCED"], "소개서 받아봤다고 함"),
        # 근거 구절이 메모에 없는 답도 버린다.
        ("VISIT_OR_SAMPLE", ["SAMPLE"], "샘플 10개 보내 달라고 함"),
        # 사람이 확정하는 질문은 제안으로만 온다.
        ("CONFIRM_PROCESS", ["ZINC_PLATING"], "견적 요청함"),
    ],
    action="RECONTACT",
    date=day(3),
    feedback=[
        "10/21 메모의 납기 걱정에 아직 답을 못 줬어요.",
        "단가를 10% 낮춰 제안해 보세요.",
        "[이름] 과장에게 010-1234-5678로 다시 걸어 보세요.",
        "납기를 다음 주로 확정해 드리세요.",
    ],
    # #750: 다음 통화에 물어볼 것. 연락처·금액이 든 줄은 버리고 3줄까지만 받는다.
    next_call=[
        "견적에 넣을 수량과 도금 두께를 물어보세요.",
        "김철수 과장에게 010-1234-5678로 확인하세요.",
        "단가를 10% 낮춰 드릴 수 있다고 말하세요.",
        "소개서에서 궁금한 공정이 있는지 물어보세요.",
        "방문 날짜를 정할 수 있는지 물어보세요.",
        "샘플이 필요한지 물어보세요.",
    ],
    summary="김철수 과장이 견적을 요청함",
)


@pytest.fixture
def coach_env(assistant_env):
    client, opp_ids, fake = assistant_env
    seed_first_contact(client, opp_ids[0])
    fake.answer = FULL_READING
    return client, opp_ids, fake


# ---------------------------------------------------------------------------
# 보내는 글: 지운 사본과 정해진 기록만
# ---------------------------------------------------------------------------


def test_only_scrubbed_memo_and_company_record_go_out(coach_env):
    """Given 이름·전화가 든 이전 기록 / When 코치 / Then 지운 사본과 정해진 기록만 나간다."""
    client, opp_ids, fake = coach_env
    counts = support.row_counts()
    response = coach(client, opp_ids[0])
    assert response.status_code == 200, response.text
    (payload,) = fake.payloads
    sent = fake.sent
    assert payload["input"].startswith("[이번 메모]\n[이름] 과장 통화. 소개서 받아봤다고 함.")
    for planted in PLANTED:
        assert planted not in sent, planted
    # 이 회사의 기록: 이전 꼬리 질문 답(날짜·질문·보기 이름), 이전 메모(지운 사본), 지금 세부 단계.
    assert "[이 회사의 지금 값]" in sent
    assert "10/21 · 지금 도금은 어떻게 하나요? = 외주 줌" in sent
    assert "10/21: 생산관리팀 [이름] 과장 통화." in sent
    assert "납기 걱정을 함 [연락처 제거]" in sent
    assert "지금 세부 단계: 수요 확인(DEMAND_CONFIRMED)" in sent
    # 주소·대표번호는 싣지 않는다.
    with session_scope() as session:
        customer = session.get(Customer, session.get(Opportunity, opp_ids[0]).customer_id)
        address, phone = customer.address, customer.main_phone
    for value in (address, phone):
        if value:
            assert value not in payload["input"]
    # 사람이 고르는 질문은 지시문 질문 목록에 없다. 정해진 모양으로만 받는다.
    assert "- QUOTE_REQUEST | 자료나 견적 요청이 있었나요?" in payload["instructions"]
    assert "- INTEREST |" not in payload["instructions"]
    assert "- SWITCH_INTENT |" not in payload["instructions"]
    assert "'모름'을 고른다" in payload["instructions"]
    assert payload["text"]["format"]["name"] == "sales_coach_reading"
    assert payload["store"] is False
    # 읽기 전용: 전송 기록(SALES_COACH) 1행만 늘고 기록은 그대로다.
    assert support.logs()[-1] == (opp_ids[0], "SALES_COACH", "ALLOWED", 1)
    assert support.row_counts() == counts


def test_answer_is_checked_and_missing_required_is_computed_by_rule(coach_env):
    """Given 보기 밖·여러 개·사람 질문이 섞인 답 / When 코치 / Then 맞는 것만, 필수는 규칙."""
    client, opp_ids, _fake = coach_env
    data = coach(client, opp_ids[0]).json()["data"]
    assert data["answers"] == [
        {
            "questionId": "QUOTE_REQUEST",
            "answerIds": ["QUOTE"],
            "quote": "견적 요청함",
            "fill": "AI",
        },
        {
            "questionId": "NEXT_ACTION",
            "answerIds": ["RECONTACT"],
            "quote": "금요일에 다시 전화",
            "fill": "AI",
        },
        {
            "questionId": "CONFIRM_PROCESS",
            "answerIds": ["ZINC_PLATING"],
            "quote": "견적 요청함",
            "fill": "SUGGEST",
        },
    ]
    assert data["nextSchedule"] == {"actionId": "RECONTACT", "date": day(3)}
    # 수요 확인 → 자료·견적. 빠진 필수 질문은 통화 전 단계(수요 확인)와 접촉마다 묻는 것만이다
    # (바뀜 #742 PM 결정: 이번 메모로 넘어간 단계의 "답이 왔나"·"방문·샘플"은 묻지 않는다).
    assert (data["stepBefore"], data["stepAfter"]) == ("DEMAND_CONFIRMED", "MATERIAL_QUOTE")
    assert data["missingRequired"] == ["SWITCH_INTENT"]
    assert data["aiGenerated"] is True
    assert data["removedNames"] == 1


def test_feedback_with_money_discount_delivery_promise_or_contact_is_dropped(coach_env):
    """Given 금액·할인·납기 확정·연락처가 든 피드백 / When 코치 / Then 그 줄은 버린다."""
    client, opp_ids, _fake = coach_env
    data = coach(client, opp_ids[0]).json()["data"]
    assert data["feedback"] == ["10/21 메모의 납기 걱정에 아직 답을 못 줬어요."]
    assert data["summary"] == "[이름] 과장이 견적을 요청함"


def test_next_call_lines_come_in_the_same_call_and_are_checked(coach_env):
    """Given 연락처·금액이 섞인 다음 통화 줄 6개 / When 코치 한 번 / Then 걸러 3줄까지, 호출 1번."""
    client, opp_ids, fake = coach_env
    data = coach(client, opp_ids[0]).json()["data"]
    assert data["nextCall"] == [
        "견적에 넣을 수량과 도금 두께를 물어보세요.",
        "소개서에서 궁금한 공정이 있는지 물어보세요.",
        "방문 날짜를 정할 수 있는지 물어보세요.",
    ]
    assert len(fake.payloads) == 1
    assert "[다음 통화] nextCall" in fake.payloads[0]["instructions"]
    # 정해진 모양에 nextCall이 들어 있다(엄격 모드는 모든 칸이 필수).
    schema = fake.payloads[0]["text"]["format"]["schema"]
    assert "nextCall" in schema["required"]


def test_switch_off_sends_nothing(coach_env):
    """Given 영업 기록 스위치 꺼짐 / When 코치 / Then 422, 외부 AI 호출 0, 거부 기록만."""
    client, opp_ids, fake = coach_env
    support.use_external_ai(salesRecordsEnabled=False)
    response = coach(client, opp_ids[0])
    assert response.status_code == 422, response.text
    assert response.json()["error"]["kind"] == "SALES_RECORDS_DISABLED"
    assert fake.payloads == []
    assert support.logs()[-1] == (opp_ids[0], "SALES_COACH", "REJECTED", 0)


def test_daily_limit_is_counted_apart_from_the_assistant(coach_env):
    """Given 코치 한도 1·비서 한도 1 / When 코치 두 번·비서 한 번 / Then 코치만 막힌다."""
    client, opp_ids, fake = coach_env
    support.change_assistant(coachDailyLimit=1, dailyQuestionLimit=1)
    assert coach(client, opp_ids[0]).status_code == 200
    blocked = coach(client, opp_ids[1])
    assert blocked.status_code == 503, blocked.text
    assert blocked.json()["error"]["kind"] == "COACH_LIMIT"
    assert len(fake.payloads) == 1
    # 영업 비서(질문)는 코치 호출을 세지 않으므로 오늘 첫 질문이 나간다.
    fake.answer = "가상 답입니다."
    assert support.ask(client).status_code == 200
    assert len(fake.payloads) == 2


@pytest.mark.parametrize(
    ("body", "field"),
    [
        ({"memo": "   "}, "memo"),
        ({"memo": "가" * 101}, "memo"),
        ({"attemptedAt": day(1)}, "attemptedAt"),
    ],
)
def test_bad_memo_or_future_date_is_rejected_before_sending(coach_env, body, field):
    """Given 빈 메모·너무 긴 메모·앞으로의 날짜 / When 코치 / Then 400, 나간 것 없음."""
    client, opp_ids, fake = coach_env
    response = coach(client, opp_ids[0], **body)
    assert response.status_code == 400, response.text
    assert [item["path"] for item in response.json()["error"]["fields"]] == [field]
    assert fake.payloads == []


@pytest.mark.parametrize("headers", [{}, support.VIEWER])
def test_viewer_and_missing_staff_key_are_forbidden(coach_env, headers):
    client, opp_ids, fake = coach_env
    assert coach(client, opp_ids[0], headers=headers).status_code == 403
    assert fake.payloads == []


def test_bad_shape_is_a_failure_not_an_empty_result(coach_env):
    """Given 모양이 맞지 않는 AI 답 / When 코치 / Then 503 LLM_FAILED(빈 결과로 넘기지 않는다)."""
    client, opp_ids, fake = coach_env
    fake.answer = '{"answers": "없음"}'
    response = coach(client, opp_ids[0])
    assert response.status_code == 503
    assert response.json()["error"]["kind"] == "LLM_FAILED"


def test_who_first_default_and_closing_without_end_are_dropped(coach_env):
    """Given 기본 보기 "우리가"·"끝" 없는 마무리 답 / When 코치 / Then 둘 다 버린다."""
    client, opp_ids, fake = coach_env
    fake.answer = reading(
        answers=[
            ("WHO_FIRST", ["OURS"], "[이름] 과장 통화"),
            ("CLOSE_RESULT", ["LOST"], "견적 요청함"),
        ]
    )
    assert coach(client, opp_ids[0]).json()["data"]["answers"] == []
    fake.answer = reading(answers=[("WHO_FIRST", ["THEIRS"], "[이름] 과장 통화")])
    assert [item["answerIds"] for item in coach(client, opp_ids[0]).json()["data"]["answers"]] == [
        ["THEIRS"]
    ]


def test_schedule_without_next_action_answer_fills_it_and_past_date_is_dropped(coach_env):
    """Given 일정만 있고 할 일 답이 없음·지난 날짜 / When 코치 / Then 할 일만 채운다."""
    client, opp_ids, fake = coach_env
    fake.answer = reading(action="SEND_MATERIAL", date=day(-1))
    data = coach(client, opp_ids[0]).json()["data"]
    assert data["nextSchedule"] == {"actionId": "SEND_MATERIAL", "date": None}
    assert data["answers"] == [
        {"questionId": "NEXT_ACTION", "answerIds": ["SEND_MATERIAL"], "quote": "", "fill": "AI"}
    ]
    # 할 일과 답이 다르면 날짜를 버린다. 끝(END)은 일정이 아니다.
    fake.answer = reading(
        answers=[("NEXT_ACTION", ["QUOTE"], "견적 요청함")], action="VISIT", date=day(2)
    )
    assert coach(client, opp_ids[0]).json()["data"]["nextSchedule"] == {
        "actionId": "QUOTE",
        "date": None,
    }
    fake.answer = reading(action="END", date=day(2))
    assert coach(client, opp_ids[0]).json()["data"]["nextSchedule"] is None


# ---------------------------------------------------------------------------
# 저장: AI가 채움 표시, 남긴 피드백
# ---------------------------------------------------------------------------


def test_saved_answers_keep_who_filled_them(coach_env):
    """Given 코치가 채운 답과 담당자 답 / When [이대로 저장] / Then 누가 채웠는지 남는다."""
    client, opp_ids, _fake = coach_env
    record(
        client,
        opp_ids[0],
        {
            "status": "IN_PROGRESS",
            "method": "CALL",
            "result": "REACHED",
            "memo": MEMO,
            "answers": [
                {"questionId": "QUOTE_REQUEST", "answerId": "QUOTE", "filledBy": "AI_CONFIRMED"},
                {"questionId": "SWITCH_INTENT", "answerId": "YES", "filledBy": "STAFF"},
                {"questionId": "NEXT_ACTION", "answerId": "RECONTACT"},
            ],
        },
    )
    with session_scope() as session:
        rows = session.execute(
            select(OutcomeAnswer.question_id, OutcomeAnswer.filled_by)
            .where(OutcomeAnswer.opp_id == opp_ids[0])
            .order_by(OutcomeAnswer.created_at, OutcomeAnswer.answer_row_id)
        ).all()
    filled = dict(rows)
    assert filled["QUOTE_REQUEST"] == "AI_CONFIRMED"
    assert filled["SWITCH_INTENT"] == "STAFF"
    # 요청에 없으면 담당자가 고른 답이다(이전 접촉의 답도 이 저장으로 STAFF).
    assert filled["NEXT_ACTION"] == "STAFF" and filled["WHO_TALKED"] == "STAFF"


def test_answer_changed_from_ai_is_kept_as_ai_changed(coach_env):
    """Given AI가 채운 답을 [고치기]에서 바꿈 / When 저장 / Then AI_CHANGED로 남는다."""
    client, opp_ids, _fake = coach_env
    record(
        client,
        opp_ids[0],
        {
            "status": "IN_PROGRESS",
            "method": "CALL",
            "result": "REACHED",
            "answers": [
                {"questionId": "QUOTE_REQUEST", "answerId": "MATERIAL", "filledBy": "AI_CHANGED"}
            ],
        },
    )
    with session_scope() as session:
        filled = session.scalar(
            select(OutcomeAnswer.filled_by).where(
                OutcomeAnswer.opp_id == opp_ids[0], OutcomeAnswer.question_id == "QUOTE_REQUEST"
            )
        )
    assert filled == "AI_CHANGED"


def test_missing_required_is_capped_by_setting(coach_env):
    """Given 설정 상한 1 / When 빠진 필수 질문이 둘 / Then 질문 파일 순서로 하나만 온다."""
    client, opp_ids, fake = coach_env
    support.change_assistant(coachMaxRequiredQuestions=1)
    fake.answer = reading(answers=[("QUOTE_REQUEST", ["QUOTE"], "견적 요청함")])
    data = coach(client, opp_ids[0]).json()["data"]
    # 상한이 없으면 외주처 바꿀 생각 · 다음 할 일 두 개다.
    assert data["missingRequired"] == ["SWITCH_INTENT"]


def test_unknown_filled_by_is_rejected(coach_env):
    client, opp_ids, _fake = coach_env
    response = client.post(
        f"/api/v1/opportunities/{opp_ids[0]}/outcomes",
        json={
            "status": "IN_PROGRESS",
            "method": "CALL",
            "result": "REACHED",
            "answers": [{"questionId": "REPLY", "answerId": "CAME", "filledBy": "AI"}],
        },
        headers=STAFF,
    )
    assert response.status_code == 400, response.text


def test_kept_feedback_shows_in_activity_detail_and_next_coaching(coach_env):
    """Given 피드백 한 줄을 [보고서에 남기기] / When 이력·상세·다음 코칭 / Then 그 줄이 보인다."""
    client, opp_ids, fake = coach_env
    line = "10/21 메모의 납기 걱정에 아직 답을 못 줬어요."
    advice_id = note(client, opp_ids[0], line, kind="ADVICE")
    items = client.get(f"/api/v1/opportunities/{opp_ids[0]}/activity").json()["data"]
    (item,) = [row for row in items if row["kind"] == "ADVICE"]
    assert item["summary"] == f"남긴 피드백 · {line}"
    assert (item["recordId"], item["recordKind"]) == (advice_id, "NOTE")
    detail = client.get(f"/api/v1/opportunities/{opp_ids[0]}").json()["data"]
    assert [(row["noteId"], row["text"]) for row in detail["records"]["advice"]] == [
        (advice_id, line)
    ]
    coach(client, opp_ids[0])
    assert "[남긴 피드백]" in fake.payloads[-1]["input"]
    assert line in fake.payloads[-1]["input"]
    # 잘못 입력으로 표시하면 상세·다음 코칭에서 빠진다.
    cancelled = client.post(
        f"/api/v1/opportunities/{opp_ids[0]}/records/{advice_id}/cancel", json={}, headers=STAFF
    )
    assert cancelled.status_code == 200, cancelled.text
    detail = client.get(f"/api/v1/opportunities/{opp_ids[0]}").json()["data"]
    assert detail["records"]["advice"] == []
    coach(client, opp_ids[0])
    assert line not in fake.payloads[-1]["input"]


@pytest.mark.parametrize("kind", ["ADVICE", "CALL_PREP"])
@pytest.mark.parametrize("text", ["담당 010-0000-0000로 다시", "kim@example.com 회신 확인", "  "])
def test_feedback_with_contact_or_blank_cannot_be_kept(coach_env, text, kind):
    client, opp_ids, _fake = coach_env
    response = client.post(
        f"/api/v1/opportunities/{opp_ids[0]}/notes",
        json={"text": text, "kind": kind},
        headers=STAFF,
    )
    assert response.status_code == 400, response.text
    with session_scope() as session:
        kinds = session.scalars(select(Note.kind).where(Note.opp_id == opp_ids[0])).all()
    assert kind not in kinds


def test_saved_call_prep_shows_in_detail_activity_and_next_coaching(coach_env):
    """Given 다음 통화 준비 두 번 저장 / When 상세·이력·다음 코칭 / Then 가장 최근 것(#750)."""
    client, opp_ids, fake = coach_env
    opp_id = opp_ids[0]
    note(client, opp_id, "샘플이 필요한지 물어보세요.", kind="CALL_PREP")
    lines = ["견적에 넣을 수량을 물어보세요.", "방문 날짜를 정할 수 있는지 물어보세요."]
    prep_id = note(client, opp_id, "\n".join(lines), kind="CALL_PREP")
    detail = client.get(f"/api/v1/opportunities/{opp_id}").json()["data"]
    prep = detail["records"]["callPrep"]
    assert (prep["noteId"], prep["lines"], prep["by"]) == (prep_id, lines, "park-lee")
    # 남긴 피드백 목록에는 섞이지 않는다.
    assert detail["records"]["advice"] == []
    items = client.get(f"/api/v1/opportunities/{opp_id}/activity").json()["data"]
    summaries = [row["summary"] for row in items if row["kind"] == "ADVICE"]
    assert f"다음 통화 준비 · {lines[0]} · {lines[1]}" in summaries
    coach(client, opp_id)
    sent = fake.payloads[-1]["input"]
    assert "[지난 통화 준비]" in sent and lines[1] in sent
    assert "샘플이 필요한지" not in sent  # 가장 최근 한 행만 싣는다
    # 잘못 입력으로 표시하면 그 앞 것이 보인다.
    cancelled = client.post(
        f"/api/v1/opportunities/{opp_id}/records/{prep_id}/cancel", json={}, headers=STAFF
    )
    assert cancelled.status_code == 200, cancelled.text
    detail = client.get(f"/api/v1/opportunities/{opp_id}").json()["data"]
    assert detail["records"]["callPrep"]["lines"] == ["샘플이 필요한지 물어보세요."]


def test_detail_without_call_prep_is_null(coach_env):
    client, opp_ids, _fake = coach_env
    detail = client.get(f"/api/v1/opportunities/{opp_ids[1]}").json()["data"]
    assert detail["records"]["callPrep"] is None


# ---------------------------------------------------------------------------
# 빠진 필수 질문 규칙(AI 아님)과 질문 파일 검사
# ---------------------------------------------------------------------------


@pytest.fixture(scope="module")
def questions() -> SalesQuestions:
    result = check_sales_questions_file(EXAMPLES_DIR / "sales-questions.yaml")
    assert result.errors == []
    return result.questions


@pytest.mark.parametrize(
    ("before", "prior", "now", "expected"),
    [
        # 첫 통화: 누구와 이야기했나 + 다음 할 일
        ("NOT_REACHED", {}, {}, ["WHO_TALKED", "NEXT_ACTION"]),
        # 담당 부서와 연결 → 연결됨으로 넘어가도 그 단계 질문은 이번에 묻지 않는다(바뀜 #742)
        (
            "NOT_REACHED",
            {},
            {"WHO_TALKED": ["RIGHT_PERSON"], "NEXT_ACTION": ["RECONTACT"]},
            [],
        ),
        # 직접 함 → 맡길 공정 있나가 보인다
        ("REACHED", {}, {"PLATING_NOW": ["IN_HOUSE"]}, ["NEED_PROCESS", "NEXT_ACTION"]),
        # 있음(→ 수요 확인) → 연결됨의 맡길 공정만. 수요 확인 단계 질문은 묻지 않는다(바뀜 #742)
        (
            "REACHED",
            {"PLATING_NOW": ["IN_HOUSE"]},
            {"NEED_PROCESS": ["YES"], "NEXT_ACTION": ["QUOTE"]},
            ["CONFIRM_PROCESS"],
        ),
        # 실측 사진의 경우: 샘플을 요청만 받았는데 "샘플 결과는?"을 묻지 않는다(#742 PM 결정)
        (
            "DEMAND_CONFIRMED",
            {"PLATING_NOW": ["OUTSOURCED"]},
            {"SENT_ITEM": ["QUOTE"], "REPLY": ["CAME"], "VISIT_OR_SAMPLE": ["SAMPLE"]},
            ["SWITCH_INTENT", "QUOTE_REQUEST", "NEXT_ACTION"],
        ),
        # 끝 → 어떻게 끝났나, 거절 → 거절 이유(접촉마다, 이번 답만 본다)
        ("VISIT_SAMPLE", {}, {"SAMPLE_RESULT": ["PASS"], "NEXT_ACTION": ["END"]}, ["CLOSE_RESULT"]),
        (
            "VISIT_SAMPLE",
            {"NEXT_ACTION": ["END"], "CLOSE_RESULT": ["LOST"]},
            {"SAMPLE_RESULT": ["FAIL"], "NEXT_ACTION": ["END"], "CLOSE_RESULT": ["LOST"]},
            ["LOST_REASON"],
        ),
    ],
)
def test_missing_required_follows_the_question_file(questions, before, prior, now, expected):
    assert missing_required(questions, prior, now, SalesStep(before)) == expected


def test_missing_required_keeps_file_order_up_to_the_limit(questions):
    prior = {"PLATING_NOW": ["OUTSOURCED"]}
    now = {"VISIT_OR_SAMPLE": ["SAMPLE"]}
    before = SalesStep.DEMAND_CONFIRMED
    assert missing_required(questions, prior, now, before, limit=2) == [
        "SWITCH_INTENT",
        "QUOTE_REQUEST",
    ]


def test_step_after_only_moves_forward(questions):
    assert step_after(questions, SalesStep.MATERIAL_QUOTE, {"PLATING_NOW": ["OUTSOURCED"]}) == (
        SalesStep.MATERIAL_QUOTE
    )
    assert step_after(questions, SalesStep.REACHED, {"QUOTE_REQUEST": ["MATERIAL"]}) == (
        SalesStep.MATERIAL_QUOTE
    )


def test_step_after_reaches_reached_for_a_connected_call(questions):
    """(#748) 코치는 '연결됨' 접촉에만 쓰므로 답이 없어도 '연결됨'까지 간다.

    다른 부서·안내만을 고르면 그대로다."""
    assert step_after(questions, SalesStep.NOT_REACHED, {}) == SalesStep.REACHED
    assert step_after(questions, SalesStep.NOT_REACHED, {"NEXT_ACTION": ["VISIT"]}) == (
        SalesStep.REACHED
    )
    for held in ("OTHER_DEPT", "GUIDE_ONLY"):
        assert step_after(questions, SalesStep.NOT_REACHED, {"WHO_TALKED": [held]}) == (
            SalesStep.NOT_REACHED
        )
    assert step_after(questions, SalesStep.NOT_REACHED, {"PLATING_NOW": ["OUTSOURCED"]}) == (
        SalesStep.DEMAND_CONFIRMED
    )


def _questions_with(tmp_path, coach_line, question_id="NEED_PROCESS"):
    source = (EXAMPLES_DIR / "sales-questions.yaml").read_text(encoding="utf-8")
    lines = source.split("\n")
    start = lines.index(f"  - id: {question_id}")
    index = next(i for i in range(start, len(lines)) if lines[i].startswith("    coach:"))
    lines[index] = f"    coach: {coach_line}"
    path = tmp_path / "sales-questions.yaml"
    path.write_text("\n".join(lines), encoding="utf-8")
    return check_sales_questions_file(path)


@pytest.mark.parametrize(
    ("coach_line", "question_id", "message"),
    [
        (
            "{ fill: AI, requiredWhen: { answers: { PLATING_NOW: [IN_HOUSE] } } }",
            "NEED_PROCESS",
            "required: true일 때만",
        ),
        (
            "{ fill: AI, required: true, requiredWhen: { answers: { NOPE: [YES] } } }",
            "NEED_PROCESS",
            "쓸 수 없는 질문",
        ),
        (
            "{ fill: AI, required: true, requiredWhen: { answers: { PLATING_NOW: [NOPE] } } }",
            "NEED_PROCESS",
            "없는 보기",
        ),
        ("{ fill: AI }", "CONFIRM_PROCESS", "SUGGEST나 STAFF만"),
        ("{ fill: MAYBE }", "NEED_PROCESS", "fill"),
        (
            "{ fill: AI, keyword: 가나다라마바사아자차카타파하가나다라마바사 }",
            "NEED_PROCESS",
            "keyword",
        ),
        ("{ fill: AI, unknown: 1 }", "NEED_PROCESS", "unknown"),
    ],
)
def test_bad_coach_field_is_rejected(tmp_path, coach_line, question_id, message):
    result = _questions_with(tmp_path, coach_line, question_id)
    assert result.questions is None
    assert any(message in f"{error.path} {error.message}" for error in result.errors), result.errors
