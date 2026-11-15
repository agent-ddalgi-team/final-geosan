"""#774: 영업 코치 답 아래 할 일 제안·[넣기] 저장·신규 거래처 찾기의 후보 표.

실제 임시 DB·실제 API, 외부 AI는 가짜 응답이다(test_sales_assistant의 가짜 어댑터를 그대로 쓴다).
가상 사례만 쓴다(거산 실제 사양 아님).
"""

from datetime import timedelta

from sqlalchemy import select

from geosan.evidence.transfer import KST
from geosan.opportunity.models import Customer, Opportunity
from geosan.records.models import Note, Outcome
from geosan.storage.base import utcnow
from geosan.storage.session import session_scope
from tests.unit.u7 import test_sales_assistant as base
from tests.unit.u7.test_bookmark import give_opinion, set_bookmark
from tests.unit.u7.test_dashboard import record

dashboard_env = base.dashboard_env
assistant_env = base.assistant_env
STAFF = base.STAFF


def day(offset: int) -> str:
    return (utcnow().astimezone(KST).date() + timedelta(days=offset)).isoformat()


def suggestion(company, action_id="VISIT", date=None):
    return {"company": company, "actionId": action_id, "date": date or day(3)}


def latest(opp_id):
    with session_scope() as session:
        row = session.scalar(
            select(Outcome)
            .where(Outcome.opp_id == opp_id, Outcome.cancelled_at.is_(None))
            .order_by(Outcome.version.desc())
        )
        return None if row is None else (row.status, row.next_schedule_at, row.version, row)


def change_lines(opp_id):
    with session_scope() as session:
        return [
            row.text
            for row in session.scalars(
                select(Note)
                .where(Note.opp_id == opp_id, Note.kind == "CHANGE")
                .order_by(Note.created_at)
            )
        ]


def set_schedule(client, opp_id, body, headers=STAFF):
    return client.post(f"/api/v1/opportunities/{opp_id}/schedule", json=body, headers=headers)


def set_customer(opp_id, **values):
    with session_scope() as session:
        customer = session.get(Customer, session.get(Opportunity, opp_id).customer_id)
        for key, value in values.items():
            setattr(customer, key, value)


# ---------------------------------------------------------------------------
# 답 아래 할 일 제안(AI가 준 것을 프로그램이 검증)
# ---------------------------------------------------------------------------


def test_suggestions_keep_only_checked_companies_actions_and_dates(assistant_env):
    """Given 기록 있는 가상 회사 / When AI가 맞는 제안·틀린 제안을 섞어 준다 /
    Then 조회에 실린 회사·목록의 할 일·오늘 이후 날짜만 남고 지금 일정·기록 번호가 붙는다."""
    client, opp_ids, fake = assistant_env
    base.seed(client, opp_ids)
    _a, name_b, name_c, _d = base.names(opp_ids)
    before = base.row_counts()
    fake.suggestions = [
        suggestion(name_b, "VISIT", day(3)),
        suggestion("없는회사Z", "VISIT", day(3)),  # 조회에 없던 회사
        suggestion(name_c, "BOGUS", day(2)),  # 목록에 없는 할 일
        suggestion(name_c, "END", day(2)),  # 끝은 일정이 아니다
        suggestion(name_c, "QUOTE", day(-1)),  # 지난 날짜
        suggestion(name_c, "QUOTE", "다음 주"),  # 날짜가 아님
        suggestion(name_b, "QUOTE", day(5)),  # 같은 회사는 앞의 하나만
        suggestion(name_c, "RECONTACT", day(0)),
    ]
    response = base.ask(client, "이번 주에 누구를 찾아가면 좋을까?")
    assert response.status_code == 200, response.text
    data = response.json()["data"]
    _status, b_due, b_version, _row = latest(opp_ids[1])
    assert data["suggestions"] == [
        {
            "oppId": opp_ids[1],
            "name": name_b,
            "actionId": "VISIT",
            "actionLabel": "방문",
            "date": day(3),
            "currentScheduleAt": b_due.isoformat(),
            "currentScheduleNote": base.SCHEDULE_NOTE,
            "outcomeVersion": b_version,
        },
        {
            "oppId": opp_ids[2],
            "name": name_c,
            "actionId": "RECONTACT",
            "actionLabel": "다시 연락",
            "date": day(0),
            "currentScheduleAt": None,
            "currentScheduleNote": None,
            "outcomeVersion": 0,
        },
    ]
    (payload,) = fake.payloads
    assert payload["text"]["format"]["name"] == "sales_ask_answer"
    assert payload["text"]["format"]["strict"] is True
    # 지시문에 할 일 보기 목록이 실린다(끝은 빠진다).
    assert "VISIT=방문" in payload["instructions"] and "END=" not in payload["instructions"]
    # 제안은 저장하지 않는다(읽기 전용 그대로).
    assert base.row_counts() == before


