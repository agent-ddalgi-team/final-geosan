"""분류 순서·핵심 근거·시점·조사·표시와 실제 엔진 시나리오 (BR5~7, BR10)."""

from datetime import timedelta

import pytest

from geosan.rules.classify import classify, display_texts
from geosan.rules.codes import (
    DatasetKind,
    ItemState,
    NeededStage,
    Profile,
    QualificationStatusCode,
    RelationStatus,
    ReviewStatus,
)
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
        ("other_ids_only", "RECHECK"),
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
    if change in {"no_ids", "other_ids_only"}:
        data.item_inputs[1].used_capability_ids = []
    if change == "other_ids_only":
        data.item_inputs[0].used_capability_ids = ["proc-anodizing"]
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
    assert display.blocks_approval and display.score_display == "참고 77점 · 7/8"


def test_brochure_score_counts_judged_items_instead_of_weight():
    """Given 미확보 5항목, When 소개서 평가, Then 배점 비율 대신 실제 3/8을 표시한다."""
    data = rule_engine_input()
    data.dataset_kind = DatasetKind.BROCHURE
    for process in data.capability.processes:
        process.dataset_kind = DatasetKind.BROCHURE
        process.review_status = ReviewStatus.PENDING
    data.item_inputs = data.item_inputs[:3]

    result = evaluate(data)

    assert sum(item.state == ItemState.UNAVAILABLE for item in result.items) == 5
    assert result.totals.E == 55
    assert result.totals.P == 60
    assert result.display.score_display == "참고 55점 · 3/8"
    assert result.display.blocks_approval


def test_recontact_score_uses_seven_item_display_boundary(monkeypatch):
    """Given 재접촉용 7행 대역, When 표시만 생성, Then 0점도 세고 6/7을 표시한다.

    재접촉 계산(U6)은 아직 미구현이므로 계산 경계만 대역으로 두고 표시 함수를 검사한다.
    """
    data = rule_engine_input()
    assessment = assess_requirements(data)
    rows = calculate_items(data)[: len(data.rule_config.recontact_profile_items)]
    rows[-1] = replace_contract(rows[-1], state=ItemState.UNAVAILABLE, score=None)
    totals = Totals(E=70, F=60, T=10, P=85, R=80, S=82.4, C=85.7)
    data.profile = Profile.RECONTACT

    def calculated_recontact_items(received):
        assert received.profile == Profile.RECONTACT
        return rows

    monkeypatch.setattr("geosan.rules.classify.calculate_items", calculated_recontact_items)
    display = display_texts(data, "CONTACT_URGENT", assessment, totals, "RECHECK", [])

    assert rows[-2].state == ItemState.NO_SIGNAL and rows[-2].score == 0
    assert display.score_display == "70점 · 6/7"


