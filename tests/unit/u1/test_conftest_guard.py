"""공통 픽스처 `no_network` 회귀 테스트 (이슈 #33).

바깥 주소 연결은 막고, 내 컴퓨터 안(loopback) 연결은 허용해야 한다. 윈도우에서 asyncio·
TestClient가 내부 준비에 127.0.0.1을 쓰기 때문이다.
"""

from __future__ import annotations

import socket

import pytest

from tests.conftest import is_loopback_address


def test_outside_connection_is_blocked() -> None:
    """바깥 주소로 연결하면 네트워크를 건드리지 않고 바로 실패한다(NFR4.3)."""
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        with pytest.raises(RuntimeError, match="네트워크 연결을 시도"):
            sock.connect(("203.0.113.1", 80))  # 문서용 예약 주소(RFC 5737), 실제로 열리지 않음


def test_loopback_connection_is_allowed() -> None:
    """127.0.0.1로 여는 연결은 허용된다(윈도우 API 테스트 준비에 필요)."""
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as server:
        server.bind(("127.0.0.1", 0))
        server.listen(1)
        port = server.getsockname()[1]
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as client:
            client.connect(("127.0.0.1", port))
            conn, _ = server.accept()
            conn.close()


def test_socketpair_still_works() -> None:
    """asyncio가 내부에서 쓰는 소켓 쌍이 만들어진다(윈도우에서는 loopback 연결로 흉내 냄)."""
    left, right = socket.socketpair()
    left.close()
    right.close()


@pytest.mark.parametrize(
    ("address", "expected"),
    [
        (("127.0.0.1", 8000), True),
        (("::1", 8000, 0, 0), True),
        (("localhost", 1), True),
        (("203.0.113.1", 80), False),
        (("example.com", 443), False),
        ("/tmp/some.sock", False),
    ],
)
def test_is_loopback_address(address: object, expected: bool) -> None:
    assert is_loopback_address(address) is expected
