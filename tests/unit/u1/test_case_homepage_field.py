"""#190·#332: 사례 파일의 회사 홈페이지 칸을 검사하고 투입 때 확정 주소로 저장한다.

임시 SQLite와 실제 검사·투입 함수로 본다. 홈페이지 찾기·AI 호출은 하지 않는다(가상 자료).
"""

import json
import re
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select

from geosan.api.app import create_app
from geosan.capability.importer import import_capability
from geosan.config.errors import InputError
from geosan.config.file_checks import check_case_file
from geosan.config.schemas import HOMEPAGE_URL_PATTERN
from geosan.opportunity.importer import import_case
from geosan.opportunity.models import Customer
from geosan.storage.session import session_scope
from tests import factories
from tests.unit.u1.test_snapshot_ledger import _write

REPO_ROOT = Path(__file__).resolve().parents[3]
FILE_URL = "http://www.example-virtual.co.kr/"
OTHER_URL = "https://other.example-virtual.co.kr/"


def _case(homepage_url="__absent__"):
    case = factories.apjeong_case()
    if homepage_url != "__absent__":
        case["customer"]["homepageUrl"] = homepage_url
    return case


def _homepage():
    with session_scope() as session:
        customer = session.scalars(select(Customer)).one()
        return (
            customer.homepage_url,
            customer.homepage_status,
            customer.homepage_source,
            customer.homepage_confidence,
        )


def _set_homepage(url, status, source, confidence=None):
    with session_scope() as session:
        customer = session.scalars(select(Customer)).one()
        customer.homepage_url = url
        customer.homepage_status = status
        customer.homepage_source = source
        customer.homepage_confidence = confidence


@pytest.fixture
def capability(tmp_db, tmp_path):
    import_capability(_write(tmp_path, "cap.json", factories.capability_file()))
    return tmp_path


@pytest.mark.parametrize("url", [FILE_URL, OTHER_URL, "https://example-virtual.co.kr/ko/about"])
def test_case_file_accepts_http_and_https_homepage(tmp_db, tmp_path, url):
    """Given 공식 주소를 적은 사례 파일 / When 검사 / Then 통과하고 값을 그대로 읽는다."""
    report = check_case_file(_write(tmp_path, "case.json", _case(url)))
    assert report.ok, report.errors
    assert report.case.customer.homepage_url == url


@pytest.mark.parametrize("value", ["__absent__", None])
def test_case_file_without_homepage_still_passes(tmp_db, tmp_path, value):
    """Given 칸이 없거나 null / When 검사 / Then 기존 파일처럼 통과한다."""
    report = check_case_file(_write(tmp_path, "case.json", _case(value)))
    assert report.ok, report.errors
    assert report.case.customer.homepage_url is None


@pytest.mark.parametrize(
    "bad",
    [
        "",
        "www.example-virtual.co.kr",
        "ftp://example-virtual.co.kr/",
        "mailto:virtual@example-virtual.co.kr",
        "https://virtual@example-virtual.co.kr/",
        "https://example-virtual.co.kr/a b",
        "javascript:alert(1)",
        123,
    ],
)
def test_bad_homepage_is_rejected_and_nothing_is_stored(capability, bad):
    """Given 주소가 아닌 값·사람 계정이 든 주소 / When 검사·투입 / Then 그 칸 오류, 저장 없음."""
    path = _write(capability, "bad.json", _case(bad))
    report = check_case_file(path)
    assert not report.ok
    assert any("homepageUrl" in error.path for error in report.errors)
    with pytest.raises(InputError):
        import_case(path)
    with session_scope() as session:
        assert session.scalar(select(Customer)) is None


def test_import_saves_file_homepage_as_confirmed_case_file(capability):
    """Given 주소를 적은 파일 / When 투입 / Then 확정·사례 파일 출처로 저장되고 상세에 나온다."""
    result = import_case(_write(capability, "case.json", _case(FILE_URL)))
    assert _homepage() == (FILE_URL, "CONFIRMED", "CASE_FILE", None)
    assert not any("홈페이지" in warning for warning in result.warnings)
    with TestClient(create_app()) as client:
        header = client.get(f"/api/v1/opportunities/{result.opp_id}").json()["data"]["header"]
    assert header["homepageUrl"] == FILE_URL
    assert header["homepageStatus"] == "CONFIRMED"


def test_file_homepage_replaces_ai_found_address(capability):
    """Given AI가 찾은 주소 / When 주소를 적은 파일을 다시 투입 / Then 파일 주소가 확정 값."""
    import_case(_write(capability, "case.json", _case()))
    _set_homepage(OTHER_URL, "NEEDS_CONFIRMATION", "AI", 0.4)
    import_case(_write(capability, "case.json", _case(FILE_URL)))
    assert _homepage() == (FILE_URL, "CONFIRMED", "CASE_FILE", None)


@pytest.mark.parametrize(
    "saved",
    [
        (OTHER_URL, "AI_FOUND", "AI", 0.82),
        (OTHER_URL, "CONFIRMED", "STAFF", None),
        (OTHER_URL, "CONFIRMED", "CASE_FILE", None),
    ],
)
def test_reimport_without_homepage_keeps_the_saved_address(capability, saved):
    """Given 저장된 주소 / When 칸이 빈 파일을 다시 투입 / Then 주소를 지우지 않는다.

    검사에 칸만 더하고 투입을 그대로 두면 다시 투입할 때 주소가 빈 값으로 지워진다.
    그 함정을 막는다.
    """
    import_case(_write(capability, "case.json", _case()))
    _set_homepage(*saved)
    result = import_case(_write(capability, "case.json", _case(None)))
    assert _homepage() == saved
    assert not any("홈페이지" in warning for warning in result.warnings)


def test_staff_address_wins_over_file_with_a_warning(capability):
    """Given 담당자가 고친 주소 / When 다른 주소를 적은 파일 투입 / Then 담당자 값 유지 + 경고."""
    import_case(_write(capability, "case.json", _case()))
    _set_homepage(OTHER_URL, "CONFIRMED", "STAFF")
    result = import_case(_write(capability, "case.json", _case(FILE_URL)))
    assert _homepage() == (OTHER_URL, "CONFIRMED", "STAFF", None)
    assert [warning for warning in result.warnings if "홈페이지" in warning] == [
        "홈페이지 주소는 담당자가 입력한 값을 유지합니다. 사례 파일 값은 반영하지 않았습니다."
    ]
    same = import_case(_write(capability, "case.json", _case(OTHER_URL)))
    assert _homepage() == (OTHER_URL, "CONFIRMED", "STAFF", None)
    assert not any("홈페이지" in warning for warning in same.warnings)


def test_schema_file_and_template_match_the_checker():
    """약속 스키마 파일의 칸·허용 글자가 검사기와 같고 예시 틀에 칸이 있다(손으로 관리하는 파일)."""
    schema = json.loads((REPO_ROOT / "contracts/case-file.schema.json").read_text(encoding="utf-8"))
    field = schema["properties"]["customer"]["properties"]["homepageUrl"]
    assert field["type"] == ["string", "null"]
    assert field["pattern"] == HOMEPAGE_URL_PATTERN
    assert "homepageUrl" not in schema["properties"]["customer"]["required"]
    assert re.match(field["pattern"], FILE_URL)
    template = json.loads((REPO_ROOT / "examples/case-template.json").read_text(encoding="utf-8"))
    assert template["customer"]["homepageUrl"] is None
    assert "homepageUrl" in template["customer"]["_설명"]
