"""#943 되먹임 ③: 담당자 선호 제안·순서 조정의 순수 계산(저장·외부 호출 없음)."""

import pytest

from geosan.dashboard.preference import (
    DISTANCE,
    PROCESS_INDUSTRY,
    Combo,
    CompanyTraits,
    PreferenceRule,
    first_match,
    keep_explore_slot,
    preferred_level,
    suggest,
)

RULE = PreferenceRule(min_picks=10, min_share=0.5, distance_km=50, min_closed_for_rate=3)
ZINC_AUTO = Combo(PROCESS_INDUSTRY, process_code="ZINC", industry="자동차 부품")


def company(opp_id, process="ZINC", industry="자동차 부품", km=30.0):
    return CompanyTraits(opp_id, frozenset({process}), frozenset({industry}), km)


def world(picked_zinc=6, picked_other=4, excluded_zinc=0, closed=None):
    """고른 회사 picked_zinc곳은 아연도금 × 자동차 부품(30km),
    나머지는 아노다이징 × 반도체(80km)."""
    traits = {}
    picked = []
    for n in range(picked_zinc):
        traits[f"z{n}"] = company(f"z{n}")
        picked.append(f"z{n}")
    for n in range(picked_other):
        traits[f"o{n}"] = company(f"o{n}", "ANOD", "반도체", 80.0)
        picked.append(f"o{n}")
    excluded = []
    for n in range(excluded_zinc):
        traits[f"x{n}"] = company(f"x{n}")
        excluded.append(f"x{n}")
    closed_rows = []
    for opp_id, inside, won in closed or []:
        traits[opp_id] = company(opp_id) if inside else company(opp_id, "ANOD", "반도체", 80.0)
        closed_rows.append((opp_id, won))
    return traits, picked, excluded, closed_rows


# 조합 안 3곳 중 2곳 성사, 밖 3곳 중 1곳 성사 → 안이 더 좋다.
GOOD = [("c1", True, True), ("c2", True, True), ("c3", True, False)] + [
    ("d1", False, True),
    ("d2", False, False),
    ("d3", False, False),
]


def run(traits, picked, excluded, closed, active=()):
    return suggest(
        traits,
        picked=picked,
        excluded=excluded,
        closed=closed,
        rule=RULE,
        process_order=["ZINC", "ANOD"],
        industry_order=["자동차 부품", "반도체"],
        active=active,
    )


def test_concentrated_picks_with_good_results_are_suggested():
    """Given 고른 10곳 중 6곳이 아연도금 × 자동차 부품(30km 안), 성사율도 더 높음
    Then 공정 × 산업 제안과 거리 제안이 나오고 숫자가 붙는다."""
    traits, picked, excluded, closed = world(closed=GOOD)
    found = run(traits, picked, excluded, closed)
    assert [row.combo for row in found] == [ZINC_AUTO, Combo(DISTANCE, distance_km=50)]
    first = found[0]
    assert (first.picked_count, first.share) == (6, 0.6)
    assert (first.closed_count, first.won_count) == (3, 2)
    assert (first.other_closed_count, first.other_won_count) == (3, 1)


def test_too_few_picks_suggest_nothing():
    traits, picked, excluded, closed = world(picked_zinc=6, picked_other=3, closed=GOOD)
    assert run(traits, picked, excluded, closed) == []


def test_exclusions_inside_the_combo_lower_the_share():
    """Given 6곳을 골랐지만 같은 조합 2곳을 제외함 / Then (6 − 2) ÷ 10 = 0.4라 제안 안 함."""
    traits, picked, excluded, closed = world(excluded_zinc=2, closed=GOOD)
    assert ZINC_AUTO not in [row.combo for row in run(traits, picked, excluded, closed)]


