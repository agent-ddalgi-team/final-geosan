"""#427: 외부 응답만 대체하고 실제 파일·판단·등록·부분 재평가를 연결한다."""

from datetime import date
from pathlib import Path
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import func, select

from geosan.api.app import create_app
from geosan.capability.importer import import_capability
from geosan.config.app_settings import load_app_settings, sync_app_settings
from geosan.config.errors import AppError
from geosan.config.models import AppSetting
from geosan.evaluation.models import EvaluationRun
from geosan.opportunity import candidate_pick
from geosan.opportunity.candidate_registration import register_candidates
from geosan.opportunity.importer import import_case
from geosan.opportunity.models import Customer, IngestBatch, Opportunity
from geosan.opportunity.source_models import SourceContract, SourceFactoryRow
from geosan.storage.base import new_id, utcnow
from geosan.storage.session import session_scope
from geosan.workflows import flow_ingest as flow
from geosan.workflows.models import FlowResult
from geosan.workflows.research import ResearchResult
from tests import factories
from tests.fakes.ingest_responses import FakeCandidateResponses
from tests.unit.u1.test_snapshot_ledger import _write


def new_batch(process="ZINC_PLATING", maximum=10, rejudge=False, dataset="VIRTUAL_REVIEWED"):
    with session_scope() as session:
        batch_id = new_id("batch")
        session.add(
            IngestBatch(
                batch_id=batch_id,
                source_id="kicox-factory-csv",
                requested_by="SYSTEM",
                started_at=utcnow(),
                status="RUNNING",
                max_candidates=maximum,
                rejudge=rejudge,
                criteria={
                    "processCodes": [process] if isinstance(process, str) else process,
                    "regions": ["충남"],
                    "industries": [],
                },
                dataset_kind=dataset,
                is_virtual=dataset == "VIRTUAL_REVIEWED",
            )
        )
    return batch_id


def saved(batch_id):
    with session_scope() as session:
        return session.get(IngestBatch, batch_id)


@pytest.fixture
def ingest_env(tmp_db, tmp_path, factory_file, monkeypatch):
    import_capability(_write(tmp_path, "cap.json", factories.capability_file()))
    with session_scope() as session:
        session.add(
            SourceContract(
                source_id="kicox-factory-csv",
                source_name="가상 파일",
                allowed_use="검사",
                allowed_storage="검사",
                confirmed_at=date(2026, 1, 1),
                is_virtual=True,
            )
        )
    path = factory_file(
        [
            [1, "가상 볼트사", "가상단지", "가상 볼트", "충청남도 당진시 가상길 1"],
            [2, "가상 패널사", "", "가상 패널", "충청남도 당진시 가상길 2"],
            [3, "가상 사무사", "가상단지", "가상 사무 서비스", "충청남도 당진시 가상길 3"],
        ]
    )

    dated_path = path.with_name("factories_20251231.csv")
    dated_path.write_bytes(path.read_bytes())
    path = dated_path
    with session_scope() as session:
        settings = session.get(AppSetting, "ingestion")
        settings.value = settings.value | {
            "factoryCsvPath": str(path),
            "aiPick": {"enabled": True, "rowsPerCall": 100, "excludeKeywords": []},
        }
        llm = session.get(AppSetting, "llm")
        llm.value = load_app_settings(Path("examples/app-settings.yaml")).llm.model_dump(
            by_alias=True, mode="json"
        ) | {"mode": "EXTERNAL"}
    picker = FakeCandidateResponses()
    monkeypatch.setenv("OPENAI_API_KEY", "synthetic")
    monkeypatch.setattr(candidate_pick, "_post", picker)
    return SimpleNamespace(picker=picker, path=path)


def test_run_records_counts_registers_only_selected_and_preserves_score_before_state(ingest_env):
    """Given 공장 3행 / When 아연도금 찾기 / Then 제조업 1곳만 등록하고 점수는 만들지 않는다."""
    batch_id = new_batch()
    assert flow.run_ingest(batch_id) is None
    batch = saved(batch_id)
    assert batch.status == "DONE" and batch.finished_at and batch.failure_reason is None
    assert (batch.scanned_count, batch.judged_count, batch.picked_count) == (3, 3, 1)
    assert (batch.new_count, batch.skipped_count, batch.merge_candidate_count) == (1, 0, 0)
    assert batch.judge_pending_count == 0
    assert ingest_env.picker.calls == 1
    with session_scope() as session:
        assert session.scalar(select(func.count()).select_from(Customer)) == 1
        assert session.scalar(select(func.count()).select_from(Opportunity)) == 1


