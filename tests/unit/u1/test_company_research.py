"""#209 기업 요약: 실제 SQLite 투입·상세 API와 조사 시각을 확인한다."""

from datetime import timedelta

from fastapi.testclient import TestClient

from geosan.api.app import create_app
from geosan.capability.importer import import_capability
from geosan.config.models import AppSetting
from geosan.opportunity.importer import import_case
from geosan.opportunity.models import Customer
from geosan.storage.base import utcnow
from geosan.storage.session import session_scope
from tests import factories
from tests.unit.u1.test_snapshot_ledger import _write


def test_case_import_populates_company_summary(tmp_db, tmp_path):
    """Given 가상 사례 / When 투입 후 상세 조회 / Then 요약·출처·시각과 빈 번호를 준다."""
    import_capability(_write(tmp_path, "cap.json", factories.capability_file()))
    case = factories.apjeong_case()
    case["opportunity"]["cardReason"] = "가상 기업의 표면처리 검토"
    before = utcnow()
    result = import_case(_write(tmp_path, "case.json", case))
    with session_scope() as session:
        customer = session.get(Customer, result.customer_id)
        assert customer.researched_at >= before
        assert customer.research_source == "CASE_FILE"
    with TestClient(create_app()) as client:
        response = client.get(f"/api/v1/opportunities/{result.opp_id}")
    assert response.status_code == 200
    header = response.json()["data"]["header"]
    assert header["summaryLine"] == case["opportunity"]["cardReason"]
    assert header["highlights"] == []
    assert header["researchSource"] == "CASE_FILE"
    assert header["researchStale"] is False
    assert header["mainPhone"] is None
    assert header["mainPhoneSource"] is None
    assert header["distanceKm"] is None
    assert isinstance(header["address"], str)


def test_research_age_uses_config_and_missing_date_is_not_old(tmp_db, tmp_path):
    """Given 조사 기준 10일 / When 11일 전·날짜 없음 조회 / Then 오래됨·미조사를 구별한다."""
    import_capability(_write(tmp_path, "cap.json", factories.capability_file()))
    result = import_case(_write(tmp_path, "case.json", factories.apjeong_case()))
    with session_scope() as session:
        session.get(AppSetting, "research").value = {"staleAfterDays": 10}
        customer = session.get(Customer, result.customer_id)
        customer.researched_at = utcnow() - timedelta(days=11)
        customer.research_source = "AI"
        customer.highlights = ["가상 품목", "가상 공정"]
    with TestClient(create_app()) as client:
        header = client.get(f"/api/v1/opportunities/{result.opp_id}").json()["data"]["header"]
        assert header["researchStale"] is True
        assert header["highlights"] == ["가상 품목", "가상 공정"]
        with session_scope() as session:
            session.get(Customer, result.customer_id).researched_at = None
        header = client.get(f"/api/v1/opportunities/{result.opp_id}").json()["data"]["header"]
        assert header["researchStale"] is False
