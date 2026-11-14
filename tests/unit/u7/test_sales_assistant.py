"""#680: 영업 비서(질문에 답하기·통화 준비). 실제 임시 DB·실제 API, 외부 AI는 가짜 응답이다.

실제 AI는 부르지 않는다(소켓도 막혀 있다). 가짜 어댑터가 받은 글을 붙잡아 "무엇이 나갔는지"를 본다.
가상 사례만 쓴다(거산 실제 사양 아님). 준비 자료의 사람 이름·전화·이메일은 모두 지어낸 것이다.
"""

from datetime import timedelta

import pytest
from sqlalchemy import func, select

from geosan.api.assistant_context import CompanyRef, named_sources
from geosan.config.app_settings import load_app_settings, read_app_settings
from geosan.config.models import AppSetting
from geosan.evaluation.models import EvaluationRun
from geosan.evidence import assistant_llm
from geosan.evidence.transfer import KST, TransferLog
from geosan.opportunity.models import Customer, Opportunity
from geosan.records.models import Bookmark, Note, Outcome, OutcomeAnswer
from geosan.storage.base import utcnow
from geosan.storage.session import session_scope
from tests.conftest import EXAMPLES_DIR
from tests.unit.u7 import test_dashboard as support
from tests.unit.u7.test_bookmark import set_bookmark
from tests.unit.u7.test_peers import note

dashboard_env = support.dashboard_env
record = support.record

STAFF = {"X-Staff-Key": "park-lee"}
VIEWER = {"X-Staff-Key": "viewer"}
ASK_URL = "/api/v1/assistant/ask"

# 일부러 넣는 자유 글. 외부 AI로 나가는 글에 하나라도 남으면 안 된다.
CONTACT_MEMO = "홍길동이 검토 중이라고만 함. 김철수 과장과 통화"
LOST_REASON_TEXT = "이영희 팀장이 기존 업체보다 비싸다고 함"
SCHEDULE_NOTE = "윤서연 매니저에게 견적 회신 전화"
NOTE_TEXT = "철수 씨가 실무. 직통 010-0000-0000, kim@example.com"
MAIN_PHONE = "041-000-0000"
PLANTED = [
    "홍길동",
    "김철수",
    "이영희",
    "윤서연",
    "철수 씨",
    "검토 중이라고만",
    "기존 업체보다",
    "견적 회신 전화",
    "실무",
    "010-0000-0000",
    "kim@example.com",
    MAIN_PHONE,
    "park-lee",
]


class FakeAI:
    """외부 AI 대신 정해 둔 답을 돌려주고 받은 요청을 붙잡아 둔다."""

    def __init__(self):
        self.payloads = []
        self.answer = "가상 답입니다."
        self.status = "completed"

    def __call__(self, payload, key, deadline):
        self.payloads.append(payload)
        return {
            "status": self.status,
            "usage": {"input_tokens": 1000, "output_tokens": 200},
            "output": [
                {
                    "type": "message",
                    "status": "completed",
                    "content": [{"type": "output_text", "text": self.answer}],
                }
            ],
        }

    @property
    def sent(self):
        """나간 글 전부(지시문 + 조회 글 + 질문)."""
        return "\n".join(f"{item['instructions']}\n{item['input']}" for item in self.payloads)


def use_external_ai(**llm):
    """임시 DB의 AI 설정을 예시 설정(기본 파일)의 모델·단가로 켠다. 키는 가짜 값이다."""
    values = load_app_settings(EXAMPLES_DIR / "app-settings.yaml").llm.model_dump(by_alias=True)
    values.update({"mode": "EXTERNAL", "salesRecordsEnabled": True, **llm})
    with session_scope() as session:
        session.get(AppSetting, "llm").value = values


def change_assistant(**values):
    with session_scope() as session:
        row = session.get(AppSetting, "assistant")
        row.value = {**row.value, **values}


@pytest.fixture
def assistant_env(dashboard_env, monkeypatch):
    client, opp_ids = dashboard_env
    use_external_ai()
    monkeypatch.setenv("OPENAI_API_KEY", "test-only-placeholder")
    fake = FakeAI()
    monkeypatch.setattr(assistant_llm, "_post", fake)
    return client, opp_ids, fake


def tomorrow():
    return (utcnow().astimezone(KST).date() + timedelta(days=1)).isoformat()


