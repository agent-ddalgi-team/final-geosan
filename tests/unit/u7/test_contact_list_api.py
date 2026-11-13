"""#610: 추천 목록 세 묶음. 실제 임시 DB(SQLite)와 실제 API로 확인한다. 외부 호출 없음.

가상 사례만 쓴다(거산 실제 사양 아님). 회사 상태(분류·거래 관계·적합도)는 시험을 위해 임시 DB의
행을 직접 고쳐 만든다. 기준 숫자(표본 5곳 등)는 예시 설정 `contactList` 값이다.
"""

import pytest
from fastapi.testclient import TestClient

from geosan.api.app import create_app
from geosan.capability.importer import import_capability
from geosan.config.app_settings import read_app_settings
from geosan.config.models import AppSetting
from geosan.evaluation.ledger import latest_confirmed_evaluation
from geosan.opportunity.importer import import_case
from geosan.opportunity.models import Customer, Opportunity
from geosan.storage.session import session_scope
from geosan.workflows.flow_evaluate import run_evaluation
from tests import factories
from tests.unit.u1.test_snapshot_ledger import _write
from tests.unit.u7.test_bookmark import give_opinion
from tests.unit.u7.test_dashboard import record
from tests.unit.u7.test_sales_analysis import contact

URL = "/api/v1/opportunities"
PAIR = "방위산업"
OTHER = "자동차 부품"
COMPANY_COUNT = 8


@pytest.fixture
def contact_env(tmp_db, tmp_path):
    """가상 회사 8곳을 투입·평가한 상태. 영업 기록은 아직 없다."""
    import_capability(_write(tmp_path, "cap.json", factories.capability_file()))
    opp_ids = [import_case(_write(tmp_path, "a.json", factories.apjeong_case())).opp_id]
    for index in range(2, COMPANY_COUNT + 1):
        case = factories.apjeong_renamed_customer(f"case-contact-{index}", f"가상{index}금속")
        opp_ids.append(import_case(_write(tmp_path, f"case-{index}.json", case)).opp_id)
    assert run_evaluation().ok
    with TestClient(create_app()) as client:
        yield client, opp_ids


def listing(client, **params):
    response = client.get(URL, params={"pageSize": 50, **params})
    assert response.status_code == 200, response.text
    return response.json()


def cards_by_id(client, **params):
    return {card["oppId"]: card for card in listing(client, **params)["data"]}


def set_state(opp_id, *, industries=None, virtual=None, **changes):
    """임시 DB에서 회사·평가 행의 상태를 바꾼다(시험 준비용)."""
    with session_scope() as session:
        opportunity = session.get(Opportunity, opp_id)
        customer = session.get(Customer, opportunity.customer_id)
        run = latest_confirmed_evaluation(session, opp_id)
        if industries is not None:
            customer.industries = industries
        if virtual is not None:
            customer.is_virtual = virtual
            opportunity.is_virtual = virtual
        for name, value in changes.items():
            target = customer if hasattr(Customer, name) else run
            setattr(target, name, value)


def make_unscored(opp_id, fit_level, own_plating=False):
    set_state(
        opp_id,
        classification_code="NOT_EVALUATED",
        relation_status="NEW_CONFIRMED",
        score_s=None,
        core_evidence_recheck_flag=True,
        blocks_approval=True,
        fit_level=fit_level,
        own_plating_line_suspected=own_plating,
    )


def make_passed(opp_id, industries=None):
    """필수를 통과하고 막는 조건이 없는 "계획해서 연락" 회사."""
    set_state(
        opp_id,
        industries=industries,
        classification_code="CONTACT_PLANNED",
        relation_status="NEW_CONFIRMED",
        core_evidence_recheck_flag=False,
        blocks_approval=False,
    )


def close(client, opp_id, status="WON", reason=None):
    """접촉 한 번 뒤 성사 또는 거절로 끝낸다."""
    record(client, opp_id, contact())
    body = {"status": status}
    if status == "LOST":
        body["lostReasonCode"] = reason
        if reason == "OTHER":
            body["reason"] = "가상 기타 사유"
    record(client, opp_id, body)


def prepare_pair(client, opp_ids, won, lost, lost_reason="NO_DEMAND"):
    """앞의 두 곳은 지금 연락할 곳(뒤쪽 회사만 성사·거절 회사와 같은 산업군), 나머지는 결과 회사."""
    first, second, *rest = rank_order(client, opp_ids)
    make_passed(first, industries=[OTHER])
    make_passed(second, industries=[PAIR])
    closing = rest[: won + lost]
    for opp_id in closing:
        make_passed(opp_id, industries=[PAIR])
    for opp_id in closing[:won]:
        close(client, opp_id)
    for opp_id in closing[won:]:
        close(client, opp_id, status="LOST", reason=lost_reason)
    return first, second, closing


