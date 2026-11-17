"""S02·S04·S06의 투입 경계: 식별·이력·참조와 전체 저장 취소를 실제 DB로 확인한다."""

from __future__ import annotations

import json

import pytest
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError

from geosan.capability.importer import import_capability
from geosan.capability.models import Process
from geosan.config.errors import InputError, RunFailedError
from geosan.config.registry import load_runtime_config, set_active_dataset_kind
from geosan.evaluation.inputs import current_item_inputs, current_readiness_check
from geosan.evaluation.models import ItemJudgmentInput, ReadinessCheck
from geosan.evidence.models import Evidence
from geosan.evidence.queries import list_evidence
from geosan.opportunity.importer import check_case, import_case
from geosan.opportunity.models import (
    Customer,
    DiscoveryPath,
    Interaction,
    Opportunity,
    OppProcessLink,
    Requirement,
    Signal,
)
from geosan.opportunity.queries import (
    list_discovery_paths,
    list_linked_interactions,
    list_requirements,
)
from geosan.questions.models import ResearchTask
from geosan.questions.store import current_research
from geosan.storage.session import session_scope
from tests import factories


def _write(tmp_path, data):
    path = tmp_path / "input.json"
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    return path


@pytest.fixture
def case_env(tmp_db, tmp_path):
    import_capability(_write(tmp_path, factories.capability_file()))
    return tmp_path


def test_check_case_uses_no_database_and_reports_lines(tmp_path, monkeypatch):
    """Given DB가 없는 환경 / When 검사 / Then 연결하지 않고 줄·항목·이유를 알린다."""
    import geosan.opportunity.importer as importer

    def forbidden_database(*args, **kwargs):
        raise AssertionError("check_case는 DB를 열면 안 됩니다")

    monkeypatch.setattr(importer, "session_scope", forbidden_database)
    monkeypatch.setenv("GEOSAN_DB_PATH", str(tmp_path / "must-not-exist.db"))
    assert check_case(_write(tmp_path, factories.apjeong_case())).ok
    data = factories.apjeong_case()
    data["evidence"][0]["quote"] = "가상 연락처: sales@example.invalid"
    report = check_case(_write(tmp_path, data))
    assert not report.ok
    assert any(item.path == "evidence[0].quote" and item.line for item in report.errors)
    assert any("연락처" in line for line in report.error_lines())
    assert not (tmp_path / "must-not-exist.db").exists()


@pytest.mark.parametrize(
    ("match_rate", "expected_step"),
    [(1.0, None), (1, None), ("1.0", None), ("해당", "해당"), (" 해당 ", "해당")],
)
def test_match_rate_number_is_distinct_from_step_name(case_env, match_rate, expected_step):
    """Given 숫자 또는 단계명 / When 입력 저장 / Then 숫자를 단계 이름으로 만들지 않는다."""
    data = factories.apjeong_case()
    data["itemInputs"][0]["matchRate"] = match_rate
    result = import_case(_write(case_env, data))
    with session_scope() as session:
        product = next(
            row
            for row in current_item_inputs(session, result.opp_id)
            if row.item_code == "NEW_PRODUCT"
        )
        assert product.match_rate == 1.0
        assert product.match_rate_step == expected_step


def test_customer_identity_case_identity_and_unlinked_history(case_env):
    first = import_case(_write(case_env, factories.apjeong_case()))
    again = import_case(_write(case_env, factories.apjeong_with_extra_discovery_path()))
    second = import_case(_write(case_env, factories.apjeong_renamed_customer("second-project")))
    assert first.opp_id == again.opp_id != second.opp_id
    assert first.customer_id == second.customer_id
    with session_scope() as session:
        assert session.scalar(select(func.count()).select_from(Customer)) == 1
        assert session.scalar(select(func.count()).select_from(Opportunity)) == 2
        assert len(list_discovery_paths(session, first.opp_id)) == 2
        assert not list_linked_interactions(session, first.opp_id)
        assert session.scalar(select(func.count()).select_from(Interaction)) == 1
        assert len(list_requirements(session, first.opp_id)) == 3