def test_changed_condition_reuses_judgments_without_another_ai_call(ingest_env):
    first = new_batch()
    flow.run_ingest(first)
    second = new_batch("ANODIZING")
    flow.run_ingest(second)
    assert ingest_env.picker.calls == 1
    assert saved(second).new_count == 1 and saved(second).status == "DONE"


def test_rejudge_repeats_judgment_but_skips_existing_company(ingest_env):
    first = new_batch()
    flow.run_ingest(first)
    second = new_batch(rejudge=True)
    flow.run_ingest(second)
    assert ingest_env.picker.calls == 2
    assert saved(second).new_count == 0 and saved(second).skipped_count == 1


@pytest.mark.parametrize("fault", ["path", "disabled", "key"])
def test_missing_execution_settings_fail_before_external_call(ingest_env, monkeypatch, fault):
    with session_scope() as session:
        row = session.get(AppSetting, "ingestion")
        if fault == "path":
            row.value = row.value | {"factoryCsvPath": ""}
        elif fault == "disabled":
            row.value = row.value | {"aiPick": {"enabled": False}}
    if fault == "key":
        monkeypatch.delenv("OPENAI_API_KEY")
    batch_id = new_batch()
    with pytest.raises(AppError):
        flow.run_ingest(batch_id)
    assert saved(batch_id).status == "FAILED" and saved(batch_id).new_count == 0
    assert ingest_env.picker.calls == 0


def test_enabled_complex_lookup_uses_real_cache_and_registration(ingest_env, monkeypatch):
    from geosan.opportunity import complex_source
    from geosan.opportunity.source_models import ComplexFetch
    from tests.unit.u3.test_complex_source import configure, responses, xml

    configure(enabled=True)
    monkeypatch.setenv("DATA_GO_KR_SERVICE_KEY", "synthetic")
    with session_scope() as session:
        session.add(
            SourceContract(
                source_id=complex_source.SOURCE_ID,
                source_name="가상 조회",
                allowed_use="검사",
                allowed_storage="검사",
                confirmed_at=date(2026, 1, 1),
                is_virtual=True,
            )
        )
    calls = responses(monkeypatch, xml([("가상 추가사", "충남 아산시 가상로 9", "EXTRA")]))
    first = new_batch()
    flow.run_ingest(first)
    batch = saved(first)
    assert (batch.scanned_count, batch.judged_count, batch.new_count) == (4, 4, 2)
    assert batch.complex_list_skipped_reason is None
    monkeypatch.delenv("DATA_GO_KR_SERVICE_KEY")
    monkeypatch.delenv("OPENAI_API_KEY")
    second = new_batch()
    flow.run_ingest(second)
    assert saved(second).new_count == 0 and saved(second).skipped_count == 2
    assert len(calls) == ingest_env.picker.calls == 1
    with session_scope() as session:
        assert session.scalar(select(func.count()).select_from(ComplexFetch)) == 1


def test_public_source_failure_stops_judgment_registration_and_records_safe_failure(
    ingest_env, monkeypatch
):
    def failed(batch_id):
        raise RuntimeError("비밀 경로와 원문은 오류에 그대로 나오면 안 됨")

    monkeypatch.setattr(flow, "load_source_rows", failed)
    batch_id = new_batch()
    with pytest.raises(AppError):
        flow.run_ingest(batch_id)
    batch = saved(batch_id)
    assert batch.status == "FAILED" and batch.finished_at
    assert "공공자료 읽기" in batch.failure_reason and "비밀 경로" not in batch.failure_reason
    assert ingest_env.picker.calls == 0
    with session_scope() as session:
        assert session.scalar(select(func.count()).select_from(Customer)) == 0


def test_missing_judgment_fails_before_registration(ingest_env, monkeypatch):
    monkeypatch.setattr(flow, "pick_candidates", lambda batch_id, row_ids: [])
    batch_id = new_batch()
    with pytest.raises(AppError):
        flow.run_ingest(batch_id)
    assert saved(batch_id).status == "FAILED"
    assert saved(batch_id).judge_pending_count == 3
    with session_scope() as session:
        assert session.scalar(select(func.count()).select_from(Customer)) == 0


