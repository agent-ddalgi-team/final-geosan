"""그룹·기한·동점·설정 정렬과 프로필 분리 검사 (BR6.4~6.5)."""

from datetime import date
from itertools import permutations

import pytest

from geosan.rules.models import RankInput, SortKey, SortKeySpec
from geosan.rules.rank import rank_outputs
from tests.factories import replace_contract, rule_engine_input


def row(opp_id, group="OTHER", **values):
    return RankInput(
        opp_id=opp_id,
        profile="NEW",
        sort_key=SortKey(
            **(
                dict(group=group, E=60, F=50, P=90, R=80, direct_confirmed_weight=70, opp_id=opp_id)
                | values
            )
        ),
    )


def ordered(rows, dataset="VIRTUAL_REVIEWED", config=None):
    result = rank_outputs(rows, dataset, config or rule_engine_input().rule_config)
    assert [r.original_rank for r in result] == list(range(1, len(rows) + 1))
    return [r.opp_id for r in result]


def test_group_priority():
    """Given 네 분류 그룹 혼합, When 순위 계산, Then 접촉 분류 우선순서가 유지된다."""
    rows = [
        row("other"),
        row("review", "REVIEW"),
        row("planned", "PLANNED"),
        row("urgent", "URGENT"),
    ]
    assert ordered(rows) == ["urgent", "planned", "review", "other"]


def test_urgent_uses_earliest_deadline_before_score():
    """Given 점수가 높은 늦은 기회, When 시점 우선 정렬, Then 이른 기한이 앞선다."""
    rows = [
        row("late", "URGENT", E=90, valid_until=date(2026, 11, 10)),
        row("early", "URGENT", E=60, valid_until=date(2026, 11, 9)),
        row("none", "URGENT", E=100),
    ]
    assert ordered(rows) == ["early", "late", "none"]


@pytest.mark.parametrize("group", ["URGENT", "PLANNED", "REVIEW"])
@pytest.mark.parametrize("field", ["E", "F", "direct_confirmed_weight", "P"])
def test_contact_score_tie_breaks(group, field):
    """Given 앞선 키가 동점, When 정렬, Then 다음 확인 수치 내림차순을 적용한다."""
    first, last = row("z", group), row("a", group)
    setattr(first.sort_key, field, getattr(first.sort_key, field) + 1)
    assert ordered([last, first]) == ["z", "a"]


@pytest.mark.parametrize(
    "dataset,expected",
    [("VIRTUAL_REVIEWED", ["potential", "score"]), ("BROCHURE", ["score", "potential"])],
)
def test_other_order_comes_from_configuration(dataset, expected):
    """Given 일반·소개서 후보, When 정렬, Then 설정된 R·E 순서를 따른다."""
    rows = [row("score", E=70, R=80), row("potential", E=60, R=90)]
    config = rule_engine_input().rule_config
    assert ordered(rows, dataset, config) == expected
    config.other_group_sort.default = [SortKeySpec(key="E", order="asc")]
    assert ordered(rows, config=config) == ["potential", "score"]


@pytest.mark.parametrize("group", ["URGENT", "PLANNED", "REVIEW", "OTHER"])
def test_deterministic_ties_and_no_input_mutation(group):
    """Given 동점 후보 입력 순서 변경, When 두 번 정렬, Then ID 순서가 같고 입력은 그대로다."""
    rows = [row("c", group), row("a", group), row("b", group)]
    before = [r.model_dump() for r in rows]
    for shuffled in permutations(rows):
        assert ordered(list(shuffled)) == ["a", "b", "c"]
    assert [r.model_dump() for r in rows] == before
    if group == "REVIEW":
        rows[0].sort_key.valid_until = date(2026, 11, 10)
        assert ordered(rows) == ["c", "a", "b"]


@pytest.mark.parametrize(
    "problem", ["mixed_profiles", "duplicate", "different_id", "dataset", "empty_config", "empty"]
)
def test_invalid_batch_rejected(problem):
    """Given 혼합 프로필·중복 기회·잘못된 설정, When 순위, Then 명확히 거부한다."""
    rows = [row("a"), row("b")]
    config = rule_engine_input().rule_config
    dataset = "VIRTUAL_REVIEWED"
    if problem == "mixed_profiles":
        rows[1] = replace_contract(rows[1], profile="RECONTACT")
    if problem == "duplicate":
        rows[1] = rows[0]
    if problem == "different_id":
        rows[0].sort_key.opp_id = "x"
    if problem == "dataset":
        dataset = "missing"
    if problem == "empty_config":
        config.other_group_sort.default = []
    if problem == "empty":
        assert rank_outputs([], dataset, config) == []
        return
    with pytest.raises(ValueError):
        rank_outputs(rows, dataset, config)


def test_brochure_tie_prefers_more_judged_not_remaining_potential():
    """Given E가 같은 둘 / When 소개서 정렬 / Then P 큰 쪽이 앞이고 R은 무관 (#63 원칙 2)."""
    thorough = row("thorough", E=48, P=85, R=65)  # 빈칸을 끝까지 "없음"으로 판정한 회사
    sparse = row("sparse", E=48, P=55, R=95)  # 다섯 항목을 비워 둔 회사(가능 점수만 높음)
    assert ordered([sparse, thorough], "BROCHURE") == ["thorough", "sparse"]
    # 가상 검수 묶음(default)은 R 순 그대로다.
    assert ordered([thorough, sparse], "VIRTUAL_REVIEWED") == ["sparse", "thorough"]


@pytest.mark.parametrize("weight", [5, 7, 10, 15])
def test_marking_unavailable_as_no_signal_never_lowers_brochure_rank(weight):
    """Given 미확보 하나를 "없음"으로 판정(E 같음, P+w, R-w) / When 정렬 / Then 순위 유지·상승."""
    others = [row("a", E=50, P=100, R=50), row("b", E=48, P=67, R=83), row("c", E=48, P=55, R=95)]
    before = row("target", E=48, P=55, R=95)
    after = row("target", E=48, P=55 + weight, R=95 - weight)
    rank_before = ordered([*others, before], "BROCHURE").index("target")
    rank_after = ordered([*others, after], "BROCHURE").index("target")
    assert rank_after <= rank_before
