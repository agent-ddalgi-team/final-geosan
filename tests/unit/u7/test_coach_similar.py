"""#915: 영업 코치가 비슷한 성사 회사의 기록을 함께 보고 제안한다(RAG 1단계).

외부 AI는 가짜 응답이다.

실제 임시 DB·실제 API로 본다. 가상 회사 4곳(A정밀을 이름만 바꾼 사본이라 공정이 같다)만 쓴다(거산
실제 사양 아님). 메모의 사람 이름·전화는 모두 지어낸 것이다.
"""

from datetime import UTC, datetime

from sqlalchemy import select

from geosan.config.app_settings import read_app_settings
from geosan.config.models import AppSetting
from geosan.opportunity.models import Customer, Opportunity, OppProcessLink
from geosan.records.models import Outcome
from geosan.storage.session import session_scope
from tests.unit.u7 import test_sales_assistant as support
from tests.unit.u7 import test_sales_coach as coach_support
from tests.unit.u7.test_peers import note

dashboard_env = support.dashboard_env
assistant_env = support.assistant_env
coach_env = coach_support.coach_env
record = support.record
coach = coach_support.coach
reading = coach_support.reading

WON_MEMO = "품질팀 이영희 과장 통화. 샘플 보내 달라함"
# 접촉 한 줄 메모는 전화번호를 받지 않아 따로 적는 메모에 넣는다(메모장에는 적을 수 있다).
WON_NOTE = "이영희 과장 직통 010-2222-3333"
WON_REASON = "샘플 시험 통과 뒤 정함"
ADVICE = "첫 통화 뒤 바로 샘플을 보내 정해졌어요. 샘플을 먼저 제안해 보세요."


def won(client, opp_id, memo=WON_MEMO, day="2026-10-10"):
    """통화(연결됨, 메모) 한 번 뒤 성사."""
    record(
        client,
        opp_id,
        {
            "status": "IN_PROGRESS",
            "method": "CALL",
            "result": "REACHED",
            "attemptedAt": day,
            "memo": memo,
        },
    )
    note(client, opp_id, WON_NOTE)
    record(client, opp_id, {"status": "WON", "reason": WON_REASON})


def drop_processes(opp_id):
    """그 회사의 공정 연결을 모두 대체된 것으로 둔다(겹치는 공정이 없게)."""
    with session_scope() as session:
        for link in session.scalars(select(OppProcessLink).where(OppProcessLink.opp_id == opp_id)):
            link.superseded_at = datetime(2026, 11, 1, tzinfo=UTC)


def set_industries(opp_id, industries):
    with session_scope() as session:
        customer = session.get(Customer, session.get(Opportunity, opp_id).customer_id)
        customer.industries = list(industries)


def name_of(opp_id):
    with session_scope() as session:
        return session.get(Customer, session.get(Opportunity, opp_id).customer_id).name


