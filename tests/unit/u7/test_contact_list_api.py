"""#675: 추천 목록의 근거 상태 묶음(#610의 세 묶음을 PM 결정 2026-11-13으로 바꿈).

실제 임시 DB(SQLite)와 실제 API로 확인한다. 외부 호출 없음. 가상 사례만 쓴다(거산 실제 사양
아님). 회사 상태(분류·거래 관계·적합도·근거 수·홈페이지)는 시험을 위해 임시 DB의 행을 직접 고쳐
만든다. 기준 숫자(근거 3건, 표본 5곳 등)는 예시 설정 `contactList` 값이다.
가상 회사는 모두 사례 파일 근거 5건으로 시작한다(= "근거 있음").
"""

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select

from geosan.api.app import create_app
from geosan.capability.importer import import_capability
from geosan.config.app_settings import read_app_settings
from geosan.config.models import AppSetting
from geosan.evaluation.ledger import latest_confirmed_evaluation
from geosan.evidence.models import Evidence
from geosan.opportunity.importer import import_case
from geosan.opportunity.models import Customer, Opportunity
from geosan.storage.base import utcnow
from geosan.storage.session import session_scope
from geosan.workflows.flow_evaluate import run_evaluation
from tests import factories
from tests.unit.u1.test_snapshot_ledger import _write
from tests.unit.u7.test_bookmark import give_opinion, set_bookmark
from tests.unit.u7.test_dashboard import record
from tests.unit.u7.test_sales_analysis import contact

URL = "/api/v1/opportunities"
PAIR = "방위산업"
OTHER = "자동차 부품"
COMPANY_COUNT = 8
BUCKET_NAMES = {"EVIDENCE_READY", "EVIDENCE_SOME", "NO_HOMEPAGE", "NOT_RESEARCHED", "CLOSED"}


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
    """후보 찾기로 막 들어온 회사처럼: 점수·근거·홈페이지 찾기 기록이 모두 없다."""
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
    keep_evidence(opp_id, 0)


def keep_evidence(opp_id, count):
    """살아 있는 근거를 `count`건만 남긴다. 나머지는 다시 넣어 교체된 근거로 표시한다."""
    with session_scope() as session:
        rows = session.scalars(
            select(Evidence)
            .where(Evidence.opp_id == opp_id, Evidence.superseded_at.is_(None))
            .order_by(Evidence.evidence_id)
        ).all()
        assert len(rows) >= count
        for row in rows[count:]:
            row.superseded_at = utcnow()


def set_homepage(opp_id, url, status):
    """홈페이지 찾기 결과를 적는다(찾음: 주소 + AI_FOUND, 못 찾음: 주소 없음 + NOT_FOUND)."""
    set_state(opp_id, homepage_url=url, homepage_status=status)


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
    """앞의 두 곳은 근거 있음 묶음(뒤쪽 회사만 성사·거절 회사와 같은 산업군), 나머지는 결과 회사."""
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
        assert card["bucket"] in BUCKET_NAMES
        assert card["bucketBasis"] and "rankAdjust" in card
    counts = body["meta"]["bucketCounts"]
    assert set(counts) == BUCKET_NAMES
    assert sum(counts.values()) == body["meta"]["total"] == COMPANY_COUNT
    assert counts["NOT_RESEARCHED"] == 1
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


