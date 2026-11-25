"""C8 #932 `geosan customer-load`: 검증된 기존 고객 파일을 통째로 바꿔 넣는다(확장 기능).

AI·외부 전송은 하지 않는다. 넣어도 설정 `existingCustomers.enabled`가 꺼져 있으면 아무 곳에도
쓰이지 않는다(요약 끝에 알린다). 단가·담당자·전화 같은 칸은 읽지 않고 버린다.
"""

import logging
from datetime import datetime
from pathlib import Path

import typer
from sqlalchemy.exc import SQLAlchemyError

from geosan.api.process_catalog import load_process_catalog
from geosan.config.app_settings import (
    DEFAULT_APP_SETTINGS_PATH,
    load_app_settings,
    read_app_settings,
)
from geosan.config.errors import AppError, InputError, RunFailedError, exit_code_for
from geosan.dashboard.sales_analysis import process_display_name
from geosan.evidence.transfer import KST
from geosan.opportunity.existing_customers import (
    clear_customers,
    file_date_of,
    read_customer_file,
    store_customers,
)
from geosan.storage.engine import database_path
from geosan.storage.session import session_scope

logger = logging.getLogger(__name__)


def _echo_fields(error: AppError, echo) -> None:
    for item in error.fields[:30]:
        where = f"{item.line}째 줄 " if item.line is not None else ""
        echo(f"  - {where}[{item.path}] {item.message}")
    if len(error.fields) > 30:
        echo(f"  … 그 밖에 {len(error.fields) - 30}군데")


def run_customer_load(
    file: Path | None, *, clear: bool = False, virtual: bool = False, echo=typer.echo
) -> int:
    try:
        if clear == (file is not None):
            raise InputError(
                "파일 하나를 넣거나 --clear 하나만 주세요.",
                "예: geosan customer-load 기존고객_20261126.csv",
            )
        if not database_path().is_file():
            raise InputError("데이터베이스가 없습니다. 먼저 geosan init-db를 실행해 주세요.")
        if clear:
            with session_scope() as session:
                removed = clear_customers(session)
            echo(f"기존 고객 {removed}곳을 모두 지웠습니다.")
            return 0
        if not file.is_file():
            raise InputError(f"파일이 없습니다: {file.name}")
        with session_scope() as session:
            settings = read_app_settings(session) or load_app_settings(DEFAULT_APP_SETTINGS_PATH)
            processes = {
                row.code: process_display_name(row.name)
                for row in load_process_catalog(session, settings.active_dataset_kind)
            }
        if not processes:
            raise InputError(
                "거산 공정 목록이 비어 있습니다.",
                "먼저 역량 파일을 넣어 주세요(import-capability).",
            )
        # 파일 읽기·검사는 저장 잠금 밖에서 한다.
        result = read_customer_file(file, processes, settings.industries)
        file_date = file_date_of(file, datetime.now(KST).date())
        with session_scope() as session:
            session.connection().exec_driver_sql("BEGIN IMMEDIATE")
            stored = store_customers(session, result.rows, file_date, virtual=virtual)
        mark = " (가상·거산 실제 사양 아님)" if virtual else ""
        echo(f"{file_date.isoformat()} 기준 기존 고객 {stored}곳을 넣었습니다{mark}.")
        if result.dropped_columns:
            echo("읽지 않고 버린 칸: " + ", ".join(result.dropped_columns))
        if not settings.existing_customers.enabled:
            echo("설정 existingCustomers.enabled가 꺼져 있어 아직 어디에도 쓰이지 않습니다.")
        return 0
    except Exception as exc:
        if isinstance(exc, AppError):
            error = exc
        else:
            if not isinstance(exc, SQLAlchemyError):
                logger.exception("기존 고객 넣기 중 예상하지 못한 오류")
            error = RunFailedError(
                "기존 고객을 저장하지 못했습니다. 변경을 되돌렸습니다.",
                next_action="geosan init-db로 DB 상태를 확인해 주세요.",
            )
        logger.error("기존 고객 넣기 실패: ref=%s type=%s", error.ref, type(exc).__name__)
        echo(f"{error.message} {error.next_action} (문의 번호: {error.ref})")
        _echo_fields(error, echo)
        return exit_code_for(error)
