"""#356: 대시보드가 관심으로 고른 회사만 세고, 칸을 눌러 연 목록과 건수가 같은지 본다.

관심 기업 하나는 여덟 칸 가운데 꼭 하나에만 든다(계약 C1 v3, PM 결정 2026-11-06).
관심 켜고 끄기·자동 관심 검사는 `test_bookmark.py`에 있다. 가상 사례만 쓴다(거산 실제 사양 아님).
"""

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import func, select

from geosan.api.app import create_app
from geosan.capability.importer import import_capability
from geosan.dashboard.queries import board_key
from geosan.opportunity.importer import import_case
from geosan.records.models import Outcome
from geosan.storage.session import session_scope
from geosan.workflows.flow_evaluate import run_evaluation
from tests import factories
from tests.unit.u1.test_snapshot_ledger import _write
from tests.unit.u7.test_bookmark import (
    MINE,
    URL,
    bookmark_rows,
    give_opinion,
    listed_ids,
    set_bookmark,
    write_note,
)
from tests.unit.u7.test_dashboard import (
    BOARD_KEYS,
    COUNT_KEYS,
    ZERO_COUNTS,
    build,
    counts_of,
    dashboard_env,  # noqa: F401
    record,
)


@pytest.fixture
def board_env(tmp_db, tmp_path):
    """가상 회사 10곳을 투입·평가한 상태. 기록도 관심도 아직 하나도 없다."""
    import_capability(_write(tmp_path, "cap.json", factories.capability_file()))
    opp_ids = [import_case(_write(tmp_path, "a.json", factories.apjeong_case())).opp_id]
    for index in range(2, 11):
        case = factories.apjeong_renamed_customer(f"case-board-{index}", f"가상회사{index}(가상)")
        opp_ids.append(import_case(_write(tmp_path, f"case-{index}.json", case)).opp_id)
    assert run_evaluation().ok
    with TestClient(create_app()) as client:
        yield client, opp_ids


def api_counts(client):
    return client.get("/api/v1/dashboard", headers=MINE).json()["data"]["counts"]


def test_companies_without_bookmark_are_counted_nowhere(board_env):
    """Given 10곳 투입, 관심 없음 / When 대시보드 / Then 목록에는 10곳이 있어도 건수는 전부 0."""
    client, opp_ids = board_env
    assert len(listed_ids(client)) == len(opp_ids) == 10
    assert api_counts(client) == ZERO_COUNTS
    for key in ("BOOKMARKED", *BOARD_KEYS):
        assert listed_ids(client, filter=key) == set(), key
    assert listed_ids(client, bookmarked="true") == set()