def test_buckets_follow_evidence_and_homepage(contact_env):
    """Given 근거·홈페이지 상태가 다른 회사들 / When sort=contact / Then 묶음·이유가 상태대로."""
    client, opp_ids = contact_env
    ready, exact, few, homepage_only, needs_confirm, not_found, not_run, lost = opp_ids
    for opp_id in opp_ids:
        make_passed(opp_id)
    keep_evidence(exact, 3)  # 기준과 같은 수는 "근거 있음"
    keep_evidence(few, 2)  # 기준보다 1건 적으면 "근거 조금"
    keep_evidence(homepage_only, 0)
    set_homepage(homepage_only, "https://example.invalid/", "AI_FOUND")
    keep_evidence(needs_confirm, 0)
    set_homepage(needs_confirm, "https://example.invalid/b", "NEEDS_CONFIRMATION")
    keep_evidence(not_found, 0)
    set_homepage(not_found, None, "NOT_FOUND")
    make_unscored(not_run, "HIGH")
    close(client, lost, status="LOST", reason="PRICE")
    body = listing(client, sort="contact")
    cards = {card["oppId"]: card for card in body["data"]}
    assert {key: (cards[key]["bucket"], cards[key]["bucketBasis"]) for key in opp_ids} == {
        ready: ("EVIDENCE_READY", "EVIDENCE_ENOUGH"),
        exact: ("EVIDENCE_READY", "EVIDENCE_ENOUGH"),
        few: ("EVIDENCE_SOME", "EVIDENCE_FEW"),
        homepage_only: ("EVIDENCE_SOME", "HOMEPAGE_ONLY"),
        needs_confirm: ("EVIDENCE_SOME", "HOMEPAGE_ONLY"),
        not_found: ("NO_HOMEPAGE", "HOMEPAGE_NOT_FOUND"),
        not_run: ("NOT_RESEARCHED", "RESEARCH_NOT_RUN"),
        lost: ("CLOSED", "CLOSED_OR_HOLD"),
    }
    assert body["meta"]["bucketCounts"] == {
        "EVIDENCE_READY": 2,
        "EVIDENCE_SOME": 3,
        "NO_HOMEPAGE": 1,
        "NOT_RESEARCHED": 1,
        "CLOSED": 1,
    }
    # 묶음 순서대로 오고, 번호는 묶음마다 1부터다.
    order = [(card["bucket"], card["rank"]) for card in body["data"]]
    assert order == [
        ("EVIDENCE_READY", 1),
        ("EVIDENCE_READY", 2),
        ("EVIDENCE_SOME", 1),
        ("EVIDENCE_SOME", 2),
        ("EVIDENCE_SOME", 3),
        ("NO_HOMEPAGE", 1),
        ("NOT_RESEARCHED", 1),
        ("CLOSED", 1),
    ]
    # 쪽을 넘겨도 묶음 안 번호가 이어진다.
    second_page = client.get(URL, params={"sort": "contact", "pageSize": 3, "page": 2}).json()
    assert [(c["bucket"], c["rank"]) for c in second_page["data"]] == order[3:6]


def test_not_found_homepage_wins_over_a_leftover_address(contact_env):
    """Given 못 찾음으로 적혔는데 옛 주소가 남은 회사 / When / Then 홈페이지 없음 묶음."""
    client, opp_ids = contact_env
    make_passed(opp_ids[0])
    keep_evidence(opp_ids[0], 0)
    set_homepage(opp_ids[0], "https://example.invalid/old", "NOT_FOUND")
    card = cards_by_id(client)[opp_ids[0]]
    assert (card["bucket"], card["bucketBasis"]) == ("NO_HOMEPAGE", "HOMEPAGE_NOT_FOUND")


def test_closed_companies_stay_at_the_bottom_whatever_the_evidence(contact_env):
    """Given 근거 5건인 탈락·제외·거래 중·성사·거절·보류 / When / Then 모두 끝난 회사, 맨 아래."""
    client, opp_ids = contact_env
    failed, excluded, existing, won, lost, hold, in_progress, passed = opp_ids
    for opp_id in opp_ids:
        make_passed(opp_id)
    set_state(failed, classification_code="FILTER_EXCLUDED", blocks_approval=True)
    give_opinion(client, excluded, "NOT_TARGET")
    set_state(existing, relation_status="EXISTING_CONFIRMED")
    close(client, won)
    close(client, lost, status="LOST", reason="NO_DEMAND")
    record(client, hold, {"status": "ON_HOLD", "reason": "가상 보류 사유"})
    record(client, in_progress, {"status": "IN_PROGRESS"})
    body = listing(client, sort="contact")
    cards = {card["oppId"]: card for card in body["data"]}
    assert {key: (cards[key]["bucket"], cards[key]["bucketBasis"]) for key in opp_ids} == {
        failed: ("CLOSED", "REQUIRED_FAILED"),
        excluded: ("CLOSED", "EXCLUDED_OPINION"),
        existing: ("CLOSED", "EXISTING_CUSTOMER"),
        won: ("CLOSED", "CLOSED_OR_HOLD"),
        lost: ("CLOSED", "CLOSED_OR_HOLD"),
        hold: ("CLOSED", "CLOSED_OR_HOLD"),
        # 접촉 중인 회사는 끝난 회사가 아니다. 근거 수로 묶는다.
        in_progress: ("EVIDENCE_READY", "EVIDENCE_ENOUGH"),
        passed: ("EVIDENCE_READY", "EVIDENCE_ENOUGH"),
    }
    assert [card["bucket"] for card in body["data"]] == ["EVIDENCE_READY"] * 2 + ["CLOSED"] * 6
    # 끝난 회사는 근거가 없어도 끝난 회사다(근거 상태보다 먼저 본다).
    keep_evidence(lost, 0)
    assert cards_by_id(client)[lost]["bucket"] == "CLOSED"


