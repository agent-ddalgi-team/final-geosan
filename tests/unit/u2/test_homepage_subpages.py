"""#557: 홈페이지 안쪽 페이지(회사소개·제품·연혁)를 더 읽어 AI는 한 번만 부른다.

읽기 부분은 가짜 HTTP 응답(reader._get)으로, 조사 흐름은 실제 임시 DB·규칙 엔진과
가짜 OpenAI 응답으로 확인한다. 실제 홈페이지 연결 확인이 아니다.
"""

import time

import pytest
from pydantic import ValidationError
from sqlalchemy import select

from geosan.config.app_settings import HomepageDiscoverySettings
from geosan.config.errors import AppError
from geosan.evidence import public_items, reader
from geosan.evidence.models import Evidence
from geosan.evidence.reader import Page
from geosan.storage.session import session_scope
from geosan.workflows import flow_extract
from tests.unit.u2 import test_extraction as support

search_env = support.search_env
extract_env = support.extract_env

HINTS = HomepageDiscoverySettings(enabled=True, terms_confirmed=False).extra_page_hints
HOME = (
    "<p>가상정밀 메인</p>"
    '<a href="/company/intro.html">회사소개</a>'
    '<a href="/notice">공지사항</a>'
    '<a href="https://other.example/about">협력사 회사소개</a>'
    '<a href="/sub/product01.html"><img alt="주요 제품"></a>'
    '<a href="/history">연혁</a>'
    '<a href="mailto:x@example.invalid">회사소개 문의</a>'
    '<a href="/company/intro.html#top">회사소개(맨 위)</a>'
    '<a href="/cert">인증</a>'
)


def _site(pages, robots="User-agent: *\nAllow: /"):
    calls = []

    def get(url, _):
        calls.append(url)
        if url.endswith("/robots.txt"):
            return 200, {}, robots
        if url in pages:
            return 200, {"content-type": "text/html"}, pages[url]
        return 404, {}, ""

    return calls, get


def _more(first, **kwargs):
    options = {"extra_pages": 3, "hints": HINTS, "max_chars": 6000, **kwargs}
    return reader.fetch_more(first, time.monotonic() + 60, **options)


def test_first_page_keeps_links_with_their_words(monkeypatch):
    _, get = _site({"https://www.example.org/": HOME})
    monkeypatch.setattr(reader, "_get", get)
    page = reader.fetch("https://www.example.org/", time.monotonic() + 60)
    assert page.text.startswith("가상정밀 메인")
    assert ("/company/intro.html", "회사소개") in page.links
    assert ("/sub/product01.html", "주요 제품") in page.links


def test_same_site_pages_with_matching_names_are_read_in_order(monkeypatch):
    calls, get = _site(
        {
            "https://www.example.org/": HOME,
            "https://www.example.org/company/intro.html": "<p>1998년 설립, SCM440 소재 가공</p>",
            "https://www.example.org/sub/product01.html": "<p>유압 실린더 생산</p>",
            "https://example.org/history": "<p>2020 두산 협력사 등록</p>",
            "https://www.example.org/history": "<p>2020 두산 협력사 등록</p>",
            "https://www.example.org/cert": "<p>ISO 9001</p>",
        }
    )
    monkeypatch.setattr(reader, "_get", get)
    first = reader.fetch("https://www.example.org/", time.monotonic() + 60)
    pages = _more(first)
    assert [page.url for page in pages] == [
        "https://www.example.org/company/intro.html",
        "https://www.example.org/sub/product01.html",
        "https://www.example.org/history",
    ]
    assert pages[0].text == "1998년 설립, SCM440 소재 가공"
    # 다른 사이트·공지사항·메일 주소·같은 페이지의 #위치·장수 초과(인증)는 읽지 않는다.
    assert not any("other.example" in url or "notice" in url or "cert" in url for url in calls)
    assert all(page.links == () for page in pages)


def test_zero_extra_pages_reads_only_the_first_page(monkeypatch):
    calls, get = _site({"https://www.example.org/": HOME})
    monkeypatch.setattr(reader, "_get", get)
    first = reader.fetch("https://www.example.org/", time.monotonic() + 60)
    before = len(calls)
    assert _more(first, extra_pages=0) == []
    assert len(calls) == before


def test_blocked_or_broken_inner_page_is_skipped_not_failed(monkeypatch):
    calls, get = _site(
        {
            "https://www.example.org/": HOME,
            "https://www.example.org/sub/product01.html": (
                '<meta name="robots" content="noai"><p>제품</p>'
            ),
            "https://www.example.org/history": "<p>2020 협력사 등록</p>",
        },
        robots="User-agent: *\nDisallow: /company/",
    )
    monkeypatch.setattr(reader, "_get", get)
    first = reader.fetch("https://www.example.org/", time.monotonic() + 60)
    pages = _more(first)
    assert [page.url for page in pages] == ["https://www.example.org/history"]
    # robots가 막은 회사소개는 본문을 요청하지 않는다.
    assert "https://www.example.org/company/intro.html" not in calls