def test_similar_won_case_is_sent_scrubbed_and_advice_is_checked(coach_env):
    """Given 공정이 같은 성사 회사 1곳·거절 1곳·공정이 안 겹치는 성사 1곳
    When 코치 / Then 성사·겹치는 곳만 "사례 S1"로 지워서 보내고,
    맞는 제안 한 줄만 이름으로 돌려준다."""
    client, opp_ids, fake = coach_env
    a, b, c, d = opp_ids
    won(client, b)
    record(client, c, {"status": "LOST", "lostReasonCode": "PRICE"})
    won(client, d)
    drop_processes(d)
    fake.answer = reading(
        similar=[
            ("사례 S1", ADVICE),
            ("사례 S9", "없는 사례에서 온 줄은 버립니다."),
            ("사례 S1", "단가를 10% 낮춰 제안해 보세요."),
            ("사례 S1", "[이름] 과장에게 010-1234-5678로 걸어 보세요."),
            ("사례 S1", ADVICE),
        ]
    )

    response = coach(client, a)

    assert response.status_code == 200, response.text
    sent = fake.sent
    assert "[비슷한 성사 사례]" in sent
    assert "[사례 S1]" in sent and "[사례 S2]" not in sent
    assert "결과: 성사" in sent and "결과 사유: " in sent and WON_REASON in sent
    assert "흐름: 10/10 전화 연결됨" in sent
    # 다른 회사 이름은 바꿔 보내고, 메모의 이름·전화는 지운다.
    for planted in (name_of(b), "이영희", "영희", "010-2222-3333"):
        assert planted not in sent, planted
    assert "품질팀 [이름] 과장 통화. 샘플 보내 달라함" in sent
    assert "[이름] 과장 직통 [연락처 제거]" in sent
    assert "[비슷한 성사 사례]" in fake.payloads[0]["instructions"]
    assert "similarAdvice" in fake.payloads[0]["text"]["format"]["schema"]["required"]

    data = response.json()["data"]
    assert [case["oppId"] for case in data["similarCases"]] == [b]
    case = data["similarCases"][0]
    assert case["name"] == name_of(b) and case["sharedProcesses"] and case["sharedIndustries"] == []
    assert data["similarAdvice"] == [{"oppId": b, "name": name_of(b), "text": ADVICE}]
    # 호출 1행은 이 회사에, 함께 실린 성사 회사에는 호출 수 0인 표시 행이 달린다.
    rows = support.logs()
    assert (a, "SALES_COACH", "ALLOWED", 1) in rows
    assert any(row[0] == b and row[3] == 0 for row in rows)
    assert not any(row[0] in (c, d) for row in rows)


def test_order_and_limit_follow_settings(coach_env):
    """Given 공정이 같은 성사 회사 2곳 / When 상한 1 / Then 최근에 성사된 한 곳만 싣는다."""
    client, opp_ids, fake = coach_env
    a, b, c, _d = opp_ids
    won(client, b)
    won(client, c)
    with session_scope() as session:
        older = session.scalars(
            select(Outcome).where(Outcome.opp_id == b, Outcome.status == "WON")
        ).one()
        older.created_at = datetime(2026, 10, 1, tzinfo=UTC)
    support.change_assistant(coachSimilarWonLimit=1)

    data = coach(client, a).json()["data"]

    assert [case["oppId"] for case in data["similarCases"]] == [c]


def test_shared_industry_alone_is_enough(coach_env):
    """Given 공정은 안 겹치고 산업만 겹치는 성사 회사 / When 코치 / Then 겹친 산업과 함께 싣는다."""
    client, opp_ids, _fake = coach_env
    a, b, _c, _d = opp_ids
    won(client, b)
    drop_processes(b)
    set_industries(a, ["자동차 부품", "전자"])
    set_industries(b, ["자동차 부품"])

    data = coach(client, a).json()["data"]

    assert data["similarCases"] == [
        {
            "oppId": b,
            "name": name_of(b),
            "sharedProcesses": [],
            "sharedIndustries": ["자동차 부품"],
        }
    ]


def test_limit_zero_or_no_won_company_keeps_the_old_coach(coach_env):
    """Given 성사 회사가 없거나 상한 0 / When 코치 / Then 사례 칸 없이 지금과 같다(제안도 버림)."""
    client, opp_ids, fake = coach_env
    a, b, _c, _d = opp_ids
    fake.answer = reading(similar=[("사례 S1", ADVICE)])

    first = coach(client, a).json()["data"]
    won(client, b)
    support.change_assistant(coachSimilarWonLimit=0)
    second = coach(client, a).json()["data"]

    for data in (first, second):
        assert data["similarCases"] == [] and data["similarAdvice"] == []
    assert all("[비슷한 성사 사례]" not in payload["input"] for payload in fake.payloads)


def test_old_settings_copy_gets_the_new_limit_from_the_example_file(coach_env):
    """Given 이 칸이 생기기 전에 등록한 DB 사본 / When 설정 읽기 / Then 예시 파일 값으로 채운다."""
    with session_scope() as session:
        row = session.get(AppSetting, "assistant")
        row.value = {k: v for k, v in row.value.items() if k != "coachSimilarWonLimit"}
    with session_scope() as session:
        assert read_app_settings(session).assistant.coach_similar_won_limit == 3
