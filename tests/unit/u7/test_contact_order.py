"""#610: 추천 목록 세 묶음·영업 결과 조정·묶음 안 순서의 계산 함수 검사.

받은 값만 쓰는 순수 함수라 DB 없이 확인한다. 가상 이름만 쓴다(거산 실제 사양 아님).
기준 숫자(표본 5곳·성사 2곳마다 한 단계 등)는 예시 설정 `contactList` 값을 읽어 쓴다.
"""

from dataclasses import replace
from datetime import date, datetime, timedelta

import pytest

from geosan.config.app_settings import DEFAULT_APP_SETTINGS_PATH, load_app_settings
from geosan.dashboard.contact_order import (
    AdjustRule,
    CompanyState,
    adjustment_for,
    assign_bucket,
    closed_results,
    contact_order_key,
)
from geosan.dashboard.sales_analysis import CompanyRecords, RecordLine
from geosan.evidence.transfer import KST

NOW = datetime(2026, 11, 13, 9, 0, tzinfo=KST)
PROCESSES = [("ANODIZING", "아노다이징"), ("ZINC", "아연도금")]
INDUSTRIES = ["방위산업", "자동차 부품"]
SETTINGS = load_app_settings(DEFAULT_APP_SETTINGS_PATH).contact_list
RULE = AdjustRule(
    window_days=SETTINGS.adjust.window_days,
    min_closed_count=SETTINGS.adjust.min_closed_count,
    won_per_step=SETTINGS.adjust.won_per_step,
    max_up=SETTINGS.adjust.max_up,
    lost_per_step=SETTINGS.adjust.lost_per_step,
    max_down=SETTINGS.adjust.max_down,
    lost_reasons_counted=frozenset(SETTINGS.adjust.lost_reasons_counted),
)
# 필수를 통과하고 막는 조건이 없는 회사. 검사마다 한두 칸만 바꿔 쓴다.
PASSED = CompanyState(
    opinion=None,
    classification_code="CONTACT_PLANNED",
    relation_status="NEW_CONFIRMED",
    outcome_status=None,
    scored=True,
    fit_level=None,
    own_plating=False,
    core_evidence_recheck=False,
    blocks_approval=False,
)
UNSCORED = replace(
    PASSED,
    classification_code="NOT_EVALUATED",
    scored=False,
    core_evidence_recheck=True,
    blocks_approval=True,
)


def bucket(state, switch=False):
    return assign_bucket(
        state,
        now_classifications=SETTINGS.now_classifications,
        unscored_high_fit_to_now=switch,
    )