def rank_order(client, opp_ids):
    order = [card["oppId"] for card in listing(client, sort="rank")["data"]]
    assert sorted(order) == sorted(opp_ids)
    return order


# ---------------------------------------------------------------------------
# 기본 정렬은 그대로
# ---------------------------------------------------------------------------


def test_default_sort_keeps_the_old_order_and_numbers(contact_env):
    """Given 평가된 8곳 / When 정렬 없이·sort=rank로 조회 / Then 예전 순서·번호 그대로."""
    client, opp_ids = contact_env
    with session_scope() as session:
        original = {
            opp_id: latest_confirmed_evaluation(session, opp_id).original_rank for opp_id in opp_ids
        }
    default = listing(client)["data"]
    assert [(card["oppId"], card["rank"]) for card in default] == sorted(
        original.items(), key=lambda item: item[1]
    )
    assert [card["rank"] for card in default] == list(range(1, COMPANY_COUNT + 1))
    explicit = listing(client, sort="rank")["data"]
    assert [(c["oppId"], c["rank"]) for c in explicit] == [(c["oppId"], c["rank"]) for c in default]
    # 영업 결과가 쌓여도 기본 정렬의 순서·번호는 움직이지 않는다.
    prepare_pair(client, opp_ids, won=3, lost=2)
    after = listing(client, sort="rank")["data"]
    assert [(c["oppId"], c["rank"]) for c in after] == [(c["oppId"], c["rank"]) for c in default]


@pytest.mark.parametrize("sort", ["rank", "recent", "contact"])
def test_every_sort_carries_bucket_fields_and_counts(contact_env, sort):
    """Given 평가된 8곳 / When 어느 정렬로 조회해도 / Then 카드 세 칸과 묶음별 건수가 온다."""
    client, opp_ids = contact_env
    make_unscored(opp_ids[0], "HIGH")
    body = listing(client, sort=sort)
    for card in body["data"]:
        assert card["bucket"] in {"NOW", "CHECK", "LATER"}
        assert card["bucketBasis"] and "rankAdjust" in card
    counts = body["meta"]["bucketCounts"]
    assert set(counts) == {"NOW", "CHECK", "LATER"}
    assert sum(counts.values()) == body["meta"]["total"] == COMPANY_COUNT
    assert counts["CHECK"] >= 1
    # 쪽을 나눠도 건수는 거른 조건 전체 기준이다.
    paged = client.get(URL, params={"sort": sort, "pageSize": 2, "page": 2}).json()
    assert paged["meta"]["bucketCounts"] == counts and len(paged["data"]) == 2


def test_unknown_sort_is_still_rejected(contact_env):
    """Given 약속에 없는 정렬 값 / When 조회 / Then 입력 오류."""
    client, _ = contact_env
    assert client.get(URL, params={"sort": "unknown"}).status_code == 400


# ---------------------------------------------------------------------------
# 묶음
# ---------------------------------------------------------------------------