def test_evidence_threshold_is_read_from_settings(contact_env):
    """Given 근거 2건 회사 / When 기준을 3 → 2로 낮춤 / Then 근거 조금 → 근거 있음."""
    client, opp_ids = contact_env
    make_passed(opp_ids[0])
    keep_evidence(opp_ids[0], 2)
    assert cards_by_id(client)[opp_ids[0]]["bucket"] == "EVIDENCE_SOME"
    with session_scope() as session:
        row = session.get(AppSetting, "contactList")
        row.value = {**row.value, "evidenceReadyMin": 2}
    assert cards_by_id(client)[opp_ids[0]]["bucket"] == "EVIDENCE_READY"


# ---------------------------------------------------------------------------
# 묶음 안 순서
# ---------------------------------------------------------------------------


def test_fit_level_orders_every_bucket_before_the_old_order(contact_env):
    """Given 추천 순 앞쪽이 적합도 낮음 / When sort=contact / Then 상 → 중 → 하, 같으면 추천 순."""
    client, opp_ids = contact_env
    for opp_id in opp_ids:
        make_passed(opp_id)
    order = rank_order(client, opp_ids)
    ready, some = order[:4], order[4:]
    for opp_id, fit in zip(ready, ["LOW", "MEDIUM", None, "HIGH"], strict=True):
        set_state(opp_id, fit_level=fit)
    for opp_id, fit in zip(some, ["MEDIUM", "HIGH", "LOW", "HIGH"], strict=True):
        set_state(opp_id, fit_level=fit)
        keep_evidence(opp_id, 1)
    listed = [card["oppId"] for card in listing(client, sort="contact")["data"]]
    # 적합도가 없는 사례 파일 회사는 설정(nullFitLevelAs: HIGH)대로 "상"으로 본다.
    assert listed[:4] == [ready[2], ready[3], ready[1], ready[0]]
    assert listed[4:] == [some[1], some[3], some[0], some[2]]


def test_score_order_is_used_only_inside_the_evidence_ready_bucket(contact_env):
    """Given 추천 순 뒤쪽이 '지금 바로 연락' / When / Then 근거 있음에서만 앞으로 온다."""
    client, opp_ids = contact_env
    for opp_id in opp_ids:
        make_passed(opp_id)
    order = rank_order(client, opp_ids)
    ready, some = order[:4], order[4:]
    set_state(ready[-1], classification_code="CONTACT_URGENT")
    for opp_id in some:
        keep_evidence(opp_id, 1)
    set_state(some[-1], classification_code="CONTACT_URGENT")
    listed = [card["oppId"] for card in listing(client, sort="contact")["data"]]
    assert listed[:4] == [ready[3], ready[0], ready[1], ready[2]]
    assert listed[4:] == some  # 근거 조금 묶음은 분류로 순서를 가르지 않는다


# ---------------------------------------------------------------------------
# 영업 결과 조정
# ---------------------------------------------------------------------------


def _ready(body):
    return [card for card in body["data"] if card["bucket"] == "EVIDENCE_READY"]


def test_recent_results_in_the_same_pair_move_the_card_up_with_a_reason(contact_env):
    """Given 같은 공정·산업 성사 3곳 + 센 거절 2곳 / When sort=contact / Then 한 단계 위와 근거."""
    client, opp_ids = contact_env
    first, second, _closing = prepare_pair(client, opp_ids, won=3, lost=2)
    ready = _ready(listing(client, sort="contact"))
    assert [card["oppId"] for card in ready] == [second, first]  # 추천 순은 first가 앞이었다
    assert [card["rank"] for card in ready] == [1, 2]
    adjust = ready[0]["rankAdjust"]
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
    assert ready[1]["rankAdjust"] is None  # 다른 산업군이라 표본 0곳
    # 점수·분류·기존 순위는 그대로다.
    before = {card["oppId"]: card for card in listing(client, sort="rank")["data"]}
    for card in ready:
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
    ready = _ready(listing(client, sort="contact"))
    assert [card["oppId"] for card in ready] == [first, second]
    assert (ready[1]["rankAdjust"]["level"], ready[1]["rankAdjust"]["lostCount"]) == (0, 3)


