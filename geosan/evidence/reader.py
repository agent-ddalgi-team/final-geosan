"""robots와 공개 주소를 검사하는 홈페이지 읽기. 요청 본문·쿠키·인증은 보내지 않는다."""

from __future__ import annotations

import http.client
import ipaddress
import re
import socket
import ssl
import time
from dataclasses import dataclass
from html.parser import HTMLParser
from threading import Timer
from urllib.parse import urljoin, urlsplit, urlunsplit
from urllib.robotparser import RobotFileParser

import certifi

from geosan.config.errors import AppError
from geosan.evidence.contacts import scrub_contacts

AGENT = "GeosanResearch/1.0"
# 메모리·전송 방어용 크기. 영업 규칙이나 점수 기준이 아니다.
MAX_BYTES = 2 * 1024 * 1024
_DENIAL = re.compile(
    r"noai|noindex|자동\s*(?:수집|크롤링).*금지|(?:scraping|crawling).*prohibited", re.I
)


def remaining(deadline: float) -> float:
    seconds = deadline - time.monotonic()
    if seconds <= 0:
        raise AppError(
            "조사 시간이 60초를 넘었습니다.",
            "잠시 뒤 다시 조사해 주세요.",
            status=503,
            kind="TIMEOUT",
        )
    return seconds


def interrupt_at(sock: socket.socket, deadline: float) -> Timer:
    """본문이 조금씩 오더라도 전체 제한 시각에는 연결을 끊는다."""

    def interrupt():
        try:
            sock.shutdown(socket.SHUT_RDWR)
        except OSError:
            # 정상 종료와 제한 시각이 겹쳐 이미 닫힌 소켓만 무시한다.
            pass

    timer = Timer(remaining(deadline), interrupt)
    timer.daemon = True
    timer.start()
    return timer


def validate_url(url: str) -> str:
    try:
        parts = urlsplit(url)
        if (
            parts.scheme not in ("http", "https")
            or not parts.hostname
            or parts.username
            or parts.password
            or parts.port not in (None, 80, 443)
            or any(char.isspace() or ord(char) < 32 for char in url)
            or "\\" in url
            or scrub_contacts(url)[1]
        ):
            raise ValueError
        return urlunsplit((parts.scheme, parts.netloc, parts.path or "/", parts.query, ""))
    except ValueError:
        raise AppError(
            "홈페이지 주소를 확인해 주세요.",
            "공개 홈페이지 주소만 넣어 주세요.",
            status=422,
            kind="UNREACHABLE",
        ) from None


def _public_address(host: str, port: int) -> str:
    addresses = socket.getaddrinfo(host, port, type=socket.SOCK_STREAM)
    if not addresses or any(not ipaddress.ip_address(row[4][0]).is_global for row in addresses):
        raise OSError("공개 주소가 아님")
    return addresses[0][4][0]


def _get(url: str, deadline: float) -> tuple[int, dict[str, str], str]:
    """검사한 IP로 직접 연결해 DNS 재해석과 내부망 리다이렉트를 막는다."""
    parts = urlsplit(validate_url(url))
    host = parts.hostname.encode("idna").decode("ascii")
    port = parts.port or (443 if parts.scheme == "https" else 80)
    address = _public_address(host, port)
    timeout = min(20, remaining(deadline))
    request_deadline = time.monotonic() + timeout
    connection = http.client.HTTPConnection(host, port, timeout=timeout)
    raw = socket.create_connection((address, port), timeout=timeout)
    timer = None
    try:
        connection.sock = (
            # 운영체제 인증서 목록이 오래되면 새 인증 기관을 몰라 실패한다(#556).
            # 확인은 끄지 않고 목록만 certifi로 맞춘다.
            ssl.create_default_context(cafile=certifi.where()).wrap_socket(
                raw, server_hostname=host
            )
            if parts.scheme == "https"
            else raw
        )
        timer = interrupt_at(connection.sock, request_deadline)
        path = urlunsplit(("", "", parts.path, parts.query, ""))
        connection.request(
            "GET", path, headers={"User-Agent": AGENT, "Accept-Encoding": "identity"}
        )
        response = connection.getresponse()
        headers = {key.lower(): value for key, value in response.getheaders()}
        if headers.get("content-encoding", "identity") != "identity":
            raise ValueError("압축 응답을 읽을 수 없음")
        chunks = []
        size = 0
        while True:
            remaining(deadline)
            if connection.sock:
                connection.sock.settimeout(min(20, remaining(deadline)))
            chunk = response.read1(65536)
            remaining(deadline)
            if time.monotonic() >= request_deadline:
                raise TimeoutError("홈페이지 읽기 제한 시간")
            if not chunk:
                break
            chunks.append(chunk)
            size += len(chunk)
            if size > MAX_BYTES:
                raise ValueError("본문이 너무 큼")
        body = b"".join(chunks)
        if response.length:
            raise http.client.IncompleteRead(body)
        return response.status, headers, _decode(response, body)
    finally:
        if timer:
            timer.cancel()
        connection.close()
        raw.close()


