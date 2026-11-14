"""#731: 변경 기록(rec_note kind CHANGE)이 어디까지 보이고 어디로는 안 나가는지.

- 대시보드 최근 내 기록: 종류만 "변경 기록을 남김", 본문은 싣지 않는다.
- 비슷한 회사의 마지막 메모(lastNote): 변경 기록은 넣지 않는다(메모·자료 조사·답 이력만).
- 메모 읽기(외부 AI): 변경 기록은 읽지 않는다(400), 아무것도 나가지 않는다.
실제 임시 DB·실제 API, 외부 AI는 가짜 응답이다. 가상 사례만 쓴다(거산 실제 사양 아님).
"""

from datetime import timedelta

from geosan.opportunity.models import Opportunity
from geosan.records.program_note import add_program_note
from geosan.storage.base import utcnow
from geosan.storage.session import session_scope
from tests.unit.u7 import test_dashboard as dashboard
from tests.unit.u7 import test_memo_read as memo
from tests.unit.u7 import test_peers as peers
from tests.unit.u7 import test_sales_assistant as support

dashboard_env = dashboard.dashboard_env
assistant_env = support.assistant_env
STAFF = {"X-Staff-Key": "park-lee"}
SECRET = "변경ZZ9 · 아노다이징 → 아연도금(전기아연도금)"


def add_change(opp_id, text=SECRET, *, later=0):
    with session_scope() as session:
        row = add_program_note(
            session,
            session.get(Opportunity, opp_id),
            text,
            staff="park-lee",
            now=utcnow() + timedelta(seconds=later),
        )
        session.flush()
        return row.note_id


def test_dashboard_recent_shows_change_kind_only(dashboard_env):
    """Given 변경 기록 / When GET /dashboard / Then "변경 기록을 남김"만 보이고 본문은 없다."""
    client, (a, *_rest) = dashboard_env
    # 최근 내 기록은 관심 기업 안에서만 센다. 변경 기록은 관심을 켜지 않으므로 먼저 켠다.
    url = f"/api/v1/opportunities/{a}/bookmark"
    bookmark = client.put(url, json={"active": True}, headers=STAFF)
    assert bookmark.status_code == 200, bookmark.text
    add_change(a)
    response = client.get("/api/v1/dashboard", headers=STAFF)
    assert response.status_code == 200
    assert SECRET not in response.text
    rows = response.json()["data"]["recentActivity"]
    assert [(row["kind"], row["summary"]) for row in rows] == [("NOTE", "변경 기록을 남김")]


def test_peer_last_note_skips_change_records(dashboard_env):
    """Given 다른 회사에 메모 뒤 변경 기록 / When 비슷한 회사 조회 / Then 마지막 메모는 메모다."""
    client, (a, b, *_rest) = dashboard_env
    peers.note(client, b, "가상 메모 한 줄")
    add_change(b, later=60)
    data = peers.get_peers(client, a)
    row = next(row for row in data["companies"] if row["oppId"] == b)
    assert row["lastNote"]["text"] == "가상 메모 한 줄"
    assert SECRET not in str(data)


def test_peer_without_memo_has_no_last_note(dashboard_env):
    """Given 변경 기록뿐인 회사 / When 비슷한 회사 조회 / Then lastNote는 비어 있다."""
    client, (a, b, *_rest) = dashboard_env
    add_change(b)
    row = next(row for row in peers.get_peers(client, a)["companies"] if row["oppId"] == b)
    assert row["lastNote"] is None


def test_memo_read_refuses_change_records_and_sends_nothing(assistant_env):
    """Given 변경 기록 / When 메모 읽기를 부름 / Then 400이고 외부 AI는 불리지 않는다."""
    client, opp_ids, fake = assistant_env
    note_id = add_change(opp_ids[0])
    response = memo.memo_read(client, opp_ids[0], note_id)
    assert response.status_code == 400
    assert fake.payloads == [] and support.logs() == []