def test_small_sample_changes_nothing(contact_env):
    """Given 표본 4곳(성사 4) / When sort=contact / Then 순서 그대로, 조정 이유 없음."""
    client, opp_ids = contact_env
    first, second, _closing = prepare_pair(client, opp_ids, won=4, lost=0)
    ready = _ready(listing(client, sort="contact"))
    assert [card["oppId"] for card in ready] == [first, second]
    assert [card["rankAdjust"] for card in ready] == [None, None]


def test_adjustment_is_given_only_to_evidence_ready_cards(contact_env):
    """Given 표본이 충분한데 근거가 1건뿐 / When / Then 근거 조금 묶음, 조정 없음·순서 그대로."""
    client, opp_ids = contact_env
    first, second, closing = prepare_pair(client, opp_ids, won=3, lost=2)
    assert cards_by_id(client)[second]["rankAdjust"]["level"] == 1
    for opp_id in (first, second):
        keep_evidence(opp_id, 1)
    some = [c for c in listing(client, sort="contact")["data"] if c["bucket"] == "EVIDENCE_SOME"]
    assert [(card["oppId"], card["rankAdjust"]) for card in some] == [(first, None), (second, None)]
    # 끝난 회사 카드에도 조정을 주지 않는다.
    assert cards_by_id(client)[closing[0]]["rankAdjust"] is None


def test_uncounted_reasons_and_own_result_are_left_out(contact_env):
    """Given 성사 3곳 + 가격 거절 2곳 / When / Then 가격 거절은 안 세어 표본 3곳 → 조정 없음."""
    client, opp_ids = contact_env
    _first, second, closing = prepare_pair(client, opp_ids, won=3, lost=2, lost_reason="PRICE")
    cards = cards_by_id(client, sort="contact")
    assert cards[second]["rankAdjust"] is None
    assert cards[closing[0]]["bucketBasis"] == "CLOSED_OR_HOLD"
    # 가격 거절도 세도록 설정을 바꾸면 표본 5곳이 되어 조정된다(세지 않은 것이 이유였음을 확인).
    with session_scope() as session:
        row = session.get(AppSetting, "contactList")
        counted = [*row.value["adjust"]["lostReasonsCounted"], "PRICE"]
        row.value = {**row.value, "adjust": {**row.value["adjust"], "lostReasonsCounted": counted}}
    assert cards_by_id(client, sort="contact")[second]["rankAdjust"]["lostCount"] == 2


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
# 관심으로 고른 회사 빼기 (hideBookmarked)
# ---------------------------------------------------------------------------


def test_hide_bookmarked_leaves_picked_companies_out_of_every_count(contact_env):
    """Given 관심 2곳 / When hideBookmarked=true / Then 카드·곳 수·묶음·선택지 모두 6곳 기준."""
    client, opp_ids = contact_env
    for opp_id in opp_ids:
        make_passed(opp_id, industries=[PAIR])
    picked = opp_ids[:2]
    keep_evidence(picked[0], 1)
    for opp_id in picked:
        assert set_bookmark(client, opp_id, True).status_code == 200
    everything = listing(client, sort="contact")
    hidden = listing(client, sort="contact", hideBookmarked="true")
    assert {card["oppId"] for card in hidden["data"]} == set(opp_ids[2:])
    assert hidden["meta"]["total"] == COMPANY_COUNT - 2
    assert sum(hidden["meta"]["bucketCounts"].values()) == COMPANY_COUNT - 2
    assert hidden["meta"]["bucketCounts"]["EVIDENCE_SOME"] == 0
    assert everything["meta"]["bucketCounts"]["EVIDENCE_SOME"] == 1
    counts = {row["processCode"]: row["count"] for row in hidden["meta"]["processCounts"]}
    assert counts["ANODIZING"] == COMPANY_COUNT - 2
    assert {row["industry"]: row["count"] for row in hidden["meta"]["industryCounts"]} == {
        PAIR: COMPANY_COUNT - 2
    }
    assert {row["region"]: row["count"] for row in hidden["meta"]["regionCounts"]}["천안시"] == (
        COMPANY_COUNT - 2
    )
    # 관심 기업 수는 조건과 무관하게 같다(목록 머리 "관심 기업 2곳").
    assert hidden["meta"]["bookmarkedCount"] == everything["meta"]["bookmarkedCount"] == 2
    assert listing(client, bookmarked="true")["meta"]["total"] == 2
    # 공정 하나를 고른 목록(공정별 묶음 보기의 한 묶음)에도 같이 적용된다.
    by_process = listing(client, sort="contact", process="ANODIZING", hideBookmarked="true")
    assert by_process["meta"]["total"] == COMPANY_COUNT - 2
    assert not {card["oppId"] for card in by_process["data"]} & set(picked)