def test_suggestions_stop_at_three(assistant_env):
    """Given 제안 4개 / When 질문 / Then 앞의 3개만 남는다."""
    client, opp_ids, fake = assistant_env
    base.seed(client, opp_ids)
    name_a, name_b, name_c, _d = base.names(opp_ids)
    assert set_bookmark(client, opp_ids[3], True).status_code == 200  # d도 조회에 싣는다
    name_d = base.names(opp_ids)[3]
    fake.suggestions = [suggestion(name) for name in (name_a, name_b, name_c, name_d)]
    data = base.ask(client).json()["data"]
    assert [row["name"] for row in data["suggestions"]] == [name_a, name_b, name_c]


def test_answer_that_is_not_the_agreed_shape_is_an_error(assistant_env):
    """Given AI가 정해진 모양이 아닌 글을 준다 / When 질문 / Then 빈 답이 아니라 오류로 알린다."""
    client, opp_ids, fake = assistant_env
    base.seed(client, opp_ids)
    fake.raw = "그냥 글로 답했습니다."
    response = base.ask(client)
    assert response.status_code == 503
    assert response.json()["error"]["kind"] == "LLM_FAILED"


def test_contacts_in_the_structured_answer_are_scrubbed(assistant_env):
    """Given 답 글에 이름·전화 / When 질문 / Then 돌려줄 때 지운다."""
    client, opp_ids, fake = assistant_env
    base.seed(client, opp_ids)
    fake.answer = "담당 홍길동, 010-0000-0000 로 물어보세요."
    answer = base.ask(client).json()["data"]["answer"]
    assert "010-0000-0000" not in answer and "홍길동" not in answer


# ---------------------------------------------------------------------------
# [넣기] 저장: POST /opportunities/{oppId}/schedule
# ---------------------------------------------------------------------------


def test_put_in_for_a_company_without_records_starts_at_not_executed(assistant_env):
    """Given 기록이 없는 회사 / When [넣기] / Then 미접촉 단계로 일정 한 행과 변경 기록 한 줄."""
    client, opp_ids, _fake = assistant_env
    d = opp_ids[3]
    response = set_schedule(
        client, d, {"nextScheduleAt": day(2), "actionId": "VISIT", "expectedVersion": 0}
    )
    assert response.status_code == 200, response.text
    status, due, version, row = latest(d)
    assert (status, due.isoformat(), version) == ("NOT_EXECUTED", day(2), 1)
    assert row.next_schedule_note == "방문" and row.method is None
    (line,) = change_lines(d)
    assert line.endswith("방문 일정 잡음 · 영업 코치 제안"), line
    assert response.json()["data"]["version"] == 1


def test_put_in_replaces_the_schedule_and_keeps_stage_and_lost_reason(assistant_env):
    """Given 일정이 있는 진행 중 회사·거절 회사 / When [넣기] / Then 단계·거절 이유는 그대로,
    일정만 바뀌고 "○ 일정(○) → ○ 방문으로 바꿈" 한 줄이 남는다."""
    client, opp_ids, _fake = assistant_env
    base.seed(client, opp_ids)
    a, b = opp_ids[0], opp_ids[1]
    _s, _due, b_version, _row = latest(b)
    response = set_schedule(
        client, b, {"nextScheduleAt": day(4), "actionId": "VISIT", "expectedVersion": b_version}
    )
    assert response.status_code == 200, response.text
    status, due, version, row = latest(b)
    assert (status, due.isoformat(), version) == ("IN_PROGRESS", day(4), b_version + 1)
    (line,) = change_lines(b)
    assert "→" in line and line.endswith("방문으로 바꿈 · 영업 코치 제안"), line
    # 거절 회사: 거절 이유 코드를 그대로 잇는다.
    _s, _due, a_version, _row = latest(a)
    response = set_schedule(
        client, a, {"nextScheduleAt": day(1), "actionId": "QUOTE", "expectedVersion": a_version}
    )
    assert response.status_code == 200, response.text
    status, due, _version, row = latest(a)
    assert (status, row.lost_reason_code, row.next_schedule_note) == ("LOST", "PRICE", "견적")


