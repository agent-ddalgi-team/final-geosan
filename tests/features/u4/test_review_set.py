import re

from fastapi.testclient import TestClient
from pytest_bdd import given, scenarios, then, when
from sqlalchemy import select

from geosan.api.app import create_app
from geosan.capability.importer import import_capability
from geosan.capability.models import FieldEvidence
from geosan.config.app_settings import load_app_settings, sync_app_settings
from geosan.opportunity.importer import import_case
from geosan.storage.session import session_scope
from geosan.workflows import flow_evaluate
from tests import factories
from tests.unit.u1 import test_review_set as support

review_db = support.review_db
scenarios("u4/review_set.feature")


@given("소개서 검수 대기 110건과 공개 기업 18곳이 평가되어 있다")
def public_data(bare_db, examples_dir, monkeypatch, tmp_path):
    from geosan.commands import review_set

    # 아래 Then이 거래 확인 전 대기 상태를 보므로 거래 관계 확인을 켠 설정을 쓴다(#567).
    factories.register_relation_check(tmp_path, "BLOCK")

    monkeypatch.setattr(review_set, "today_in_seoul", lambda: support.REVIEW_DATE)
    monkeypatch.setattr(flow_evaluate, "today_in_seoul", lambda: support.REVIEW_DATE)
    settings = examples_dir / "app-settings.yaml"
    with session_scope() as session:
        sync_app_settings(session, load_app_settings(settings), source_path=settings)
    import_capability(examples_dir / "capability-geosan-brochure.json")
    paths = list((examples_dir / "cases").glob("*.json"))
    assert len(paths) == 18
    for path in paths:
        import_case(path)
    before = flow_evaluate.run_evaluation(base_date=support.REVIEW_DATE)
    assert before.ok and len(before.new_eval_ids) == 18
    with TestClient(create_app()) as client:
        payload = client.get("/api/v1/opportunities").json()
        assert payload["meta"]["datasetKind"] == "BROCHURE"
        assert len(payload["data"]) == 18
        assert all(row["scoreDisplay"].startswith("참고") for row in payload["data"])


@when("소개서 전체를 확인 완료로 전환한다")
def confirm():
    result = support.invoke("--all", "REVIEWED")
    assert result.exit_code == 0 and "기회 18건" in result.output, result.output


@then("원본 110건은 그대로이고 확인 이력 110건이 새로 생긴다")
def proof():
    with session_scope() as session:
        for kind, status in [("BROCHURE", "PENDING"), ("COMPANY_CONFIRMED", "REVIEWED")]:
            rows = list(
                session.scalars(select(FieldEvidence).where(FieldEvidence.dataset_kind == kind))
            )
            assert len(rows) == 110
            assert all(row.review_status == status and row.data_version == 1 for row in rows)
            if kind == "COMPANY_CONFIRMED":
                assert all(
                    row.reviewer == "가상 검수자" and row.basis == "가상 전체 확인" for row in rows
                )


@then("추천 목록 두 공정 탭에 각각 9곳의 확인 묶음이 보이고 거래 확인 전 점수와 상태가 보인다")
def cards():
    with TestClient(create_app()) as client:
        for process in ("ZINC_PLATING", "ANODIZING"):
            response = client.get("/api/v1/opportunities", params={"process": process})
            assert response.status_code == 200
            payload = response.json()
            assert payload["meta"]["datasetKind"] == "COMPANY_CONFIRMED"
            assert payload["meta"]["hasVirtualData"] is False
            assert len(payload["data"]) == payload["meta"]["total"] == 9
            assert [row["rank"] for row in payload["data"]] == list(range(1, 10))
            assert all(row["datasetKind"] == "COMPANY_CONFIRMED" for row in payload["data"])
            # #262 PM 승인: 미확인 분류는 유지하고 숫자·PENDING을 함께 보인다.
            assert all(row["classificationCode"] == "FILTER_PENDING" for row in payload["data"])
            assert all(row["scoreState"] == "PENDING" for row in payload["data"])
            assert all(
                re.fullmatch(r"\d+점 · [1-8]/8", row["scoreDisplay"]) for row in payload["data"]
            )


@given("소개서와 두 기회의 평가가 저장되어 있다", target_fixture="original")
def existing(review_db):
    return support.database_rows(review_db)


@when("전체 전환 후 첫 재평가 저장에서 오류가 난다")
def fail(monkeypatch):
    original = flow_evaluate.save_evaluation

    def save_then_fail(*args, **kwargs):
        original(*args, **kwargs)
        raise RuntimeError("가상 저장 실패")

    monkeypatch.setattr(flow_evaluate, "save_evaluation", save_then_fail)
    result = support.invoke("--all", "REVIEWED")
    assert result.exit_code == 2


@then("검수 값과 설정과 이전 평가가 모두 그대로 남는다")
def unchanged(review_db, original):
    assert support.database_rows(review_db) == original
