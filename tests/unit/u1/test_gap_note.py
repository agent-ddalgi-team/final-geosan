"""#259: 검토사항 자료 줄에 자료 조사 메모를 붙인다. 가상 입력·실제 SQLite·실제 API."""

from geosan.records.models import Note
from geosan.storage.session import session_scope
from tests.unit.u1 import test_record_cancel as cancel_support
from tests.unit.u1 import test_sales_records as records

records_env = records.records_env
post = records.post
detail = cancel_support.detail
activity = cancel_support.activity

GAP_KINDS = {"DATA_NOT_FOUND", "DATA_INSUFFICIENT"}


def gap_item(client, opp_id):
    """지금 검토사항의 첫 자료 줄."""
    return next(x for x in detail(client, opp_id)["reviewItems"] if x["kind"] in GAP_KINDS)


def item_of(client, opp_id, item_id):
    return next(x for x in detail(client, opp_id)["reviewItems"] if x["itemId"] == item_id)


def save(client, opp_id, item_id, text, kind="RESEARCH", staff="park-lee"):
    body = {"kind": kind, "text": text, "itemId": item_id}
    return post(client, opp_id, "notes", body, staff=staff)


def test_latest_note_shows_on_the_gap_line_and_scores_stay(records_env):
    """Given 자료 줄 / When 메모를 두 번 붙임 / Then 줄에는 최신만, 이력에는 둘 다, 점수 그대로."""
    client, opp_id = records_env
    before = detail(client, opp_id)
    gap = gap_item(client, opp_id)
    assert gap["note"] is None
    first_text = "홈페이지 연혁에 2023 납품 기재(가상)"
    second_text = "https://example.invalid/history 에서 다시 확인(가상)"
    assert (
        save(client, opp_id, gap["itemId"], "홈페이지 연혁에 2023 납품 기재(가상)").status_code
        == 200
    )
    second = save(
        client, opp_id, gap["itemId"], "https://example.invalid/history 에서 다시 확인(가상)"
    )
    assert second.status_code == 200
    note = item_of(client, opp_id, gap["itemId"])["note"]
    assert note["text"] == "https://example.invalid/history 에서 다시 확인(가상)"
    assert note["by"] == "park-lee" and note["at"]
    others = [x for x in detail(client, opp_id)["reviewItems"] if x["itemId"] != gap["itemId"]]
    assert all(x["note"] is None for x in others)
    label = {"DATA_NOT_FOUND": "자료 못 찾음", "DATA_INSUFFICIENT": "자료 부족"}[gap["kind"]]
    summaries = [x["summary"] for x in activity(client, opp_id) if x["kind"] == "NOTE"]
    assert summaries == [
        f"자료 조사 · [{label}] {gap['text']} · {second_text}",
        f"자료 조사 · [{label}] {gap['text']} · {first_text}",
    ]
    after = detail(client, opp_id)
    assert after["scores"] == before["scores"] and after["evalId"] == before["evalId"]
    with session_scope() as session:
        assert session.get(Note, second.json()["data"]["noteId"]).item_id == gap["itemId"]


def test_gap_note_rejects_question_line_wrong_kind_and_unknown_line(records_env):
    """Given 검토사항 / When 질문 줄·일반 메모·없는 줄·501자 / Then 400·400·404·400이다."""
    client, opp_id = records_env
    gap = gap_item(client, opp_id)
    question = next(
        (x for x in detail(client, opp_id)["reviewItems"] if x["itemId"].startswith("Q:")), None
    )
    question_id = question["itemId"] if question else "Q:none"
    rejected = save(client, opp_id, question_id, "가상 메모")
    assert rejected.status_code == 400
    assert rejected.json()["error"]["message"] == "질문 줄은 [답 적기]로 적어 주세요"
    assert save(client, opp_id, gap["itemId"], "가상 메모", kind="MEMO").status_code == 400
    assert save(client, opp_id, "GAP:REQ:none", "가상 메모").status_code == 404
    assert save(client, opp_id, gap["itemId"], "가" * 501).status_code == 400
    assert save(client, opp_id, gap["itemId"], "가" * 500).status_code == 200
    assert save(client, opp_id, gap["itemId"], "가상", staff="viewer").status_code == 403
    with session_scope() as session:
        assert session.query(Note).count() == 1


def test_plain_note_keeps_the_old_limit_and_has_no_line(records_env):
    """Given 줄 번호 없는 메모 / When 201자·200자 저장 / Then 예전 상한 그대로, 줄에 안 붙는다."""
    client, opp_id = records_env
    assert post(client, opp_id, "notes", {"text": "가" * 201}).status_code == 400
    assert (
        post(client, opp_id, "notes", {"kind": "RESEARCH", "text": "가" * 200}).status_code == 200
    )
    assert all(x["note"] is None for x in detail(client, opp_id)["reviewItems"])
    assert [x["summary"] for x in activity(client, opp_id)] == ["자료 조사 · " + "가" * 200]


def test_cancelled_gap_note_falls_back_to_the_previous_one(records_env):
    """Given 자료 줄 메모 둘 / When 최신을 잘못 입력으로 표시 / Then 줄에는 그 전 메모가 보인다."""
    client, opp_id = records_env
    gap = gap_item(client, opp_id)
    assert save(client, opp_id, gap["itemId"], "첫 메모(가상)").status_code == 200
    newest = save(client, opp_id, gap["itemId"], "잘못 적은 메모(가상)").json()["data"]["noteId"]
    assert cancel_support.cancel(client, opp_id, newest).status_code == 200
    assert item_of(client, opp_id, gap["itemId"])["note"]["text"] == "첫 메모(가상)"