@pytest.mark.parametrize("sort", ["rank", "recent"])
def test_other_sorts_and_filters_are_unchanged_without_the_new_condition(contact_env, sort):
    """Given 관심 1곳 / When 새 조건 없이·false로 조회 / Then 순서·번호·곳 수가 서로 같다."""
    client, opp_ids = contact_env
    assert set_bookmark(client, opp_ids[0], True).status_code == 200

    def view(**params):
        body = listing(client, sort=sort, **params)
        return [(c["oppId"], c["rank"]) for c in body["data"]], body["meta"]["total"]

    assert view() == view(hideBookmarked="false")
    assert view()[1] == COMPANY_COUNT
    assert view(bookmarked="true") == ([(opp_ids[0], 1)], 1)


def test_bookmarked_only_and_hide_bookmarked_together_are_rejected(contact_env):
    """Given 서로 반대인 두 조건 / When 함께 보냄 / Then 입력 오류(빈 목록을 성공처럼 주지 않음)."""
    client, _ = contact_env
    response = client.get(URL, params={"bookmarked": "true", "hideBookmarked": "true"})
    assert response.status_code == 400


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
        assert settings.evidence_ready_min == 3
        assert settings.null_fit_level_as == "HIGH"
        adjust = settings.adjust
        assert (adjust.window_days, adjust.min_closed_count) == (365, 5)
        assert (adjust.won_per_step, adjust.max_up) == (2, 2)
        assert (adjust.lost_per_step, adjust.max_down) == (3, 1)
        assert adjust.lost_reasons_counted == ["NO_DEMAND", "QUALITY_CERT"]
    assert sum(listing(client, sort="contact")["meta"]["bucketCounts"].values()) == COMPANY_COUNT


def test_old_contact_list_copy_without_the_evidence_key_reads_the_example_value(contact_env):
    """Given #610 때 만든 DB 사본(근거 기준 키 없음) / When 조회 / Then 예시 값 3건으로 묶는다."""
    client, opp_ids = contact_env
    with session_scope() as session:
        row = session.get(AppSetting, "contactList")
        row.value = {key: value for key, value in row.value.items() if key != "evidenceReadyMin"}
        # 옛 사본에 있던 두 키는 그대로 두어도 읽힌다(더는 쓰지 않음).
        assert {"nowClassifications", "unscoredHighFitToNow"} <= set(row.value)
    with session_scope() as session:
        assert read_app_settings(session).contact_list.evidence_ready_min == 3
    for opp_id in opp_ids[:2]:
        make_passed(opp_id)
    keep_evidence(opp_ids[0], 2)
    cards = cards_by_id(client, sort="contact")
    assert cards[opp_ids[0]]["bucket"] == "EVIDENCE_SOME"
    assert cards[opp_ids[1]]["bucket"] == "EVIDENCE_READY"


def test_adjust_numbers_are_read_from_settings(contact_env):
    """Given 표본 기준을 3곳으로 낮춤 / When 성사 3곳 / Then 한 단계 위로 조정된다."""
    client, opp_ids = contact_env
    _first, second, _closing = prepare_pair(client, opp_ids, won=3, lost=0)
    assert cards_by_id(client)[second]["rankAdjust"] is None
    with session_scope() as session:
        row = session.get(AppSetting, "contactList")
        row.value = {**row.value, "adjust": {**row.value["adjust"], "minClosedCount": 3}}
    assert cards_by_id(client)[second]["rankAdjust"]["level"] == 1
