"""C4·C9. 파일 투입과 DB 읽기는 실제 코드로, 외부 검색은 대역으로 확인한다."""

from unittest.mock import Mock

from fastapi.testclient import TestClient
from pytest_bdd import given, parsers, scenarios, then, when
from sqlalchemy import select

from geosan.api.app import create_app
from geosan.capability.importer import import_capability
from geosan.config.app_settings import load_app_settings, sync_app_settings
from geosan.evidence import openai_search
from geosan.evidence.homepage import find_case_homepage
from geosan.evidence.transfer import TransferLog
from geosan.opportunity.importer import import_case
from geosan.storage.session import session_scope
from tests.unit.u2.test_search_limits import provider_reply

scenarios("u2/homepage_search.feature")


@given("공개 등급의 A정밀 사례가 데이터베이스에 있다", target_fixture="opp_id")
def public_case(tmp_db, capability_file_path, apjeong_case_path):
    import_capability(capability_file_path)
    return import_case(apjeong_case_path).opp_id


@when(parsers.parse("검색 대역이 {answer} 결과를 돌려준다"), target_fixture="lookup")
def search(opp_id, answer):
    response = {
        "provider": "OPENAI_WEB_SEARCH",
        "url": None if answer == "주소가 없는" else "https://example.org/",
        "confidence": 0.69 if answer == "기준보다 낮은" else 0.7,
        "reason": "시험용 검색 응답",
        "fetchedAt": "2026-11-03T09:00:00+09:00",
    }
    adapter = Mock(return_value=response)
    return adapter, find_case_homepage(opp_id, search=adapter)


@when("검색 한 번이 완료되고 상한 밖의 추가 검색이 응답에 남는다", target_fixture="lookup")
def search_with_ignored_extra_call(opp_id, app_settings_path, monkeypatch):
    settings = load_app_settings(app_settings_path)
    settings.llm.mode = "EXTERNAL"
    with session_scope() as session:
        sync_app_settings(session, settings)
    monkeypatch.setenv("OPENAI_API_KEY", "test-only-placeholder")
    response = provider_reply()
    response["max_tool_calls"] = 1
    response["output"].insert(
        1, {"type": "web_search_call", "status": "searching", "action": {"type": "open_page"}}
    )
    transport = Mock(return_value=response)
    monkeypatch.setattr(openai_search, "_post_response", transport)
    return transport, find_case_homepage(opp_id)


@then("외부 호출과 검색 사용량은 각각 한 번만 기록된다")
def single_paid_search(lookup):
    transport, _ = lookup
    transport.assert_called_once()
    with session_scope() as session:
        (row,) = session.scalars(select(TransferLog)).all()
        assert row.call_count == row.web_search_calls == 1
        assert row.input_tokens == 1000
        assert row.output_tokens == 200


@then("회사명과 주소만 한 번 전달된다")
def only_public_identity(lookup):
    adapter, _ = lookup
    adapter.assert_called_once_with("A정밀", "충남천안시(가상)")


@then(parsers.parse("검색 결과는 {expected} 상태다"))
def status_matches(lookup, expected):
    _, result = lookup
    assert result.status(0.7) == expected


@then(parsers.parse("상세에서 저장한 홈페이지 주소와 {expected} 상태를 다시 읽을 수 있다"))
def saved_homepage(opp_id, lookup, expected):
    _, result = lookup
    with TestClient(create_app()) as client:
        response = client.get(f"/api/v1/opportunities/{opp_id}")
    assert response.status_code == 200, response.text
    data = response.json()["data"]
    assert data["header"]["homepageStatus"] == expected
    assert data["header"].get("homepageUrl") == result.url
    gaps = {item["itemId"] for item in data["reviewItems"]}
    assert ("GAP:HOMEPAGE" in gaps) == (expected == "NOT_FOUND")