@pytest.mark.parametrize(
    "change,code,score,blocked",
    [
        ("none", "CONTACT_URGENT", "77점 · 7/8", False),
        ("none", "FILTER_PENDING", "77점 · 7/8", False),
        ("none", "OPS_PENDING", "77점 · 7/8", False),
        ("null", "NOT_EVALUATED", "--", False),
        ("half", "CONTACT_URGENT", "77점 · 7/8", False),
        ("unknown_stage", "CONTACT_URGENT", "77점 · 7/8", True),
        ("relation", "CONTACT_URGENT", "77점 · 7/8", True),
        ("none", "CONDITIONAL_WAIT", "77점 · 7/8", False),
        ("none", "WATCH", "77점 · 7/8", False),
        ("none", "LOW", "77점 · 7/8", False),
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
    assert "(승인 막힘)" not in display.blocker_text
    assert "(승인은 막지 않음)" not in display.blocker_text
    assert display.blocker_text == {
        "unknown_stage": "ISO 9001이 아직 확인 전",
        "relation": "거래 여부가 아직 확인 전",
    }.get(change, "없음 — 지금 단계 필수 요구 통과")
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
        assert output.display.score_display == "77점 · 7/8"
        assert "없음" in output.display.blocker_text
        assert len(output.question_candidates) == 1
        assert "Nadcap" in output.question_candidates[0].text


def test_card_reason_keeps_author_text_without_trimming_or_cutting():
    """Given 작성자 카드 문장, When 평가, Then 긴 문장·공백·추정 표시도 그대로 보존한다 (#139)."""
    data = rule_engine_input()
    original = evaluate(data)
    data.opportunity.card_reason = (
        "  알루미늄 부품을 만듭니다. " * 12 + "외주 수요는 확인 전(추정).  "
    )
    result = evaluate(data)
    assert result.display.reason == data.opportunity.card_reason
    assert result.totals == original.totals
    assert result.classification_code == original.classification_code
    assert result.sort_key == original.sort_key
    assert result.display.blocks_approval == original.display.blocks_approval


@pytest.mark.parametrize("with_question", [True, False])
def test_next_action_lists_unavailable_items_by_configured_weight(with_question):
    """Given 질문·미확보 항목, When 평가, Then 첫 질문과 미확보를 배점순으로 보인다 (#139)."""
    data = rule_engine_input()
    data.item_inputs = [
        replace_contract(item, state="UNAVAILABLE")
        if item.item_code in {"NEW_RECORD", "SIG_ORDER", "SIG_HIRE"}
        else item
        for item in reversed(data.item_inputs)
    ]
    data.research_readiness = ResearchReadinessInput(
        has_graded_evidence=False,
        has_question_set=with_question,
        has_channel_and_owner=False,
        question_can_change_class=False,
        question_set=["도금을 외주하는지 확인", "두 번째 질문은 카드에 넣지 않음"]
        if with_question
        else [],
    )
    prefix = "도금을 외주하는지 확인 · " if with_question else ""
    assert evaluate(data).display.next_action == prefix + "자료 미확보: 납품실적·수주·채용"
    data.rule_config.new_profile_items[2].weight, data.rule_config.new_profile_items[5].weight = (
        data.rule_config.new_profile_items[5].weight,
        data.rule_config.new_profile_items[2].weight,
    )
    assert evaluate(data).display.next_action == prefix + "자료 미확보: 수주·납품실적·채용"


@pytest.mark.parametrize("with_question", [True, False])
def test_next_action_without_unavailable_items_uses_question_or_class_action(with_question):
    """Given 미확보 없음, When 평가, Then 첫 질문만 쓰거나 기존 분류 문장을 유지한다 (#139)."""
    data = rule_engine_input()
    data.item_inputs[-1] = replace_contract(data.item_inputs[-1], state="NO_SIGNAL")
    if with_question:
        data.research_readiness = ResearchReadinessInput(
            has_graded_evidence=False,
            has_question_set=True,
            has_channel_and_owner=False,
            question_can_change_class=False,
            question_set=["합의한 기한 안에 대응할 수 있는지 확인"],
        )
    assert evaluate(data).display.next_action == (
        "합의한 기한 안에 대응할 수 있는지 확인"
        if with_question
        else "유효 기한 안에 연락 준비와 담당자 검토를 진행하세요"
    )


def test_next_action_includes_missing_and_effectively_unavailable_inputs():
    """Given 입력 누락·날짜 미상 신호, When 평가, Then 실제 미확보를 빠뜨리지 않는다 (#139)."""
    data = rule_engine_input()
    data.item_inputs = [item for item in data.item_inputs if item.item_code != "NEW_PERF"]
    for signal in data.signals:
        if signal.signal_kind == "EXPANSION":
            signal.occurred_at = None
    assert evaluate(data).display.next_action == "자료 미확보: 목적·증설·채용"


def test_blocker_names_relation_linked_processes_and_pending_requirements_in_order():
    """Given 소개서·거래 미확인·필수 요구, When 평가, Then 실제 이름을 순서대로 보인다 (#160)."""
    data = rule_engine_input()
    data.dataset_kind = DatasetKind.BROCHURE
    data.opportunity.relation_status = RelationStatus.UNCONFIRMED
    for process in data.capability.processes:
        process.dataset_kind = DatasetKind.BROCHURE
        process.name = "관련 없는 공정"
    process = next(p for p in data.capability.processes if p.code == "ANODIZING")
    process.name = "아노다이징(양극산화피막)"
    data.process_links.append(data.process_links[0].model_copy(update={"link_id": "duplicate"}))
    data.requirements[0].needed_stage = NeededStage.UNKNOWN
    before = data.model_dump()
    result = evaluate(data)
    assert result.display.blocker_text == (
        "거래 여부와 거산의 아노다이징(양극산화피막) 공정과 ISO 9001이 아직 확인 전"
    )
    assert result.display.blocks_approval is True
    assert data.model_dump() == before
    assert evaluate(data) == result


@pytest.mark.parametrize("kind", ["process", "capability", "record", "unused"])
def test_blocker_only_names_the_process_of_pending_values_actually_used(kind):
    """Given 검수 대기 값, When 평가, Then 사용한 공정·세부역량·실적만 공정 이름으로 알린다."""
    data = rule_engine_input()
    process = next(p for p in data.capability.processes if p.code == "ANODIZING")
    process.name = "파일의 공정 이름 — 가상"
    target = {
        "process": process,
        "capability": next(c for c in data.capability.capabilities if c.name == "처리 소재"),
        "record": data.capability.delivery_records[0],
        "unused": data.capability.capabilities[0],
    }[kind]
    target.review_status = ReviewStatus.PENDING
    data.operational_ready = kind == "unused"
    result = evaluate(data)
    assert result.display.blocker_text == (
        "없음 — 지금 단계 필수 요구 통과"
        if kind == "unused"
        else "거산의 파일의 공정 이름 — 가상 공정이 아직 확인 전"
    )
    assert result.display.blocks_approval is (kind != "unused")


def test_blocker_lists_multiple_used_processes_once_and_in_link_order():
    """Given 공정 연결 둘과 중복 사용 근거, When 평가, Then 관련 공정만 한 번씩 보인다."""
    data = rule_engine_input()
    data.dataset_kind = "BROCHURE"
    data.requirements = []
    for process in data.capability.processes:
        process.dataset_kind = "BROCHURE"
        process.name = f"가상 {process.code}"
    zinc = data.capability.processes[0]
    zinc.name = "아연도금(전기아연도금)"
    anodizing = data.capability.processes[1]
    anodizing.name = "아노다이징(양극산화피막)"
    data.process_links.append(
        replace_contract(
            data.process_links[0],
            link_id="zinc",
            process_id=zinc.process_id,
            process_code=zinc.code,
            applied_material="FE",
        )
    )
    result = evaluate(data)
    assert result.display.blocker_text == (
        "거산의 아노다이징(양극산화피막) 공정과 거산의 아연도금(전기아연도금) 공정이 아직 확인 전"
    )


@pytest.mark.parametrize("name", [None, "", "   "])
def test_blocker_keeps_existing_explanation_when_legacy_process_name_is_missing(name):
    """Given 이름 없는 기존 입력, When 평가, Then 이름을 지어내지 않고 기존 안내를 보존한다."""
    data = rule_engine_input()
    data.dataset_kind = "BROCHURE"
    data.requirements = []
    for process in data.capability.processes:
        process.dataset_kind = "BROCHURE"
        process.name = name
    result = evaluate(data)
    assert result.display.blocker_text == "거산 역량 확인 필요; 거산 확인 전"
    assert result.display.blocks_approval is True


@pytest.mark.parametrize("excluded_by", ["company", "requirement", "material"])
def test_blocker_preserves_excluded_explanation_without_approval_suffix(excluded_by):
    """Given 제외된 기회, When 평가, Then 기존 제외 안내를 유지하고 통과라고 하지 않는다."""
    data = rule_engine_input()
    if excluded_by == "company":
        data.opportunity.company_filter_status = "EXCLUDED"
    elif excluded_by == "requirement":
        data.capability.qualifications[0].current_status = QualificationStatusCode.CANCELLED
    else:
        data.process_links[0].applied_material = "SUS"
    result = evaluate(data)
    assert result.classification_code == "FILTER_EXCLUDED"
    assert result.display.blocker_text == "대상 아님(제외)"
    assert result.display.blocks_approval is True


def test_blocker_ignores_preferred_and_later_requirements():
    """Given 우대 미확인·나중 단계 요구, When 평가, Then 필수 미확인으로 표시하지 않는다."""
    data = rule_engine_input()
    data.requirements[0].name = "등록되지 않은 우대 인증"
    data.requirements[0].req_level = "PREFERRED"
    result = evaluate(data)
    assert result.display.blocker_text == "없음 — 지금 단계 필수 요구 통과"
    assert result.display.blocks_approval is False
