"""#849: 활동 이력 한 줄에 화면이 나눠 보일 값(단계·방법·결과·다음 일정·메모 종류)을 따로 싣는다.

화면이 흐름 줄·내용 카드·AI 피드백을 글(summary) 쪼개기 없이 나누려고 더한 칸이다.
더하는 변경이고 DB는 그대로다.
기존 summary 글은 그대로이고, 잘못 입력 행의 메모·글은 summary처럼 싣지 않는다.
가상 입력·실제 SQLite·실제 API. 글은 가짜 문장이다(거산 실제 기록 아님).
"""

from tests.unit.u1 import test_record_cancel as cancel_helpers
from tests.unit.u1 import test_sales_records as records
from tests.unit.u7.test_peers import note

records_env = records.records_env
post = records.post
activity = cancel_helpers.activity
cancel = cancel_helpers.cancel

CALL = {"status": "IN_PROGRESS", "method": "CALL", "result": "REACHED"}
OUTCOME_FIELDS = (
    "status",
    "method",
    "result",
    "attemptedAt",
    "nextScheduleAt",
    "nextScheduleNote",
    "lostReasonCode",
    "firstMover",
    "memo",
)


def lines_of(client, opp_id, kind):
    return [item for item in activity(client, opp_id) if item["kind"] == kind]


def test_contact_line_carries_its_values_and_keeps_the_summary(records_env):
    """Given 상대가 먼저 건 통화(메모·일정) / When 이력 / Then 값은 칸마다, 글은 그대로."""
    client, opp_id = records_env
    body = CALL | {
        "memo": "샘플 다음 주 회신(가상)",
        "attemptedAt": "2026-11-10",
        "nextScheduleAt": "2099-01-05",
        "nextScheduleNote": "샘플 확인",
        "answers": [{"questionId": "WHO_FIRST", "answerId": "THEIRS"}],
    }
    saved = post(client, opp_id, "outcomes", body)
    assert saved.status_code == 200, saved.text
    (line,) = lines_of(client, opp_id, "CONTACT_ATTEMPT")
    assert line["status"] == "IN_PROGRESS"
    assert (line["method"], line["result"]) == ("CALL", "REACHED")
    assert line["attemptedAt"] == "2026-11-10"
    assert (line["nextScheduleAt"], line["nextScheduleNote"]) == ("2099-01-05", "샘플 확인")
    assert line["firstMover"] == "상대가"
    assert line["memo"] == "샘플 다음 주 회신(가상)"
    assert line["lostReasonCode"] is None
    assert (line["noteKind"], line["text"]) == (None, None)
    # 기존 글은 바꾸지 않는다(다른 화면·시험이 쓴다).
    assert (
        "2026-11-10 전화 연결됨 · 상대가 먼저 · 다음 일정 2099-01-05 샘플 확인" in line["summary"]
    )
    assert line["summary"].endswith("메모: 샘플 다음 주 회신(가상)")


def test_stage_only_line_has_status_but_no_contact_values(records_env):
    """Given 접촉 없이 거절로 바꾼 기록 / When 이력 / Then 단계·거절 이유만, 방법·결과는 빈다."""
    client, opp_id = records_env
    saved = post(
        client,
        opp_id,
        "outcomes",
        {"status": "LOST", "lostReasonCode": "PRICE", "reason": "단가가 맞지 않음(가상)"},
    )
    assert saved.status_code == 200, saved.text
    (line,) = lines_of(client, opp_id, "OUTCOME")
    assert (line["status"], line["lostReasonCode"]) == ("LOST", "PRICE")
    assert (line["method"], line["result"], line["attemptedAt"]) == (None, None, None)
    assert (line["firstMover"], line["memo"]) == (None, None)


def test_default_first_mover_is_left_empty(records_env):
    """Given 우리가 먼저 건 통화(기본 보기) / When 이력 / Then firstMover는 빈다(글에도 없음)."""
    client, opp_id = records_env
    body = CALL | {"answers": [{"questionId": "WHO_FIRST", "answerId": "OURS"}]}
    assert post(client, opp_id, "outcomes", body).status_code == 200
    (line,) = lines_of(client, opp_id, "CONTACT_ATTEMPT")
    assert line["firstMover"] is None
    assert "먼저" not in line["summary"]


