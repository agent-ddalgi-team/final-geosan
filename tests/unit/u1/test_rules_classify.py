"""분류 순서·핵심 근거·시점·조사·표시와 실제 엔진 시나리오 (BR5~7, BR10)."""

from datetime import timedelta

import pytest

from geosan.rules.classify import classify, display_texts
from geosan.rules.codes import QualificationStatusCode, ReviewStatus
from geosan.rules.engine import evaluate, rank
from geosan.rules.items import calculate_items
from geosan.rules.models import RankInput, ResearchReadinessInput, TimingRequirements, Totals
from geosan.rules.requirements import assess_requirements
from geosan.rules.timing import (
    core_evidence,
    readiness_needs_reset,
    research_missing,
    timing_requirements,
    valid_contact_until,
)
from geosan.rules.totals import calculate_totals
from tests.factories import replace_contract, rule_engine_input


@pytest.mark.parametrize(
    "filter_state,ops,p,e,r,core,ready,research,expected",
    [
        ("EXCLUDED", False, 0, 0, 0, "RECHECK", False, False, "FILTER_EXCLUDED"),
        ("PENDING", False, 0, 0, 0, "RECHECK", False, False, "FILTER_PENDING"),
        ("PASS", False, 0, 0, 0, "RECHECK", False, False, "OPS_PENDING"),
        ("PASS", True, 0, 0, 100, "RECHECK", False, True, "NOT_EVALUATED"),
        ("PASS", True, 95, 75, 82, "MET", True, True, "CONTACT_URGENT"),
        ("PASS", True, 95, 75, 82, "MET", False, True, "CONTACT_PLANNED"),
        ("PASS", True, 70, 60, 80, "MET", True, True, "CONTACT_REVIEW"),
        ("PASS", True, 69, 60, 80, "MET", True, True, "RESEARCH"),
        ("PASS", True, 95, 80, 82, "RECHECK", True, True, "RESEARCH"),
        ("PASS", True, 95, 80, 82, "RECHECK", True, False, "CONDITIONAL_WAIT"),
        ("PASS", True, 95, 40, 59, "RECHECK", True, True, "WATCH"),
        ("PASS", True, 95, 40, 40, "RECHECK", True, False, "WATCH"),
        ("PASS", True, 95, 20, 39, "MET", True, True, "LOW"),
    ],
)
def test_classification_first_matching_branch(
    filter_state, ops, p, e, r, core, ready, research, expected
):
    """Given 겹치는 분류 조건, When 순서 판정, Then 처음 해당하는 분기와 설정 기준을 따른다."""
    data = rule_engine_input()
    data.operational_ready = ops
    totals = Totals(E=e, F=e, T=0, P=p, R=r, S=100, C=100)
    timing = TimingRequirements(direct_signal=True, agreed_window=True, readiness=ready)
    assert classify(data, filter_state, totals, core, timing, research) == expected
    if expected == "CONTACT_URGENT":
        data.rule_config.thresholds.urgent_e = e + 1
        assert classify(data, filter_state, totals, core, timing, research) == "CONTACT_PLANNED"
        data.rule_config.thresholds.planned_e = e + 1
        assert classify(data, filter_state, totals, core, timing, research) == "CONTACT_REVIEW"
        data.rule_config.thresholds.review_e = e + 1
        assert classify(data, filter_state, totals, core, timing, research) == "RESEARCH"


@pytest.mark.parametrize(
    "change,expected",
    [
        ("none", "MET"),
        ("weak", "RECHECK"),
        ("pending", "RECHECK"),
        ("no_ids", "RECHECK"),
        ("missing_id", "RECHECK"),
        ("config_states", "MET"),
        ("config_review", "MET"),
        ("config_item", "RECHECK"),
    ],
)
def test_core_evidence_requires_review(change, expected):
    """Given 핵심 항목과 사용한 거산 값, When 핵심 판단, Then 설정과 검수 여부를 확인한다."""
    data = rule_engine_input()
    if change in {"weak", "config_states"}:
        data.item_inputs[1] = replace_contract(data.item_inputs[1], state="WEAK")
    if change == "config_states":
        data.rule_config.core_evidence.new.allowed_states = ["CONFIRMED", "WEAK"]
    if change in {"pending", "config_review"}:
        used_process = next(
            p
            for p in data.capability.processes
            if p.process_id in data.item_inputs[1].used_capability_ids
        )
        used_process.review_status = ReviewStatus.PENDING
    if change == "config_review":
        data.rule_config.core_evidence.new.require_reviewed_capability = False
    if change == "no_ids":
        data.item_inputs[1].used_capability_ids = []
    if change == "missing_id":
        data.item_inputs[1].used_capability_ids = ["missing"]
    if change == "config_item":
        data.rule_config.core_evidence.new.items = ["missing"]
    assert core_evidence(data, calculate_items(data)) == expected


