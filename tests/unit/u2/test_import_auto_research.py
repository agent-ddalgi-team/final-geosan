"""사례 투입 후 자동 조사. 외부 응답만 대체하고 저장·평가는 실제 DB로 확인한다."""

import json
from unittest.mock import Mock

import pytest
from sqlalchemy import func, select
from typer.testing import CliRunner

from geosan.capability.importer import import_capability
from geosan.commands.app import app
from geosan.config.errors import AppError
from geosan.config.models import AppSetting
from geosan.evaluation.models import EvaluationRun
from geosan.evidence import openai_search
from geosan.evidence.models import Evidence
from geosan.opportunity.importer import import_case
from geosan.opportunity.models import Customer, Opportunity
from geosan.storage.session import session_scope
from geosan.workflows import flow_extract
from tests import factories
from tests.unit.u1.test_snapshot_ledger import _write
from tests.unit.u2 import test_extraction as extraction_support
from tests.unit.u2 import test_search_limits as search_support

search_env = search_support.search_env
extract_env = extraction_support.extract_env
runner = CliRunner()
CASE_ID = "auto-import"


@pytest.fixture
def import_env(extract_env, tmp_path):
    import_capability(_write(tmp_path, "cap.json", factories.brochure_capability_file()))
    with session_scope() as session:
        session.get(AppSetting, "activeDatasetKind").value = "BROCHURE"
    data = factories.brochure_case(CASE_ID)
    data["customer"]["bizNumber"] = None
    return data, extract_env[1]


def invoke_import(tmp_path, data):
    return runner.invoke(app, ["import-case", str(_write(tmp_path, "case.json", data))])


def imported_opportunity(session):
    return session.scalar(select(Opportunity).where(Opportunity.case_id == CASE_ID))


def test_import_commits_before_search_and_researches_only_imported_case(import_env, tmp_path):
    data, extraction = import_env

    def check_committed(*_):
        # 별도 연결에서 저장을 읽고 쓸 수 있어야 한다. 외부 요청 동안 투입 트랜잭션은 없다.
        with session_scope() as session:
            opp = imported_opportunity(session)
            assert opp is not None
            customer = session.get(Customer, opp.customer_id)
            assert customer.research_source == "CASE_FILE"
            customer.homepage_reason = "저장 완료 확인"
        return search_support.provider_reply()

    openai_search._post_response.side_effect = check_committed
    result = invoke_import(tmp_path, data)
    assert result.exit_code == 0, result.output
    assert "자동 조사 완료: 근거 저장·재평가" in result.output
    assert "찾음 · 근거 1건 · 확인된 비용 $0.018000" in result.output
    assert openai_search._post_response.call_count == extraction.call_count == 1
    with session_scope() as session:
        opp = imported_opportunity(session)
        assert session.get(Customer, opp.customer_id).research_source == "AI"
        runs = session.scalars(select(EvaluationRun)).all()
        assert runs and {run.opp_id for run in runs} == {opp.opp_id}
        assert session.scalar(
            select(Evidence).where(
                Evidence.opp_id == opp.opp_id, Evidence.is_llm_proposed.is_(True)
            )
        )
    assert [row.purpose for row in search_support.logs()] == ["EXTERNAL_SEARCH", "EXTERNAL_AI"]


@pytest.mark.parametrize(
    "excluded", ["off", "virtual", "private", "unknown", "follow_up", "dataset"]
)
def test_excluded_case_is_saved_without_external_calls(import_env, tmp_path, excluded):
    data, extraction = import_env
    if excluded == "off":
        search_support.change_setting("homepageDiscovery", autoResearch=False)
    elif excluded == "virtual":
        data["isVirtual"] = True
    elif excluded in {"private", "unknown"}:
        data["customer"]["securityGrade"] = "INTERNAL_ONLY" if excluded == "private" else "UNKNOWN"
    elif excluded == "follow_up":
        data["opportunity"]["purpose"] = "FOLLOW_UP_PROPOSAL"
    else:
        with session_scope() as session:
            session.get(AppSetting, "activeDatasetKind").value = "VIRTUAL_REVIEWED"
    result = invoke_import(tmp_path, data)
    assert result.exit_code == 0, result.output
    assert "사례 저장만 완료" in result.output
    assert openai_search._post_response.call_count == extraction.call_count == 0
    assert not search_support.logs()
    with session_scope() as session:
        assert imported_opportunity(session)
        assert not session.scalar(select(EvaluationRun))


def test_import_failure_does_not_start_research(import_env, tmp_path):
    data, extraction = import_env
    data["caseId"] = ""
    result = invoke_import(tmp_path, data)
    assert result.exit_code == 1, result.output
    assert "자동 조사" not in result.output
    assert openai_search._post_response.call_count == extraction.call_count == 0
    with session_scope() as session:
        assert imported_opportunity(session) is None


def test_plain_store_and_capability_command_do_not_auto_research(import_env, tmp_path):
    data, extraction = import_env
    import_case(_write(tmp_path, "case.json", data))
    path = _write(tmp_path, "cap.json", factories.brochure_capability_file())
    result = runner.invoke(app, ["import-capability", str(path)])
    assert result.exit_code == 0, result.output
    assert "자동 조사" not in result.output
    assert openai_search._post_response.call_count == extraction.call_count == 0


