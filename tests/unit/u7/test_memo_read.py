"""#720: 메모 읽기(메모를 AI가 읽고 요약·변경 제안). 실제 임시 DB·실제 API, 외부 AI는 가짜 응답이다.

실제 AI는 부르지 않는다. 가짜 어댑터가 받은 글을 붙잡아 "무엇이 나갔는지"를 본다.
가상 사례만 쓴다(거산 실제 사양 아님). 메모의 사람 이름·전화는 모두 지어낸 것이다.
"""

import json
from datetime import timedelta

import pytest

from geosan.evidence.transfer import KST
from geosan.records.models import Note
from geosan.storage.base import utcnow
from geosan.storage.session import session_scope
from tests.unit.u1.test_sales_confirm import links
from tests.unit.u7 import test_sales_assistant as support
from tests.unit.u7.test_peers import note

dashboard_env = support.dashboard_env
assistant_env = support.assistant_env
record = support.record

STAFF = support.STAFF
MEMO = "김철수 과장과 통화. 아연도금으로 바꾸고 싶다고 함. 수요일 샘플 보내기로. 010-0000-0000"
OTHER_MEMO = "철수가 다음 주에 도면을 준다고 함. 홍길동 동석"
LINE_MEMO = "김철수 과장과 통화. 아연도금으로 바꾸고 싶다고 함."
SCRUBBED = "[이름] 과장과 통화. 아연도금으로 바꾸고 싶다고 함. 수요일 샘플 보내기로. [연락처 제거]"


def day(offset):
    return (utcnow().astimezone(KST).date() + timedelta(days=offset)).isoformat()


def reading(summary="공정을 아연도금으로 바꾸려 함. 샘플 예정", proposals=()):
    return json.dumps({"summary": summary, "proposals": list(proposals)}, ensure_ascii=False)


def proposal(kind, values, quote, date=None):
    return {"kind": kind, "values": values, "date": date, "quote": quote}


PROCESS_CHANGE = proposal("PROCESS", ["ZINC_PLATING"], "아연도금으로 바꾸고 싶다고 함")


def memo_read(client, opp_id, record_id, kind="NOTE", headers=STAFF):
    return client.post(
        f"/api/v1/opportunities/{opp_id}/assistant/memo-read",
        json={"recordKind": kind, "recordId": record_id},
        headers=headers,
    )


@pytest.fixture
def memo_env(assistant_env):
    """회사 a에 메모 둘(읽을 메모 + 이름을 알아 두는 데만 쓰는 다른 메모)."""
    client, opp_ids, fake = assistant_env
    other = note(client, opp_ids[0], OTHER_MEMO)
    target = note(client, opp_ids[0], MEMO)
    fake.answer = reading(proposals=[PROCESS_CHANGE])
    return client, opp_ids, fake, target, other


def test_only_the_scrubbed_memo_and_picked_values_go_out(memo_env):
    """Given 이름·전화가 적힌 메모 / When 메모 읽기 / Then 지운 사본과 고른 값만 나간다."""
    client, opp_ids, fake, target, _ = memo_env
    before, counts = links(opp_ids[0]), support.row_counts()
    response = memo_read(client, opp_ids[0], target)
    assert response.status_code == 200, response.text
    (payload,) = fake.payloads
    assert payload["input"].startswith(SCRUBBED)
    # 이름·전화는 나가지 않는다. 같은 회사의 다른 메모도 나가지 않는다.
    for planted in ("김철수", "철수", "홍길동", "010-0000-0000", "도면을 준다고", "park-lee"):
        assert planted not in fake.sent, planted
    # 고른 값 한 줄: 오늘 날짜, 회사 이름, 확정 공정.
    assert "[이 회사의 지금 값]" in payload["input"]
    assert support.names(opp_ids[:1])[0] in payload["input"]
    assert "아노다이징" in payload["input"]
    # 고를 수 있는 값은 지시문에 실린다. 응답은 정해진 모양으로만 받는다.
    assert "ZINC_PLATING=아연도금(전기아연도금)" in payload["instructions"]
    assert "RECONTACT=다시 연락" in payload["instructions"]
    assert "END=" not in payload["instructions"]
    assert payload["text"]["format"]["type"] == "json_schema"
    assert payload["store"] is False
    # 읽기 전용: 전송 기록 1행만 늘고 회사 값·기록은 그대로다.
    assert support.logs() == [(opp_ids[0], "SALES_RECORD", "ALLOWED", 1)]
    assert links(opp_ids[0]) == before and support.row_counts() == counts
    with session_scope() as session:
        assert session.get(Note, target).text == MEMO