@pytest.mark.parametrize(
    "closed",
    [
        # 안전장치①: 조합 안 성사율(1/3)이 밖(2/3)보다 낮다.
        [("c1", True, True), ("c2", True, False), ("c3", True, False)]
        + [("d1", False, True), ("d2", False, True), ("d3", False, False)],
        # 표본 모자람: 조합 안 결과가 2곳뿐.
        [("c1", True, True), ("c2", True, True)]
        + [("d1", False, False), ("d2", False, False), ("d3", False, False)],
        # 결과가 하나도 없음: 고르기만 많다.
        [],
    ],
)
def test_safeguard_one_needs_results_at_least_as_good_as_elsewhere(closed):
    traits, picked, excluded, rows = world(closed=closed)
    assert run(traits, picked, excluded, rows) == []


def test_already_approved_combo_is_not_suggested_again():
    traits, picked, excluded, closed = world(closed=GOOD)
    found = run(traits, picked, excluded, closed, active=[ZINC_AUTO])
    assert [row.combo.kind for row in found] == [DISTANCE]


def test_distance_combo_needs_a_known_distance():
    assert not Combo(DISTANCE, distance_km=50).matches(company("a", km=None))
    assert Combo(DISTANCE, distance_km=50).matches(company("a", km=50.0))
    assert not Combo(DISTANCE, distance_km=50).matches(company("a", km=50.1))


def test_first_match_uses_the_earliest_approval():
    approvals = [("p-dist", Combo(DISTANCE, distance_km=50)), ("p-zinc", ZINC_AUTO)]
    assert first_match(company("a"), approvals) == "p-dist"
    assert first_match(company("b", km=90.0), approvals) == "p-zinc"
    assert first_match(company("c", "ANOD", "반도체", 90.0), approvals) is None


@pytest.mark.parametrize(
    ("base", "matched", "expected"),
    [(0, True, 1), (1, True, 2), (2, True, 2), (-1, True, 0), (1, False, 1), (3, True, 3)],
)
def test_preferred_level_adds_one_step_up_to_the_cap(base, matched, expected):
    assert preferred_level(base, matched=matched, step=1, max_level=2) == expected


def test_explore_slot_moves_the_first_non_preferred_company_into_the_top():
    """Given 근거 있음 앞 5자리가 모두 선호 회사 / Then 선호 밖 첫 회사가 5번째 자리로 올라온다."""
    order = ["a", "b", "c", "d", "e", "f", "x", "g", "later"]
    ready = set(order) - {"later"}
    preferred = {"a", "b", "c", "d", "e", "f", "g"}
    result, moved = keep_explore_slot(order, ready=ready, preferred=preferred, top_n=5)
    assert moved == "x"
    assert result == ["a", "b", "c", "d", "x", "e", "f", "g", "later"]


def test_explore_slot_skips_other_buckets_and_leaves_mixed_tops_alone():
    # 앞 5자리 안에 이미 선호 밖 회사가 있으면 그대로.
    order = ["a", "x", "b", "c", "d", "e"]
    result, moved = keep_explore_slot(
        order, ready=set(order), preferred={"a", "b", "c", "d", "e"}, top_n=5
    )
    assert (result, moved) == (order, None)
    # 선호 밖 회사가 다른 묶음에만 있으면 옮기지 않는다.
    order = ["a", "b", "c", "d", "e", "other-bucket"]
    result, moved = keep_explore_slot(
        order, ready={"a", "b", "c", "d", "e"}, preferred={"a", "b", "c", "d", "e"}, top_n=5
    )
    assert (result, moved) == (order, None)


def test_example_settings_carry_the_pm_numbers():
    """예시 설정의 값이 PM 결정(2026-11-26)과 같다:
    180일·10곳·절반·50km·성사율 표본 3·90일·한 단계."""
    from geosan.config.app_settings import DEFAULT_APP_SETTINGS_PATH, load_app_settings

    found = load_app_settings(DEFAULT_APP_SETTINGS_PATH).contact_list.preference
    assert found is not None and found.enabled is True
    assert (found.window_days, found.min_picks, found.min_share, found.distance_km) == (
        180,
        10,
        0.5,
        50,
    )
    assert (found.min_closed_for_rate, found.approval_days, found.step, found.max_level) == (
        3,
        90,
        1,
        2,
    )
    assert found.explore_top_n == 5
