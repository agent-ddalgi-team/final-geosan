"""#675: 추천 목록의 근거 상태 묶음·영업 결과 조정(#610)·묶음 안 순서의 계산 함수 검사.

받은 값만 쓰는 순수 함수라 DB 없이 확인한다. 가상 이름만 쓴다(거산 실제 사양 아님).
기준 숫자(근거 3건·표본 5곳·성사 2곳마다 한 단계 등)는 예시 설정 `contactList` 값을 읽어 쓴다.
#610의 세 묶음(지금 연락할 곳 / 확인 필요 / 나중) 검사를 PM 결정(2026-11-13)에 따라 바꿨다.
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
from geosan.rules.codes import LostReasonCode

NOW = datetime(2026, 11, 13, 9, 0, tzinfo=KST)
PROCESSES = [("ANODIZING", "아노다이징"), ("ZINC", "아연도금")]
INDUSTRIES = ["방위산업", "자동차 부품"]
# 계산 함수에 넘기는 거절 이유 코드표 순서(계약 C0). 창구가 넘기는 값과 같다.
LOST_REASON_ORDER = [code.value for code in LostReasonCode]
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
READY_MIN = SETTINGS.evidence_ready_min
# 끝나지 않았고 근거가 기준만큼 있는 회사. 검사마다 한두 칸만 바꿔 쓴다.
READY = CompanyState(
    opinion=None,
    classification_code="CONTACT_PLANNED",
    relation_status="NEW_CONFIRMED",
    outcome_status=None,
    fit_level=None,
    evidence_count=READY_MIN,
    homepage_url="https://example.invalid/",
    homepage_status="AI_FOUND",
)
# 후보 찾기로 막 들어와 아직 조사가 돌지 않은 회사.
FRESH = replace(
    READY,
    classification_code="NOT_EVALUATED",
    evidence_count=0,
    homepage_url=None,
    homepage_status=None,
)


def bucket(state, ready_min=READY_MIN):
    return assign_bucket(state, evidence_ready_min=ready_min)


# ---------------------------------------------------------------------------
# 묶음 정하기
# ---------------------------------------------------------------------------


def test_example_threshold_is_three():
    """Given 예시 설정 / When 근거 기준을 읽으면 / Then 3건(PM 결정 2026-11-13의 초기값)."""
    assert READY_MIN == 3


@pytest.mark.parametrize(
    ("change", "expected"),
    [
        ({}, ("EVIDENCE_READY", "EVIDENCE_ENOUGH")),
        ({"evidence_count": 30}, ("EVIDENCE_READY", "EVIDENCE_ENOUGH")),
        # 근거가 충분하면 홈페이지 기록이 없어도(사례 파일 회사) 근거 있음이다.
        (
            {"homepage_url": None, "homepage_status": None},
            ("EVIDENCE_READY", "EVIDENCE_ENOUGH"),
        ),
        (
            {"homepage_url": None, "homepage_status": "NOT_FOUND"},
            ("EVIDENCE_READY", "EVIDENCE_ENOUGH"),
        ),
        ({"evidence_count": 2}, ("EVIDENCE_SOME", "EVIDENCE_FEW")),
        ({"evidence_count": 1}, ("EVIDENCE_SOME", "EVIDENCE_FEW")),
        # 근거가 1건이라도 있으면 홈페이지를 못 찾았어도 근거 조금이다.
        (
            {"evidence_count": 1, "homepage_url": None, "homepage_status": "NOT_FOUND"},
            ("EVIDENCE_SOME", "EVIDENCE_FEW"),
        ),
        ({"evidence_count": 0}, ("EVIDENCE_SOME", "HOMEPAGE_ONLY")),
        (
            {"evidence_count": 0, "homepage_status": "NEEDS_CONFIRMATION"},
            ("EVIDENCE_SOME", "HOMEPAGE_ONLY"),
        ),
        ({"evidence_count": 0, "homepage_status": "CONFIRMED"}, ("EVIDENCE_SOME", "HOMEPAGE_ONLY")),
        # 근거 출처에서 주소만 알고 찾기 기록은 없는 회사도 주소가 있으면 근거 조금이다.
        ({"evidence_count": 0, "homepage_status": None}, ("EVIDENCE_SOME", "HOMEPAGE_ONLY")),
        (
            {"evidence_count": 0, "homepage_url": None, "homepage_status": "NOT_FOUND"},
            ("NO_HOMEPAGE", "HOMEPAGE_NOT_FOUND"),
        ),
        # 못 찾음으로 적혔으면 옛 주소가 남아 있어도 홈페이지 없음이다.
        (
            {"evidence_count": 0, "homepage_status": "NOT_FOUND"},
            ("NO_HOMEPAGE", "HOMEPAGE_NOT_FOUND"),
        ),
        (
            {"evidence_count": 0, "homepage_url": None, "homepage_status": None},
            ("NOT_RESEARCHED", "RESEARCH_NOT_RUN"),
        ),
        (
            {"evidence_count": 0, "homepage_url": "", "homepage_status": None},
            ("NOT_RESEARCHED", "RESEARCH_NOT_RUN"),
        ),
    ],
)
def test_each_evidence_bucket_rule(change, expected):
    """Given 끝나지 않은 회사의 근거·홈페이지 상태 / When 묶음을 정하면 / Then 그 줄의 묶음·이유."""
    assert bucket(replace(READY, **change)) == expected


@pytest.mark.parametrize(
    ("change", "expected"),
    [
        ({"opinion": "NOT_TARGET"}, ("CLOSED", "EXCLUDED_OPINION")),
        ({"classification_code": "FILTER_EXCLUDED"}, ("CLOSED", "REQUIRED_FAILED")),
        ({"relation_status": "EXISTING_CONFIRMED"}, ("CLOSED", "EXISTING_CUSTOMER")),
        ({"outcome_status": "WON"}, ("CLOSED", "CLOSED_OR_HOLD")),
        ({"outcome_status": "LOST"}, ("CLOSED", "CLOSED_OR_HOLD")),
        ({"outcome_status": "ON_HOLD"}, ("CLOSED", "CLOSED_OR_HOLD")),
    ],
)
@pytest.mark.parametrize("base", [READY, replace(READY, evidence_count=1), FRESH])
def test_closed_companies_are_closed_whatever_the_evidence(change, expected, base):
    """Given 탈락·제외·거래 중·성사·거절·보류 / When 근거가 많든 없든 / Then 늘 끝난 회사."""
    assert bucket(replace(base, **change)) == expected


def test_closed_reasons_keep_the_old_first_match_order():
    """Given 끝난 이유가 겹침 / When / Then 제외 의견 → 필수 탈락 → 거래 중 → 성사·거절·보류."""
    everything = replace(
        READY,
        opinion="NOT_TARGET",
        classification_code="FILTER_EXCLUDED",
        relation_status="EXISTING_CONFIRMED",
        outcome_status="LOST",
    )
    assert bucket(everything)[1] == "EXCLUDED_OPINION"
    assert bucket(replace(everything, opinion=None))[1] == "REQUIRED_FAILED"
    without_failed = replace(everything, opinion=None, classification_code="CONTACT_PLANNED")
    assert bucket(without_failed)[1] == "EXISTING_CUSTOMER"
    assert bucket(replace(without_failed, relation_status="UNCONFIRMED"))[1] == "CLOSED_OR_HOLD"


@pytest.mark.parametrize(
    "change",
    [
        {"outcome_status": "IN_PROGRESS"},
        {"outcome_status": "SAMPLE_OR_REGISTRATION_APPROVED"},
        {"outcome_status": "NOT_EXECUTED"},
        {"opinion": "NEED_CHECK"},
        {"opinion": "WORTH_REVIEW"},
        {"classification_code": "FILTER_PENDING"},
        {"classification_code": "OPS_PENDING"},
        {"classification_code": "NOT_EVALUATED"},
        {"classification_code": "WATCH"},
        {"classification_code": "LOW"},
        {"relation_status": "UNCONFIRMED"},
    ],
)
def test_states_that_used_to_split_the_three_buckets_no_longer_matter(change):
    """Given 접촉 중·추가 확인 필요·필수 확인 전·관찰 분류 / When / Then 근거 수로만 묶는다."""
    assert bucket(replace(READY, **change)) == ("EVIDENCE_READY", "EVIDENCE_ENOUGH")
    assert bucket(replace(FRESH, **change)) == ("NOT_RESEARCHED", "RESEARCH_NOT_RUN")


def test_threshold_comes_from_settings():
    """Given 근거 2건 / When 기준 3건·2건 / Then 3건이면 근거 조금, 2건이면 근거 있음."""
    state = replace(READY, evidence_count=2)
    assert bucket(state)[0] == "EVIDENCE_SOME"
    assert bucket(state, ready_min=2)[0] == "EVIDENCE_READY"
    assert bucket(replace(READY, evidence_count=4), ready_min=5)[0] == "EVIDENCE_SOME"


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
        closed_results(companies, window_days=rule.window_days, now=NOW, tz=KST),
        rule=rule,
        processes=PROCESSES,
        industry_order=INDUSTRIES,
        lost_reason_order=LOST_REASON_ORDER,
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


def key(state=READY, position=1, level=0, valid_until=None, met=0, score_t=0):
    name, _basis = bucket(state)
    return contact_order_key(
        bucket=name,
        state=state,
        null_fit_level_as=SETTINGS.null_fit_level_as,
        level=level,
        valid_until=valid_until,
        timing_met_count=met,
        score_t=score_t,
        base_position=position,
    )


SOME = replace(READY, evidence_count=1)
NOT_FOUND = replace(READY, evidence_count=0, homepage_url=None, homepage_status="NOT_FOUND")
LOST = replace(READY, outcome_status="LOST")


def test_buckets_come_before_everything_else():
    """Given 다섯 묶음의 회사 / When 정렬 / Then 근거 있음 → 조금 → 홈페이지 없음 → 조사 전 → 끝."""
    ready = key(replace(READY, fit_level="LOW"), position=9, level=-1)
    some = key(replace(SOME, fit_level="HIGH"), position=4, level=2)
    not_found = key(replace(NOT_FOUND, fit_level="HIGH"), position=3)
    fresh = key(replace(FRESH, fit_level="HIGH"), position=2)
    closed_company = key(replace(LOST, fit_level="HIGH"), position=1, level=2)
    shuffled = [closed_company, fresh, some, ready, not_found]
    assert sorted(shuffled) == [ready, some, not_found, fresh, closed_company]


@pytest.mark.parametrize("base", [READY, SOME, NOT_FOUND, FRESH, LOST])
def test_fit_level_comes_first_inside_every_bucket(base):
    """Given 같은 묶음 / When 정렬 / Then 적합도 상 → 중 → 하, 지금 순서보다 먼저."""
    high = key(replace(base, fit_level="HIGH"), position=9)
    medium = key(replace(base, fit_level="MEDIUM"), position=5)
    low = key(replace(base, fit_level="LOW"), position=1)
    assert high < medium < low


def test_order_inside_the_evidence_ready_bucket():
    """Given 근거 있음 묶음 / When 정렬 / Then 적합도 → 접촉 분류 → 조정 → 시점 신호 → 지금 순서."""
    # 적합도가 분류보다 먼저다(#675): 적합도 중인 '지금 바로 연락'은 적합도 상인 '계획' 뒤.
    urgent_medium = key(
        replace(READY, classification_code="CONTACT_URGENT", fit_level="MEDIUM"), position=1
    )
    planned_high = key(replace(READY, fit_level="HIGH"), position=9, level=-1)
    assert planned_high < urgent_medium
    # 적합도가 같으면 접촉 분류(부록 F 순서)가 조정보다 먼저다.
    urgent = key(replace(READY, classification_code="CONTACT_URGENT"), position=9, level=-1)
    planned = key(position=8, level=2)
    other = key(replace(READY, classification_code="RESEARCH"), position=1, level=2)
    assert urgent < planned < other
    # 분류가 같으면 조정 단계가 큰 쪽이 위.
    assert key(position=5, level=1) < key(position=1, level=0) < key(position=0, level=-1)
    # 조정이 같으면 유효 기한이 가까운 곳 → 기한 없는 곳, 그다음 시점 조건 수 → T 점수.
    soon, far = date(2026, 11, 20), date(2026, 12, 20)
    assert key(position=5, valid_until=soon) < key(position=4, valid_until=far) < key(position=1)
    assert key(position=5, met=2) < key(position=4, met=1, score_t=30) < key(position=1)
    assert key(position=5, score_t=20) < key(position=1, score_t=10)
    # 모두 같으면 지금 순서.
    assert key(position=1) < key(position=2)


@pytest.mark.parametrize("base", [SOME, NOT_FOUND, FRESH, LOST])
def test_other_buckets_use_only_fit_level_and_the_old_order(base):
    """Given 근거 있음이 아닌 묶음 / When 분류·조정·시점 신호가 달라도 / Then 지금 순서 그대로."""
    front = key(replace(base, classification_code="LOW"), position=1, level=-1)
    back = key(
        replace(base, classification_code="CONTACT_URGENT"),
        position=2,
        level=2,
        valid_until=date(2026, 11, 20),
        met=3,
        score_t=90,
    )
    assert front < back


def test_missing_fit_level_is_read_from_settings():
    """Given 적합도가 없는 사례 파일 회사 / When 정렬 / Then 설정 값(상)으로 본다."""
    assert SETTINGS.null_fit_level_as == "HIGH"
    none, medium = key(position=2), key(replace(READY, fit_level="MEDIUM"), position=1)
    assert none < medium
    assert key(position=2) == key(replace(READY, fit_level="HIGH"), position=2)


def test_same_input_gives_the_same_key():
    """Given 같은 입력 / When 두 번 / Then 같은 키(같은 순서)."""
    assert key(position=3, level=1) == key(position=3, level=1)