def test_registration_failure_rolls_back_company_and_counts_together(ingest_env, monkeypatch):
    def failed(session, batch_id, judgments):
        register_candidates(session, batch_id, judgments)
        session.flush()
        raise RuntimeError("등록 확정 전 실패")

    monkeypatch.setattr(flow, "register_candidates", failed)
    batch_id = new_batch()
    with pytest.raises(AppError):
        flow.run_ingest(batch_id)
    batch = saved(batch_id)
    assert batch.status == "FAILED" and batch.new_count == 0
    with session_scope() as session:
        assert session.scalar(select(func.count()).select_from(Customer)) == 0
        assert session.scalar(select(func.count()).select_from(Opportunity)) == 0


def test_evaluation_failure_keeps_committed_registration_counts(ingest_env, monkeypatch):
    monkeypatch.setattr(flow, "run_evaluation", lambda **kwargs: FlowResult(ok=False))
    batch_id = new_batch()
    with pytest.raises(AppError):
        flow.run_ingest(batch_id)
    assert saved(batch_id).status == "FAILED" and saved(batch_id).new_count == 1
    with session_scope() as session:
        assert session.scalar(select(func.count()).select_from(Customer)) == 1


def test_completed_batch_cannot_be_started_twice(ingest_env):
    batch_id = new_batch()
    flow.run_ingest(batch_id)
    with pytest.raises(AppError):
        flow.run_ingest(batch_id)
    assert saved(batch_id).status == "DONE" and ingest_env.picker.calls == 1


def test_missing_source_approval_fails_before_reading(ingest_env):
    with session_scope() as session:
        session.get(SourceContract, "kicox-factory-csv").confirmed_at = None
    batch_id = new_batch()
    with pytest.raises(AppError):
        flow.run_ingest(batch_id)
    assert saved(batch_id).status == "FAILED" and ingest_env.picker.calls == 0


@pytest.mark.parametrize("value", [None, "", "missing-batch"])
def test_unknown_batch_does_not_create_a_successful_record(tmp_db, value):
    with pytest.raises(AppError):
        flow.run_ingest(value)
    with session_scope() as session:
        assert session.scalar(select(func.count()).select_from(IngestBatch)) == 0


def test_original_eighteen_cards_keep_score_evaluation_and_rank(ingest_env, tmp_path):
    """Given 기존 18곳 / When 새 후보 등록·부분 평가 / Then 기존 카드·순위가 그대로다."""
    for index in range(18):
        case = factories.apjeong_renamed_customer(str(index), name=f"가상 기존 회사 {index}")
        case["customer"]["address"] = f"충남 천안시 가상 기존길 {index}"
        import_case(_write(tmp_path, f"case-{index}.json", case))
    with session_scope() as session:
        assert session.scalar(select(func.count()).select_from(Customer)) == 18
    assert flow.run_evaluation().ok
    with TestClient(create_app()) as client:
        before = client.get("/api/v1/opportunities").json()["data"]
        assert len(before) == 18
        batch_id = new_batch()
        flow.run_ingest(batch_id)
        after = client.get("/api/v1/opportunities").json()["data"]
    by_id = {row["oppId"]: row for row in after}
    assert all(by_id[row["oppId"]] == row for row in before)
    assert len(after) == 19 and after[-1]["scoreState"] == "NONE"
    assert after[-1]["ingestBatchId"] == batch_id


def test_maximum_is_applied_after_selection_using_source_order(ingest_env, monkeypatch):
    picker = flow.pick_candidates
    monkeypatch.setattr(
        flow, "pick_candidates", lambda batch_id, rows: list(reversed(picker(batch_id, rows)))
    )
    batch_id = new_batch(["ZINC_PLATING", "ANODIZING"], maximum=1)
    flow.run_ingest(batch_id)
    assert saved(batch_id).picked_count == saved(batch_id).new_count == 1
    with session_scope() as session:
        assert session.scalar(select(Customer.name)) == "가상 볼트사"


def test_empty_source_completes_without_an_ai_call(ingest_env, monkeypatch):
    monkeypatch.setattr(flow, "load_source_rows", lambda batch_id: flow.SourceRows((), 0))
    batch_id = new_batch()
    flow.run_ingest(batch_id)
    assert saved(batch_id).status == "DONE" and saved(batch_id).new_count == 0
    assert ingest_env.picker.calls == 0