def test_buckets_follow_saved_state(contact_env):
    """Given 상태가 서로 다른 회사들 / When sort=contact / Then 묶음·이유가 상태대로 온다."""
    client, opp_ids = contact_env
    failed, excluded, existing, unscored_high, unscored_low, own, in_progress, passed = opp_ids
    for opp_id in opp_ids:
        make_passed(opp_id)
    set_state(failed, classification_code="FILTER_EXCLUDED", blocks_approval=True)
    give_opinion(client, excluded, "NOT_TARGET")
    set_state(existing, relation_status="EXISTING_CONFIRMED")
    make_unscored(unscored_high, "HIGH")
    make_unscored(unscored_low, "LOW")
    make_unscored(own, "HIGH", own_plating=True)
    record(client, in_progress, {"status": "IN_PROGRESS"})
    give_opinion(client, in_progress, "NEED_CHECK")
    body = listing(client, sort="contact")
    cards = {card["oppId"]: card for card in body["data"]}
    assert {key: (cards[key]["bucket"], cards[key]["bucketBasis"]) for key in opp_ids} == {
        failed: ("LATER", "REQUIRED_FAILED"),
        excluded: ("LATER", "EXCLUDED_OPINION"),
        existing: ("LATER", "EXISTING_CUSTOMER"),
        unscored_high: ("CHECK", "NOT_EVALUATED_HIGH_FIT"),
        unscored_low: ("LATER", "NOT_EVALUATED_LOWER_FIT"),
        own: ("CHECK", "OWN_PLATING"),
        in_progress: ("NOW", "IN_PROGRESS"),
        passed: ("NOW", "REQUIRED_PASSED"),
    }
    assert body["meta"]["bucketCounts"] == {"NOW": 2, "CHECK": 2, "LATER": 4}
    # 묶음 순서대로 오고, 번호는 묶음마다 1부터다. 평가 전 + 표면처리 표시는 확인 필요의 맨 뒤.
    order = [(card["bucket"], card["rank"]) for card in body["data"]]
    assert order == [
        ("NOW", 1),
        ("NOW", 2),
        ("CHECK", 1),
        ("CHECK", 2),
        ("LATER", 1),
        ("LATER", 2),
        ("LATER", 3),
        ("LATER", 4),
    ]
    assert [card["oppId"] for card in body["data"][2:4]] == [unscored_high, own]
    # 쪽을 넘겨도 묶음 안 번호가 이어진다.
    second_page = client.get(URL, params={"sort": "contact", "pageSize": 3, "page": 2}).json()
    assert [(c["bucket"], c["rank"]) for c in second_page["data"]] == order[3:6]


def test_switch_lets_unevaluated_high_fit_in_but_never_failed_or_excluded(contact_env):
    """Given 스위치를 켬 / When / Then 평가 전 적합도 상만 지금 연락, 탈락·제외·거래 중은 나중."""
    client, opp_ids = contact_env
    failed, excluded, existing, unscored, *_rest = opp_ids
    set_state(failed, classification_code="FILTER_EXCLUDED", fit_level="HIGH")
    make_unscored(excluded, "HIGH")
    give_opinion(client, excluded, "NOT_TARGET")
    make_unscored(existing, "HIGH")
    set_state(existing, relation_status="EXISTING_CONFIRMED")
    make_unscored(unscored, "HIGH")
    assert cards_by_id(client)[unscored]["bucket"] == "CHECK"
    with session_scope() as session:
        row = session.get(AppSetting, "contactList")
        row.value = {**row.value, "unscoredHighFitToNow": True}
    cards = cards_by_id(client, sort="contact")
    assert (cards[unscored]["bucket"], cards[unscored]["bucketBasis"]) == (
        "NOW",
        "NOT_EVALUATED_HIGH_FIT",
    )
    assert {cards[key]["bucket"] for key in (failed, excluded, existing)} == {"LATER"}


# ---------------------------------------------------------------------------
# 영업 결과 조정
# ---------------------------------------------------------------------------


def test_recent_results_in_the_same_pair_move_the_card_up_with_a_reason(contact_env):
    """Given 같은 공정·산업 성사 3곳 + 센 거절 2곳 / When sort=contact / Then 한 단계 위와 근거."""
    client, opp_ids = contact_env
    first, second, _closing = prepare_pair(client, opp_ids, won=3, lost=2)
    body = listing(client, sort="contact")
    now = [card for card in body["data"] if card["bucket"] == "NOW"]
    assert [card["oppId"] for card in now] == [second, first]  # 추천 순은 first가 앞이었다
    assert [card["rank"] for card in now] == [1, 2]
    adjust = now[0]["rankAdjust"]
    assert adjust == {
        "level": 1,
        "processCode": "ANODIZING",
        "processName": adjust["processName"],
        "industry": PAIR,
        "wonCount": 3,
        "lostCount": 2,
        "countedLostReasons": ["NO_DEMAND"],
        "windowDays": 365,
    }
    assert "가상" not in adjust["processName"]
    assert now[1]["rankAdjust"] is None  # 다른 산업군이라 표본 0곳
    # 점수·분류·기존 순위는 그대로다.
    before = {card["oppId"]: card for card in listing(client, sort="rank")["data"]}
    for card in now:
        old = before[card["oppId"]]
        assert (card["scoreS"], card["scoreDisplay"], card["classificationCode"]) == (
            old["scoreS"],
            old["scoreDisplay"],
            old["classificationCode"],
        )


def test_two_won_and_three_counted_lost_keep_the_order(contact_env):
    """Given 성사 2곳(+1) + 센 거절 3곳(−1) / When / Then 단계 0이라 순서 그대로."""
    client, opp_ids = contact_env
    first, second, _closing = prepare_pair(client, opp_ids, won=2, lost=3)
    now = [c for c in listing(client, sort="contact")["data"] if c["bucket"] == "NOW"]
    assert [card["oppId"] for card in now] == [first, second]
    assert (now[1]["rankAdjust"]["level"], now[1]["rankAdjust"]["lostCount"]) == (0, 3)