def _read(url: str, deadline: float) -> tuple[int, dict[str, str], str]:
    for attempt in range(2):
        try:
            response = _get(url, deadline)
            if response[0] < 500 or attempt:
                return response
        except (OSError, http.client.HTTPException, ValueError, LookupError):
            if attempt:
                break
        remaining(deadline)
    remaining(deadline)
    raise AppError(
        "홈페이지를 읽을 수 없습니다.",
        "공개 본문을 직접 붙여넣어 주세요.",
        status=422,
        kind="UNREACHABLE",
    )


def _read_robots(url: str, deadline: float) -> tuple[int, str]:
    """robots.txt를 읽는다. 표준(RFC 9309)대로 이동은 5번까지 따라간다(#556).

    http→https 이동이나 "없는 페이지" 화면으로 보내는 호스팅이 흔하다. 예전에는 이동을 금지로 읽어
    막지 않은 회사도 "자동으로 읽을 수 없는 홈페이지"가 됐다. 끝까지 이동하면 읽지 않는다.
    """
    for _ in range(6):
        status, headers, body = _read(url, deadline)
        if status not in (301, 302, 303, 307, 308) or not headers.get("location"):
            # "없는 페이지" 화면이 200으로 와도 규칙 줄이 없으니 허용으로 읽힌다.
            # 형식과 상관없이 규칙은 그대로 읽는다.
            return status, body
        url = validate_url(urljoin(url, headers["location"]))
    return 508, ""


def _decode(response: http.client.HTTPResponse, body: bytes) -> str:
    """본문 글자를 푼다. 이동 응답의 본문은 쓰지 않으므로 풀지 않는다(#556)."""
    if 300 <= response.status < 400:
        return ""
    charset = response.headers.get_content_charset()
    if not charset:
        match = re.search(rb"charset\s*=\s*[\"']?([\w-]+)", body[:4096], re.I)
        charset = match[1].decode("ascii") if match else None
    # EUC-KR로 적힌 국내 홈페이지에는 EUC-KR에 없는 글자가 섞이는 일이 흔하다.
    # 그래서 그 확장(CP949)으로 읽는다.
    if charset and charset.lower().replace("_", "-") in ("euc-kr", "ks-c-5601-1987", "ksc5601"):
        charset = "cp949"
    if charset:
        return body.decode(charset, errors="strict")
    try:
        return body.decode("utf-8", errors="strict")
    except UnicodeDecodeError:
        # 글자 방식을 적지 않은 국내 홈페이지. 이것도 아니면 읽기 실패로 안내한다.
        return body.decode("cp949", errors="strict")


def _same_site(url: str, other: str) -> bool:
    def host(value: str) -> str:
        name = (urlsplit(value).hostname or "").lower()
        return name[4:] if name.startswith("www.") else name

    return bool(host(url)) and host(url) == host(other)


