"""실제 사례 파일·임시 SQLite·API로 주소 추가와 평가 보존을 확인한다. 외부 호출 없음."""

import json

from fastapi.testclient import TestClient
from pytest_bdd import given, scenarios, then, when
from sqlalchemy import select

from geosan.api.app import create_app
from geosan.capability.importer import import_capability
from geosan.config.app_settings import load_app_settings, sync_app_settings
from geosan.config.file_checks import check_case_file
from geosan.evaluation.models import EvaluationRun
from geosan.opportunity.importer import import_case
from geosan.opportunity.models import Customer, Opportunity
from geosan.storage.session import session_scope
from geosan.workflows.flow_evaluate import run_evaluation

scenarios("u2/motiontec_homepage.feature")

CASE_NAME = "motiontec-daejeon-profile-anodizing.json"
OFFICIAL_URL = "http://www.motiontec.co.kr/"


def _evaluate(base_date):
    result = run_evaluation(base_date=base_date)
    assert result.ok, result.error
    assert len(result.new_eval_ids) == 18
    with session_scope() as session:
        rows = session.scalars(
            select(EvaluationRun).where(EvaluationRun.eval_id.in_(result.new_eval_ids))
        ).all()
        return {
            row.opp_id: (
                row.score_e,
                row.score_f,
                row.score_t,
                row.score_p,
                row.score_s,
                row.score_r,
                row.completion_c,
                row.classification_code,
                row.core_evidence_met,
            )
            for row in rows
        }


def _process_cards():
    with TestClient(create_app()) as client:
        result = {}
        for process in ("ZINC_PLATING", "ANODIZING"):
            response = client.get("/api/v1/opportunities", params={"process": process})
            assert response.status_code == 200
            payload = response.json()
            assert payload["meta"]["total"] == len(payload["data"]) == 9
            result[process] = [
                (row["oppId"], row["rank"], row["scoreDisplay"], row["classificationCode"])
                for row in payload["data"]
            ]
        return result


@given("모션텍의 홈페이지 칸 없이 공개 사례 18곳이 평가되어 있다", target_fixture="original")
def before(bare_db, examples_dir, tmp_path, base_date):
    settings_path = examples_dir / "app-settings.yaml"
    with session_scope() as session:
        sync_app_settings(session, load_app_settings(settings_path), source_path=settings_path)
    import_capability(examples_dir / "capability-geosan-brochure.json")
    paths = sorted((examples_dir / "cases").glob("*.json"))
    assert len(paths) == 18
    for path in paths:
        if path.name == CASE_NAME:
            case = json.loads(path.read_text(encoding="utf-8"))
            case["customer"].pop("homepageUrl", None)
            path = tmp_path / "before-motiontec.json"
            path.write_text(json.dumps(case, ensure_ascii=False), encoding="utf-8")
            opp_id = import_case(path).opp_id
        else:
            import_case(path)
    return {"opp_id": opp_id, "scores": _evaluate(base_date), "cards": _process_cards()}


@when("공식 주소를 보탠 모션텍 사례를 다시 넣고 전체 평가한다", target_fixture="updated")
def reimport(examples_dir, original, base_date):
    path = examples_dir / "cases" / CASE_NAME
    report = check_case_file(path)
    assert report.ok, report.errors
    result = import_case(path)
    assert result.opp_id == original["opp_id"]
    return {"scores": _evaluate(base_date), "cards": _process_cards()}


@then("모션텍 상세는 공식 홈페이지를 확정된 사례 파일 주소로 보여 준다")
def official_address(original):
    with session_scope() as session:
        opportunity = session.get(Opportunity, original["opp_id"])
        customer = session.get(Customer, opportunity.customer_id)
        assert (customer.homepage_url, customer.homepage_status, customer.homepage_source) == (
            OFFICIAL_URL,
            "CONFIRMED",
            "CASE_FILE",
        )
    with TestClient(create_app()) as client:
        response = client.get(f"/api/v1/opportunities/{original['opp_id']}")
        assert response.status_code == 200
        header = response.json()["data"]["header"]
    assert header["homepageUrl"] == OFFICIAL_URL
    assert header["homepageStatus"] == "CONFIRMED"
    assert header["homepageSource"] == "CASE_FILE"


@then("18곳의 계산 점수와 두 공정의 순위는 그대로다")
def unchanged(original, updated):
    assert updated["scores"] == original["scores"]
    assert updated["cards"] == original["cards"]