def test_cancelled_contact_drops_the_memo_but_keeps_the_other_values(records_env):
    """Given 메모를 쓴 통화 / When 잘못 입력으로 표시 / Then memo는 비고 단계·방법 값은 남는다."""
    client, opp_id = records_env
    assert post(client, opp_id, "outcomes", CALL | {"memo": "지울 메모(가상)"}).status_code == 200
    (line,) = lines_of(client, opp_id, "CONTACT_ATTEMPT")
    assert cancel(client, opp_id, line["recordId"]).status_code == 200
    (after,) = lines_of(client, opp_id, "CONTACT_ATTEMPT")
    assert after["cancelled"] is True
    assert after["memo"] is None
    assert (after["status"], after["method"]) == ("IN_PROGRESS", "CALL")
    assert "지울 메모(가상)" not in client.get(f"/api/v1/opportunities/{opp_id}/activity").text


def test_advice_and_call_prep_are_told_apart_by_note_kind(records_env):
    """Given 남긴 피드백·통화 준비 / When 이력 / Then noteKind로 갈리고 text는 앞머리가 없다."""
    client, opp_id = records_env
    note(client, opp_id, "납기 걱정에 답을 아직 못 줬어요(가상).", kind="ADVICE")
    note(client, opp_id, "샘플이 필요한지 물어보세요.\n담당 부서를 확인하세요.", kind="CALL_PREP")
    lines = {item["noteKind"]: item for item in lines_of(client, opp_id, "ADVICE")}
    assert set(lines) == {"ADVICE", "CALL_PREP"}
    assert lines["ADVICE"]["text"] == "납기 걱정에 답을 아직 못 줬어요(가상)."
    assert lines["ADVICE"]["summary"] == "남긴 피드백 · 납기 걱정에 답을 아직 못 줬어요(가상)."
    assert lines["CALL_PREP"]["text"] == "샘플이 필요한지 물어보세요.\n담당 부서를 확인하세요."
    assert lines["CALL_PREP"]["summary"].startswith("다음 통화 준비 · ")
    for item in lines.values():
        assert all(item[field] is None for field in OUTCOME_FIELDS)


def test_memo_line_has_note_kind_and_cancelled_memo_has_no_text(records_env):
    """Given 메모 한 줄 / When 잘못 입력 표시 / Then noteKind는 남고 text는 비고 글도 안 나간다."""
    client, opp_id = records_env
    note_id = note(client, opp_id, "지울 메모 글(가상)")
    (line,) = lines_of(client, opp_id, "NOTE")
    assert (line["noteKind"], line["text"]) == ("MEMO", "지울 메모 글(가상)")
    assert cancel(client, opp_id, note_id).status_code == 200
    (after,) = lines_of(client, opp_id, "NOTE")
    assert (after["noteKind"], after["text"], after["cancelled"]) == ("MEMO", None, True)
    assert "지울 메모 글(가상)" not in client.get(f"/api/v1/opportunities/{opp_id}/activity").text


def test_other_lines_leave_the_new_fields_empty(records_env):
    """Given 의견 같은 줄 / When 이력 / Then 새 칸은 모두 비어 있다(해당 없는 줄은 null)."""
    client, opp_id = records_env
    eval_id = next(
        row["evalId"]
        for row in client.get("/api/v1/opportunities").json()["data"]
        if row["oppId"] == opp_id
    )
    body = {"evalId": eval_id, "opinion": "WORTH_REVIEW"}
    assert post(client, opp_id, "opinions", body).status_code == 200
    others = [item for item in activity(client, opp_id) if item.get("recordKind") is None]
    assert others, "의견 줄이 있어야 한다"
    for item in others:
        assert all(item[field] is None for field in (*OUTCOME_FIELDS, "noteKind", "text"))
