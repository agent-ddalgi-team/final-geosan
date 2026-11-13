"""#664: 좌표 채우기 대상은 목록과 같은 기준, 서버 시작 때 위치 CSV를 미리 읽는다.

모든 데이터는 가상이다.
"""

from datetime import date

import pytest
from typer.testing import CliRunner

from geosan.commands import serve as serve_module
from geosan.commands.app import app
from geosan.commands.geocode import run_geocode
from geosan.config.app_settings import read_app_settings, sync_app_settings
from geosan.evaluation.models import EvaluationBatch, EvaluationRun
from geosan.opportunity import location_csv
from geosan.opportunity.models import Customer
from geosan.rules.codes import DatasetKind
from geosan.storage.session import session_scope
from tests.unit.u7.test_geocoding import csv_file, public_company

__all__ = ["public_company"]


def use_csv(tmp_path, *, active=None, enabled=True, files=None):
    with session_scope() as session:
        settings = read_app_settings(session)
        if active is not None:
            settings.active_dataset_kind = active
        settings.geocoding.enabled = enabled
        settings.geocoding.location_csv_files = (
            [str(csv_file(tmp_path))] if files is None else files
        )
        settings.geocoding.location_csv_base_date = date(2026, 10, 31)
        sync_app_settings(session, settings)


def add_evaluation(kind, number=1, run_status="CONFIRMED", opp_id="opp-geocode"):
    with session_scope() as session:
        batch_id = f"batch-{number}"
        session.add(
            EvaluationBatch(
                batch_id=batch_id,
                profile="NEW",
                scope="FULL",
                base_date=date(2026, 11, 1),
                rule_version="v-test",
                rule_hash="0" * 64,
                code_version="test",
                population_spec={},
                status="CONFIRMED",
                sort_rule="test",
                dataset_kind=kind,
            )
        )
        session.flush()
        session.add(
            EvaluationRun(
                eval_id=f"eval-{number}",
                batch_id=batch_id,
                opp_id=opp_id,
                profile="NEW",
                run_status=run_status,
                input_snapshot={},
                snapshot_hash="0" * 64,
                capability_version="test",
                filter_state="PASS",
                core_evidence_met="MET",
                operational_ready=True,
                timing_requirements=[],
                research_ready=True,
                score_e=0,
                score_f=0,
                score_t=0,
                score_p=0,
                score_r=0,
                completion_c=0,
                classification_code="WATCH",
                reason="가상",
                blocker_text="",
                blocks_approval=False,
                score_display="-",
                next_action="가상",
                dataset_kind=kind,
            )
        )


def stored_source():
    with session_scope() as session:
        return session.get(Customer, "cust-geocode").geocode_source


def test_company_marked_brochure_is_targeted_when_its_evaluation_is_active(
    public_company, tmp_path, capsys
):
    """Given 원본 표시는 소개서, 최신 확정 평가는 활성 묶음 / When 좌표 채우기 / Then 저장한다."""
    use_csv(tmp_path, active=DatasetKind.COMPANY_CONFIRMED)
    add_evaluation("COMPANY_CONFIRMED")
    assert run_geocode(True) == 0
    assert "공공좌표 저장 1곳" in capsys.readouterr().out
    assert stored_source() == "CSV"


@pytest.mark.parametrize(
    ("kind", "run_status"),
    [("BROCHURE", "CONFIRMED"), ("COMPANY_CONFIRMED", "SUPERSEDED")],
)
def test_company_outside_the_active_list_is_still_skipped(
    public_company, tmp_path, capsys, kind, run_status
):
    """Given 다른 묶음의 평가 또는 확정이 아닌 평가 / When 좌표 채우기 / Then 대상이 아니다."""
    use_csv(tmp_path, active=DatasetKind.COMPANY_CONFIRMED)
    add_evaluation(kind, run_status=run_status)
    assert run_geocode(True) == 0
    assert "공공좌표 저장 0곳" in capsys.readouterr().out
    assert stored_source() is None


def serve(monkeypatch):
    monkeypatch.setattr(serve_module, "port_in_use", lambda port, host: False)
    monkeypatch.setattr(serve_module, "_run_server", lambda port, host: None)
    location_csv._cached_index.cache_clear()
    result = CliRunner().invoke(app, ["serve", "--port", "18766"], catch_exceptions=False)
    return result.exit_code, result.output


def test_serve_reads_location_csv_before_the_first_request(public_company, tmp_path, monkeypatch):
    """Given 좌표 조회 켬·위치 CSV / When serve / Then 첫 요청 전에 색인이 준비돼 있다."""
    use_csv(tmp_path)
    code, out = serve(monkeypatch)
    assert code == 0, out
    assert "위치 CSV 1개를 미리 읽었습니다" in out
    assert location_csv._cached_index.cache_info().currsize == 1


def test_serve_warns_but_starts_when_location_csv_is_missing(public_company, tmp_path, monkeypatch):
    use_csv(tmp_path, files=[str(tmp_path / "없는파일.csv")])
    code, out = serve(monkeypatch)
    assert code == 0, out
    assert "경고: 위치 CSV 파일을 확인할 수 없습니다." in out and "서버 시작" in out


def test_serve_skips_csv_when_lookup_is_off(public_company, tmp_path, monkeypatch):
    use_csv(tmp_path, enabled=False)
    code, out = serve(monkeypatch)
    assert code == 0, out
    assert "위치 CSV" not in out
    assert location_csv._cached_index.cache_info().currsize == 0