def seed(client, opp_ids):
    """a: 통화 뒤 가격 이유로 거절 / b: 메일 연결·내일 일정·메모 / c: 관심만 / d: 없음."""
    a, b, c, _d = opp_ids
    record(
        client,
        a,
        {
            "status": "IN_PROGRESS",
            "method": "CALL",
            "result": "REACHED",
            "attemptedAt": "2026-10-06",
            "memo": CONTACT_MEMO,
            "answers": [{"questionId": "PLATING_NOW", "answerId": "OUTSOURCED"}],
        },
    )
    record(client, a, {"status": "LOST", "lostReasonCode": "PRICE", "reason": LOST_REASON_TEXT})
    record(
        client,
        b,
        {
            "status": "IN_PROGRESS",
            "method": "EMAIL",
            "result": "REACHED",
            "attemptedAt": "2026-10-12",
            "nextScheduleAt": tomorrow(),
            "nextScheduleNote": SCHEDULE_NOTE,
        },
    )
    note(client, b, NOTE_TEXT)
    assert set_bookmark(client, c, True).status_code == 200
    with session_scope() as session:
        for opp_id in opp_ids:
            customer = session.get(Customer, session.get(Opportunity, opp_id).customer_id)
            customer.main_phone = MAIN_PHONE


def ask(client, question="가격 때문에 거절된 회사는?", headers=STAFF):
    return client.post(ASK_URL, json={"question": question}, headers=headers)


def call_prep(client, opp_id, headers=STAFF):
    return client.post(f"/api/v1/opportunities/{opp_id}/assistant/call-prep", headers=headers)


def logs():
    with session_scope() as session:
        rows = session.scalars(
            select(TransferLog).order_by(TransferLog.occurred_at, TransferLog.call_count.desc())
        ).all()
        return [(row.opp_id, row.kind, row.decision, row.call_count) for row in rows]


def row_counts():
    """읽기 전용인지 볼 때 쓰는 표별 행 수(전송 기록 표는 뺀다)."""
    with session_scope() as session:
        return {
            model.__tablename__: session.scalar(select(func.count()).select_from(model))
            for model in (Outcome, OutcomeAnswer, Note, Bookmark, EvaluationRun, Opportunity)
        }


def names(opp_ids):
    with session_scope() as session:
        return [
            session.get(Customer, session.get(Opportunity, opp_id).customer_id).name
            for opp_id in opp_ids
        ]


# ---------------------------------------------------------------------------
# 근거 회사 고르기(프로그램이 만든다)
# ---------------------------------------------------------------------------


def test_sources_are_only_companies_that_were_in_the_queries():
    """Given 조회에 실린 회사 2곳 / When 답에 다른 회사 이름도 있다 / Then 실린 회사만 고른다."""
    companies = [CompanyRef("opp-1", "가상정밀A"), CompanyRef("opp-2", "가상금속B")]
    picked = named_sources("가상정밀A와 없는회사Z가 거절했습니다.", companies)
    assert picked == [companies[0]]


# ---------------------------------------------------------------------------
# 질문에 답하기
# ---------------------------------------------------------------------------


def test_ask_sends_picked_values_and_returns_answer_with_sources(assistant_env):
    """Given 기록 있는 가상 회사 / When 질문 / Then 고른 값이 나가고 답·근거·본 회사 수가 온다."""
    client, opp_ids, fake = assistant_env
    seed(client, opp_ids)
    name_a, name_b, name_c, name_d = names(opp_ids)
    fake.answer = f"{name_a}: 2026-10-06 전화 뒤 가격 이유로 거절. 없는회사Z도 거절."
    response = ask(client)
    assert response.status_code == 200, response.text
    data = response.json()["data"]
    assert data["answer"] == fake.answer and data["aiGenerated"] is True
    assert data["sources"] == [{"oppId": opp_ids[0], "name": name_a}]
    assert data["usedQueries"] == [
        "COMPANY_LIST",
        "COMPANY_SUMMARY",
        "SALES_ANALYSIS",
        "SCHEDULE",
        "LOST_REASONS",
    ]
    assert (data["companiesIncluded"], data["companiesTotal"]) == (3, 3)
    assert response.json()["meta"]["hasVirtualData"] is True
    (payload,) = fake.payloads
    sent = payload["input"]
    # 고른 값은 나간다: 이름·날짜·방법·결과·거절 이유·고른 답·다음 일정 날짜·건수.
    for expected in (
        name_a,
        name_b,
        name_c,
        "2026-10-06 전화 연결됨",
        "고른 답: 지금 도금은 어떻게 하나요? → 외주 줌",
        "2026-10-12 메일 연결됨",
        "가격",
        tomorrow(),
        "합계 | 접촉한 곳 2곳 | 진행 중 1곳 | 보류 0곳 | 성사 0곳 | 거절 1곳",
        "질문: 가격 때문에 거절된 회사는?",
    ):
        assert expected in sent, expected
    assert name_d not in sent  # 관심도 기록도 없는 회사는 싣지 않는다.
    assert payload["store"] is False and payload["max_output_tokens"] == 3000


