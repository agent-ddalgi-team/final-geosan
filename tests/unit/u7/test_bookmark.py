"""#356: 관심(찜) 켜고 끄기, 자동 관심, 목록 거르기, 카드·상세 표시를 실제 SQLite와 API로 본다.

관심은 영업 단계가 아니라 따로 켜고 끄는 표시다(계약 v3, PM 결정 2026-11-06).
대시보드 칸 검사는 `test_bookmark_board.py`에 있다. 가상 사례만 쓴다(거산 실제 사양 아님).
"""

import pytest
from sqlalchemy import event, func, select

from geosan.records.models import Bookmark, Note, Outcome, ReviewOpinion
from geosan.storage.session import session_scope
from tests.unit.u7.test_dashboard import dashboard_env, record  # noqa: F401

URL = "/api/v1/opportunities"
MINE = {"X-Staff-Key": "park-lee"}
REFUSAL_MESSAGE = "기록이 있는 회사는 관심에서 뺄 수 없습니다"
REFUSAL_NEXT_ACTION = "빼려면 검토 의견을 '검토 대상 제외'로 저장해 주세요"


def set_bookmark(client, opp_id, active, staff="park-lee", **extra):
    headers = {"X-Staff-Key": staff} if staff is not None else {}
    return client.put(f"{URL}/{opp_id}/bookmark", json={"active": active, **extra}, headers=headers)


def eval_ids(client):
    cards = client.get(URL, params={"pageSize": 50}).json()["data"]
    return {card["oppId"]: card["evalId"] for card in cards}


def give_opinion(client, opp_id, opinion, staff="park-lee"):
    body = {"evalId": eval_ids(client)[opp_id], "opinion": opinion}
    if opinion == "NOT_TARGET":
        body["reason"] = "가상 제외 사유"
    response = client.post(f"{URL}/{opp_id}/opinions", json=body, headers={"X-Staff-Key": staff})
    assert response.status_code == 200, response.text
    return response


def write_note(client, opp_id, text="가상 메모", staff="park-lee"):
    response = client.post(
        f"{URL}/{opp_id}/notes", json={"text": text}, headers={"X-Staff-Key": staff}
    )
    assert response.status_code == 200, response.text
    return response


def bookmark_rows(opp_id=None):
    with session_scope() as session:
        query = select(Bookmark).order_by(Bookmark.opp_id, Bookmark.version)
        if opp_id is not None:
            query = query.where(Bookmark.opp_id == opp_id)
        return [
            (row.opp_id, row.version, row.active, row.source, row.staff_key)
            for row in session.scalars(query)
        ]


def listed_ids(client, **params):
    response = client.get(URL, params={"pageSize": 50, **params})
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["meta"]["total"] == len(body["data"])
    return {card["oppId"] for card in body["data"]}


# ---------------------------------------------------------------------------
# 자동 관심
# ---------------------------------------------------------------------------


@pytest.mark.parametrize("kind", ["notes", "outcomes", "opinions"])
def test_saving_a_record_turns_bookmark_on(dashboard_env, kind):  # noqa: F811
    """Given 관심이 꺼진 회사 / When 메모·영업 기록·의견 저장 / Then 같은 저장에서 관심이 켜진다."""
    client, (a, b, *_rest) = dashboard_env
    assert bookmark_rows() == []
    if kind == "notes":
        write_note(client, a, staff="kim-gwajang")
    elif kind == "outcomes":
        record(client, a, {"status": "IN_PROGRESS"}, staff="kim-gwajang")
    else:
        give_opinion(client, a, "NEED_CHECK", staff="kim-gwajang")
    assert bookmark_rows() == [(a, 1, True, "AUTO_RECORD", "kim-gwajang")]
    detail = client.get(f"{URL}/{a}").json()["data"]["records"]["bookmark"]
    assert detail["active"] is True and detail["updatedBy"] == "kim-gwajang"
    assert listed_ids(client, bookmarked="true") == {a}
    # 이미 켜져 있으면 기록을 더 남겨도 관심 행이 늘지 않는다.
    write_note(client, a)
    record(client, a, {"status": "ON_HOLD"})
    assert bookmark_rows() == [(a, 1, True, "AUTO_RECORD", "kim-gwajang")]
    assert bookmark_rows(b) == []


