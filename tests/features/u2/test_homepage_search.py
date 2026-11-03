"""C4·C9. 파일 투입과 DB 읽기는 실제 코드로, 외부 검색은 대역으로 확인한다."""

from unittest.mock import Mock

from pytest_bdd import given, parsers, scenarios, then, when

from geosan.capability.importer import import_capability
from geosan.evidence.homepage import find_case_homepage
from geosan.opportunity.importer import import_case

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


@then("회사명과 주소만 한 번 전달된다")
def only_public_identity(lookup):
    adapter, _ = lookup
    adapter.assert_called_once_with("A정밀", "충남천안시(가상)")


@then(parsers.parse("검색 결과는 {expected} 상태다"))
def status_matches(lookup, expected):
    _, result = lookup
    assert result.status(0.7) == expected
