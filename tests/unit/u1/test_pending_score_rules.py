"""#262: 점수·승인 판정은 유지하고 확인 상태와 기존 거래처 배치만 바꾼다."""

import json
from itertools import permutations
from pathlib import Path

import pytest

from geosan.config.errors import InputError
from geosan.config.rule_config import load_rule_config
from geosan.rules.codes import DatasetKind, ItemState, RelationStatus
from geosan.rules.engine import evaluate, rank
from geosan.rules.models import EvaluationOutput, RankInput, RuleConfig
from tests.factories import rule_engine_input
from tests.unit.u1.test_rules_rank import ordered, row

DATASETS = ["VIRTUAL_REVIEWED", "BROCHURE", "COMPANY_CONFIRMED"]


def pending_input(dataset, reason):
    data = rule_engine_input()
    data.dataset_kind = DatasetKind(dataset)
    for process in data.capability.processes:
        process.dataset_kind = data.dataset_kind
    if reason == "relation":
        data.opportunity.relation_status = RelationStatus.UNCONFIRMED
    else:
        # 운영 준비만 남은 상황: 소개서의 필수 자격 미확인이 먼저 분류되지 않게 한다.
        data.requirements = []
        data.operational_ready = False
    return data


@pytest.mark.parametrize("dataset", DATASETS)
@pytest.mark.parametrize("reason,code", [("relation", "FILTER_PENDING"), ("ops", "OPS_PENDING")])
def test_pending_keeps_calculated_numbers_and_approval_block(dataset, reason, code):
    data = pending_input(dataset, reason)
    before = data.model_dump()
    result = evaluate(data)
    prefix = "참고 " if dataset == "BROCHURE" else ""
    assert result.display.score_display == f"{prefix}77점 · 7/8"
    assert result.classification_code == code
    assert result.score_state == "PENDING" and result.display.blocks_approval
    assert (result.totals.E, result.totals.P, result.totals.S, result.totals.R) == (
        77,
        95,
        81.1,
        82,
    )
    assert data.model_dump() == before
    assert result.model_dump(by_alias=True)["scoreState"] == "PENDING"
    assert EvaluationOutput.model_validate(result.model_dump()) == result


@pytest.mark.parametrize("dataset", DATASETS)
@pytest.mark.parametrize("reason", ["relation", "ops"])
def test_pending_without_any_judged_item_is_none(dataset, reason):
    data = pending_input(dataset, reason)
    data.item_inputs = []
    result = evaluate(data)
    assert result.totals.S is None
    assert result.display.score_display == "--" and result.score_state == "NONE"
    assert result.display.blocks_approval


@pytest.mark.parametrize(
    "relation,state", [("UNCONFIRMED", "PENDING"), ("NEW_CONFIRMED", "CONFIRMED")]
)
def test_zero_is_a_score_not_missing(relation, state):
    data = rule_engine_input()
    data.opportunity.relation_status = RelationStatus(relation)
    for item in data.item_inputs:
        item.state = ItemState.NO_SIGNAL
    result = evaluate(data)
    assert result.totals.S == 0
    assert result.display.score_display == "0점 · 8/8" and result.score_state == state


@pytest.mark.parametrize("relation", ["NEW_CONFIRMED", "EXISTING_CONFIRMED", "UNCONFIRMED"])
def test_evaluation_passes_relation_to_rank_without_changing_scores(relation):
    data = rule_engine_input()
    data.opportunity.relation_status = RelationStatus(relation)
    result = evaluate(data)
    assert result.sort_key.relation_status == relation
    assert result.sort_key.model_dump(by_alias=True)["relationStatus"] == relation
    assert result.totals.model_dump() == evaluate(rule_engine_input()).totals.model_dump()
    assert (
        rank(
            [
                RankInput(
                    opp_id=data.opportunity.opp_id, profile=data.profile, sort_key=result.sort_key
                )
            ],
            data.dataset_kind,
            data.rule_config,
        )[0].original_rank
        == 1
    )


@pytest.mark.parametrize("dataset", DATASETS)
@pytest.mark.parametrize("placement", ["BOTTOM", "INLINE"])
def test_existing_customer_partition_preserves_each_group_order(dataset, placement):
    rows = [
        row(f"{group}-existing", group, E=90, relation_status="EXISTING_CONFIRMED")
        for group in ("URGENT", "PLANNED", "REVIEW", "OTHER")
    ] + [
        row(f"{group}-new", group, E=60, relation_status="NEW_CONFIRMED")
        for group in ("URGENT", "PLANNED", "REVIEW", "OTHER")
    ]
    rows.append(row("OTHER-unknown", E=70, relation_status="UNCONFIRMED"))
    config = rule_engine_input().rule_config
    config.existing_customer_placement = placement
    usual = [
        "URGENT-existing",
        "URGENT-new",
        "PLANNED-existing",
        "PLANNED-new",
        "REVIEW-existing",
        "REVIEW-new",
        "OTHER-existing",
        "OTHER-unknown",
        "OTHER-new",
    ]
    expected = (
        [name for name in usual if not name.endswith("-existing")]
        + [name for name in usual if name.endswith("-existing")]
        if placement == "BOTTOM"
        else usual
    )
    before = [item.model_dump() for item in rows]
    for batch in (rows, list(reversed(rows))):
        assert ordered(batch, dataset, config) == expected
    assert [item.model_dump() for item in rows] == before


def test_bottom_keeps_existing_ties_stable_and_never_hides_rows():
    rows = [row(name, relation_status="EXISTING_CONFIRMED") for name in ("c", "a", "b")]
    for batch in permutations(rows):
        assert ordered(list(batch)) == ["a", "b", "c"]
    assert ordered([]) == []


def test_previous_configuration_uses_bottom_default():
    raw = rule_engine_input().rule_config.model_dump(by_alias=True)
    raw.pop("existingCustomerPlacement", None)
    assert RuleConfig.model_validate(raw).existing_customer_placement == "BOTTOM"


@pytest.mark.parametrize("placement", ["BOTTOM", "INLINE", "REMOVE"])
def test_configuration_file_accepts_only_approved_placements(tmp_path, placement):
    source = Path("examples/rule-config.yaml").read_text(encoding="utf-8")
    path = tmp_path / "rules.yaml"
    path.write_text(
        source.replace(
            "existingCustomerPlacement: BOTTOM", f"existingCustomerPlacement: {placement}"
        ),
        encoding="utf-8",
    )
    if placement == "REMOVE":
        with pytest.raises(InputError):
            load_rule_config(path)
    else:
        assert load_rule_config(path).existing_customer_placement == placement
    schema = json.loads(Path("contracts/rule-config.schema.json").read_text(encoding="utf-8"))
    assert schema["properties"]["existingCustomerPlacement"]["enum"] == ["BOTTOM", "INLINE"]
