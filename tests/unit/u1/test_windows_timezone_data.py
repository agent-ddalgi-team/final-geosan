"""Windows에서도 서울 시간대를 읽을 수 있게 시간대 자료를 의존성에 적어 둔다 (#655).

Windows에는 운영체제 시간대 자료가 없어 `ZoneInfo("Asia/Seoul")`가 실패하고 서버 시작이 멈춘다.
파이썬 공식 문서가 권하는 대로 `tzdata`를 Windows에서만 설치하게 적었는지 확인한다.
"""

from pathlib import Path
from zoneinfo import ZoneInfo

ROOT = Path(__file__).resolve().parents[3]


def test_seoul_timezone_can_be_read_here():
    """Given 설치된 환경 / When 서울 시간대를 읽으면 / Then 오류 없이 읽힌다."""
    assert ZoneInfo("Asia/Seoul").key == "Asia/Seoul"


def test_pyproject_declares_tzdata_for_windows_only():
    """Given 의존성 파일 / When tzdata 줄을 찾으면 / Then Windows에서만 설치하게 적혀 있다."""
    lines = [
        line.strip()
        for line in (ROOT / "pyproject.toml").read_text(encoding="utf-8").splitlines()
        if line.strip().startswith('"tzdata')
    ]
    assert len(lines) == 1, lines
    assert "sys_platform == 'win32'" in lines[0]


def test_lock_file_pins_tzdata_for_windows_only():
    """Given 잠금 파일 / When tzdata 줄을 찾으면 / Then 버전이 고정돼 있고 Windows 조건이 붙는다."""
    lines = [
        line
        for line in (ROOT / "requirements.lock").read_text(encoding="utf-8").splitlines()
        if line.startswith("tzdata==")
    ]
    assert len(lines) == 1, lines
    assert "sys_platform == 'win32'" in lines[0]


def test_lock_file_has_no_personal_path():
    """Given 잠금 파일 / When 머리말을 보면 / Then 개인 PC 절대경로가 없다."""
    assert "/Users/" not in (ROOT / "requirements.lock").read_text(encoding="utf-8")