@pytest.mark.parametrize(
    "change,direct,agreed,ready",
    [
        ("none", True, True, True),
        ("indirect", False, False, True),
        ("weak", False, False, True),
        ("expired", False, False, True),
        ("closed", False, False, True),
        ("no_deadline", False, False, True),
        ("no_window", True, False, True),
        ("outside", True, False, True),
        ("no_check", True, True, False),
        ("unchecked", True, True, False),
        ("optional_window", True, True, True),
        ("scheduled", True, True, True),
        ("no_schedule", True, False, True),
        ("past_schedule", True, False, True),
    ],
)
def test_timing_three_independent_requirements(change, direct, agreed, ready):
    """Given 행동 신호·합의기간·담당자 체크, When 시점 판단, Then 세 요건을 별도로 판정한다."""
    data = rule_engine_input()
    signal = data.signals[0]
    if change == "indirect":
        signal.relation = "INDIRECT"
    if change == "weak":
        signal.certainty = "WEAK"
    if change == "expired":
        signal.deadline_at = data.base_date - timedelta(days=1)
    if change == "closed":
        signal.progress_status = "CLOSED"
    if change == "no_deadline":
        signal.deadline_at = None
    if change in {"no_window", "optional_window"}:
        signal.agreed_window = None
    if change == "outside":
        signal.agreed_window.days = 20
    if change == "no_check":
        data.readiness_check = None
    if change == "unchecked":
        data.readiness_check.checked = False
    if change == "optional_window":
        data.rule_config.timing_requirements.agreed_window_required = False
    if change in {"scheduled", "no_schedule", "past_schedule"}:
        signal.signal_kind = "NEXT_CONTACT"
        signal.scheduled_at = signal.deadline_at if change == "scheduled" else None
        if change == "past_schedule":
            signal.scheduled_at = data.base_date - timedelta(days=1)
        signal.deadline_at = None
    actual = timing_requirements(data)
    assert (actual.direct_signal, actual.agreed_window, actual.readiness) == (direct, agreed, ready)


@pytest.mark.parametrize(
    "missing",
    [
        None,
        "has_graded_evidence",
        "has_question_set",
        "has_channel_and_owner",
        "question_can_change_class",
        "time",
        "no_estimate",
        "negative",
        "no_snapshot_evidence",
        "forbidden",
        "blocked",
        "config_limit",
        "custom_limit",
    ],
)
def test_research_needs_all_five_requirements(missing):
    """Given 조사 준비 항목 하나 부족, When 조사 가능 판단, Then 부족 사유를 남긴다."""
    data = rule_engine_input()
    data.research_readiness = ResearchReadinessInput(
        has_graded_evidence=True,
        has_question_set=True,
        has_channel_and_owner=True,
        question_can_change_class=True,
        estimated_hours=2,
    )
    ready = data.research_readiness
    if missing in {
        "has_graded_evidence",
        "has_question_set",
        "has_channel_and_owner",
        "question_can_change_class",
    }:
        setattr(ready, missing, False)
    if missing == "time":
        ready.estimated_hours = 2.1
    if missing == "no_estimate":
        ready.estimated_hours = None
    if missing == "negative":
        ready.estimated_hours = -1
    if missing == "no_snapshot_evidence":
        data.evidence = []
    if missing == "forbidden":
        for e in data.evidence:
            e.security_grade = "FORBIDDEN"
    if missing == "blocked":
        for e in data.evidence:
            e.blocked = True
    if missing == "config_limit":
        data.rule_config.research_requirements.max_hours_default = 1
    if missing == "custom_limit":
        ready.max_hours = 1
    assert bool(research_missing(data)) == (missing is not None)
    data.research_readiness = None
    assert len(research_missing(data)) == 5


@pytest.mark.parametrize(
    "change,reset",
    [
        ("same", False),
        ("deadline", True),
        ("requirement", True),
        ("score", False),
        ("later", False),
        ("new_required", True),
        ("unrelated_signal", False),
    ],
)
def test_readiness_reset_compares_previous_snapshot(change, reset):
    """Given 체크 당시 입력, When 기한·현재 필수 요구가 바뀜, Then 재확인이 필요한지 알린다."""
    before = rule_engine_input()
    after = before.model_copy(deep=True)
    old = assess_requirements(before).requirement_checks
    if change == "deadline":
        after.signals[0].deadline_at += timedelta(days=1)
    if change == "requirement":
        after.capability.qualifications[0].current_status = QualificationStatusCode.CANCELLED
    if change == "score":
        after.item_inputs[0].state = "WEAK"
    if change == "later":
        after.requirements[1].due_at = after.base_date
    if change == "new_required":
        after.requirements[2] = replace_contract(
            after.requirements[2], req_level="REQUIRED", needed_stage="NOW"
        )
    if change == "unrelated_signal":
        after.signals[1].deadline_at = after.base_date
    new = assess_requirements(after).requirement_checks
    assert readiness_needs_reset(before, after, old, new) is reset
    after.opportunity.opp_id = "different"
    with pytest.raises(ValueError, match="같은 기회"):
        readiness_needs_reset(before, after, old, new)