def test_small_sample_changes_nothing(contact_env):
    """Given 표본 4곳(성사 4) / When sort=contact / Then 순서 그대로, 조정 이유 없음."""
    client, opp_ids = contact_env
    first, second, _closing = prepare_pair(client, opp_ids, won=4, lost=0)
    now = [c for c in listing(client, sort="contact")["data"] if c["bucket"] == "NOW"]
    assert [card["oppId"] for card in now] == [first, second]
    assert [card["rankAdjust"] for card in now] == [None, None]


def test_uncounted_reasons_and_own_result_are_left_out(contact_env):
    """Given 성사 3곳 + 가격 거절 2곳 / When / Then 가격 거절은 안 세어 표본 3곳 → 조정 없음."""
    client, opp_ids = contact_env
    _first, second, closing = prepare_pair(client, opp_ids, won=3, lost=2, lost_reason="PRICE")
    cards = cards_by_id(client, sort="contact")
    assert cards[second]["rankAdjust"] is None
    # 결과 회사 자신도 자기 결과는 빼고 센다(성사 3곳 가운데 한 곳 → 남은 표본 2곳).
    assert cards[closing[0]]["rankAdjust"] is None
    assert cards[closing[0]]["bucketBasis"] == "CLOSED_OR_HOLD"


def test_virtual_and_real_results_are_not_mixed(contact_env):
    """Given 성사·거절 5곳이 실제 회사 표시 / When 가상 묶음 목록 / Then 세지 않는다."""
    client, opp_ids = contact_env
    _first, second, closing = prepare_pair(client, opp_ids, won=3, lost=2)
    assert cards_by_id(client)[second]["rankAdjust"]["level"] == 1
    for opp_id in closing:
        set_state(opp_id, virtual=False)
    assert cards_by_id(client)[second]["rankAdjust"] is None


def test_same_input_gives_the_same_buckets_and_order(contact_env):
    """Given 같은 자료 / When 두 번 조회 / Then 같은 묶음·순서·번호."""
    client, opp_ids = contact_env
    prepare_pair(client, opp_ids, won=3, lost=2)
    make_unscored(opp_ids[-1], "HIGH")

    def snapshot():
        return [
            (card["oppId"], card["bucket"], card["bucketBasis"], card["rank"], card["rankAdjust"])
            for card in listing(client, sort="contact")["data"]
        ]

    assert snapshot() == snapshot()


# ---------------------------------------------------------------------------
# 설정
# ---------------------------------------------------------------------------


def test_old_settings_copy_without_contact_list_reads_example_values(contact_env):
    """Given #610 전 DB 사본(contactList 없음) / When 조회 / Then 예시 파일 값으로 읽는다."""
    client, _ = contact_env
    with session_scope() as session:
        session.delete(session.get(AppSetting, "contactList"))
    with session_scope() as session:
        settings = read_app_settings(session).contact_list
        assert settings.now_classifications == [
            "CONTACT_URGENT",
            "CONTACT_PLANNED",
            "RESEARCH",
            "CONDITIONAL_WAIT",
        ]
        assert settings.unscored_high_fit_to_now is False
        assert settings.null_fit_level_as == "HIGH"
        adjust = settings.adjust
        assert (adjust.window_days, adjust.min_closed_count) == (365, 5)
        assert (adjust.won_per_step, adjust.max_up) == (2, 2)
        assert (adjust.lost_per_step, adjust.max_down) == (3, 1)
        assert adjust.lost_reasons_counted == ["NO_DEMAND", "QUALITY_CERT"]
    assert sum(listing(client, sort="contact")["meta"]["bucketCounts"].values()) == COMPANY_COUNT


def test_adjust_numbers_are_read_from_settings(contact_env):
    """Given 표본 기준을 3곳으로 낮춤 / When 성사 3곳 / Then 한 단계 위로 조정된다."""
    client, opp_ids = contact_env
    _first, second, _closing = prepare_pair(client, opp_ids, won=3, lost=0)
    assert cards_by_id(client)[second]["rankAdjust"] is None
    with session_scope() as session:
        row = session.get(AppSetting, "contactList")
        row.value = {**row.value, "adjust": {**row.value["adjust"], "minClosedCount": 3}}
    assert cards_by_id(client)[second]["rankAdjust"]["level"] == 1
