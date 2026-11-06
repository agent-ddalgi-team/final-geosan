"""robots·약관 차단·내부망 차단과 실제 로컬 HTTP 응답 읽기를 검사한다."""

import socket
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from threading import Thread

import pytest
from pydantic import ValidationError

from geosan.config.app_settings import MainPhoneSettings
from geosan.config.errors import AppError
from geosan.evidence import reader
from geosan.evidence.contacts import extract_main_phone, scrub_contacts

FRAME_PAGE = """<html><head><title>가상 회사</title></head>
<frameset><frame src="https://example.org/company">
<noframes><body>This page uses frames. Your browser does not support frames.</body></noframes>
</frameset></html>"""


@pytest.mark.parametrize(
    "body",
    [
        FRAME_PAGE,
        FRAME_PAGE.replace("</head>", ""),
        "<head><title>가상 회사</title><script>loadCompany()</script></head><body></body>",
        "<title>가상 회사</title>",
    ],
)
def test_frame_notice_or_title_alone_is_not_company_body(monkeypatch, body):
    calls = []

    def get(url, _):
        calls.append(url)
        return (
            (404, {}, "")
            if url.endswith("robots.txt")
            else (200, {"content-type": "text/html"}, body)
        )

    monkeypatch.setattr(reader, "_get", get)
    with pytest.raises(AppError) as error:
        reader.fetch("https://example.org/", time.monotonic() + 60)
    assert error.value.kind == "UNREACHABLE"
    assert "붙여넣어" in error.value.next_action
    assert calls == ["https://example.org/robots.txt", "https://example.org/"]


def test_real_body_survives_metadata_and_frame_fallback_removal(monkeypatch):
    body = (
        "<head><title>가상 회사</title><style>css</style><script>js</script></head>"
        "<body><p>공개 제품 <b>볼트</b></p>"
        "<noframes>브라우저 안내문<script>fallback()</script></noframes>"
        "<p>자동차용 부품을 생산합니다.</p></body>"
    )
    monkeypatch.setattr(
        reader,
        "_get",
        lambda url, _: (
            (404, {}, "")
            if url.endswith("robots.txt")
            else (200, {"content-type": "text/html"}, body)
        ),
    )
    page = reader.fetch("https://example.org/", time.monotonic() + 60)
    assert page.text == "공개 제품 볼트\n자동차용 부품을 생산합니다."


@pytest.mark.parametrize(
    "head",
    [
        "<head><title>가상 회사</title>",
        "<HEAD><TITLE>가상 회사</TITLE>",
        "<head><title>가상 회사</title><script>loadCompany()</script><style>css</style>",
    ],
)
def test_body_start_reads_text_when_head_end_is_omitted(monkeypatch, head):
    body = head + "<BODY><p>공개 제품 볼트를 생산합니다.</p></BODY>"
    monkeypatch.setattr(
        reader,
        "_get",
        lambda url, _: (
            (404, {}, "")
            if url.endswith("robots.txt")
            else (200, {"content-type": "text/html"}, body)
        ),
    )
    page = reader.fetch("https://example.org/", time.monotonic() + 60)
    assert page.text == "공개 제품 볼트를 생산합니다."


@pytest.mark.parametrize("hidden", ["template", "noframes", "noscript"])
def test_body_inside_hidden_block_does_not_end_head(monkeypatch, hidden):
    body = (
        "<head><title>가상 회사</title>"
        f"<{hidden}></head><body>숨길 안내</body></{hidden}>"
        "머리말 잡문<body><p>공개 제품 볼트를 생산합니다.</p></body>"
    )
    monkeypatch.setattr(
        reader,
        "_get",
        lambda url, _: (
            (404, {}, "")
            if url.endswith("robots.txt")
            else (200, {"content-type": "text/html"}, body)
        ),
    )
    page = reader.fetch("https://example.org/", time.monotonic() + 60)
    assert page.text == "공개 제품 볼트를 생산합니다."


def test_html_reader_checks_robots_and_discards_scripts(monkeypatch):
    calls = []

    def get(url, _):
        calls.append(url)
        if url.endswith("robots.txt"):
            return 200, {}, "User-agent: *\nDisallow: /private"
        return (
            200,
            {"content-type": "text/html"},
            "<div>공개 제품 <b>볼트</b></div><script>비공개명령</script>",
        )

    monkeypatch.setattr(reader, "_get", get)
    page = reader.fetch("https://example.org/", time.monotonic() + 60)
    assert page.text == "공개 제품 볼트"
    assert calls == ["https://example.org/robots.txt", "https://example.org/"]


@pytest.mark.parametrize(
    "status,robots", [(200, "User-agent: *\nDisallow: /"), (403, ""), (503, "")]
)
def test_robots_denial_never_reads_body(monkeypatch, status, robots):
    calls = []

    def get(url, _):
        calls.append(url)
        return status, {}, robots

    monkeypatch.setattr(reader, "_get", get)
    with pytest.raises(AppError, match="자동으로"):
        reader.fetch("https://example.org/", time.monotonic() + 60)
    assert all(url.endswith("robots.txt") for url in calls)


