"""공통 픽스처 (단위 테스트 지침 1장).

- `no_network`(autouse): 소켓 연결을 막아 외부 호출이 생기면 테스트가 실패한다(NFR4.3).
- `base_date`: 고정 기준일 2026-10-20(A정밀 파일 baseDate). 현재 시각에 의존하는 테스트를
  두지 않는다(NFR12).
- `fixed_today`(autouse): 평가 기준일을 안 주면 쓰는 "오늘"(`today_in_seoul`)을 같은 날짜로
  고정한다. 예시 공고 마감(2026-11-10)이 실제 날짜에 가까워지면 시점 점수가 내려가 검사가
  달력에 따라 깨졌기 때문(2026-11-05, #280).
- `examples_dir`와 예시 파일 경로 픽스처: `examples/`를 그대로 쓴다.
- `tmp_db`: 임시 폴더의 SQLite 파일에 init-db(마이그레이션)를 적용하고 GEOSAN_DB_PATH로 넣는다.
  앱 설정 사본은 가상 묶음(`examples/app-settings-virtual.yaml`, VIRTUAL_REVIEWED)으로 미리 만든다.
  예시 기본 파일(`examples/app-settings.yaml`)은 시연용 BROCHURE라서(이슈 #91) 가상 사례 흐름이
  그 값에 기대면 안 된다.
- `bare_db`: 앱 설정 사본 없이 init-db만 적용한 DB. 사본이 없을 때의 대체 동작을 검사할 때만 쓴다.
- `client`: FastAPI TestClient. Step 20에서 `geosan.api.app`이 생기면 켠다(지금은 건너뜀).
"""

from __future__ import annotations

import importlib
import socket
from collections.abc import Iterator
from datetime import date
from pathlib import Path

import pytest

# "오늘"(`today_in_seoul`)을 이름으로 가져다 쓰는 모듈은 `fixed_today`가 바꾸기 전에 먼저 읽어 둔다.
# 그러지 않으면 테스트 파일을 일부만 골라 돌릴 때(묶음별 실행 포함) 읽는 순서에 따라 그 모듈이
# 고정된 날짜를 쓰기도 하고 실제 날짜를 쓰기도 해서, 같은 테스트의 결과가 달라진다(2026-11-14 확인).
# 전체를 한 번에 돌릴 때와 같은 동작(그 모듈은 실제 날짜)을 어떤 순서로 돌려도 지키게 한다.
for _module in ("geosan.api.routes.records", "geosan.commands.review_set"):
    importlib.import_module(_module)

ROOT_DIR = Path(__file__).resolve().parent.parent
EXAMPLES_DIR = ROOT_DIR / "examples"
VIRTUAL_APP_SETTINGS_PATH = EXAMPLES_DIR / "app-settings-virtual.yaml"
BASE_DATE = date(2026, 10, 20)


LOOPBACK_HOSTS = frozenset({"127.0.0.1", "::1", "localhost"})


def is_loopback_address(address: object) -> bool:
    """내 컴퓨터 안(loopback) 주소인가. 윈도우의 asyncio·TestClient가 준비에 127.0.0.1을 쓴다."""
    if isinstance(address, tuple) and address:
        host = address[0]
        return isinstance(host, str) and host.strip("[]") in LOOPBACK_HOSTS
    return False


@pytest.fixture(autouse=True)
def no_network(monkeypatch: pytest.MonkeyPatch) -> None:
    """테스트 중 바깥으로 나가는 소켓 연결을 막는다. 생기면 실패(가짜로 대체하지 않고 제거한다).

    내 컴퓨터 안(127.0.0.1·::1·localhost) 연결만 허용한다. 윈도우에서는 asyncio가 내부 준비에
    127.0.0.1 소켓 쌍을 쓰므로 이것까지 막으면 API 테스트(TestClient)가 시작되지 않는다
    (2026-10-22, 이슈 #33). 바깥 주소는 전과 같이 막는다.
    """
    real_connect = socket.socket.connect
    real_connect_ex = socket.socket.connect_ex

    def _guarded_connect(self: socket.socket, address: object) -> None:
        if is_loopback_address(address):
            return real_connect(self, address)
        raise RuntimeError(f"테스트에서 네트워크 연결을 시도했습니다: {address!r} (NFR4.3)")

    def _guarded_connect_ex(self: socket.socket, address: object) -> int:
        if is_loopback_address(address):
            return real_connect_ex(self, address)
        raise RuntimeError(f"테스트에서 네트워크 연결을 시도했습니다: {address!r} (NFR4.3)")

    monkeypatch.setattr(socket.socket, "connect", _guarded_connect)
    monkeypatch.setattr(socket.socket, "connect_ex", _guarded_connect_ex)


@pytest.fixture
def base_date() -> date:
    return BASE_DATE


@pytest.fixture(autouse=True)
def fixed_today(monkeypatch: pytest.MonkeyPatch) -> None:
    """평가의 "오늘"을 BASE_DATE로 고정한다(NFR12, #280). 기준일을 직접 넣으면 그 값을 쓴다."""
    from geosan.workflows import flow_evaluate

    monkeypatch.setattr(flow_evaluate, "today_in_seoul", lambda: BASE_DATE)


@pytest.fixture
def examples_dir() -> Path:
    return EXAMPLES_DIR


@pytest.fixture
def rule_config_path(examples_dir: Path) -> Path:
    return examples_dir / "rule-config.yaml"


@pytest.fixture
def app_settings_path(examples_dir: Path) -> Path:
    return examples_dir / "app-settings.yaml"


@pytest.fixture
def capability_file_path(examples_dir: Path) -> Path:
    return examples_dir / "capability-geosan.json"


@pytest.fixture
def apjeong_case_path(examples_dir: Path) -> Path:
    return examples_dir / "case-apjeong.json"


@pytest.fixture
def bare_db(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Iterator[Path]:
    """테스트마다 새 SQLite 파일에 init-db(마이그레이션)만 적용하고 GEOSAN_DB_PATH로 넣는다.

    앱 설정 사본은 만들지 않는다. 사본이 없을 때의 대체 동작(예시 파일을 읽어 사본을 만듦)을
    검사하는 테스트만 쓴다. 메모리 DB를 쓰지 않는다(WAL·파일 동작을 그대로 검사). 끝나면 엔진
    캐시를 비운다.
    """
    from geosan.storage.engine import dispose_engines
    from geosan.storage.init_db import init_db

    db_path = tmp_path / "geosan-test.db"
    monkeypatch.setenv("GEOSAN_DB_PATH", str(db_path))
    dispose_engines()
    init_db(db_path)
    try:
        yield db_path
    finally:
        dispose_engines()


@pytest.fixture
def tmp_db(bare_db: Path) -> Path:
    """`bare_db`에 가상 묶음 앱 설정 사본(`examples/app-settings-virtual.yaml`)을 미리 만든 DB.

    실제 실행 순서(init-db → check-config → import …)와 같다. 예시 기본 파일은 시연용
    BROCHURE이므로(이슈 #91) A정밀 가상 사례 테스트가 기본값에 기대지 않게 한다.
    """
    from geosan.config.app_settings import load_app_settings, sync_app_settings
    from geosan.storage.session import session_scope

    with session_scope(bare_db) as session:
        sync_app_settings(
            session,
            load_app_settings(VIRTUAL_APP_SETTINGS_PATH),
            source_path=VIRTUAL_APP_SETTINGS_PATH,
        )
    return bare_db


def staff_headers(staff_key: str = "park-lee") -> dict[str, str]:
    """기록 요청용 담당자 키 헤더 도우미."""
    return {"X-Staff-Key": staff_key}
