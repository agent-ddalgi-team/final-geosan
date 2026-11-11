"""#557 후속: 안쪽 페이지의 사이트 경계와 잘못된 링크 건너뛰기. 외부 요청은 가짜다."""

import time

import pytest

from geosan.config.errors import AppError
from geosan.evidence import reader

HOME = "https://example.org/"
INNER = "https://example.org/about"
OTHER = "https://other.example.org/product"
HTML = {"content-type": "text/html"}


def _site(monkeypatch, pages):
    calls = []

    def get(url, _):
        calls.append(url)
        return pages.get(url, (404, {}, ""))

    monkeypatch.setattr(reader, "_get", get)
    return calls


def _more(first):
    return reader.fetch_more(
        first, time.monotonic() + 60, extra_pages=3, hints=["회사소개"], max_chars=6000
    )


@pytest.mark.parametrize("href", ["https://[broken", "//[broken", "https://example.org:bad/about"])
def test_malformed_link_is_skipped_before_next_valid_link(monkeypatch, href):
    calls = _site(monkeypatch, {INNER: (200, HTML, "<p>SCM440 소재 가공</p>")})
    first = reader.Page(HOME, "정밀 볼트 생산", ((href, "회사소개"), ("/about", "회사소개")))
    assert [page.url for page in _more(first)] == [INNER]
    assert calls == [HOME + "robots.txt", INNER]


@pytest.mark.parametrize("location", [OTHER, "https://[broken"])
def test_unreadable_inner_redirect_is_skipped_and_next_link_is_read(monkeypatch, location):
    product = HOME + "products"
    calls = _site(
        monkeypatch,
        {
            INNER: (302, {"location": location}, ""),
            product: (200, HTML, "<p>정밀 볼트 생산</p>"),
            OTHER: (200, HTML, "<p>다른 회사 제품</p>"),
        },
    )
    first = reader.Page(HOME, "첫 화면", ((INNER, "회사소개"), (product, "회사소개 제품")))
    assert [page.url for page in _more(first)] == [product]
    assert not any("other.example.org" in url for url in calls)


def test_frame_redirect_cannot_leave_its_original_site(monkeypatch):
    calls = _site(
        monkeypatch,
        {
            HOME: (200, HTML, '<frameset><frame src="/about"></frameset>'),
            INNER: (302, {"location": OTHER}, ""),
            OTHER: (200, HTML, "<p>다른 회사 제품</p>"),
        },
    )
    with pytest.raises(AppError) as error:
        reader.fetch(HOME, time.monotonic() + 60)
    assert error.value.kind == "UNREACHABLE"
    assert not any("other.example.org" in url for url in calls)


@pytest.mark.parametrize("framed", [True, False])
def test_same_site_redirect_including_www_alias_still_succeeds(monkeypatch, framed):
    destination = "https://www.example.org/products"
    _site(
        monkeypatch,
        {
            HOME: (200, HTML, '<frameset><frame src="/about"></frameset>'),
            INNER: (302, {"location": destination}, ""),
            destination: (200, HTML, "<p>정밀 볼트 생산</p>"),
        },
    )
    if framed:
        page = reader.fetch(HOME, time.monotonic() + 60)
    else:
        (page,) = _more(reader.Page(HOME, "첫 화면", ((INNER, "회사소개"),)))
    assert page.url == destination and page.text == "정밀 볼트 생산"


def test_original_homepage_redirect_remains_allowed(monkeypatch):
    _site(
        monkeypatch,
        {HOME: (302, {"location": OTHER}, ""), OTHER: (200, HTML, "<p>이전한 홈페이지</p>")},
    )
    assert reader.fetch(HOME, time.monotonic() + 60).url == OTHER


def test_bad_frame_address_is_skipped_before_valid_same_site_frame(monkeypatch):
    _site(
        monkeypatch,
        {
            HOME: (
                200,
                HTML,
                '<frameset><frame src="https://[broken"><frame src="/about"></frameset>',
            ),
            INNER: (200, HTML, "<p>정밀 볼트 생산</p>"),
        },
    )
    assert reader.fetch(HOME, time.monotonic() + 60).url == INNER