# ---------------------------------------------------------------------------
# 묶음 정하기
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("change", "expected"),
    [
        ({"opinion": "NOT_TARGET"}, ("LATER", "EXCLUDED_OPINION")),
        ({"classification_code": "FILTER_EXCLUDED"}, ("LATER", "REQUIRED_FAILED")),
        ({"relation_status": "EXISTING_CONFIRMED"}, ("LATER", "EXISTING_CUSTOMER")),
        ({"outcome_status": "WON"}, ("LATER", "CLOSED_OR_HOLD")),
        ({"outcome_status": "LOST"}, ("LATER", "CLOSED_OR_HOLD")),
        ({"outcome_status": "ON_HOLD"}, ("LATER", "CLOSED_OR_HOLD")),
        ({"outcome_status": "IN_PROGRESS"}, ("NOW", "IN_PROGRESS")),
        ({"outcome_status": "SAMPLE_OR_REGISTRATION_APPROVED"}, ("NOW", "IN_PROGRESS")),
        ({"opinion": "NEED_CHECK"}, ("CHECK", "NEED_CHECK_OPINION")),
        ({"classification_code": "FILTER_PENDING"}, ("CHECK", "REQUIRED_PENDING")),
        ({"classification_code": "OPS_PENDING"}, ("CHECK", "REQUIRED_PENDING")),
        ({"core_evidence_recheck": True}, ("CHECK", "EVIDENCE_RECHECK")),
        ({"classification_code": "CONTACT_REVIEW"}, ("CHECK", "EVIDENCE_RECHECK")),
        ({"own_plating": True}, ("CHECK", "OWN_PLATING")),
        ({}, ("NOW", "REQUIRED_PASSED")),
        ({"classification_code": "CONTACT_URGENT"}, ("NOW", "REQUIRED_PASSED")),
        ({"classification_code": "RESEARCH"}, ("NOW", "REQUIRED_PASSED")),
        ({"classification_code": "CONDITIONAL_WAIT"}, ("NOW", "REQUIRED_PASSED")),
        ({"classification_code": "WATCH"}, ("LATER", "MONITOR")),
        ({"classification_code": "LOW"}, ("LATER", "MONITOR")),
        ({"blocks_approval": True}, ("LATER", "MONITOR")),
        ({"outcome_status": "NOT_EXECUTED"}, ("NOW", "REQUIRED_PASSED")),
        ({"opinion": "WORTH_REVIEW"}, ("NOW", "REQUIRED_PASSED")),
    ],
)
def test_each_bucket_rule_for_scored_companies(change, expected):
    """Given 점수 있는 회사의 상태 한 가지 / When 묶음을 정하면 / Then 그 줄의 묶음과 이유."""
    assert bucket(replace(PASSED, **change)) == expected


@pytest.mark.parametrize(
    ("change", "expected"),
    [
        ({"own_plating": True, "fit_level": "HIGH"}, ("CHECK", "OWN_PLATING")),
        ({"fit_level": "HIGH"}, ("CHECK", "NOT_EVALUATED_HIGH_FIT")),
        ({"fit_level": "MEDIUM"}, ("LATER", "NOT_EVALUATED_LOWER_FIT")),
        ({"fit_level": "LOW"}, ("LATER", "NOT_EVALUATED_LOWER_FIT")),
        ({"fit_level": None}, ("LATER", "NOT_EVALUATED_LOWER_FIT")),
    ],
)
def test_each_bucket_rule_for_unevaluated_companies(change, expected):
    """Given 평가 전 회사(핵심 근거 재확인 표시가 켜져 있음) / When / Then 평가 전 줄이 먼저."""
    assert bucket(replace(UNSCORED, **change)) == expected


def test_unevaluated_high_fit_is_never_now_unless_the_switch_is_on():
    """Given 평가 전 + 적합도 상 / When 스위치 끔·켬 / Then 끄면 확인 필요, 켜면 지금 연락."""
    state = replace(UNSCORED, fit_level="HIGH")
    assert bucket(state)[0] == "CHECK"
    assert bucket(state, switch=True) == ("NOW", "NOT_EVALUATED_HIGH_FIT")
    # 스위치는 적합도 상에만 듣는다.
    assert bucket(replace(UNSCORED, fit_level="MEDIUM"), switch=True)[0] == "LATER"


def test_in_progress_wins_over_need_check_opinion():
    """Given 접촉 중인데 의견은 추가 확인 필요 / When / Then 지금 연락(진행 중)."""
    state = replace(PASSED, outcome_status="IN_PROGRESS", opinion="NEED_CHECK")
    assert bucket(state) == ("NOW", "IN_PROGRESS")
    # 필수조건 확인 전이어도 이미 접촉 중이면 지금 연락이다.
    pending = replace(state, classification_code="FILTER_PENDING", blocks_approval=True)
    assert bucket(pending) == ("NOW", "IN_PROGRESS")