def test_reimport_supersedes_children_and_keeps_old_references(case_env):
    path = _write(case_env, factories.apjeong_case())
    first = import_case(path)
    with session_scope() as session:
        old_evidence = {row.evidence_id for row in list_evidence(session, first.opp_id)}
        old_inputs = {row.item_input_id for row in current_item_inputs(session, first.opp_id)}
        old_requirements = {row.req_id for row in list_requirements(session, first.opp_id)}
    import_case(path)
    with session_scope() as session:
        current = current_item_inputs(session, first.opp_id)
        assert len(current) == 8 and {row.version for row in current} == {2}
        for model, ids, id_column in (
            (Evidence, old_evidence, Evidence.evidence_id),
            (ItemJudgmentInput, old_inputs, ItemJudgmentInput.item_input_id),
            (Requirement, old_requirements, Requirement.req_id),
        ):
            rows = list(session.scalars(select(model).where(id_column.in_(ids))))
            assert len(rows) == len(ids) and all(row.superseded_at for row in rows)
        assert not old_evidence.intersection(
            row.evidence_id for row in list_evidence(session, first.opp_id)
        )


def test_missing_items_are_filled_and_array_references_become_ids(case_env):
    data = factories.apjeong_case()
    selected = data["itemInputs"][0]
    data["itemInputs"] = [selected]
    result = import_case(_write(case_env, data), requested_by="park-lee")
    with session_scope() as session:
        rows = current_item_inputs(session, result.opp_id)
        assert len(rows) == 8
        assert sum(row.state == "UNAVAILABLE" for row in rows) == 7
        product = next(row for row in rows if row.item_code == selected["itemCode"])
        assert product.match_rate == 1.0 and product.entered_by == "park-lee"
        assert product.evidence_ids
        for evidence_id in product.evidence_ids:
            assert session.get(Evidence, evidence_id).opp_id == result.opp_id
        assert all(
            not row.evidence_ids and row.match_rate is None
            for row in rows
            if row.state == "UNAVAILABLE"
        )
    # 시점 항목은 같은 파일의 신호 ID를 가리킨다.
    result = import_case(_write(case_env, factories.apjeong_case()))
    with session_scope() as session:
        from geosan.opportunity.models import Signal

        bid = next(
            row for row in current_item_inputs(session, result.opp_id) if row.item_code == "SIG_BID"
        )
        assert bid.signal_ids and session.get(Signal, bid.signal_ids[0]).opp_id == result.opp_id


def test_invalid_contact_duplicate_requirement_and_signal_rate_save_nothing(case_env):
    invalid_contact = factories.apjeong_case()
    invalid_contact["evidence"][0]["quote"] = "가상 연락처: sales@example.invalid"
    duplicate = factories.apjeong_case()
    duplicate["requirements"].append(duplicate["requirements"][0].copy())
    bad_signal = factories.apjeong_case()
    next(item for item in bad_signal["itemInputs"] if item["itemCode"] == "SIG_BID")[
        "matchRate"
    ] = 0.5
    for data, expected_path in (
        (invalid_contact, "evidence"),
        (duplicate, "requirements"),
        (bad_signal, "itemInputs"),
    ):
        with pytest.raises(InputError) as error:
            import_case(_write(case_env, data))
        assert any(expected_path in field.path for field in error.value.fields)
        with session_scope() as session:
            assert session.scalar(select(func.count()).select_from(Opportunity)) == 0
            assert session.scalar(select(func.count()).select_from(Customer)) == 0


def test_unknown_process_is_rejected_and_inactive_dataset_only_warns(case_env):
    with session_scope() as session:
        load_runtime_config(session)
        set_active_dataset_kind(session, "BROCHURE")
    result = import_case(_write(case_env, factories.apjeong_case()))
    assert any("활성 묶음에 없는 공정" in warning for warning in result.warnings)
    # 다른 묶음에도 없는 참조는 저장을 거부한다.
    with session_scope() as session:
        process = session.scalar(select(Process).where(Process.code == "PHOSPHATE_COATING"))
        session.delete(process)
    data = factories.apjeong_with_process_link("PHOSPHATE_COATING", "FE")
    with pytest.raises(InputError) as error:
        import_case(_write(case_env, data))
    assert any(field.line and "processCode" in field.path for field in error.value.fields)
    with session_scope() as session:
        assert len(list_requirements(session, result.opp_id)) == 3


