"""C8 #573: 보조 자료(팩토리온 공장조회·수질 명단)를 넣고 목록 회사에 붙인다."""

import logging
from pathlib import Path

import typer
from sqlalchemy.exc import SQLAlchemyError

from geosan.config.app_settings import (
    DEFAULT_APP_SETTINGS_PATH,
    load_app_settings,
    read_app_settings,
)
from geosan.config.errors import AppError, InputError, RunFailedError, exit_code_for
from geosan.opportunity.factory_profile import (
    FACTORYON_SOURCE_ID,
    WATER_SOURCE_ID,
    attach_all,
    file_date_of,
    read_factoryon,
    read_water,
    store_profiles,
    store_water,
    stored_regions,
)
from geosan.storage.engine import database_path
from geosan.storage.session import session_scope

logger = logging.getLogger(__name__)


def _file_date(source_id: str, files: list[Path]):
    if not files:
        raise InputError("불러올 파일을 하나 이상 넣어 주세요.")
    if source_id == WATER_SOURCE_ID and len(files) != 1:
        raise InputError("수질 명단은 CSV 파일 하나만 넣어 주세요.")
    missing = [path.name for path in files if not path.is_file()]
    if missing:
        raise InputError(f"파일이 없습니다: {', '.join(missing)}")
    dates = {file_date_of(path) for path in files}
    if len(dates) != 1:
        raise InputError(
            "파일들의 기준일이 서로 다릅니다.", "같은 날 내려받은 파일끼리 함께 넣어 주세요."
        )
    return dates.pop()


def run_source_load(source_id: str, files: list[Path], *, echo=typer.echo) -> int:
    try:
        if source_id not in (FACTORYON_SOURCE_ID, WATER_SOURCE_ID):
            raise InputError(f"소스는 {FACTORYON_SOURCE_ID} 또는 {WATER_SOURCE_ID}를 넣어 주세요.")
        file_date = _file_date(source_id, files)
        if not database_path().is_file():
            raise InputError("데이터베이스가 없습니다. 먼저 geosan init-db를 실행해 주세요.")
        with session_scope() as session:
            settings = read_app_settings(session) or load_app_settings(DEFAULT_APP_SETTINGS_PATH)
        regions = stored_regions(settings)
        # 파일 읽기는 저장 잠금 밖에서 한다(C5).
        if source_id == FACTORYON_SOURCE_ID:
            result = read_factoryon(files, regions)
        else:
            result = read_water(files[0], regions)
        with session_scope() as session:
            session.connection().exec_driver_sql("BEGIN IMMEDIATE")
            store = store_profiles if source_id == FACTORYON_SOURCE_ID else store_water
            stored = store(session, result.rows, file_date)
            attached = attach_all(session, settings)
        echo(
            f"{file_date.isoformat()} 기준 {result.raw_count}행을 읽어 {stored}행을 저장했습니다"
            f"(지역 밖 제외, 건너뛴 행 {result.skipped_count})."
        )
        echo(
            f"공장 정보가 붙은 회사 {attached.attached}곳 · 표면처리 표시 새로 붙음 "
            f"{attached.flagged}곳 · 풀림 {attached.unflagged}곳"
        )
        return 0
    except Exception as exc:
        if isinstance(exc, AppError):
            error = exc
        else:
            if not isinstance(exc, SQLAlchemyError):
                logger.exception("보조 자료 불러오기 중 예상하지 못한 오류")
            error = RunFailedError(
                "보조 자료를 저장하지 못했습니다. 변경을 되돌렸습니다.",
                next_action="geosan init-db로 DB 상태를 확인해 주세요.",
            )
        logger.error("보조 자료 불러오기 실패: ref=%s type=%s", error.ref, type(exc).__name__)
        echo(f"{error.message} {error.next_action} (문의 번호: {error.ref})")
        return exit_code_for(error)
