"""#515: 공개 자료 식별자만 구분하고 URL 나머지의 개인정보 검사는 유지한다."""

import pytest

from geosan.opportunity.candidate_web_results import parse_search_results, source_url
from tests.fakes.web_candidate_search import candidate, response

FILE_URL = "https://www.data.go.kr/data/15105482/fileData.do"
API_URL = "https://www.data.go.kr/data/15087611/openapi.do"


@pytest.mark.parametrize(
    "url",
    [
        FILE_URL,
        API_URL,
        FILE_URL.replace("www.data.go.kr", "data.go.kr"),
        FILE_URL + "?view=table#details",
    ],
)
def test_public_resource_identifier_is_not_a_phone_number(url):
    assert source_url(url, ()) == url.split("#")[0]


@pytest.mark.parametrize(
    "url",
    [
        FILE_URL + "?phone=010-1234-5678",
        FILE_URL + "?value=1588-1234",
        FILE_URL + "?value=15105482",
        FILE_URL + "?value=a%40example.com",
        FILE_URL + "?value=%30%31%30%2D1234%2D5678",
        FILE_URL + "?value=대표자홍길동",
        FILE_URL + "#010-1234-5678",
        FILE_URL + "#a%40example.com",
        FILE_URL + "#%EB%8B%B4%EB%8B%B9%EC%9E%90",
        FILE_URL.replace("www.data.go.kr", "www.data.go.kr.evil.example"),
        FILE_URL.replace("www.data.go.kr", "unverified.data.go.kr"),
        FILE_URL.replace("www.data.go.kr", "other.example"),
        FILE_URL.replace("www.data.go.kr", "user:pass@www.data.go.kr"),
        FILE_URL.replace("www.data.go.kr", "www.data.go.kr:444"),
        FILE_URL.replace("/data/", "/contact/"),
        FILE_URL.replace("/15105482/", "/01012345678/"),
        FILE_URL + "/010-1234-5678",
        FILE_URL.replace("fileData.do", "contact.do"),
    ],
)
def test_identifier_exception_does_not_allow_contacts_or_other_url_shapes(url):
    assert source_url(url, ()) is None


def test_configured_domain_block_still_wins_for_public_resources():
    assert source_url(FILE_URL, ("data.go.kr",)) is None


def test_public_source_must_still_be_returned_by_search_provider():
    rows, dropped = parse_search_results(response([candidate(sourceUrl=FILE_URL)]), (), 10)
    assert [row.source_url for row in rows] == [FILE_URL]
    assert dropped == 0
    assert parse_search_results(response([candidate(sourceUrl=FILE_URL)], sources=[]), (), 10) == (
        (),
        1,
    )


@pytest.mark.parametrize(
    "field,value",
    [
        ("companyName", "담당자 홍길동"),
        ("address", "충남 010-1234-5678"),
        ("snippet", "문의 a@example.com"),
        ("snippet", "자료 번호 15105482"),
        ("homepageUrl", FILE_URL + "?value=a%40example.com"),
        ("homepageUrl", "https://jobs.jobkorea.co.kr/"),
    ],
)
def test_valid_public_source_does_not_relax_other_candidate_fields(field, value):
    data = response([candidate(sourceUrl=FILE_URL, **{field: value})])
    assert parse_search_results(data, ("jobkorea.co.kr",), 10) == ((), 1)


def test_optional_homepage_address_uses_the_same_url_validation():
    data = response([candidate(homepageUrl=API_URL)])
    assert len(parse_search_results(data, (), 10)[0]) == 1
