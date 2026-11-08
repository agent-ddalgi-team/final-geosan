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
from geosan.opportunity import candidate_pick
from geosan.opportunity.candidate_registration import register_candidates
from geosan.opportunity.importer import import_case
from geosan.opportunity.models import Customer, IngestBatch, Opportunity
from geosan.opportunity.source_models import SourceContract
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
            "aiPick": {"enabled": True, "rowsPerCall": 100},
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


def test_research_failure_keeps_registration_and_completed_research_count(ingest_env, monkeypatch):
    _brochure_runtime()
    calls = []

    def research(opp_id):
        calls.append(opp_id)
        if len(calls) == 2:
            return ResearchResult(error=AppError("가상 오류", "가상 확인"))
        return ResearchResult(status="NOT_FOUND")

    monkeypatch.setattr(flow, "research_one", research)
    batch_id = new_batch(["ZINC_PLATING", "ANODIZING"], dataset="BROCHURE")
    with pytest.raises(AppError):
        flow.run_ingest(batch_id)
    batch = saved(batch_id)
    assert batch.status == "FAILED" and batch.new_count == 2 and batch.research_done_count == 1