@pytest.mark.parametrize("required,expected", [(True, "FILTER_PENDING"), (False, "OPS_PENDING")])
def test_brochure_reference_scores_never_allow_contact(required, expected):
    """Given 검수 대기 소개서, When 평가, Then 필수 요구 유무에 따라 ②·③이고 승인은 막힌다."""
    data = rule_engine_input()
    data.dataset_kind = "BROCHURE"
    for process in data.capability.processes:
        process.dataset_kind = "BROCHURE"
        process.review_status = "PENDING"
    for q in data.capability.qualifications:
        q.review_status = ReviewStatus.PENDING
    if not required:
        data.requirements = []
    assessment = assess_requirements(data)
    totals = calculate_totals(calculate_items(data), data.rule_config)
    code = classify(
        data, assessment.filter_state, totals, "RECHECK", timing_requirements(data), False
    )
    assert code == expected
    display = display_texts(data, code, assessment, totals, "RECHECK", research_missing(data))
    assert display.blocks_approval and display.score_display == "참고 81"


@pytest.mark.parametrize(
    "change,code,score,blocked",
    [
        ("none", "CONTACT_URGENT", "81", False),
        ("none", "FILTER_PENDING", "--", True),
        ("none", "OPS_PENDING", "--", True),
        ("null", "NOT_EVALUATED", "--", True),
        ("half", "CONTACT_URGENT", "82", False),
        ("unknown_stage", "CONTACT_URGENT", "81", True),
        ("relation", "CONTACT_URGENT", "81", True),
        ("none", "CONDITIONAL_WAIT", "81", True),
    ],
)
def test_display_score_and_approval(change, code, score, blocked):
    """Given 표시 분류·요구·관계, When 표시 생성, Then 승인 차단과 점수 문구를 일관되게 만든다."""
    data = rule_engine_input()
    if change == "unknown_stage":
        data.requirements[0].needed_stage = "UNKNOWN"
    if change == "relation":
        data.opportunity.relation_status = "UNCONFIRMED"
    assessment = assess_requirements(data)
    totals = calculate_totals(calculate_items(data), data.rule_config)
    if change == "null":
        totals.S = None
    if change == "half":
        totals.S = 81.5
    data.rule_config.classification_labels[code] = "설정에서 바꾼 문구"
    display = display_texts(data, code, assessment, totals, "RECHECK", research_missing(data))
    assert (display.score_display, display.blocks_approval) == (score, blocked)
    assert "설정에서 바꾼 문구" in display.reason
    assert ("승인 막힘" if blocked else "없음") in display.blocker_text
    if code == "CONDITIONAL_WAIT":
        assert "조사 재개 조건" in display.reason


@pytest.mark.parametrize(
    "filename,code",
    [("apjeong-input.json", "CONTACT_URGENT"), ("reading_example2.json", "FILTER_PENDING")],
)
def test_acceptance_decision(filename, code):
    """Given 완료 기준 사례, When 실제 계산, Then A정밀만 연락 후보가 된다."""
    data = rule_engine_input(filename)
    before = data.model_dump()
    output = evaluate(data)
    assert evaluate(data) == output
    assert data.model_dump() == before
    assert output.classification_code == code
    result = rank(
        [RankInput(opp_id=data.opportunity.opp_id, profile=data.profile, sort_key=output.sort_key)],
        data.dataset_kind,
        data.rule_config,
    )
    assert result[0].original_rank == 1
    rows = calculate_items(data)
    totals = calculate_totals(rows, data.rule_config)
    assessment = assess_requirements(data)
    assert (
        classify(
            data,
            assessment.filter_state,
            totals,
            core_evidence(data, rows),
            timing_requirements(data),
            not research_missing(data),
        )
        == code
    )
    if filename == "apjeong-input.json":
        assert str(valid_contact_until(data)) == "2026-11-10"
        assert output.sort_key.direct_confirmed_weight == 87
        assert output.sort_key.group == "URGENT"
        assert output.display.blocks_approval is False
        assert output.display.score_display == "81"
        assert "없음" in output.display.blocker_text
        assert len(output.question_candidates) == 1
        assert "Nadcap" in output.question_candidates[0].text
