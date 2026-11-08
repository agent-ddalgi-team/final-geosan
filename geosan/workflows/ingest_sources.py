"""#427: PM이 정한 원본 이름 규칙으로 기준일을 읽어 기존 파일 저장 부품에 넘긴다."""

import re
from datetime import date, datetime
from pathlib import Path

from geosan.config.errors import InputError
from geosan.opportunity.factory_store import StoredFactoryCsv, store_factory_csv


class FactoryFileDateError(InputError):
    """원문·경로가 없는 고정 기준일 안내. 회차 실패 사유에도 그대로 보여 줄 수 있다."""


def factory_file_date(path: Path) -> date:
    """파일명 끝 8자리 우선, 없을 때만 바로 위 폴더의 8자리를 쓴다.

    PM #427 답변(2026-11-08). 수정 시각이나 오늘 날짜로 대신하지 않는다.
    이름에 날짜가 있지만 잘못된 날짜면 폴더 값으로 오류를 숨기지 않는다.
    """
    path = Path(path)
    match = re.search(r"(?<![0-9])([0-9]{8})$", path.stem)
    value = match.group(1) if match else None
    if value is None and re.fullmatch(r"[0-9]{8}", path.parent.name):
        value = path.parent.name
    if value is None:
        raise FactoryFileDateError("파일명이나 폴더명에 기준일(YYYYMMDD)이 있어야 합니다.")
    try:
        return datetime.strptime(value, "%Y%m%d").date()
    except ValueError:
        raise FactoryFileDateError(
            "파일명이나 폴더명의 기준일(YYYYMMDD)이 올바른 날짜여야 합니다."
        ) from None


def store_dated_factory_csv(batch_id: str, path: Path) -> StoredFactoryCsv:
    """기준일 확인 뒤에만 원본을 읽고 저장한다. 실패 시 날짜를 추정하거나 재시도하지 않는다."""
    return store_factory_csv(batch_id, path, factory_file_date(path))