@pytest.mark.parametrize(
    "body,headers",
    [
        ('<meta name="robots" content="noai"><p>본문</p>', {}),
        ('<head><meta name="robots" content="noai"></head><body>본문</body>', {}),
        ('<head><meta name="robots" content="noai"><body>본문</body>', {}),
        ("공개 자료 자동 수집 금지", {}),
        ("본문", {"x-robots-tag": "noai"}),
    ],
)
def test_terms_restriction_requests_paste(monkeypatch, body, headers):
    monkeypatch.setattr(
        reader,
        "_get",
        lambda url, _: (
            (404, {}, "")
            if url.endswith("robots.txt")
            else (200, {"content-type": "text/html", **headers}, body)
        ),
    )
    with pytest.raises(AppError) as error:
        reader.fetch("https://example.org/", time.monotonic() + 60)
    assert error.value.kind == "TERMS_DISALLOW" and "붙여넣어" in error.value.next_action


@pytest.mark.parametrize(
    "url",
    [
        "file:///secret",
        "https://user:password@example.org/",
        "https://example.org:1234/",
        "https://example.org/\nsecret",
    ],
)
def test_invalid_urls_rejected(url):
    with pytest.raises(AppError):
        reader.validate_url(url)


@pytest.mark.parametrize(
    "address", ["127.0.0.1", "10.0.0.1", "169.254.169.254", "::1", "::ffff:127.0.0.1"]
)
def test_private_network_addresses_are_never_connected(monkeypatch, address):
    monkeypatch.setattr(
        socket, "getaddrinfo", lambda *_args, **_kwargs: [(None, None, None, None, (address, 443))]
    )
    with pytest.raises(OSError):
        reader._public_address("test.invalid", 443)


def test_local_http_reads_utf8_and_identifies_itself(monkeypatch):
    seen = []

    class Handler(BaseHTTPRequestHandler):
        def do_GET(self):
            seen.append((self.path, self.headers.get("User-Agent")))
            body = "<p>공개 제품 볼트</p>".encode()
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def log_message(self, *_):
            pass

    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    thread = Thread(target=server.serve_forever, daemon=True)
    thread.start()
    connect = socket.create_connection
    monkeypatch.setattr(reader, "_public_address", lambda *_: "93.184.215.14")

    def local(address, timeout):
        assert address == ("93.184.215.14", 80)
        return connect(server.server_address, timeout=timeout)

    monkeypatch.setattr(socket, "create_connection", local)
    try:
        status, _, body = reader._get("http://example.org/products", time.monotonic() + 60)
        assert status == 200 and "볼트" in body
        assert seen == [("/products", reader.AGENT)]
    finally:
        server.shutdown()
        server.server_close()
        thread.join()


def test_deadline_prevents_reading():
    with pytest.raises(AppError, match="60초"):
        reader.remaining(time.monotonic() - 1)


@pytest.mark.parametrize("prefix", ["", "abc", "03100", "０３１", 31])
def test_phone_settings_reject_invalid_prefixes(prefix):
    with pytest.raises(ValidationError):
        MainPhoneSettings(allowed_prefixes=[prefix])


def test_first_allowed_phone_and_scrub_all_contacts():
    first = "041" + "-123-4567"
    text = (
        f"대표전화 {first} / 02-123-4567\n담당자 031-123-4567\n"
        "01012345678\nx@example.invalid\n1588-1234"
    )
    assert extract_main_phone(text, "https://example.org", ["02", "031", "041"])[0] == first
    clean, count = scrub_contacts(text)
    assert count == 6 and "4567" not in clean and "@" not in clean
    assert extract_main_phone("담당자 031-123-4567", "url", ["031"])[0] is None
    assert extract_main_phone("010-1234-5678", "url", ["010"])[0] is None


def test_person_named_landline_is_not_company_phone():
    assert extract_main_phone("홍길동 031-123-4567", "url", ["031"])[0] is None


def test_redirect_checks_destination_robots(monkeypatch):
    calls = []

    def get(url, _):
        calls.append(url)
        if url == "https://example.org/robots.txt":
            return 404, {}, ""
        if url == "https://example.org/":
            return 302, {"location": "https://example.com/private"}, ""
        return 200, {}, "User-agent: *\nDisallow: /private"

    monkeypatch.setattr(reader, "_get", get)
    with pytest.raises(AppError) as error:
        reader.fetch("https://example.org/", time.monotonic() + 60)
    assert error.value.kind == "ROBOTS_DISALLOW"
    assert calls[-1] == "https://example.com/robots.txt"


@pytest.mark.parametrize(
    "response",
    [
        (200, {"content-type": "application/pdf"}, "pdf"),
        (200, {"content-type": "text/html"}, "<script>script only</script>"),
        (500, {}, ""),
    ],
)
def test_unreadable_body_is_failure_not_empty_success(monkeypatch, response):
    monkeypatch.setattr(
        reader, "_get", lambda url, _: (404, {}, "") if url.endswith("robots.txt") else response
    )
    with pytest.raises(AppError) as error:
        reader.fetch("https://example.org/", time.monotonic() + 60)
    assert error.value.kind == "UNREACHABLE"
