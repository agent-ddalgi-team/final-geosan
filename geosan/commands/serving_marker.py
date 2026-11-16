"""서버 실행 중 표식 파일 (계약 C8 `restore`의 "서버가 멈춘 상태에서만 허용", #214).

`geosan serve`가 서버를 띄우는 동안 DB 파일 옆에 `<DB 이름>.serving`을 두고(안에 pid·포트·시작
시각), 끝나면 지운다. `geosan restore`는 이 파일의 pid가 살아 있으면 복원을 거부한다. pid가
죽어 있으면(강제 종료 등) 오래된 표식으로 보고 지운 뒤 진행한다.

포트를 찔러 보는 방식은 다른 프로그램이 같은 포트를 쓸 때 헷갈리므로 쓰지 않는다. Windows에서는
`os.kill(pid, 0)`이 프로세스를 죽이므로 쓰지 않고 OpenProcess로 살아 있는지만 본다.

#736: 배포 서버(컨테이너)에서는 서버가 pid 1이라 표식에 pid 1이 적힌다. 컨테이너를 다시 띄우면
새 pid 1(예: 점검용 `sleep`)이 늘 살아 있어 남은 표식이 복원을 영구히 막았다. 그래서 표식의 pid가
1이면 리눅스 `/proc/1/cmdline`으로 지금 pid 1이 `geosan serve`인지 한 번 더 본다. 명령줄을 읽을
수 없으면(리눅스가 아니거나 권한 없음) 지금처럼 켜져 있다고 본다(안전한 쪽).
"""

from __future__ import annotations

import json
import os
import sys
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

MARKER_SUFFIX = ".serving"
PROC_ROOT = Path("/proc")
"""리눅스 프로세스 정보 폴더. 테스트에서 바꿔 끼운다."""
CONTAINER_INIT_PID = 1


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


def process_command_line(pid: int) -> list[str] | None:
    """그 pid의 명령줄(인자 목록). 리눅스 `/proc`에서만 읽고, 읽을 수 없으면 None(모름)."""
    try:
        raw = (PROC_ROOT / str(pid) / "cmdline").read_bytes()
    except OSError:
        return None
    parts = [part.decode("utf-8", errors="replace") for part in raw.split(b"\0") if part]
    return parts or None


def looks_like_geosan_serve(argv: list[str]) -> bool:
    """명령줄이 `geosan serve`일 수 있는가(콘솔 명령, `python -m geosan serve`, 그것을 부르는 셸).

    셸 한 줄(`/bin/sh -c "geosan init-db && exec geosan serve …"`)도 낱말로 나눠 본다. 곧 서버가
    될 셸을 오래된 표식으로 오해하지 않기 위해서다(헷갈리면 켜져 있는 쪽으로 본다).
    """
    words = [word for arg in argv for word in arg.split()]
    for index, word in enumerate(words):
        if Path(word).name in ("geosan", "geosan.exe") and "serve" in words[index + 1 :]:
            return True
    return False


def _container_pid1_is_other_program(pid: int) -> bool:
    """표식의 pid가 1인데 지금 pid 1이 확실히 geosan serve가 아니면 True. 모르면 False."""
    if pid != CONTAINER_INIT_PID:
        return False
    argv = process_command_line(pid)
    return argv is not None and not looks_like_geosan_serve(argv)


def running_server(db_path: Path) -> dict[str, Any] | None:
    """이 DB로 켜진 서버가 있으면 표식 내용을, 없으면 None. 오래된 표식은 지운다.

    오래된 표식: 그 pid가 죽어 있거나, pid 1인데 지금 pid 1이 geosan serve가 아님(#736).
    """
    data = read_marker(db_path)
    if data is None:
        return None
    pid = data["pid"]
    if pid_alive(pid) and not _container_pid1_is_other_program(pid):
        return data
    remove_marker(db_path)
    return None