@pytest.mark.parametrize(
    "blocked",
    [
        {"classification_code": "FILTER_EXCLUDED"},
        {"opinion": "NOT_TARGET"},
        {"relation_status": "EXISTING_CONFIRMED"},
    ],
)
@pytest.mark.parametrize("base", [PASSED, replace(UNSCORED, fit_level="HIGH")])
def test_required_failed_excluded_and_existing_are_never_now(blocked, base):
    """Given 필수 탈락·제외 의견·거래 중 / When 스위치를 켜고 접촉 중이어도 / Then 늘 나중."""
    state = replace(base, outcome_status="IN_PROGRESS", **blocked)
    assert bucket(state, switch=True)[0] == "LATER"
    assert bucket(state)[0] == "LATER"


def test_now_classifications_come_from_settings():
    """Given 설정에서 분류 하나만 남김 / When / Then 다른 분류는 지금 연락에 들지 않는다."""
    state = replace(PASSED, classification_code="CONDITIONAL_WAIT")
    result = assign_bucket(
        state, now_classifications=["CONTACT_URGENT"], unscored_high_fit_to_now=False
    )
    assert result == ("LATER", "MONITOR")


# ---------------------------------------------------------------------------
# 영업 결과 조정
# ---------------------------------------------------------------------------


def closed(
    name,
    status="WON",
    reason=None,
    at=NOW - timedelta(days=10),
    process="ANODIZING",
    industry="방위산업",
    contacted=True,
):
    lines = []
    if contacted:
        lines.append(
            RecordLine(
                status="IN_PROGRESS",
                method="CALL",
                result="REACHED",
                attempted_at=date(2026, 10, 1),
                created_at=at - timedelta(days=1),
                lost_reason_code=None,
            )
        )
    lines.append(
        RecordLine(
            status=status,
            method=None,
            result=None,
            attempted_at=None,
            created_at=at,
            lost_reason_code=reason,
        )
    )
    return CompanyRecords(
        opp_id=f"opp-{name}",
        name=name,
        process_codes=(process,),
        industries=(industry,),
        sales_step=None,
        lines=tuple(lines),
    )


def won(count, prefix="성사", **extra):
    return [closed(f"{prefix}{index}", **extra) for index in range(count)]


def lost(count, reason="NO_DEMAND", prefix="거절", **extra):
    return [
        closed(f"{prefix}{index}", status="LOST", reason=reason, **extra) for index in range(count)
    ]


def adjust(
    companies, opp_id="opp-대상", processes=("ANODIZING",), industries=("방위산업",), rule=RULE
):
    return adjustment_for(
        opp_id,
        processes,
        industries,
        closed_results(companies, window_days=rule.window_days, now=NOW),
        rule=rule,
        processes=PROCESSES,
        industry_order=INDUSTRIES,
    )


def test_three_won_and_two_counted_lost_move_one_step_up():
    """Given 같은 공정·산업 성사 3곳 + 센 거절 2곳 / When / Then 한 단계 위, 근거 숫자가 함께."""
    result = adjust(won(3) + lost(2))
    assert result.level == 1
    assert (result.process_code, result.process_name, result.industry) == (
        "ANODIZING",
        "아노다이징",
        "방위산업",
    )
    assert (result.won_count, result.lost_count, result.window_days) == (3, 2, 365)
    assert result.counted_lost_reasons == ["NO_DEMAND"]


def test_two_won_and_three_counted_lost_cancel_out():
    """Given 성사 2곳(+1) + 센 거절 3곳(−1) / When / Then 표본은 차지만 단계는 0."""
    result = adjust(won(2) + lost(3))
    assert (result.level, result.won_count, result.lost_count) == (0, 2, 3)


def test_sample_below_minimum_gives_no_adjustment():
    """Given 표본 4곳(성사 4) / When / Then 조정 없음."""
    assert adjust(won(4)) is None
    assert adjust([]) is None


def test_upper_and_lower_limits():
    """Given 성사 9곳 / 센 거절 9곳 / When / Then 위로 최대 두 단계, 아래로 최대 한 단계."""
    assert adjust(won(9)).level == 2
    assert adjust(lost(9)).level == -1
    mixed = adjust(lost(3, reason="NO_DEMAND") + lost(3, reason="QUALITY_CERT", prefix="품질"))
    assert mixed.level == -1
    assert mixed.counted_lost_reasons == ["NO_DEMAND", "QUALITY_CERT"]