def test_record_after_manual_off_turns_bookmark_on_again(dashboard_env):  # noqa: F811
    """Given 켰다가 끈 회사 / When 메모 저장 / Then 새 행으로 다시 켜진다(이력은 남는다)."""
    client, (a, *_rest) = dashboard_env
    assert set_bookmark(client, a, True).status_code == 200
    assert set_bookmark(client, a, False).status_code == 200
    write_note(client, a, staff="kim-gwajang")
    assert bookmark_rows(a) == [
        (a, 1, True, "MANUAL", "park-lee"),
        (a, 2, False, "MANUAL", "park-lee"),
        (a, 3, True, "AUTO_RECORD", "kim-gwajang"),
    ]


@pytest.mark.parametrize(
    "kind,body",
    [
        ("notes", {"text": "가" * 5000}),
        ("notes", {"text": "가상 메모", "kind": "UNKNOWN"}),
        ("outcomes", {"status": "LOST"}),
        ("outcomes", {"status": "LOST", "lostReasonCode": "OTHER"}),
        ("opinions", {"opinion": "NOT_TARGET"}),
        ("opinions", {"opinion": "WORTH_REVIEW", "evalId": "eval-missing"}),
    ],
)
def test_rejected_record_does_not_turn_bookmark_on(dashboard_env, kind, body):  # noqa: F811
    """Given 관심이 꺼진 회사 / When 입력 오류로 저장 실패 / Then 관심도 켜지지 않는다."""
    client, (a, *_rest) = dashboard_env
    if kind == "opinions":
        body = {"evalId": eval_ids(client)[a], **body}
    response = client.post(f"{URL}/{a}/{kind}", json=body, headers=MINE)
    assert response.status_code == 400, response.text
    assert bookmark_rows() == []
    assert client.get(f"{URL}/{a}").json()["data"]["records"]["bookmark"] is None


@pytest.mark.parametrize(
    "kind,model", [("notes", Note), ("outcomes", Outcome), ("opinions", ReviewOpinion)]
)
def test_failed_record_save_rolls_bookmark_back(dashboard_env, kind, model):  # noqa: F811
    """Given 관심이 꺼진 회사 / When 기록 행 저장이 DB에서 실패 / Then 관심 행도 함께 되돌린다."""
    client, (a, *_rest) = dashboard_env
    body = {
        "notes": {"text": "가상 메모"},
        "outcomes": {"status": "IN_PROGRESS"},
        "opinions": {"evalId": eval_ids(client)[a], "opinion": "WORTH_REVIEW"},
    }[kind]
    attempts = []

    def fail_insert(*_):
        attempts.append(1)
        raise RuntimeError("가상 저장 실패")

    event.listen(model, "before_insert", fail_insert)
    try:
        response = client.post(f"{URL}/{a}/{kind}", json=body, headers=MINE)
    finally:
        event.remove(model, "before_insert", fail_insert)
    assert response.status_code == 500 and attempts == [1]
    assert bookmark_rows() == []
    with session_scope() as session:
        assert session.scalar(select(func.count()).select_from(model)) == 0


# ---------------------------------------------------------------------------
# 관심 켜고 끄기 창구
# ---------------------------------------------------------------------------


