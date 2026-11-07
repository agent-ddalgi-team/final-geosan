"""서버 실행 중 표식 파일 (계약 C8 `restore`의 "서버가 멈춘 상태에서만 허용", #214).

`geosan serve`가 서버를 띄우는 동안 DB 파일 옆에 `<DB 이름>.serving`을 두고(안에 pid·포트·시작
시각), 끝나면 지운다. `geosan restore`는 이 파일의 pid가 살아 있으면 복원을 거부한다. pid가
죽어 있으면(강제 종료 등) 오래된 표식으로 보고 지운 뒤 진행한다.

포트를 찔러 보는 방식은 다른 프로그램이 같은 포트를 쓸 때 헷갈리므로 쓰지 않는다. Windows에서는
`os.kill(pid, 0)`이 프로세스를 죽이므로 쓰지 않고 OpenProcess로 살아 있는지만 본다.
"""

from __future__ import annotations

import json
import os
import sys
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

MARKER_SUFFIX = ".serving"


def marker_path(db_path: Path) -> Path:
    """DB 파일 옆 표식 파일 경로. 예: data/geosan.db → data/geosan.db.serving"""
    return db_path.with_name(db_path.name + MARKER_SUFFIX)


def write_marker(db_path: Path, port: int, host: str) -> Path:
    """표식을 쓴다. 폴더가 없으면 만든다."""
    path = marker_path(db_path)
    path.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        "pid": os.getpid(),
        "port": port,
        "host": host,
        "startedAt": datetime.now(UTC).isoformat(timespec="seconds"),
    }
    path.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")
    return path


def remove_marker(db_path: Path) -> None:
    marker_path(db_path).unlink(missing_ok=True)


def read_marker(db_path: Path) -> dict[str, Any] | None:
    """표식 내용. 없거나 읽을 수 없는 모양이면 None."""
    path = marker_path(db_path)
    if not path.exists():
        return None
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None
    if not isinstance(data, dict) or not isinstance(data.get("pid"), int):
        return None
    return data


def pid_alive(pid: int) -> bool:
    """그 pid의 프로세스가 지금 살아 있는지. 권한이 없어 확인 못 하면 살아 있다고 본다."""
    if pid <= 0:
        return False
    if sys.platform == "win32":  # pragma: no cover - Windows에서만 실행
        import ctypes

        process_query_limited_information = 0x1000
        still_active = 259
        kernel32 = ctypes.windll.kernel32  # type: ignore[attr-defined]
        handle = kernel32.OpenProcess(process_query_limited_information, False, pid)
        if not handle:
            return False
        try:
            exit_code = ctypes.c_ulong()
            if not kernel32.GetExitCodeProcess(handle, ctypes.byref(exit_code)):
                return True
            return exit_code.value == still_active
        finally:
            kernel32.CloseHandle(handle)
    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        return False
    except PermissionError:
        return True
    return True


def running_server(db_path: Path) -> dict[str, Any] | None:
    """이 DB로 켜진 서버가 있으면 표식 내용을, 없으면 None. 죽은 pid의 표식은 지운다."""
    data = read_marker(db_path)
    if data is None:
        return None
    if pid_alive(data["pid"]):
        return data
    remove_marker(db_path)
    return None