def test_ask_never_sends_free_text_phone_or_staff_key(assistant_env):
    """Given 이름·전화가 든 메모·일정 글·사유·대표번호 / When 질문 / Then 하나도 안 나간다."""
    client, opp_ids, fake = assistant_env
    seed(client, opp_ids)
    assert ask(client).status_code == 200
    for planted in PLANTED:
        assert planted not in fake.sent, planted
    assert "[연락처 제거]" not in fake.sent and "[이름]" not in fake.sent  # 지울 것이 애초에 없다.


def test_ask_logs_one_row_per_company_and_settles_usage(assistant_env):
    """Given 조회에 회사 3곳 / When 질문 / Then 호출 1행 + 표시 2행, 사용량은 호출 행에만."""
    client, opp_ids, fake = assistant_env
    seed(client, opp_ids)
    assert ask(client).status_code == 200
    rows = logs()
    assert sorted(row[0] for row in rows) == sorted(opp_ids[:3])
    assert [row[1:] for row in rows] == [
        ("SALES_RECORD", "ALLOWED", 1),
        ("SALES_RECORD", "ALLOWED", 0),
        ("SALES_RECORD", "ALLOWED", 0),
    ]
    with session_scope() as session:
        settled = session.scalars(select(TransferLog).where(TransferLog.cost_usd.is_not(None)))
        (row,) = settled.all()
        assert (row.call_count, row.input_tokens, row.output_tokens) == (1, 1000, 200)
        assert row.requested_by == "park-lee"


def test_ask_changes_nothing_but_transfer_log(assistant_env):
    """Given 기록 / When 질문 / Then 영업 기록·답·메모·관심·평가 행 수가 그대로다(읽기 전용)."""
    client, opp_ids, _fake = assistant_env
    seed(client, opp_ids)
    before = row_counts()
    assert ask(client).status_code == 200
    assert row_counts() == before


def test_switch_off_rejects_and_sends_nothing(assistant_env):
    """Given 영업 기록 전용 스위치 꺼짐 / When 질문·통화 준비 / Then 422, 거부 기록만, 호출 없음."""
    client, opp_ids, fake = assistant_env
    seed(client, opp_ids)
    use_external_ai(salesRecordsEnabled=False)
    for response in (ask(client), call_prep(client, opp_ids[0])):
        assert response.status_code == 422, response.text
        assert response.json()["error"]["kind"] == "SALES_RECORDS_DISABLED"
    assert fake.payloads == []
    assert [row[1:] for row in logs()] == [("SALES_RECORD", "REJECTED", 0)] * 2
    config = client.get("/api/v1/config/ui").json()["data"]["assistant"]
    assert config == {"enabled": False, "questionMaxLength": 300}


def test_main_ai_switch_off_blocks_with_existing_error(assistant_env):
    """Given 전체 AI 스위치 NONE / When 질문 / Then 기존 오류 그대로(LLM_NOT_CONFIGURED)."""
    client, opp_ids, fake = assistant_env
    seed(client, opp_ids)
    use_external_ai(mode="NONE")
    response = ask(client)
    assert response.status_code == 503
    assert response.json()["error"]["kind"] == "LLM_NOT_CONFIGURED"
    assert fake.payloads == []
    assert client.get("/api/v1/config/ui").json()["data"]["assistant"]["enabled"] is False


def test_config_ui_reports_enabled_when_both_switches_are_on(assistant_env):
    client, _opp_ids, _fake = assistant_env
    config = client.get("/api/v1/config/ui").json()["data"]["assistant"]
    assert config == {"enabled": True, "questionMaxLength": 300}


def test_daily_limit_blocks_both_endpoints(assistant_env):
    """Given 하루 한도 1 / When 두 번째 호출 / Then 503 ASSISTANT_LIMIT, 더 나가지 않는다."""
    client, opp_ids, fake = assistant_env
    seed(client, opp_ids)
    change_assistant(dailyQuestionLimit=1)
    assert ask(client).status_code == 200
    for response in (ask(client), call_prep(client, opp_ids[0])):
        assert response.status_code == 503
        assert response.json()["error"]["kind"] == "ASSISTANT_LIMIT"
    assert len(fake.payloads) == 1