def test_each_bookmarked_company_falls_in_exactly_one_column(board_env):
    """Given 칸마다 한 건(완료만 두 건) / When 대시보드 / Then 칸 숫자 = 눌러 연 목록, 합 = 관심."""
    client, ids = board_env
    expected = {key: set() for key in BOARD_KEYS}
    # ③ 접촉 전: 검토 의견으로 나뉜다.
    assert set_bookmark(client, ids[0], True).status_code == 200
    expected["NO_OPINION"].add(ids[0])
    give_opinion(client, ids[1], "NEED_CHECK")
    record(client, ids[1], {"status": "NOT_EXECUTED"})  # 미접촉 기록은 접촉 전과 같다
    expected["NEED_CHECK"].add(ids[1])
    give_opinion(client, ids[3], "WORTH_REVIEW")
    expected["NOT_CONTACTED"].add(ids[3])
    # ① 검토 대상 제외는 영업 단계보다 먼저다.
    record(client, ids[2], {"status": "IN_PROGRESS"})
    give_opinion(client, ids[2], "NOT_TARGET")
    expected["NOT_TARGET"].add(ids[2])
    # ② 최신 영업 단계: 검토 권고가 있어도 접촉을 시작했으면 미접촉이 아니다.
    give_opinion(client, ids[4], "WORTH_REVIEW")
    record(client, ids[4], {"status": "IN_PROGRESS"})
    expected["IN_CONTACT"].add(ids[4])
    record(client, ids[5], {"status": "SAMPLE_OR_REGISTRATION_APPROVED"})
    expected["QUOTE_SAMPLE"].add(ids[5])
    give_opinion(client, ids[6], "NEED_CHECK")
    record(client, ids[6], {"status": "ON_HOLD"})
    expected["ON_HOLD"].add(ids[6])
    record(client, ids[7], {"status": "WON"})
    record(client, ids[8], {"status": "LOST", "lostReasonCode": "PRICE"})
    expected["DONE"] |= {ids[7], ids[8]}
    # ids[9]는 아무것도 하지 않았다: 관심 기업이 아니다.

    counts = api_counts(client)
    assert set(counts) == set(COUNT_KEYS)
    assert counts == {
        **{key: len(found) for key, found in expected.items()},
        "BOOKMARKED": 9,
        "SCHEDULE_DUE": 0,
    }
    assert counts == counts_of(build())
    assert sum(counts[key] for key in BOARD_KEYS) == counts["BOOKMARKED"]
    # 칸을 눌러 열리는 목록은 그 칸의 회사 그대로다(meta.total = 칸 숫자).
    for key in BOARD_KEYS:
        assert listed_ids(client, filter=key) == expected[key], key
        total = client.get(URL, params={"filter": key}).json()["meta"]["total"]
        assert total == counts[key], key
    everyone = set(ids[:9])
    assert listed_ids(client, filter="BOOKMARKED") == everyone
    assert listed_ids(client, bookmarked="true") == everyone
    # 칸 거르기는 다른 거르기와 AND다.
    assert listed_ids(client, filter="DONE", stage="WON") == {ids[7]}
    assert listed_ids(client, filter="DONE", stage="IN_PROGRESS") == set()
    assert listed_ids(client, filter="ON_HOLD", opinion="NEED_CHECK") == {ids[6]}
    assert listed_ids(client, filter="ON_HOLD", opinion="NONE") == set()
    assert listed_ids(client, filter="NO_OPINION", bookmarked="true") == {ids[0]}


def test_column_follows_latest_opinion_stage_and_bookmark(dashboard_env):  # noqa: F811
    """Given 의견·단계·관심이 바뀜 / When 대시보드 / Then 늘 마지막 값으로 한 칸에만 든다."""
    client, (a, b, *_rest) = dashboard_env

    def only(key, bookmarked=1):
        counts = api_counts(client)
        assert counts == {**ZERO_COUNTS, "BOOKMARKED": bookmarked, key: 1}, key
        assert listed_ids(client, filter=key) == {a}

    give_opinion(client, a, "NEED_CHECK")
    only("NEED_CHECK")
    give_opinion(client, a, "WORTH_REVIEW")
    only("NOT_CONTACTED")
    record(client, a, {"status": "IN_PROGRESS"})
    only("IN_CONTACT")
    give_opinion(client, a, "NOT_TARGET")
    only("NOT_TARGET")
    give_opinion(client, a, "WORTH_REVIEW")  # 제외를 풀면 다시 영업 단계 칸으로
    only("IN_CONTACT")
    record(client, a, {"status": "NOT_EXECUTED"})
    only("NOT_CONTACTED")
    # 기록이 없는 회사는 관심을 켰다 끄면 다시 어느 칸에도 없다.
    assert set_bookmark(client, b, True).status_code == 200
    assert api_counts(client) == {
        **ZERO_COUNTS,
        "BOOKMARKED": 2,
        "NOT_CONTACTED": 1,
        "NO_OPINION": 1,
    }
    assert set_bookmark(client, b, False).status_code == 200
    only("NOT_CONTACTED")


@pytest.mark.parametrize(
    "opinion,stage,expected",
    [
        ("NOT_TARGET", None, "NOT_TARGET"),
        ("NOT_TARGET", "WON", "NOT_TARGET"),
        (None, "IN_PROGRESS", "IN_CONTACT"),
        ("WORTH_REVIEW", "SAMPLE_OR_REGISTRATION_APPROVED", "QUOTE_SAMPLE"),
        ("NEED_CHECK", "ON_HOLD", "ON_HOLD"),
        (None, "WON", "DONE"),
        ("WORTH_REVIEW", "LOST", "DONE"),
        ("WORTH_REVIEW", None, "NOT_CONTACTED"),
        ("WORTH_REVIEW", "NOT_EXECUTED", "NOT_CONTACTED"),
        ("NEED_CHECK", None, "NEED_CHECK"),
        ("NEED_CHECK", "NOT_EXECUTED", "NEED_CHECK"),
        (None, None, "NO_OPINION"),
        (None, "NOT_EXECUTED", "NO_OPINION"),
    ],
)
def test_board_key_takes_the_first_matching_rule(opinion, stage, expected):
    """계약 C1(#356)의 순서: ① 제외 → ② 영업 단계 → ③ 검토 의견."""
    assert board_key(opinion, stage) == expected
    assert expected in BOARD_KEYS