@pytest.mark.parametrize("failure", ["read", "extract", "evaluate", "unexpected", "settings"])
def test_research_failure_keeps_import_and_never_reports_save_failure(
    import_env, tmp_path, monkeypatch, failure
):
    import geosan.commands.import_case as command

    data, extraction = import_env
    if failure == "read":
        monkeypatch.setattr(
            flow_extract,
            "fetch",
            Mock(side_effect=AppError("본문 읽기 실패", "주소 확인", kind="UNREACHABLE")),
        )
    elif failure == "extract":
        extraction.side_effect = lambda *_: extraction_support.reply({"evidence": "잘못된 형식"})
    elif failure == "evaluate":
        monkeypatch.setattr(
            flow_extract, "evaluate_in_session", Mock(side_effect=RuntimeError("가상 오류"))
        )
    elif failure == "unexpected":
        monkeypatch.setattr(
            command, "research_one", Mock(side_effect=RuntimeError("숨겨야 하는 가상 오류"))
        )
    else:
        monkeypatch.setattr(
            command, "read_app_settings", Mock(side_effect=AppError("설정 읽기 실패", "설정 확인"))
        )
    result = invoke_import(tmp_path, data)
    assert result.exit_code == 2, result.output
    assert "사례는 저장했습니다" in result.output
    assert "자동 조사 완료" not in result.output
    assert "파일을 저장하지 못했습니다" not in result.output
    assert "숨겨야 하는" not in result.output
    assert "파일을 다시 넣지 않아도 됩니다" in result.output
    with session_scope() as session:
        opp = imported_opportunity(session)
        assert opp is not None
        assert session.get(Customer, opp.customer_id).research_source == "CASE_FILE"
        assert session.scalar(
            select(func.count()).select_from(Evidence).where(Evidence.opp_id == opp.opp_id)
        ) == len(data["evidence"])
        assert not session.scalar(select(EvaluationRun))


@pytest.mark.parametrize("block", ["daily", "monthly", "cost", "unknown", "key"])
def test_limits_and_unconfirmed_usage_apply_after_import(import_env, tmp_path, monkeypatch, block):
    data, extraction = import_env
    if block == "daily":
        search_support.change_setting("homepageDiscovery", dailyCallLimit=0)
    elif block == "monthly":
        search_support.change_setting("llm", monthlyCallLimit=1)
    elif block == "cost":
        search_support.change_setting("llm", monthlyCostLimitUsd=0.01)
    elif block == "key":
        monkeypatch.setenv("OPENAI_API_KEY", "")
    else:
        openai_search._post_response.side_effect = TimeoutError()
    result = invoke_import(tmp_path, data)
    assert result.exit_code == 2, result.output
    assert "사례는 저장했습니다" in result.output
    assert extraction.call_count == 0
    assert openai_search._post_response.call_count == (1 if block in {"monthly", "unknown"} else 0)
    with session_scope() as session:
        assert imported_opportunity(session)
        assert not session.scalar(select(EvaluationRun))
    if block == "unknown":
        assert "총비용 미확정" in result.output
        assert search_support.logs()[0].cost_usd is None


def test_not_found_preserves_import_without_extraction(import_env, tmp_path):
    data, extraction = import_env
    reply = search_support.provider_reply()
    reply["output"][-1]["content"][0]["text"] = json.dumps(
        {"url": None, "confidence": 0.0, "reason": "가상 검색에서 찾지 못함"}
    )
    openai_search._post_response.side_effect = lambda *_: reply
    result = invoke_import(tmp_path, data)
    assert result.exit_code == 0, result.output
    assert "못 찾음 · 근거 0건" in result.output
    assert "근거 추출·재평가를 건너뛰었습니다" in result.output
    assert extraction.call_count == 0
    with session_scope() as session:
        opp = imported_opportunity(session)
        assert session.get(Customer, opp.customer_id).homepage_status == "NOT_FOUND"
        assert not session.scalar(select(EvaluationRun))


def test_reimport_reuses_confirmed_url_and_preserves_history(import_env, tmp_path):
    data, extraction = import_env
    assert invoke_import(tmp_path, data).exit_code == 0
    with session_scope() as session:
        opp = imported_opportunity(session)
        customer = session.get(Customer, opp.customer_id)
        customer.homepage_url = extraction_support.URL
        customer.homepage_status = "CONFIRMED"
        customer.homepage_source = "STAFF"
        first_runs = set(session.scalars(select(EvaluationRun.eval_id)))
        first_evidence = set(session.scalars(select(Evidence.evidence_id)))
    result = invoke_import(tmp_path, data)
    assert result.exit_code == 0, result.output
    assert "확인된 주소 · 근거 1건 · 확인된 비용 $0.004000" in result.output
    assert openai_search._post_response.call_count == 1
    assert extraction.call_count == 2
    with session_scope() as session:
        opp = imported_opportunity(session)
        customer = session.get(Customer, opp.customer_id)
        assert (customer.homepage_url, customer.homepage_status) == (
            extraction_support.URL,
            "CONFIRMED",
        )
        assert first_runs < set(session.scalars(select(EvaluationRun.eval_id)))
        assert first_evidence < set(session.scalars(select(Evidence.evidence_id)))
        assert (
            session.scalar(
                select(func.count()).select_from(Opportunity).where(Opportunity.case_id == CASE_ID)
            )
            == 1
        )