def test_answer_has_summary_and_checked_proposals(memo_env):
    """Given AI가 공정 변경·일정을 제안 / When 메모 읽기 / Then 지금 값 → 새 값과 근거가 온다."""
    client, opp_ids, fake, target, _ = memo_env
    fake.answer = reading(
        proposals=[
            PROCESS_CHANGE,
            proposal("NEXT_SCHEDULE", ["SEND_MATERIAL"], "수요일 샘플 보내기로", day(3)),
            proposal("INDUSTRY", ["반도체"], "[이름] 과장과 통화"),
        ]
    )
    data = memo_read(client, opp_ids[0], target).json()["data"]
    assert data["summary"] == "공정을 아연도금으로 바꾸려 함. 샘플 예정"
    assert data["aiGenerated"] is True
    assert (data["removedNames"], data["removedContacts"]) == (1, 1)
    assert data["proposals"] == [
        {
            "kind": "PROCESS",
            "values": ["ZINC_PLATING"],
            "before": ["아노다이징"],
            "after": ["아연도금(전기아연도금)"],
            "date": None,
            "quote": "아연도금으로 바꾸고 싶다고 함",
        },
        {
            "kind": "NEXT_SCHEDULE",
            "values": ["SEND_MATERIAL"],
            "before": [],
            "after": ["자료 보내기"],
            "date": day(3),
            "quote": "수요일 샘플 보내기로",
        },
        {
            "kind": "INDUSTRY",
            "values": ["반도체"],
            "before": [],
            "after": ["반도체"],
            "date": None,
            "quote": "[이름] 과장과 통화",
        },
    ]


@pytest.mark.parametrize(
    "bad",
    [
        proposal("PROCESS", ["NOT_A_PROCESS"], "아연도금으로 바꾸고 싶다고 함"),
        proposal("PROCESS", ["ZINC_PLATING"], "메모에 없는 구절"),
        proposal("PROCESS", ["ZINC_PLATING"], ""),
        proposal("PROCESS", ["ANODIZING"], "아연도금으로 바꾸고 싶다고 함"),  # 지금 값과 같다
        proposal("PROCESS", [], "아연도금으로 바꾸고 싶다고 함"),
        proposal("PROCESS", ["ZINC_PLATING"], "수요일 샘플 보내기로", day(3)),
        proposal("INDUSTRY", ["없는 산업"], "수요일 샘플 보내기로"),
        proposal(
            "INDUSTRY", ["방위산업", "반도체", "자동차 부품", "기계·설비"], "수요일 샘플 보내기로"
        ),
        proposal("NEXT_SCHEDULE", ["END"], "수요일 샘플 보내기로", day(3)),
        proposal("NEXT_SCHEDULE", ["RECONTACT"], "수요일 샘플 보내기로", day(-1)),
        proposal("NEXT_SCHEDULE", ["RECONTACT"], "수요일 샘플 보내기로", "수요일"),
        proposal("NEXT_SCHEDULE", ["RECONTACT"], "수요일 샘플 보내기로"),
        proposal("NEXT_SCHEDULE", ["RECONTACT", "VISIT"], "수요일 샘플 보내기로", day(3)),
    ],
)
def test_made_up_or_unsupported_proposals_are_dropped(memo_env, bad):
    """Given 목록에 없는 값·근거 없는 제안 / When 메모 읽기 / Then 그 제안은 버리고 요약만 온다."""
    client, opp_ids, fake, target, _ = memo_env
    fake.answer = reading(proposals=[bad])
    response = memo_read(client, opp_ids[0], target)
    assert response.status_code == 200, response.text
    assert response.json()["data"]["proposals"] == []


def test_only_the_first_usable_proposal_of_a_kind_is_kept(memo_env):
    client, opp_ids, fake, target, _ = memo_env
    second = proposal("PROCESS", ["CHROMATE"], "아연도금으로 바꾸고 싶다고 함")
    fake.answer = reading(proposals=[PROCESS_CHANGE, second])
    proposals = memo_read(client, opp_ids[0], target).json()["data"]["proposals"]
    assert [item["values"] for item in proposals] == [["ZINC_PLATING"]]


def test_no_proposals_is_a_normal_answer(memo_env):
    client, opp_ids, fake, target, _ = memo_env
    fake.answer = reading(summary="안부만 나눔")
    data = memo_read(client, opp_ids[0], target).json()["data"]
    assert (data["summary"], data["proposals"]) == ("안부만 나눔", [])


def test_names_and_contacts_in_the_summary_are_removed_again(memo_env):
    """Given AI가 요약에 이름·전화를 적음 / When 메모 읽기 / Then 돌려주기 전에 한 번 더 지운다."""
    client, opp_ids, fake, target, _ = memo_env
    fake.answer = reading(summary="김철수 과장이 010-0000-0000으로 회신. 철수가 샘플 요청")
    summary = memo_read(client, opp_ids[0], target).json()["data"]["summary"]
    assert summary == "[이름] 과장이 [연락처 제거]으로 회신. [이름]가 샘플 요청"