@pytest.mark.parametrize("opinion,stage", [(None, "INTERESTED"), ("UNKNOWN", None)])
def test_board_key_refuses_unknown_codes(opinion, stage):
    """모르는 값은 아무 칸에나 넣지 않고 멈춘다."""
    with pytest.raises(ValueError, match="모르는"):
        board_key(opinion, stage)


def test_excluding_a_recorded_company_keeps_it_bookmarked(dashboard_env):  # noqa: F811
    """Given 기록이 있어 관심을 끌 수 없는 회사 / When 안내대로 '검토 대상 제외' / Then 제외 칸."""
    client, (a, *_rest) = dashboard_env
    write_note(client, a)
    assert set_bookmark(client, a, False).status_code == 422
    assert api_counts(client) == {**ZERO_COUNTS, "BOOKMARKED": 1, "NO_OPINION": 1}
    give_opinion(client, a, "NOT_TARGET")
    assert api_counts(client) == {**ZERO_COUNTS, "BOOKMARKED": 1, "NOT_TARGET": 1}
    assert listed_ids(client, bookmarked="true") == {a}


def test_interested_stage_is_no_longer_accepted(dashboard_env):  # noqa: F811
    """Given 관심은 단계가 아님 / When INTERESTED를 단계로 보냄 / Then 모르는 값처럼 입력 오류."""
    client, (a, *_rest) = dashboard_env
    unknown = client.post(f"{URL}/{a}/outcomes", json={"status": "UNKNOWN"}, headers=MINE)
    saved = client.post(f"{URL}/{a}/outcomes", json={"status": "INTERESTED"}, headers=MINE)
    assert saved.status_code == unknown.status_code == 400
    assert saved.json()["error"]["message"] == unknown.json()["error"]["message"]
    assert saved.json()["error"]["fields"] == unknown.json()["error"]["fields"]
    listed = client.get(URL, params={"stage": "INTERESTED"})
    assert listed.status_code == client.get(URL, params={"stage": "UNKNOWN"}).status_code == 400
    with session_scope() as session:
        assert session.scalar(select(func.count()).select_from(Outcome)) == 0
    assert bookmark_rows() == []
    assert "INTERESTED" not in api_counts(client)


def test_bookmarked_list_counts_choices_inside_bookmarks_only(board_env):
    """Given 1곳만 관심 / When bookmarked=true 목록 / Then 선택지 건수는 관심 기업 안에서만."""
    client, ids = board_env
    set_bookmark(client, ids[0], True)
    everyone = client.get(URL).json()["meta"]
    mine = client.get(URL, params={"bookmarked": "true"}).json()["meta"]
    assert sum(row["count"] for row in everyone["processCounts"]) >= 10
    # 공정 선택지는 9종 모두 오되(0곳 포함) 건수는 관심 1곳의 공정에만 붙는다.
    assert [row["processCode"] for row in mine["processCounts"]] == [
        row["processCode"] for row in everyone["processCounts"]
    ]
    assert (
        sum(row["count"] for row in mine["processCounts"])
        == len([row for row in mine["processCounts"] if row["count"] == 1])
        >= 1
    )
    assert all(row["count"] in (0, 1) for row in mine["processCounts"])
    assert sum(row["count"] for row in mine["regionCounts"]) <= 2  # 묶음 이름 + 시·군 각 1곳
    # 공정을 함께 고르면 관심 기업 안에서 그 공정만 남는다.
    code = next(row["processCode"] for row in mine["processCounts"] if row["count"] == 1)
    assert listed_ids(client, bookmarked="true", process=code) == {ids[0]}
    other = next(row["processCode"] for row in mine["processCounts"] if row["count"] == 0)
    assert listed_ids(client, bookmarked="true", process=other) == set()