@pytest.mark.parametrize(
    "question",
    ["담당자 010-0000-0000 회사는?", "kim@example.com 으로 보낸 회사는?", "", "   ", "가" * 301],
)
def test_question_with_contact_or_bad_length_is_rejected(assistant_env, question):
    """Given 전화·이메일이 든 질문, 빈 질문, 너무 긴 질문 / When 질문 / Then 400, 나간 것 없음."""
    client, opp_ids, fake = assistant_env
    seed(client, opp_ids)
    response = ask(client, question)
    assert response.status_code == 400, response.text
    assert fake.payloads == [] and logs() == []


def test_person_name_in_question_is_scrubbed_before_sending(assistant_env):
    """Given 직함이 붙은 이름이 든 질문 / When 질문 / Then 이름은 "[이름]"으로 바뀌어 나간다."""
    client, opp_ids, fake = assistant_env
    seed(client, opp_ids)
    assert ask(client, "김철수 과장이 있는 회사는 어디야?").status_code == 200
    assert "김철수" not in fake.sent and "질문: [이름] 과장이 있는 회사는" in fake.sent


@pytest.mark.parametrize("headers", [VIEWER, {}])
def test_viewer_and_missing_staff_key_are_forbidden(assistant_env, headers):
    client, opp_ids, fake = assistant_env
    seed(client, opp_ids)
    assert ask(client, headers=headers).status_code == 403
    assert call_prep(client, opp_ids[0], headers=headers).status_code == 403
    assert fake.payloads == [] and logs() == []


def test_no_companies_means_nothing_is_sent(assistant_env):
    """Given 관심 회사도 접촉 기록도 없음 / When 질문 / Then 422 ASSISTANT_NO_RECORDS."""
    client, _opp_ids, fake = assistant_env
    response = ask(client)
    assert response.status_code == 422
    assert response.json()["error"]["kind"] == "ASSISTANT_NO_RECORDS"
    assert fake.payloads == [] and logs() == []


def test_company_cap_keeps_bookmarked_first_and_reports_counts(assistant_env):
    """Given 회사 수 상한 2, 대상 3곳 / When 질문 / Then 2곳만 싣고 "3곳 가운데 2곳"을 알린다."""
    client, opp_ids, fake = assistant_env
    seed(client, opp_ids)
    change_assistant(maxCompanies=2)
    data = ask(client).json()["data"]
    assert (data["companiesIncluded"], data["companiesTotal"]) == (2, 3)
    assert "3곳 가운데 2곳" in fake.sent
    assert len(logs()) == 2


def test_real_companies_are_not_mixed_into_the_virtual_bundle(assistant_env):
    """Given 가상 묶음이 활성 / When 실제 회사 기록이 있어도 / Then 조회 글에 섞이지 않는다."""
    client, opp_ids, fake = assistant_env
    seed(client, opp_ids)
    name_a, name_b, *_ = names(opp_ids)
    with session_scope() as session:
        opportunity = session.get(Opportunity, opp_ids[1])
        opportunity.is_virtual = False
        session.get(Customer, opportunity.customer_id).is_virtual = False
    data = ask(client).json()["data"]
    assert data["companiesTotal"] == 2
    assert name_a in fake.sent and name_b not in fake.sent
    assert opp_ids[1] not in [row[0] for row in logs()]


def test_cancelled_contact_and_its_answers_are_left_out(assistant_env):
    """Given 잘못 입력으로 표시한 접촉 / When 질문 / Then 그 접촉과 답은 조회 글에 없다."""
    client, opp_ids, fake = assistant_env
    seed(client, opp_ids)
    with session_scope() as session:
        outcome_id = session.scalar(
            select(Outcome.outcome_id).where(Outcome.opp_id == opp_ids[0], Outcome.method == "CALL")
        )
    response = client.post(
        f"/api/v1/opportunities/{opp_ids[0]}/records/{outcome_id}/cancel",
        json={"reason": "가상 취소"},
        headers=STAFF,
    )
    assert response.status_code == 200, response.text
    assert ask(client).status_code == 200
    assert "2026-10-06 전화" not in fake.sent and "외주 줌" not in fake.sent


def test_failed_ai_reply_is_an_error_not_an_empty_answer(assistant_env):
    """Given AI가 답을 끝까지 못 줌 / When 질문 / Then 빈 답을 성공처럼 주지 않고 503."""
    client, opp_ids, fake = assistant_env
    seed(client, opp_ids)
    fake.status = "incomplete"
    response = ask(client)
    assert response.status_code == 503 and response.json()["error"]["kind"] == "LLM_FAILED"
    # 나간 호출은 기록에 남는다(비용이 든 호출).
    assert ("SALES_RECORD", "ALLOWED", 1) in [row[1:] for row in logs()]


