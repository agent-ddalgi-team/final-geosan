"""#731: 프로그램이 남기는 한 줄은 메모 종류 "변경 기록"(CHANGE)으로 저장하고 메모와 구분한다.

PM 결정 2026-11-14: 새 칸 없이 코드표 값 하나만 더한다. 활동 이력에서 "변경 기록"으로 보이고
[잘못 입력] 단추(recordId)가 없다. 이미 저장된 옛 줄(kind MEMO)은 그대로 메모로 보인다.
실제 임시 DB·실제 API로 본다. 외부 호출 없음. 가상 사례만 쓴다(거산 실제 사양 아님).
"""

from sqlalchemy import select

from geosan.records.models import Note
from geosan.records.program_note import CHANGE_KIND
from geosan.rules.codes import NoteKind
from geosan.storage.base import new_id, utcnow
from geosan.storage.session import session_scope
from tests.unit.u1 import test_industry_chips as chips
from tests.unit.u1 import test_sales_records as records

confirm_env = chips.confirm_env
records_env = records.records_env
STAFF = {"X-Staff-Key": "park-lee"}


def activity(client, opp_id):
    response = client.get(f"/api/v1/opportunities/{opp_id}/activity")
    assert response.status_code == 200, response.text
    return response.json()["data"]


def notes_of(opp_id):
    with session_scope() as session:
        rows = session.scalars(select(Note).where(Note.opp_id == opp_id).order_by(Note.version))
        return [(row.kind, row.text, row.cancelled_at) for row in rows]


def change_id(opp_id):
    with session_scope() as session:
        return session.scalars(
            select(Note.note_id).where(Note.opp_id == opp_id, Note.kind == "CHANGE")
        ).one()


def test_code_table_has_the_change_kind():
    """Given 코드표 / When 메모 종류를 읽음 / Then 약속대로 CHANGE가 끝에 더해져 있다."""
    assert NoteKind.CHANGE == "CHANGE"
    assert list(NoteKind)[-1] == "CHANGE"
    # 기록 부품은 규칙 부품을 가져오지 않아 같은 값을 글자로 둔다. 두 값이 같아야 한다.
    assert CHANGE_KIND == NoteKind.CHANGE


def test_program_line_is_saved_as_change_and_shown_without_cancel(confirm_env):
    """Given 산업군 칩 / When 담당자가 확정 / Then 변경 기록으로 저장되고 취소 번호 없이 보인다."""
    client, opp_id, _ = confirm_env
    response = chips.save(client, opp_id, ["반도체"])
    assert response.status_code == 200, response.text
    assert [(kind, text) for kind, text, _ in notes_of(opp_id)] == [
        ("CHANGE", "상세에서 산업 확정 · 반도체")
    ]
    lines = [row for row in activity(client, opp_id) if row["kind"] in {"NOTE", "CHANGE"}]
    assert len(lines) == 1
    line = lines[0]
    assert (line["kind"], line["summary"], line["actor"]) == (
        "CHANGE",
        "상세에서 산업 확정 · 반도체",
        "park-lee",
    )
    assert line["recordId"] is None and line["recordKind"] is None
    assert line["cancelled"] is False


def test_change_record_cannot_be_cancelled(confirm_env):
    """Given 변경 기록 / When 그 번호로 잘못 입력 표시 / Then 404이고 아무것도 바뀌지 않는다."""
    client, opp_id, _ = confirm_env
    assert chips.save(client, opp_id, ["반도체"]).status_code == 200
    note_id = change_id(opp_id)
    response = client.post(
        f"/api/v1/opportunities/{opp_id}/records/{note_id}/cancel",
        json={"reason": "가상 이유"},
        headers=STAFF,
    )
    assert response.status_code == 404
    assert response.json()["error"]["message"] == "잘못 입력으로 표시할 수 있는 기록이 아닙니다."
    assert notes_of(opp_id)[0][2] is None
    assert not [row for row in activity(client, opp_id) if row["kind"] == "RECORD_CANCELLED"]


def test_notes_request_cannot_send_change(records_env):
    """Given 메모 입력 / When 종류를 CHANGE로 보냄 / Then 400이고 새 행이 없다(REPLY와 같음)."""
    client, opp_id = records_env
    for kind in ("CHANGE", "REPLY"):
        response = records.post(client, opp_id, "notes", {"kind": kind, "text": "가상 변경"})
        assert response.status_code == 400, response.text
    assert notes_of(opp_id) == []


def test_old_program_lines_saved_as_memo_stay_memos(records_env):
    """Given 전에 메모 종류로 저장된 프로그램 줄 / When 활동 이력 / Then 지금처럼 메모로 보인다."""
    client, opp_id = records_env
    with session_scope() as session:
        session.add(
            Note(
                note_id=new_id("note"),
                opp_id=opp_id,
                staff_key="park-lee",
                text="공정 변경 · 아노다이징 → 아연도금(전기아연도금)",
                kind="MEMO",
                version=1,
                created_at=utcnow(),
                created_by="park-lee",
            )
        )
    line = next(row for row in activity(client, opp_id) if row["kind"] == "NOTE")
    assert line["summary"] == "공정 변경 · 아노다이징 → 아연도금(전기아연도금)"
    assert line["recordKind"] == "NOTE" and line["recordId"].startswith("note")