@pytest.mark.parametrize("rows", [flow.SourceRows(("missing",), 1), flow.SourceRows((), -1)])
def test_invalid_source_result_fails_before_judgment(ingest_env, monkeypatch, rows):
    monkeypatch.setattr(flow, "load_source_rows", lambda batch_id: rows)
    batch_id = new_batch()
    with pytest.raises(AppError):
        flow.run_ingest(batch_id)
    assert saved(batch_id).status == "FAILED" and ingest_env.picker.calls == 0


def test_complex_partial_reason_is_preserved_in_batch(ingest_env, monkeypatch):
    loader = flow.load_source_rows

    def partial(batch_id):
        result = loader(batch_id)
        return flow.SourceRows(result.row_ids, result.scanned_count, "DAILY_LIMIT")

    monkeypatch.setattr(flow, "load_source_rows", partial)
    batch_id = new_batch()
    flow.run_ingest(batch_id)
    assert saved(batch_id).status == "DONE"
    assert saved(batch_id).complex_list_skipped_reason == "DAILY_LIMIT"


def test_registration_invalid_count_rolls_back_written_company(ingest_env, monkeypatch):
    def invalid(session, batch_id, judgments):
        register_candidates(session, batch_id, judgments)
        return SimpleNamespace(new_count=-1, skipped_count=0, merge_candidate_count=0)

    monkeypatch.setattr(flow, "register_candidates", invalid)
    batch_id = new_batch()
    with pytest.raises(AppError):
        flow.run_ingest(batch_id)
    assert saved(batch_id).status == "FAILED" and saved(batch_id).new_count == 0
    with session_scope() as session:
        assert session.scalar(select(func.count()).select_from(Customer)) == 0


def _brochure_runtime():
    import_capability(Path("examples/capability-geosan-brochure.json"))
    with session_scope() as session:
        ingestion = session.get(AppSetting, "ingestion").value
        settings = load_app_settings(Path("examples/app-settings.yaml"))
        settings.ingestion.factory_csv_path = ingestion["factoryCsvPath"]
        settings.ingestion.ai_pick.enabled = True
        settings.llm.mode = "EXTERNAL"
        sync_app_settings(session, settings)


def test_only_new_public_companies_are_researched_after_registration_done(ingest_env, monkeypatch):
    _brochure_runtime()
    researched = []
    batch_id = new_batch(dataset="BROCHURE")

    def research(opp_id):
        assert saved(batch_id).status == "DONE" and saved(batch_id).new_count == 1
        researched.append(opp_id)
        return ResearchResult(status="NOT_FOUND")

    monkeypatch.setattr(flow, "research_one", research)
    flow.run_ingest(batch_id)
    assert len(researched) == saved(batch_id).research_done_count == 1
    next_batch = new_batch(dataset="BROCHURE")
    flow.run_ingest(next_batch)
    assert len(researched) == 1 and saved(next_batch).skipped_count == 1


def test_research_error_skips_that_company_and_continues(ingest_env, monkeypatch):
    _brochure_runtime()
    calls = []

    def research(opp_id):
        calls.append(opp_id)
        if len(calls) == 1:
            return ResearchResult(error=AppError("가상 오류", "가상 확인"))
        return ResearchResult(status="NOT_FOUND")

    monkeypatch.setattr(flow, "research_one", research)
    batch_id = new_batch(["ZINC_PLATING", "ANODIZING"], dataset="BROCHURE")
    flow.run_ingest(batch_id)
    batch = saved(batch_id)
    assert len(calls) == 2  # 약속 C1: 실패는 그 회사만 남기고 다음으로(#528)
    assert batch.status == "DONE" and batch.new_count == 2 and batch.research_done_count == 2


@pytest.mark.parametrize("stop", ["LLM_LIMIT", "SEARCH_LIMIT", "LLM_NOT_CONFIGURED"])
def test_limits_and_configuration_still_stop_research(ingest_env, monkeypatch, stop):
    _brochure_runtime()
    calls = []

    def research(opp_id):
        calls.append(opp_id)
        return ResearchResult(error=AppError("가상 한도·설정 오류", "확인", kind=stop))

    monkeypatch.setattr(flow, "research_one", research)
    batch_id = new_batch(["ZINC_PLATING", "ANODIZING"], dataset="BROCHURE")
    with pytest.raises(AppError):
        flow.run_ingest(batch_id)
    assert len(calls) == 1 and saved(batch_id).status == "FAILED"
    assert saved(batch_id).new_count == 2