def test_uncounted_lost_reasons_are_not_in_the_sample():
    """Given 성사 4곳 + 가격 거절 5곳 / When / Then 가격 거절은 안 세어 표본 4곳 → 조정 없음."""
    assert adjust(won(4) + lost(5, reason="PRICE")) is None
    result = adjust(won(5) + lost(5, reason="PRICE") + lost(1, reason=None, prefix="옛거절"))
    assert (result.level, result.won_count, result.lost_count) == (2, 5, 0)
    assert result.counted_lost_reasons == []


def test_results_outside_the_window_are_not_counted():
    """Given 성사 5곳 중 2곳이 400일 전 / When 기간 365일 / Then 표본 3곳 → 조정 없음."""
    old = NOW - timedelta(days=400)
    assert adjust(won(3) + won(2, prefix="옛성사", at=old)) is None
    assert adjust(won(3) + won(2, prefix="최근성사", at=NOW - timedelta(days=364))).level == 2


def test_companies_without_a_contact_attempt_are_not_counted():
    """Given 접촉 없이 단계만 성사로 바꾼 회사 / When / Then 영업 분석표처럼 세지 않는다."""
    assert adjust(won(4) + won(1, prefix="단계만", contacted=False)) is None


def test_own_result_is_left_out():
    """Given 성사 5곳 가운데 한 곳이 자기 자신 / When / Then 자기를 뺀 4곳 → 조정 없음."""
    companies = won(5)
    assert adjust(companies, opp_id="opp-성사0") is None
    assert adjust(companies).level == 2


def test_only_the_same_process_and_industry_pair_is_counted():
    """Given 공정만 같거나 산업만 같은 성사 / When / Then 세지 않는다."""
    companies = (
        won(3)
        + won(3, prefix="다른산업", industry="자동차 부품")
        + won(3, prefix="다른공정", process="ZINC")
    )
    assert adjust(companies) is None
    assert adjust(companies, processes=(), industries=("방위산업",)) is None
    assert adjust(companies, industries=()) is None


def test_pair_with_the_largest_sample_is_used():
    """Given 쌍 둘 중 표본이 더 많은 쪽 / When / Then 그 쌍 하나만 쓴다(합치지 않는다)."""
    companies = won(5, prefix="아연", process="ZINC", industry="자동차 부품") + won(6)
    result = adjust(
        companies, processes=("ZINC", "ANODIZING"), industries=("자동차 부품", "방위산업")
    )
    assert (result.process_code, result.industry, result.won_count) == ("ANODIZING", "방위산업", 6)


def test_tied_pairs_follow_process_order_then_industry_order():
    """Given 표본이 같은 쌍 / When / Then 역량 파일 공정 순 → 설정 산업 순으로 앞선 쌍."""
    both = ("ZINC", "ANODIZING"), ("자동차 부품", "방위산업")
    by_process = won(5, prefix="아연", process="ZINC") + won(5)
    result = adjust(by_process, processes=both[0], industries=both[1])
    assert (result.process_code, result.industry) == ("ANODIZING", "방위산업")
    by_industry = won(5, prefix="차", industry="자동차 부품") + won(5)
    result = adjust(by_industry, processes=both[0], industries=both[1])
    assert (result.process_code, result.industry) == ("ANODIZING", "방위산업")


def test_rule_numbers_come_from_settings():
    """Given 설정 숫자를 바꿈 / When / Then 바꾼 숫자대로 계산한다."""
    rule = replace(RULE, min_closed_count=2, won_per_step=1, max_up=1)
    assert adjust(won(2), rule=rule).level == 1
    counted = replace(RULE, lost_reasons_counted=frozenset({"PRICE"}), lost_per_step=5)
    assert adjust(lost(5, reason="PRICE"), rule=counted).level == -1