def test_one_line_memo_of_a_contact_can_be_read(assistant_env):
    """Given 한 줄 메모가 있는 통화 기록 / When 메모 읽기 / Then 그 메모가 지운 사본으로 나간다."""
    client, opp_ids, fake = assistant_env
    record(
        client,
        opp_ids[0],
        # 한 줄 메모에는 전화번호를 적을 수 없다(저장 때 거부). 이름은 적을 수 있다.
        {"status": "IN_PROGRESS", "method": "CALL", "result": "REACHED", "memo": LINE_MEMO},
    )
    activity = client.get(f"/api/v1/opportunities/{opp_ids[0]}/activity").json()["data"]
    record_id = next(row["recordId"] for row in activity if row.get("recordKind") == "OUTCOME")
    fake.answer = reading()
    response = memo_read(client, opp_ids[0], record_id, kind="OUTCOME")
    assert response.status_code == 200, response.text
    assert fake.payloads[0]["input"].startswith(
        "[이름] 과장과 통화. 아연도금으로 바꾸고 싶다고 함.\n"
    )
    assert "김철수" not in fake.sent


def test_switch_off_rejects_and_sends_nothing(memo_env):
    """Given 영업 기록 전용 스위치 꺼짐 / When 메모 읽기 / Then 422, 거부 기록만, 호출 없음."""
    client, opp_ids, fake, target, _ = memo_env
    support.use_external_ai(salesRecordsEnabled=False)
    response = memo_read(client, opp_ids[0], target)
    assert response.status_code == 422, response.text
    assert response.json()["error"]["kind"] == "SALES_RECORDS_DISABLED"
    assert fake.payloads == []
    assert support.logs() == [(opp_ids[0], "SALES_RECORD", "REJECTED", 0)]


def test_daily_limit_is_shared_with_the_other_assistant_calls(memo_env):
    """Given 하루 한도 1 / When 메모 읽기 뒤 통화 준비·메모 읽기 / Then 503 ASSISTANT_LIMIT."""
    client, opp_ids, fake, target, _ = memo_env
    support.change_assistant(dailyQuestionLimit=1)
    assert memo_read(client, opp_ids[0], target).status_code == 200
    for response in (memo_read(client, opp_ids[0], target), support.call_prep(client, opp_ids[0])):
        assert response.status_code == 503
        assert response.json()["error"]["kind"] == "ASSISTANT_LIMIT"
    assert len(fake.payloads) == 1


@pytest.mark.parametrize("answer", ["요약만 적은 글", '{"summary": "모양이 다름"}', "{}"])
def test_answer_in_the_wrong_shape_is_a_failure_not_an_empty_result(memo_env, answer):
    """Given AI 답 모양이 다름 / When 메모 읽기 / Then 503 LLM_FAILED(빈 결과로 안 넘김)."""
    client, opp_ids, fake, target, _ = memo_env
    fake.answer = answer
    response = memo_read(client, opp_ids[0], target)
    assert response.status_code == 503, response.text
    assert response.json()["error"]["kind"] == "LLM_FAILED"
    # 호출은 나갔으므로 전송 기록 1행은 남는다.
    assert support.logs() == [(opp_ids[0], "SALES_RECORD", "ALLOWED", 1)]


@pytest.mark.parametrize("headers", [support.VIEWER, {}])
def test_viewer_and_missing_staff_key_are_forbidden(memo_env, headers):
    client, opp_ids, fake, target, _ = memo_env
    assert memo_read(client, opp_ids[0], target, headers=headers).status_code == 403
    assert fake.payloads == [] and support.logs() == []


def test_records_that_cannot_be_read_are_refused_and_nothing_is_sent(memo_env):
    """없는 기록·다른 회사 기록은 404, 취소한 메모·자료 조사 메모·한 줄 메모 없는 접촉은 400."""
    client, opp_ids, fake, target, _ = memo_env
    a, b = opp_ids[:2]
    assert memo_read(client, a, "note-missing").status_code == 404
    assert memo_read(client, b, target).status_code == 404
    assert memo_read(client, "opp-missing", target).status_code == 404
    research = note(client, a, "자료 조사 메모", kind="RESEARCH")
    assert memo_read(client, a, research).status_code == 400
    record(client, a, {"status": "IN_PROGRESS", "method": "CALL", "result": "ABSENT"})
    activity = client.get(f"/api/v1/opportunities/{a}/activity").json()["data"]
    outcome_id = next(row["recordId"] for row in activity if row.get("recordKind") == "OUTCOME")
    assert memo_read(client, a, outcome_id, kind="OUTCOME").status_code == 400
    cancelled = client.post(
        f"/api/v1/opportunities/{a}/records/{target}/cancel",
        json={"reason": "잘못 적음"},
        headers=STAFF,
    )
    assert cancelled.status_code == 200, cancelled.text
    assert memo_read(client, a, target).status_code == 400
    assert fake.payloads == [] and support.logs() == []