def test_unknown_usage_skips_failed_company_and_researches_next(ingest_env, monkeypatch):
    _brochure_runtime()
    calls = []

    def research(opp_id):
        calls.append(opp_id)
        if len(calls) == 1:
            return ResearchResult(
                usage_unconfirmed=True,
                error=AppError("응답을 받지 못했습니다", "다시 조사", kind="LLM_FAILED"),
            )
        return ResearchResult(status="NOT_FOUND")

    monkeypatch.setattr(flow, "research_one", research)
    batch_id = new_batch(["ZINC_PLATING", "ANODIZING"], dataset="BROCHURE")
    flow.run_ingest(batch_id)
    batch = saved(batch_id)
    assert len(calls) == 2
    assert batch.status == "DONE" and batch.new_count == 2 and batch.research_done_count == 2


def _with_first_row_low(monkeypatch):
    original = flow.pick_candidates

    def pick(batch_id, row_ids, **kwargs):
        rows = original(batch_id, row_ids, **kwargs)
        return [rows[0].model_copy(update={"fit_level": "LOW"}), *rows[1:]]

    monkeypatch.setattr(flow, "pick_candidates", pick)


def _registered_names():
    with session_scope() as session:
        return sorted(session.scalars(select(Customer.name)).all())


def test_higher_fit_is_registered_first_within_the_limit(ingest_env, monkeypatch):
    """#528 Given 앞 행 하·뒤 행 상 / When 최대 1곳 / Then 파일 순서가 아니라 상을 등록한다."""
    _with_first_row_low(monkeypatch)
    batch_id = new_batch(["ZINC_PLATING", "ANODIZING"], maximum=1)
    flow.run_ingest(batch_id)
    assert _registered_names() == ["가상 패널사"]


def test_next_run_registers_the_next_company(ingest_env):
    """#528 Given 조건에 맞는 2곳·최대 1곳 / When 두 번 / Then 다음 회사가 들어온다."""
    first = new_batch(["ZINC_PLATING", "ANODIZING"], maximum=1)
    flow.run_ingest(first)
    second = new_batch(["ZINC_PLATING", "ANODIZING"], maximum=1)
    flow.run_ingest(second)
    assert _registered_names() == ["가상 볼트사", "가상 패널사"]
    assert (saved(second).new_count, saved(second).skipped_count) == (1, 1)
    assert saved(second).picked_count == 2


def _choose_regions(batch_id, regions):
    with session_scope() as session:
        batch = session.get(IngestBatch, batch_id)
        batch.criteria = batch.criteria | {"regions": regions}


def _second_row_in(ingest_env, address):
    text = ingest_env.path.read_text(encoding="utf-8")
    ingest_env.path.write_text(text.replace("충청남도 당진시 가상길 2", address), encoding="utf-8")


def test_city_choice_judges_only_that_city_and_stores_province_rows(ingest_env):
    """#521 Given 당진시 2행·천안시 1행 / When 당진시만 / Then 2행만 판단, 저장은 충남 3행."""
    _second_row_in(ingest_env, "충청남도 천안시서북구 가상길 2")
    batch_id = new_batch()
    _choose_regions(batch_id, ["당진시"])
    flow.run_ingest(batch_id)
    batch = saved(batch_id)
    assert batch.status == "DONE" and batch.judged_count == 2
    with session_scope() as session:
        regions = session.scalars(select(SourceFactoryRow.region)).all()
    assert sorted(regions) == ["충남", "충남", "충남"]


def test_city_with_district_suffix_is_matched_and_province_choice_keeps_all(ingest_env):
    _second_row_in(ingest_env, "충청남도 천안시서북구 가상길 2")
    city = new_batch()
    _choose_regions(city, ["천안시"])
    flow.run_ingest(city)
    assert saved(city).judged_count == 1
    whole = new_batch()
    flow.run_ingest(whole)
    assert saved(whole).judged_count == 3