# ---------------------------------------------------------------------------
# 묶음 안 순서
# ---------------------------------------------------------------------------


def key(state=PASSED, position=1, level=0, valid_until=None, met=0, score_t=0, switch=False):
    name, basis = bucket(state, switch=switch)
    return contact_order_key(
        bucket=name,
        basis=basis,
        state=state,
        null_fit_level_as=SETTINGS.null_fit_level_as,
        level=level,
        valid_until=valid_until,
        timing_met_count=met,
        score_t=score_t,
        base_position=position,
    )


def test_buckets_come_before_everything_else():
    """Given 세 묶음의 회사 / When 정렬 / Then 지금 연락 → 확인 필요 → 나중(조정은 묶음 안만)."""
    now = key(PASSED, position=9, level=-1)
    check = key(replace(PASSED, core_evidence_recheck=True), position=2, level=2)
    later = key(replace(PASSED, classification_code="WATCH"), position=1, level=2)
    assert sorted([later, check, now]) == [now, check, later]


def test_order_inside_a_bucket():
    """Given 같은 묶음 / When 정렬 / Then 접촉 분류 → 적합도 → 조정 → 시점 신호 → 지금 순서."""
    urgent = key(replace(PASSED, classification_code="CONTACT_URGENT"), position=9, level=-1)
    planned = key(position=8, level=2)
    assert urgent < planned
    other_high = key(replace(PASSED, classification_code="RESEARCH", fit_level="HIGH"), 7)
    other_low = key(replace(PASSED, classification_code="RESEARCH", fit_level="LOW"), 1, level=2)
    assert planned < other_high < other_low
    # 적합도가 같으면 조정 단계가 큰 쪽이 위.
    assert key(position=5, level=1) < key(position=1, level=0) < key(position=0, level=-1)
    # 조정이 같으면 유효 기한이 가까운 곳 → 기한 없는 곳, 그다음 시점 조건 수 → T 점수.
    soon, far = date(2026, 11, 20), date(2026, 12, 20)
    assert key(position=5, valid_until=soon) < key(position=4, valid_until=far) < key(position=1)
    assert key(position=5, met=2) < key(position=4, met=1, score_t=30) < key(position=1)
    assert key(position=5, score_t=20) < key(position=1, score_t=10)
    # 모두 같으면 지금 순서.
    assert key(position=1) < key(position=2)


def test_missing_fit_level_is_read_from_settings():
    """Given 적합도가 없는 사례 파일 회사 / When 정렬 / Then 설정 값(상)으로 본다."""
    assert SETTINGS.null_fit_level_as == "HIGH"
    none, medium = key(position=2), key(replace(PASSED, fit_level="MEDIUM"), position=1)
    assert none < medium


def test_unevaluated_own_plating_goes_to_the_end_of_check():
    """Given 평가 전 + 표면처리 직접 표시 / When 정렬 / Then 확인 필요 묶음의 맨 뒤."""
    own = key(replace(UNSCORED, fit_level="HIGH", own_plating=True), position=1, level=2)
    high = key(replace(UNSCORED, fit_level="HIGH"), position=9)
    pending = key(
        replace(PASSED, classification_code="FILTER_PENDING", fit_level="LOW"), position=8
    )
    later = key(replace(UNSCORED, fit_level="LOW"), position=0)
    assert sorted([later, own, high, pending]) == [high, pending, own, later]
    # 점수가 있는 표면처리 표시 회사는 맨 뒤로 보내지 않는다.
    scored_own = key(replace(PASSED, own_plating=True, fit_level="HIGH"), position=9)
    assert scored_own < own


def test_same_input_gives_the_same_key():
    """Given 같은 입력 / When 두 번 / Then 같은 키(같은 순서)."""
    assert key(position=3, level=1) == key(position=3, level=1)