def test_bookmark_toggle_keeps_history_and_reports_previous_value(dashboard_env):  # noqa: F811
    """Given 기록 없는 회사 / When 켜고 끄고 다시 켬 / Then 행이 쌓이고 마지막 행이 현재 값이다."""
    client, (a, b, *_rest) = dashboard_env
    first = set_bookmark(client, a, True)
    assert first.status_code == 200
    body = first.json()
    assert set(body["data"]) == {"active", "version", "updatedBy", "updatedAt"}
    assert (body["data"]["active"], body["data"]["version"]) == (True, 1)
    assert body["data"]["updatedBy"] == "park-lee"
    assert body["meta"]["previousValue"] is None
    assert body["meta"]["datasetKind"] == "VIRTUAL_REVIEWED"
    assert body["meta"]["hasVirtualData"] is True

    off = set_bookmark(client, a, False, staff="kim-gwajang").json()
    assert (off["data"]["active"], off["data"]["version"]) == (False, 2)
    assert off["data"]["updatedBy"] == "kim-gwajang"
    # 다른 사람이 먼저 바꾼 값을 알려 준다(다른 기록 창구와 같은 칸).
    assert off["meta"]["previousValue"]["active"] is True
    assert off["meta"]["previousValue"]["updatedBy"] == "park-lee"
    assert listed_ids(client, bookmarked="true") == set()

    again = set_bookmark(client, a, True, expectedVersion=2).json()
    assert (again["data"]["active"], again["data"]["version"]) == (True, 3)
    assert again["meta"]["previousValue"] is None  # 내가 본 버전 그대로였다
    assert bookmark_rows() == [
        (a, 1, True, "MANUAL", "park-lee"),
        (a, 2, False, "MANUAL", "kim-gwajang"),
        (a, 3, True, "MANUAL", "park-lee"),
    ]
    assert listed_ids(client, bookmarked="true") == {a}
    assert bookmark_rows(b) == []


def test_same_value_adds_no_row_and_returns_current(dashboard_env):  # noqa: F811
    """Given 이미 같은 값 / When 다시 보냄 / Then 새 행 없이 지금 값을 돌려준다."""
    client, (a, b, *_rest) = dashboard_env
    first = set_bookmark(client, a, True).json()["data"]
    repeated = set_bookmark(client, a, True, staff="kim-gwajang")
    assert repeated.status_code == 200
    assert repeated.json()["data"] == first  # 처음 켠 사람·시각·버전 그대로
    assert bookmark_rows() == [(a, 1, True, "MANUAL", "park-lee")]
    # 한 번도 켠 적이 없는 회사를 끄라는 요청: 행을 만들지 않고 꺼져 있다고 답한다.
    never = set_bookmark(client, b, False)
    assert never.status_code == 200
    assert (never.json()["data"]["active"], never.json()["data"]["version"]) == (False, 0)
    assert bookmark_rows(b) == []
    assert client.get(f"{URL}/{b}").json()["data"]["records"]["bookmark"] is None


@pytest.mark.parametrize("kind", ["notes", "outcomes", "opinions"])
def test_turning_off_is_refused_when_records_exist(dashboard_env, kind):  # noqa: F811
    """Given 메모·영업 기록·의견이 있는 회사 / When 관심 끄기 / Then 422로 거부하고 안내한다."""
    client, (a, *_rest) = dashboard_env
    if kind == "notes":
        write_note(client, a)
    elif kind == "outcomes":
        record(client, a, {"status": "NOT_EXECUTED", "nextScheduleNote": "가상 일정 메모"})
    else:
        give_opinion(client, a, "WORTH_REVIEW")
    before = bookmark_rows()
    response = set_bookmark(client, a, False)
    assert response.status_code == 422
    error = response.json()["error"]
    assert error["kind"] == "BOOKMARK_HAS_RECORDS"
    assert error["message"] == REFUSAL_MESSAGE
    assert error["nextAction"] == REFUSAL_NEXT_ACTION
    assert bookmark_rows() == before == [(a, 1, True, "AUTO_RECORD", "park-lee")]
    assert client.get(f"{URL}/{a}").json()["data"]["records"]["bookmark"]["active"] is True


@pytest.mark.parametrize("staff", ["viewer", "unknown", "", None])
def test_viewer_and_unknown_staff_cannot_change_bookmark(dashboard_env, staff):  # noqa: F811
    """Given 보기 전용·목록 밖·담당자 없음 / When 관심 켜기 / Then 403, 행 없음."""
    client, (a, *_rest) = dashboard_env
    assert set_bookmark(client, a, True, staff=staff).status_code == 403
    assert bookmark_rows() == []


