"""#943 되먹임 ③: 담당자 선호 제안·승인 창구와 목록 "근거 있음" 묶음 안 순서.

실제 임시 DB(SQLite)와 실제 API로 확인한다. 외부 호출 없음. 가상 사례만 쓴다(거산 실제 사양 아님).
가상 회사 8곳은 공정이 모두 같고, 산업군만 시험을 위해 바꾼다. 가상 회사는 좌표가 없어 거리 제안은
나오지 않는다. 기준 숫자는 회사 수에 맞춰 임시 DB 설정에서 낮춘다(고른 회사 4곳·성사율 표본 1곳).
"""

from datetime import timedelta

import pytest
from sqlalchemy import select

from geosan.config.models import AppSetting
from geosan.records.models import PreferenceApproval
from geosan.storage.base import utcnow
from geosan.storage.session import session_scope
from tests.unit.u7.test_bookmark import give_opinion, set_bookmark
from tests.unit.u7.test_contact_list_api import (
    OTHER,
    PAIR,
    cards_by_id,
    close,
    contact_env,  # noqa: F401
    listing,
    make_passed,
    rank_order,
)

URL = "/api/v1/preferences"
OPS = {"X-Staff-Key": "choi-pm"}
STAFF = {"X-Staff-Key": "park-lee"}


def settings(**changes):
    """임시 DB 설정의 contactList.preference 값을 바꾼다(시험 준비용)."""
    with session_scope() as session:
        row = session.get(AppSetting, "contactList")
        row.value = {**row.value, "preference": {**row.value["preference"], **changes}}


@pytest.fixture
def picked_env(contact_env):  # noqa: F811
    """앞 4곳은 방위산업, 뒤 4곳은 자동차 부품. 방위산업 3곳·자동차 1곳을 관심으로 고르고,
    방위산업 한 곳은 성사, 자동차 한 곳은 거절로 끝냄(둘 다 접촉이 있어 고른 회사로도 센다).
    고른 회사 6곳 중 방위산업 4곳 = 0.67 → 방위산업 조합이 제안된다."""
    client, opp_ids = contact_env
    order = rank_order(client, opp_ids)
    pair, other = order[:4], order[4:]
    for opp_id in pair:
        make_passed(opp_id, industries=[PAIR])
    for opp_id in other:
        make_passed(opp_id, industries=[OTHER])
    settings(minPicks=4, minClosedForRate=1, exploreTopN=3)
    for opp_id in [*pair[:3], other[0]]:
        assert set_bookmark(client, opp_id, True).status_code == 200
    close(client, pair[3], "WON")
    close(client, other[1], "LOST", reason="NO_DEMAND")
    return client, pair, other


def preferences(client, headers=STAFF):
    response = client.get(URL, headers=headers)
    assert response.status_code == 200, response.text
    return response.json()["data"]


def pair_suggestion(data):
    found = [row for row in data["suggestions"] if row["industry"] == PAIR]
    assert found, data
    return found[0]


def approve(client, suggestion, headers=OPS):
    body = {
        key: suggestion[key]
        for key in ("kind", "processCode", "industry", "distanceKm")
        if suggestion.get(key) is not None
    }
    return client.post(URL, json=body, headers=headers)


def test_concentrated_picks_are_suggested_with_their_numbers(picked_env):
    """Given 고른 6곳 중 4곳이 방위산업이고 성사율도 낮지 않음 / When 영업 담당이 조회
    Then 방위산업 조합 제안이 숫자와 함께 보이고, 승인 단추는 없다(관리자 아님)."""
    client, _pair, _other = picked_env
    data = preferences(client)
    assert data["enabled"] is True and data["canApprove"] is False
    assert data["basis"]["pickedCount"] == 6
    row = pair_suggestion(data)
    assert row["kind"] == "PROCESS_INDUSTRY" and row["processName"]
    assert (row["pickedCount"], row["excludedCount"]) == (4, 0)
    assert row["share"] == pytest.approx(4 / 6)
    assert (row["closedCount"], row["wonCount"]) == (1, 1)
    assert (row["otherClosedCount"], row["otherWonCount"]) == (1, 0)
    assert not [row for row in data["suggestions"] if row["industry"] == OTHER]
    assert data["active"] == []
    assert preferences(client, OPS)["canApprove"] is True


def test_only_operations_staff_can_approve(picked_env):
    client, _pair, _other = picked_env
    row = pair_suggestion(preferences(client))
    assert approve(client, row, STAFF).status_code == 403
    assert approve(client, row, {"X-Staff-Key": "viewer"}).status_code == 403
    with session_scope() as session:
        assert session.scalars(select(PreferenceApproval)).all() == []


