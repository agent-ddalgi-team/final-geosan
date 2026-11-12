"""공식 HTTPS 요청 모양·응답 크기·시간·연결 해제를 가상 소켓으로 검사한다(#404)."""

from urllib.parse import parse_qs, urlsplit

import pytest

from geosan.opportunity import complex_source as source
from geosan.opportunity.complex_rows import ComplexSourceError


class FakeSocket:
    def __init__(self):
        self.timeouts = []

    def settimeout(self, seconds):
        self.timeouts.append(seconds)


class FakeResponse:
    def __init__(self, body=b"<response/>", status=200):
        self.status = status
        self.body = body

    def read1(self, size):
        result, self.body = self.body[:size], self.body[size:]
        return result


class FakeConnection:
    def __init__(self, response):
        self.sock = FakeSocket()
        self.response = response
        self.calls = []
        self.closed = False

    def connect(self):
        self.calls.append("connect")

    def request(self, method, path, headers):
        self.calls.append((method, path, headers))

    def getresponse(self):
        return self.response

    def close(self):
        self.closed = True


@pytest.fixture
def wire(monkeypatch):
    connection = FakeConnection(FakeResponse())
    captured = {}

    def connect(host, timeout):
        captured.update(host=host, timeout=timeout)
        return connection

    class Timer:
        def cancel(self):
            captured["cancelled"] = True

    def interrupt(sock, deadline):
        captured.update(sock=sock, deadline=deadline)
        return Timer()

    monkeypatch.setattr(source.http.client, "HTTPSConnection", connect)
    monkeypatch.setattr(source, "interrupt_at", interrupt)
    return connection, captured


@pytest.mark.parametrize("key", ["synthetic+/=", "synthetic%2B%2F%3D"])
def test_fixed_https_get_encodes_key_and_query_once(wire, key):
    connection, captured = wire
    result = source._request_page("가상단지 & 제2", key, 3)
    assert result == b"<response/>"
    assert (captured["host"], captured["timeout"]) == ("apis.data.go.kr", 30)
    method, path, headers = connection.calls[1]
    assert method == "GET" and headers == {"Accept": "application/xml"}
    assert urlsplit(path).path == "/B550624/fctryRegistInfo/getFctryListInIrsttService_v2"
    assert parse_qs(urlsplit(path).query) == {
        "serviceKey": ["synthetic+/="],
        "irsttNm": ["가상단지 & 제2"],
        "pageNo": ["3"],
        "numOfRows": ["1000"],
        "type": ["XML"],
    }
    assert connection.closed and captured["cancelled"]
    assert all(0 < value <= 30 for value in connection.sock.timeouts)


@pytest.mark.parametrize("status", [301, 302, 307, 403, 429, 500])
def test_http_error_is_closed_without_reading_redirect_body(wire, status):
    connection, captured = wire
    connection.response = FakeResponse(b"PRIVATE_REDIRECT_BODY", status)
    with pytest.raises(source._HttpError) as error:
        source._request_page("가상단지", "synthetic", 1)
    assert error.value.status == status
    assert connection.response.body == b"PRIVATE_REDIRECT_BODY"
    assert connection.closed and captured["cancelled"]
    assert len(connection.calls) == 2


def test_company_lookup_uses_official_company_parameter_and_no_private_fields(wire):
    connection, captured = wire
    source._request_page("가상볼트 & 공장", "synthetic%2B%2F%3D", 2, company_lookup=True)
    _, path, _ = connection.calls[1]
    assert urlsplit(path).path == "/B550624/fctryRegistInfo/getFctryPrdctnService_v2"
    assert parse_qs(urlsplit(path).query) == {
        "serviceKey": ["synthetic+/="],
        "cmpnyNm": ["가상볼트 & 공장"],
        "pageNo": ["2"],
        "numOfRows": ["1000"],
        "type": ["XML"],
    }
    assert captured["host"] == "apis.data.go.kr" and connection.closed


def test_body_size_limit_is_not_silently_truncated(wire, monkeypatch):
    connection, captured = wire
    monkeypatch.setattr(source, "MAX_BYTES", 8)
    connection.response = FakeResponse(b"123456789")
    with pytest.raises(ComplexSourceError):
        source._request_page("가상단지", "synthetic", 1)
    assert connection.closed and captured["cancelled"]


def test_slow_chunks_share_one_deadline(wire, monkeypatch):
    connection, captured = wire
    clock = [0.0]
    monkeypatch.setattr(source.time, "monotonic", lambda: clock[0])

    def read(size):
        clock[0] += 16
        return b"x"

    connection.response.read1 = read
    with pytest.raises(TimeoutError):
        source._request_page("가상단지", "synthetic", 1)
    assert clock[0] == 32 and captured["deadline"] == 30
    assert connection.closed and captured["cancelled"]


def test_connect_failure_closes_connection_without_starting_timer(wire):
    connection, captured = wire

    def fail():
        raise OSError("PRIVATE_KEY_MARKER")

    connection.connect = fail
    with pytest.raises(OSError):
        source._request_page("가상단지", "synthetic", 1)
    assert connection.closed and "deadline" not in captured
