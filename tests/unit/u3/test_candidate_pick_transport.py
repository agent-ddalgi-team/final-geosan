"""고정 HTTPS·요청 형식·응답 상한·시간·연결 정리를 가상 소켓으로 검사한다."""

import json

import pytest

from geosan.opportunity import candidate_pick as pick
from tests.unit.u3.test_complex_transport import FakeResponse, FakeSocket


@pytest.fixture
def wire(monkeypatch):
    class Connection:
        sock = FakeSocket()
        response = FakeResponse(b'{"status":"completed"}')
        closed = False

        def connect(self):
            pass

        def request(self, *args, **kwargs):
            self.request_args = args
            self.request_kwargs = kwargs

        def getresponse(self):
            return self.response

        def close(self):
            self.closed = True

    connection = Connection()
    captured = {}

    def create(host, timeout):
        captured.update(host=host, timeout=timeout)
        return connection

    class Timer:
        def cancel(self):
            captured["cancelled"] = True

    monkeypatch.setattr(pick.http.client, "HTTPSConnection", create)
    monkeypatch.setattr(pick, "interrupt_at", lambda sock, deadline: Timer())
    monkeypatch.setattr(pick.time, "monotonic", lambda: 10)
    return connection, captured


def test_fixed_https_and_no_storage_or_tool_request(wire):
    conn, captured = wire
    payload = {"model": "test", "store": False, "instructions": "가상 지시문", "input": "[]"}
    assert pick._post(payload, "synthetic", 70) == {"status": "completed"}
    assert captured["host"] == "api.openai.com" and captured["timeout"] == 60
    assert conn.request_args == ("POST", "/v1/responses")
    assert json.loads(conn.request_kwargs["body"]) == payload
    assert conn.closed and captured["cancelled"]


@pytest.mark.parametrize("status", [302, 429, 500])
def test_rejection_is_not_followed_or_read(wire, status):
    conn, captured = wire
    conn.response = FakeResponse(b"PRIVATE_REDIRECT", status)
    with pytest.raises(pick._HttpError):
        pick._post({}, "synthetic", 70)
    assert conn.response.body == b"PRIVATE_REDIRECT" and conn.closed and captured["cancelled"]


def test_response_size_limit_closes_connection(wire, monkeypatch):
    conn, captured = wire
    monkeypatch.setattr(pick, "MAX_BYTES", 1)
    with pytest.raises(ValueError):
        pick._post({}, "synthetic", 70)
    assert conn.closed and captured["cancelled"]


def test_response_deadline_closes_connection(wire, monkeypatch):
    conn, captured = wire

    class LateResponse(FakeResponse):
        def read1(self, size):
            monkeypatch.setattr(pick.time, "monotonic", lambda: 71)
            return b"{}"

    conn.response = LateResponse()
    with pytest.raises(TimeoutError):
        pick._post({}, "synthetic", 70)
    assert conn.closed and captured["cancelled"]