def test_put_in_rejects_stale_version_past_date_unknown_action_and_viewer(assistant_env):
    """Given 그 사이 다른 기록 / 지난 날짜 / 없는 할 일 / 보기 전용 / When [넣기] /
    Then 409·400·400·403, 아무것도 저장되지 않는다."""
    client, opp_ids, _fake = assistant_env
    c = opp_ids[2]
    record(client, c, {"status": "IN_PROGRESS"})
    stale = set_schedule(
        client, c, {"nextScheduleAt": day(2), "actionId": "VISIT", "expectedVersion": 0}
    )
    assert stale.status_code == 409
    _s, _due, version, _row = latest(c)
    past = set_schedule(
        client, c, {"nextScheduleAt": day(-1), "actionId": "VISIT", "expectedVersion": version}
    )
    assert past.status_code == 400
    unknown = set_schedule(
        client, c, {"nextScheduleAt": day(2), "actionId": "END", "expectedVersion": version}
    )
    assert unknown.status_code == 400
    viewer = set_schedule(
        client,
        c,
        {"nextScheduleAt": day(2), "actionId": "VISIT", "expectedVersion": version},
        headers=base.VIEWER,
    )
    assert viewer.status_code == 403
    assert latest(c)[2] == version and change_lines(c) == []  # 아무것도 저장되지 않았다.
    missing = set_schedule(
        client, "opp-none", {"nextScheduleAt": day(2), "actionId": "VISIT", "expectedVersion": 0}
    )
    assert missing.status_code == 404


# ---------------------------------------------------------------------------
# 신규 거래처 찾기(page LIST)의 "아직 연락 안 한 후보" 표
# ---------------------------------------------------------------------------


def test_list_page_adds_candidates_not_yet_contacted(assistant_env):
    """Given 접촉한 회사 2곳·관심만 1곳·아무것도 없는 1곳 / When 신규 거래처 찾기에서 묻기 /
    Then 접촉 없는 두 곳이 적합도 순으로 지역·적합도·거리와 함께 실리고 주소 뒷부분은 안 나간다."""
    client, opp_ids, fake = assistant_env
    base.seed(client, opp_ids)
    _a, _b, name_c, name_d = base.names(opp_ids)
    set_customer(opp_ids[2], fit_level="LOW", address="충청남도 천안시 서북구 가상로 7")
    set_customer(opp_ids[3], fit_level="HIGH", address="(31400) 충청남도 아산시 둔포면 가상길 1")
    response = client.post(
        base.ASK_URL, json={"question": "아산 적합도 상 후보?", "page": "LIST"}, headers=STAFF
    )
    assert response.status_code == 200, response.text
    data = response.json()["data"]
    assert data["usedQueries"][-1] == "CANDIDATES"
    sent = fake.payloads[0]["input"]
    table = sent.split("[조회 6. 아직 연락 안 한 후보]")[1]
    assert "접촉 기록이 없고 제외하지 않은 2곳 가운데 2곳" in table
    lines = [line for line in table.splitlines() if " | " in line][1:]
    assert [line.split(" | ")[:3] for line in lines] == [
        [name_d, "충남 아산시", "상"],
        [name_c, "충남 천안시", "하"],
    ]
    assert [line.split(" | ")[4] for line in lines] == ["관심 아님", "관심"]
    for hidden in ("둔포면", "가상길", "서북구", "31400"):
        assert hidden not in sent, hidden
    # 후보 표의 회사도 근거 링크·전송 기록 대상이다.
    fake.answer = f"{name_d}이 가장 맞습니다."
    again = client.post(
        base.ASK_URL, json={"question": "가장 맞는 곳?", "page": "LIST"}, headers=STAFF
    )
    assert again.json()["data"]["sources"] == [{"oppId": opp_ids[3], "name": name_d}]


def test_candidates_skip_excluded_and_other_pages_do_not_get_the_table(assistant_env):
    """Given 대상 아님으로 제외한 회사 / When 신규 거래처 찾기에서 묻기 / Then 후보에서 빠진다.
    다른 화면(대시보드)에서 물으면 후보 표가 없다."""
    client, opp_ids, fake = assistant_env
    base.seed(client, opp_ids)
    name_d = base.names(opp_ids)[3]
    give_opinion(client, opp_ids[3], "NOT_TARGET")
    client.post(base.ASK_URL, json={"question": "후보?", "page": "LIST"}, headers=STAFF)
    table = fake.payloads[0]["input"].split("[조회 6. 아직 연락 안 한 후보]")[1]
    assert name_d not in table
    client.post(base.ASK_URL, json={"question": "후보?", "page": "DASHBOARD"}, headers=STAFF)
    assert "[조회 6." not in fake.payloads[1]["input"]
    assert client.post(
        base.ASK_URL, json={"question": "후보?", "page": "ELSEWHERE"}, headers=STAFF
    ).status_code in (400, 422)


def test_list_page_answers_even_without_bookmarks_or_contacts(assistant_env):
    """Given 관심도 접촉도 없다 / When 신규 거래처 찾기에서 묻기 / Then 후보 표만으로 답한다
    (다른 화면에서는 지금처럼 "답할 자료가 없음")."""
    client, opp_ids, fake = assistant_env
    elsewhere = base.ask(client)
    assert elsewhere.status_code == 422
    response = client.post(base.ASK_URL, json={"question": "후보?", "page": "LIST"}, headers=STAFF)
    assert response.status_code == 200, response.text
    assert "4곳 가운데 4곳" in fake.payloads[0]["input"]