class _Text(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.in_head = False
        self.skip = 0
        self.parts: list[str] = []
        self.denied = False
        # 본문이 비어 있는 프레임 화면(옛날 홈페이지)에서 따라갈 안쪽 페이지 주소(#556).
        self.frames: list[str] = []

    def handle_starttag(self, tag, attrs):
        # </head>가 생략돼도 실제 본문은 읽되, 숨김 영역 안의 <body>는 제외한다.
        if not self.skip and tag in ("head", "body"):
            self.in_head = tag == "head"
        # 제목·프레임 대체 안내는 회사 본문이 아니다. 본문이 비면 읽기 실패로 안내한다.
        if tag in ("title", "script", "style", "noscript", "template", "noframes"):
            self.skip += 1
        if tag in ("p", "div", "br", "li", "footer", "header"):
            self.parts.append("\n")
        attrs = dict(attrs)
        if tag in ("frame", "iframe") and (attrs.get("src") or "").strip():
            self.frames.append(attrs["src"].strip())
        if tag == "meta" and attrs.get("name", "").lower() in ("robots", "geosanresearch"):
            self.denied |= bool(_DENIAL.search(attrs.get("content", "")))

    def handle_endtag(self, tag):
        if tag == "head" and not self.skip:
            self.in_head = False
        if tag in ("title", "script", "style", "noscript", "template", "noframes") and self.skip:
            self.skip -= 1
        if tag in ("p", "div", "li", "footer", "header"):
            self.parts.append("\n")

    def handle_data(self, data):
        if not self.in_head and not self.skip:
            self.parts.append(data)


@dataclass(frozen=True)
class Page:
    url: str
    text: str


def fetch(url: str, deadline: float) -> Page:
    """차단 신호·robots 실패는 붙여넣기로 안내하며 원문은 로그에 남기지 않는다."""
    url = validate_url(url)
    for _ in range(6):
        parts = urlsplit(url)
        robots_url = urlunsplit((parts.scheme, parts.netloc, "/robots.txt", "", ""))
        status, robots = _read_robots(robots_url, deadline)
        parser = RobotFileParser()
        parser.parse(robots.splitlines() if status == 200 else [])
        if status not in (200, 404, 410) or (status == 200 and not parser.can_fetch(AGENT, url)):
            raise AppError(
                "자동으로 읽을 수 없는 홈페이지입니다.",
                "이용 조건을 확인하고 공개 본문을 붙여넣어 주세요.",
                status=422,
                kind="ROBOTS_DISALLOW",
            )
        delay = parser.crawl_delay(AGENT)
        rate = parser.request_rate(AGENT)
        if delay or (rate and rate.seconds > rate.requests):
            raise AppError(
                "홈페이지의 읽기 간격을 확인해야 합니다.",
                "공개 본문을 붙여넣어 주세요.",
                status=422,
                kind="ROBOTS_DISALLOW",
            )
        status, headers, body = _read(url, deadline)
        if status in (301, 302, 303, 307, 308) and headers.get("location"):
            url = validate_url(urljoin(url, headers["location"]))
            continue
        if status != 200 or not any(
            kind in headers.get("content-type", "") for kind in ("text/html", "text/plain")
        ):
            break
        parser_html = _Text()
        parser_html.feed(body)
        text = "\n".join(
            line.strip() for line in "".join(parser_html.parts).splitlines() if line.strip()
        )
        if (
            parser_html.denied
            or _DENIAL.search(headers.get("x-robots-tag", ""))
            or _DENIAL.search(text)
        ):
            raise AppError(
                "자동 수집을 제한한 홈페이지입니다.",
                "이용 조건을 확인하고 공개 본문을 붙여넣어 주세요.",
                status=422,
                kind="TERMS_DISALLOW",
            )
        if text:
            return Page(url, text)
        # 프레임 화면은 첫 화면에 글이 없다.
        # 같은 사이트의 첫 프레임 페이지를 robots 검사부터 다시 읽는다.
        frame = next(
            (
                urljoin(url, src)
                for src in parser_html.frames
                if _same_site(url, urljoin(url, src)) and urljoin(url, src).split("#")[0] != url
            ),
            None,
        )
        if frame:
            try:
                url = validate_url(frame)
            except AppError:
                break
            continue
        break
    raise AppError(
        "홈페이지 본문을 읽을 수 없습니다.",
        "공개 본문을 붙여넣어 주세요.",
        status=422,
        kind="UNREACHABLE",
    )
