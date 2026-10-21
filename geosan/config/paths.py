"""명령 인자로 받는 파일 경로 정규화 (보안 설계 7장 '파일 경로 탈출').

절대 경로로 정규화하고, 경로에 `..`가 들어 있거나 심볼릭 링크를 거치면 거부한다.
모든 명령(check-case·import-*·check-config·verify-case)이 같은 함수를 쓴다.
"""

from __future__ import annotations

from pathlib import Path

from geosan.config.errors import InputError


def normalize_input_path(raw: Path | str, must_exist: bool = True) -> Path:
    """사용자가 준 경로를 안전한 절대 경로로 바꾼다. 거부 사유는 쉬운 말로."""
    given = Path(raw)
    if ".." in given.parts:
        raise InputError(
            message=f"경로에 '..'(상위 폴더)가 들어 있어 받지 않습니다: {given}",
            next_action="저장소 안의 파일을 전체 경로나 저장소 기준 경로로 적어 주세요.",
        )
    absolute = given if given.is_absolute() else Path.cwd() / given
    if must_exist and not absolute.exists():
        raise InputError(
            message=f"파일을 찾을 수 없습니다: {absolute}",
            next_action="경로와 파일 이름을 확인해 주세요.",
        )
    if absolute.exists():
        # 파일 자체가 심볼릭 링크면 거부한다.
        # (상위 폴더의 링크, 예: macOS /tmp → /private/tmp는 허용)
        if absolute.is_symlink():
            raise InputError(
                message=f"심볼릭 링크 파일은 받지 않습니다: {absolute}",
                next_action="실제 파일 경로를 적어 주세요.",
            )
        if absolute.is_dir():
            raise InputError(
                message=f"폴더가 아니라 파일을 적어 주세요: {absolute}",
                next_action="파일 이름까지 포함한 경로를 적어 주세요.",
            )
    return absolute.resolve()