def test_contacts_in_the_ai_answer_are_scrubbed(assistant_env):
    client, opp_ids, fake = assistant_env
    seed(client, opp_ids)
    fake.answer = "담당 홍길동, 010-0000-0000 로 물어보세요."
    assert ask(client).json()["data"]["answer"] == "담당 [이름], [연락처 제거] 로 물어보세요."


def test_old_settings_copy_without_assistant_section_reads_example_values(assistant_env):
    """Given #680 전 DB 사본(assistant 없음) / When 읽기 / Then 예시 파일 값으로 읽는다."""
    with session_scope() as session:
        session.delete(session.get(AppSetting, "assistant"))
    with session_scope() as session:
        settings = read_app_settings(session).assistant
        assert (settings.daily_question_limit, settings.max_companies) == (30, 60)


# ---------------------------------------------------------------------------
# 통화 준비
# ---------------------------------------------------------------------------


def test_call_prep_sends_company_and_peer_values_without_notes(assistant_env):
    """Given 기록·메모가 있는 비슷한 회사 / When 통화 준비 / Then 고른 값만 나가고 기록은 1행."""
    client, opp_ids, fake = assistant_env
    seed(client, opp_ids)
    name_a, name_b, name_c, name_d = names(opp_ids)
    fake.answer = f"{name_a}처럼 가격을 먼저 확인하세요.\n- 지금 도금은 어떻게 하나요?"
    response = call_prep(client, opp_ids[3])
    assert response.status_code == 200, response.text
    data = response.json()["data"]
    assert data["answer"] == fake.answer and data["aiGenerated"] is True
    # 이 회사는 늘 근거에 들고, 비슷한 회사는 답에 이름이 나온 곳만.
    assert data["sources"] == [
        {"oppId": opp_ids[3], "name": name_d},
        {"oppId": opp_ids[0], "name": name_a},
    ]
    assert data["usedQueries"] == ["COMPANY_SUMMARY", "PEERS"]
    sent = fake.payloads[0]["input"]
    for expected in (
        "[조회 1. 이 회사 요약]",
        name_d,
        "접촉 기록 없음",
        "[조회 2. 비슷한 회사] 같은 공정 3곳",
        "많은 거절 이유: 가격 1곳",
        "메일 1번 중 1번 연결",
        f"{name_a} | 예 |",
        "물어볼 것 2~3개",
    ):
        assert expected in fake.sent, expected
    for planted in PLANTED:
        assert planted not in fake.sent, planted
    assert "질문:" not in sent
    # 전송 기록은 요청한 회사에만 단다.
    assert logs() == [(opp_ids[3], "SALES_RECORD", "ALLOWED", 1)]


def test_call_prep_shows_own_contacts_step_and_changes_nothing(assistant_env):
    client, opp_ids, fake = assistant_env
    seed(client, opp_ids)
    before = row_counts()
    assert call_prep(client, opp_ids[0]).status_code == 200
    assert row_counts() == before
    for expected in ("2026-10-06 전화 연결됨", "외주 줌", "| 거절 | 해당 없음 |", "가격"):
        assert expected in fake.payloads[0]["input"], expected


def test_call_prep_unknown_company_is_404(assistant_env):
    client, _opp_ids, fake = assistant_env
    assert call_prep(client, "opp-missing").status_code == 404
    assert fake.payloads == [] and logs() == []


def test_ask_instructions_tell_not_to_append_unrelated_companies(assistant_env):
    """Given 질문 / When 답을 받음 / Then 지시문에 "관계없는 회사를 덧붙이지 않는다"가 있다(#720).

    지시문만으로 막는 것이라 AI가 늘 따르는지는 여기서 확인하지 못한다. 근거 회사 계산은 그대로다.
    """
    client, opp_ids, fake = assistant_env
    seed(client, opp_ids)
    a_name, b_name = names(opp_ids[:2])
    fake.answer = f"기록에 없음. 참고로 {b_name}은 메일로 연결됨."
    response = ask(client, "샘플을 보낸 회사는?")
    assert response.status_code == 200, response.text
    instructions = fake.payloads[0]["instructions"]
    assert "질문과 관계없는 회사를 덧붙이지 않는다." in instructions
    assert "기록에 없으면 없다고만 답하고 다른 회사를 예로 들지 않는다." in instructions
    # sources 계산은 바꾸지 않았다: 답 글에 이름이 나온 회사는 지금처럼 근거로 달린다.
    assert response.json()["data"]["sources"] == [{"oppId": opp_ids[1], "name": b_name}]
    assert a_name not in fake.answer