def test_approval_moves_matching_ready_cards_up_with_a_reason(picked_env):
    """Given 방위산업 조합을 승인 / When 근거 있음 순서로 목록 / Then 방위산업 카드에 선호 근거가
    붙고 앞에 오며, 자동차 부품 카드에는 없다. 점수·분류는 그대로."""
    client, pair, other = picked_env
    before = cards_by_id(client, sort="contact")
    response = approve(client, pair_suggestion(preferences(client)))
    assert response.status_code == 200, response.text
    approved = response.json()["data"]
    assert approved["approvedBy"] == "choi-pm" and approved["industry"] == PAIR
    after = cards_by_id(client, sort="contact")
    for opp_id in pair[:3]:
        assert after[opp_id]["preferenceAdjust"]["prefId"] == approved["prefId"]
        assert after[opp_id]["scoreS"] == before[opp_id]["scoreS"]
        assert after[opp_id]["classificationCode"] == before[opp_id]["classificationCode"]
    # 성사로 끝난 회사는 "끝난 회사" 묶음이라 선호를 붙이지 않는다.
    assert after[pair[3]]["preferenceAdjust"] is None
    assert all(after[opp_id]["preferenceAdjust"] is None for opp_id in other)
    data = preferences(client)
    assert [row["prefId"] for row in data["active"]] == [approved["prefId"]]
    assert not [row for row in data["suggestions"] if row["industry"] == PAIR]


def test_explore_slot_keeps_one_non_preferred_company_near_the_top(picked_env):
    """안전장치③: 위쪽 3자리(시험 설정)가 모두 선호 회사가 되면
    선호 밖 한 곳이 3번째 자리로 온다."""
    client, pair, other = picked_env
    assert approve(client, pair_suggestion(preferences(client))).status_code == 200
    ready = [
        card
        for card in listing(client, sort="contact")["data"]
        if card["bucket"] == "EVIDENCE_READY"
    ]
    assert [card["oppId"] for card in ready[:2]] == pair[:2]
    third = ready[2]
    assert third["oppId"] in other and third["exploreSlot"] is True
    assert third["preferenceAdjust"] is None
    assert ready[3]["oppId"] == pair[2]
    assert sum(card["exploreSlot"] for card in ready) == 1


def test_not_suggested_combo_is_refused(picked_env):
    client, _pair, _other = picked_env
    row = {**pair_suggestion(preferences(client)), "industry": OTHER}
    response = approve(client, row)
    assert response.status_code == 409
    assert response.json()["error"]["kind"] == "PREFERENCE_NOT_SUGGESTED"
    wrong = client.post(URL, json={"kind": "DISTANCE", "industry": PAIR}, headers=OPS)
    assert wrong.status_code == 400


def test_revoke_and_expiry_turn_the_preference_off(picked_env):
    """Given 승인 / When 관리자가 끄거나 기한이 지남
    Then 카드 근거가 사라지고 제안이 다시 보인다."""
    client, pair, _other = picked_env
    pref_id = approve(client, pair_suggestion(preferences(client))).json()["data"]["prefId"]
    assert client.post(f"{URL}/{pref_id}/revoke", headers=STAFF).status_code == 403
    response = client.post(f"{URL}/{pref_id}/revoke", headers=OPS)
    assert response.status_code == 200, response.text
    assert cards_by_id(client, sort="contact")[pair[0]]["preferenceAdjust"] is None
    assert client.post(f"{URL}/{pref_id}/revoke", headers=OPS).status_code == 409
    assert client.post(f"{URL}/pref-none/revoke", headers=OPS).status_code == 404
    # 안전장치②: 다시 승인한 뒤 기한이 지나면 저절로 꺼진다.
    again = approve(client, pair_suggestion(preferences(client))).json()["data"]["prefId"]
    with session_scope() as session:
        session.get(PreferenceApproval, again).expires_at = utcnow() - timedelta(minutes=1)
    assert cards_by_id(client, sort="contact")[pair[0]]["preferenceAdjust"] is None
    data = preferences(client)
    assert data["active"] == [] and pair_suggestion(data)


def test_safeguard_one_hides_a_preference_with_worse_results(contact_env):  # noqa: F811
    """Given 방위산업을 많이 골랐지만 방위산업은 거절, 자동차 부품은 성사 / Then 제안 안 함."""
    client, opp_ids = contact_env
    order = rank_order(client, opp_ids)
    pair, other = order[:4], order[4:]
    for opp_id in pair:
        make_passed(opp_id, industries=[PAIR])
    for opp_id in other:
        make_passed(opp_id, industries=[OTHER])
    settings(minPicks=4, minClosedForRate=1)
    for opp_id in [*pair[:3], other[0]]:
        set_bookmark(client, opp_id, True)
    close(client, pair[3], "LOST", reason="NO_DEMAND")
    close(client, other[1], "WON")
    data = preferences(client)
    assert data["basis"]["pickedCount"] == 6
    assert not [row for row in data["suggestions"] if row["industry"] == PAIR]


def test_exclusions_in_the_combo_count_against_it(picked_env):
    """Given 방위산업 두 곳을 제외 의견으로 바꿈
    Then 고른 수에서 빠지고 제외로 세어 제안이 사라진다."""
    client, pair, _other = picked_env
    for opp_id in pair[:2]:
        give_opinion(client, opp_id, "NOT_TARGET")
    data = preferences(client)
    assert data["basis"]["pickedCount"] == 4
    assert not [row for row in data["suggestions"] if row["industry"] == PAIR]


def test_switched_off_settings_hide_everything(picked_env):
    client, pair, _other = picked_env
    pref_id = approve(client, pair_suggestion(preferences(client))).json()["data"]["prefId"]
    assert pref_id
    settings(enabled=False)
    assert preferences(client) == {
        "enabled": False,
        "canApprove": False,
        "basis": None,
        "suggestions": [],
        "active": [],
    }
    card = cards_by_id(client, sort="contact")[pair[0]]
    assert card["preferenceAdjust"] is None and card["exploreSlot"] is False