def test_bookmark_rejects_missing_opportunity_and_bad_body(dashboard_env):  # noqa: F811
    """Given 없는 회사·약속에 없는 입력 / When 관심 켜기 / Then 404·400, 행 없음."""
    client, (a, *_rest) = dashboard_env
    assert set_bookmark(client, "opp-missing", True).status_code == 404
    url = f"{URL}/{a}/bookmark"
    for body in (
        {},
        {"active": "켜기"},
        {"active": True, "evalId": eval_ids(client)[a]},  # 관심은 평가 ID를 받지 않는다
        {"active": True, "expectedVersion": -1},
    ):
        assert client.put(url, json=body, headers=MINE).status_code == 400, body
    assert bookmark_rows() == []


# ---------------------------------------------------------------------------
# 목록 거르기와 카드·상세 모양
# ---------------------------------------------------------------------------


def test_list_filters_by_bookmark_and_latest_opinion(dashboard_env):  # noqa: F811
    """Given 의견이 다른 회사들 / When bookmarked·opinion으로 거름 / Then 최신 값으로, 서로 AND."""
    client, (a, b, c, d) = dashboard_env
    everyone = {a, b, c, d}
    give_opinion(client, a, "WORTH_REVIEW")
    give_opinion(client, b, "WORTH_REVIEW")
    give_opinion(client, b, "NEED_CHECK")  # 최신 의견만 본다
    give_opinion(client, c, "NOT_TARGET")
    record(client, a, {"status": "IN_PROGRESS"})
    assert listed_ids(client, opinion="WORTH_REVIEW") == {a}
    assert listed_ids(client, opinion="NEED_CHECK") == {b}
    assert listed_ids(client, opinion="NOT_TARGET") == {c}
    assert listed_ids(client, opinion="NONE") == {d}  # 의견을 한 번도 안 고른 회사
    assert listed_ids(client) == everyone
    assert listed_ids(client, bookmarked="false") == everyone
    assert listed_ids(client, bookmarked="true") == {a, b, c}
    # 다른 거르기와 모두 AND.
    assert listed_ids(client, bookmarked="true", opinion="NONE") == set()
    assert set_bookmark(client, d, True).status_code == 200
    assert listed_ids(client, bookmarked="true", opinion="NONE") == {d}
    assert listed_ids(client, bookmarked="true", stage="IN_PROGRESS") == {a}
    assert listed_ids(client, opinion="WORTH_REVIEW", stage="NOT_EXECUTED") == set()
    assert listed_ids(client, opinion="NEED_CHECK", stage="NOT_EXECUTED") == {b}
    assert listed_ids(client, bookmarked="true", q="없는 회사 이름") == set()
    name = client.get(f"{URL}/{b}").json()["data"]["header"]["customerName"]
    assert listed_ids(client, bookmarked="true", q=name) == {b}
    for params in ({"opinion": "OTHER"}, {"opinion": ""}, {"bookmarked": "아마도"}):
        assert client.get(URL, params=params).status_code == 400, params


def test_card_and_detail_show_latest_bookmark(dashboard_env):  # noqa: F811
    """Given 한 번도 안 켬 → 켬 → 껐다 켬 / When 카드·상세 / Then null → 최신 값(버전 3)."""
    client, (a, b, *_rest) = dashboard_env

    def shown(opp_id):
        card = next(row for row in client.get(URL).json()["data"] if row["oppId"] == opp_id)
        detail = client.get(f"{URL}/{opp_id}").json()["data"]
        assert "bookmark" in card["records"] and "bookmark" in detail["records"]
        assert card["records"]["bookmark"] == detail["records"]["bookmark"]
        return card["records"]["bookmark"]

    assert shown(a) is None
    first = set_bookmark(client, a, True).json()["data"]
    assert shown(a) == first
    assert set(first) == {"version", "updatedBy", "updatedAt", "active"}
    assert set_bookmark(client, a, False).status_code == 200
    assert shown(a)["active"] is False and shown(a)["version"] == 2
    last = set_bookmark(client, a, True, staff="kim-gwajang").json()["data"]
    assert shown(a) == last
    assert (last["version"], last["active"], last["updatedBy"]) == (3, True, "kim-gwajang")
    assert shown(b) is None  # 다른 회사로 새지 않는다