def test_city_without_rows_finishes_without_ai_call(ingest_env):
    batch_id = new_batch()
    _choose_regions(batch_id, ["서산시"])
    flow.run_ingest(batch_id)
    assert saved(batch_id).status == "DONE" and saved(batch_id).judged_count == 0
    assert ingest_env.picker.calls == 0


NEW_REASON = "가상 볼트 절삭가공으로 도금 외주 가능성"


def with_changed_judgment(monkeypatch, **changes):
    """#615: 다시 판단에서 문장·적합도(또는 넘긴 값)가 달라진 응답을 흉내 낸다."""
    original = flow.pick_candidates
    update = {"reason": NEW_REASON, "fit_level": "MEDIUM"} | changes

    def pick(batch_id, row_ids, **kwargs):
        return [
            row.model_copy(update=update) if row.is_manufacturer else row
            for row in original(batch_id, row_ids, **kwargs)
        ]

    monkeypatch.setattr(flow, "pick_candidates", pick)


def _card():
    with session_scope() as session:
        customer = session.scalars(select(Customer)).one()
        opportunity = session.scalars(select(Opportunity)).one()
        runs = session.scalars(
            select(EvaluationRun).where(EvaluationRun.opp_id == opportunity.opp_id)
        ).all()
        confirmed = [run.reason for run in runs if run.run_status == "CONFIRMED"]
        return SimpleNamespace(
            reason=customer.pick_reason,
            fit=customer.fit_level,
            card_reason=opportunity.card_reason,
            eval_reasons=confirmed,
            run_count=len(runs),
        )


def test_rejudge_refreshes_existing_card_and_reevaluates_without_research(ingest_env, monkeypatch):
    """#615 Given 등록된 회사 / When 판단이 달라짐 / Then 카드·평가 문장이 바뀌고 조사는 없다."""
    _brochure_runtime()
    researched = []
    monkeypatch.setattr(
        flow,
        "research_one",
        lambda opp_id: researched.append(opp_id) or ResearchResult(status="NOT_FOUND"),
    )
    flow.run_ingest(new_batch(dataset="BROCHURE"))
    before = _card()
    assert before.reason != NEW_REASON and before.fit == "HIGH" and len(researched) == 1
    with_changed_judgment(monkeypatch)
    second = new_batch(dataset="BROCHURE", rejudge=True)
    flow.run_ingest(second)
    after = _card()
    assert (after.reason, after.fit, after.card_reason) == (NEW_REASON, "MEDIUM", NEW_REASON)
    assert after.eval_reasons == [NEW_REASON] and after.run_count == before.run_count + 1
    assert len(researched) == 1
    assert (saved(second).new_count, saved(second).skipped_count) == (0, 1)


def test_unchanged_judgment_does_not_reevaluate_existing_company(ingest_env):
    """#615 Given 등록된 회사 / When 같은 판단으로 다시 찾음 / Then 평가 기록이 늘지 않는다."""
    flow.run_ingest(new_batch())
    before = _card()
    flow.run_ingest(new_batch())
    assert _card() == before


def test_company_outside_the_new_condition_is_still_refreshed(ingest_env, monkeypatch):
    """#615 Given 아연도금으로 등록 / When 다른 공정으로 찾고 판단이 달라짐 / Then 카드가 바뀐다."""
    flow.run_ingest(new_batch())
    with_changed_judgment(monkeypatch)
    second = new_batch("ANODIZING", rejudge=True)
    flow.run_ingest(second)
    with session_scope() as session:
        bolt = session.scalars(select(Customer).where(Customer.name == "가상 볼트사")).one()
        assert (bolt.pick_reason, bolt.fit_level) == (NEW_REASON, "MEDIUM")


def test_stale_evaluation_sentence_is_repaired_on_the_next_run(ingest_env, monkeypatch):
    """#615 Given 카드만 바뀌고 재평가가 실패 / When 다시 찾음 / Then 평가 문장도 맞춰진다."""
    flow.run_ingest(new_batch())
    with_changed_judgment(monkeypatch)
    with monkeypatch.context() as patch:
        patch.setattr(flow, "run_evaluation", lambda **_: FlowResult(ok=False))
        with pytest.raises(AppError):
            flow.run_ingest(new_batch(rejudge=True))
    assert _card().reason == NEW_REASON and _card().eval_reasons != [NEW_REASON]
    flow.run_ingest(new_batch())
    assert _card().eval_reasons == [NEW_REASON]