def test_research_readiness_and_forbidden_evidence_are_handled(case_env):
    data = factories.apjeong_case()
    data["researchReadiness"] = dict(
        questionSet=["공정 적용 범위 확인"],
        allowedChannel="공개 자료",
        owner="park-lee",
        canChangeClass=True,
        estimatedHours=1.0,
    )
    result = import_case(_write(case_env, data))
    with session_scope() as session:
        research = current_research(session, result.opp_id)
        check = current_readiness_check(session, result.opp_id)
        assert research.question_set == ["공정 적용 범위 확인"]
        assert check.checked and check.eval_id_at_check is None
        assert check.checked_at.utcoffset() is not None
        evidence = list_evidence(session, result.opp_id)[0]
        evidence.security_grade = "FORBIDDEN"
    with session_scope() as session:
        assert len(list_evidence(session, result.opp_id)) == result.evidence_count - 1
    data["evidence"][0]["securityGrade"] = "FORBIDDEN"
    with pytest.raises(InputError):
        import_case(_write(case_env, data))
    with session_scope() as session:
        assert session.scalar(select(func.count()).select_from(ResearchTask)) == 1


def test_late_storage_failure_rolls_back_all_case_parts(case_env, monkeypatch):
    import geosan.opportunity.importer as importer

    def fail_research(*args, **kwargs):
        raise IntegrityError("test", {}, Exception("가상 저장 실패"))

    monkeypatch.setattr(importer, "store_research", fail_research)
    with pytest.raises(RunFailedError):
        import_case(_write(case_env, factories.apjeong_case()))
    with session_scope() as session:
        for model in (Customer, Opportunity, Requirement, Evidence, ItemJudgmentInput):
            assert session.scalar(select(func.count()).select_from(model)) == 0
        assert session.scalar(select(func.count()).select_from(Process)) == 9


@pytest.mark.parametrize("failed_step", ["store_inputs", "store_research"])
def test_failed_reimport_preserves_existing_values_and_history(case_env, monkeypatch, failed_step):
    """Given 재투입 이력이 있는 사례 / When 재투입 중 저장 실패 / Then 기존 값·이력을 보존한다."""
    import geosan.opportunity.importer as importer

    data = factories.apjeong_case()
    data["researchReadiness"] = dict(
        questionSet=["가상 공정 범위 확인"],
        allowedChannel="공개 자료",
        owner="park-lee",
        canChangeClass=True,
        estimatedHours=1.0,
    )
    original = import_case(_write(case_env, data))
    import_case(_write(case_env, data))
    models = (
        Customer,
        Opportunity,
        DiscoveryPath,
        OppProcessLink,
        Requirement,
        Signal,
        Interaction,
        Evidence,
        ItemJudgmentInput,
        ReadinessCheck,
        ResearchTask,
    )

    def stored_rows():
        with session_scope() as session:
            return {
                model: session.execute(
                    select(model.__table__).order_by(*model.__table__.primary_key)
                ).all()
                for model in models
            }

    before = stored_rows()
    data["customer"]["relationStatus"] = "UNCONFIRMED"
    data["customer"]["relationConfirmedAt"] = None
    data["opportunity"]["project"] = "실패하면 남으면 안 되는 가상 프로젝트"
    data["evidence"][0]["quote"] = "실패하면 남으면 안 되는 가상 근거"
    data["researchReadiness"]["questionSet"] = ["실패하면 남으면 안 되는 가상 질문"]
    real_store = getattr(importer, failed_step)
    calls = []

    def fail_after_store(session, *args, **kwargs):
        real_store(session, *args, **kwargs)
        session.flush()
        calls.append(failed_step)
        raise IntegrityError("test", {}, Exception("가상 재투입 저장 실패"))

    with monkeypatch.context() as patch:
        patch.setattr(importer, failed_step, fail_after_store)
        with pytest.raises(RunFailedError):
            import_case(_write(case_env, data))

    assert calls == [failed_step]  # 저장 실패를 자동 재시도하지 않는다(ADR-009).
    assert stored_rows() == before
    recovered = import_case(_write(case_env, data))
    assert recovered.opp_id == original.opp_id
    with session_scope() as session:
        assert {row.version for row in current_item_inputs(session, original.opp_id)} == {3}