def test_inner_page_text_is_cut_to_setting(monkeypatch):
    _, get = _site(
        {
            "https://www.example.org/": HOME,
            "https://www.example.org/company/intro.html": "<p>" + "가" * 50 + "</p>",
        }
    )
    monkeypatch.setattr(reader, "_get", get)
    first = reader.fetch("https://www.example.org/", time.monotonic() + 60)
    (page,) = _more(first, extra_pages=1, max_chars=10)
    assert page.text == "가" * 10


def test_inner_pages_stop_while_time_is_left_for_ai(monkeypatch):
    calls, get = _site({"https://www.example.org/": HOME})
    monkeypatch.setattr(reader, "_get", get)
    first = reader.fetch("https://www.example.org/", time.monotonic() + 60)
    before = len(calls)
    near = time.monotonic() + reader._EXTRA_PAGE_RESERVE_SECONDS - 1
    options = {"extra_pages": 3, "hints": HINTS, "max_chars": 6000}
    assert reader.fetch_more(first, near, **options) == []
    assert len(calls) == before


def test_fetch_site_first_failure_is_the_research_failure(monkeypatch):
    _, get = _site({}, robots="User-agent: *\nDisallow: /")
    monkeypatch.setattr(reader, "_get", get)
    with pytest.raises(AppError) as error:
        reader.fetch_site(
            "https://www.example.org/",
            time.monotonic() + 60,
            extra_pages=3,
            hints=HINTS,
            max_chars=6000,
        )
    assert error.value.kind == "ROBOTS_DISALLOW"


@pytest.mark.parametrize(
    "field,value",
    [("extra_pages", -1), ("extra_pages", 11), ("extra_page_max_chars", 10)],
)
def test_settings_reject_out_of_range_numbers(field, value):
    with pytest.raises(ValidationError):
        HomepageDiscoverySettings(enabled=True, terms_confirmed=False, **{field: value})


def test_settings_reject_blank_hint():
    with pytest.raises(ValidationError):
        HomepageDiscoverySettings(enabled=True, terms_confirmed=False, extra_page_hints=["  "])


INNER_URL = "https://example.org/company/intro"
INNER = "1998년 설립.\nSCM440 소재 볼트를 두산에 납품합니다.\n대표전화 041-555-1234"


def test_research_sends_all_pages_once_and_cites_the_inner_page(extract_env, monkeypatch):
    """Given 첫 화면 + 회사소개 / When 조사 / Then AI 1회, 근거 출처는 인용문이 있는 페이지."""
    case, transport = extract_env
    answer = support.answer()
    answer["evidence"].append(
        {
            "quote": "SCM440 소재 볼트를 두산에 납품합니다.",
            "subject": "PRODUCT",
            "occurredAtCandidate": None,
            "sourceGradeProposed": "B",
            "certaintyProposed": "STRONG",
        }
    )
    transport.side_effect = lambda *_: support.reply(answer)
    seen = {}

    def more(first, deadline, **options):
        seen.update(options)
        return [Page(INNER_URL, INNER)]

    monkeypatch.setattr(flow_extract, "fetch_more", more)
    result = flow_extract.run_extract(case.opp_id, support.URL)
    assert result.ok, result.error
    assert seen == {"extra_pages": 3, "hints": HINTS, "max_chars": 6000}
    assert transport.call_count == 1
    sent = transport.call_args.args[0]["input"]
    assert support.BODY in sent and "SCM440 소재 볼트" in sent
    # 대표번호는 우리 코드가 먼저 뽑고 보내기 전에 지운다(안쪽 페이지도 같다).
    assert "555-1234" not in sent
    with session_scope() as session:
        rows = session.scalars(
            select(Evidence).where(
                Evidence.opp_id == case.opp_id,
                Evidence.is_llm_proposed.is_(True),
                Evidence.superseded_at.is_(None),
            )
        ).all()
        sources = {row.quote: row.source_ref for row in rows}
    assert sources["정밀 볼트를 생산합니다."] == support.URL
    assert sources["SCM440 소재 볼트를 두산에 납품합니다."] == INNER_URL
    assert not public_items._items


def test_pasted_text_never_reads_inner_pages(extract_env, monkeypatch):
    case, _ = extract_env
    monkeypatch.setattr(
        flow_extract,
        "fetch_more",
        lambda *_a, **_k: pytest.fail("붙여넣기는 안쪽 페이지를 안 읽음"),
    )
    result = flow_extract.run_extract(case.opp_id, support.URL, pasted_text=support.BODY)
    assert result.ok, result.error


def test_source_finder_falls_back_to_first_page():
    finder = flow_extract._source_finder(
        [Page("https://a.example/", "첫 화면"), Page("https://a.example/b", "안쪽 본문")]
    )
    assert finder("안쪽 본문") == "https://a.example/b"
    assert finder("어디에도 없는 문장") == "https://a.example/"
    assert finder("") == "https://a.example/"
