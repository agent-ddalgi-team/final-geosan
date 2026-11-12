"""`geosan check-config [rule-config.yaml] [app-settings.yaml]` 본문 (W9, BR2.2·BR7.6·BR11.3).

두 파일의 형식을 검사해 오류를 "N번째 줄 항목: 이유"로 전부 보인다. DB 파일이 있으면 규칙 버전을
등록하고 앱 설정 사본을 만든다(없으면 검사만). 종료 코드 0/1/2.
"""

from __future__ import annotations

from pathlib import Path

import typer
from sqlalchemy.exc import SQLAlchemyError

from geosan.config.app_settings import check_app_settings_file, read_app_settings
from geosan.config.errors import AppError
from geosan.config.paths import normalize_input_path
from geosan.config.registry import (
    DEFAULT_APP_SETTINGS_PATH,
    DEFAULT_RULE_CONFIG_PATH,
    register_config_files,
)
from geosan.config.rule_config import check_rule_config_file
from geosan.config.sales_questions import check_sales_questions_file, questions_path
from geosan.config.validators import format_field_error
from geosan.storage.engine import database_path
from geosan.storage.session import session_scope

EXIT_OK = 0
EXIT_INPUT_ERROR = 1
EXIT_RUN_FAILED = 2


def run_check_config(
    rule_config: Path | None, app_settings: Path | None, *, register: bool = True
) -> int:
    """두 설정 파일을 검사한다. `register=False`면 DB가 있어도 등록·사본 갱신을 하지 않는다.

    `serve`가 이 경로를 쓴다: 서버 시작은 파일 모양만 확인하고, 담당자가 `check-config`로
    골라 둔 활성 묶음 같은 DB 사본 값은 그대로 둔다(이슈 #91).
    """
    try:
        rule_path = normalize_input_path(rule_config or DEFAULT_RULE_CONFIG_PATH)
        app_path = normalize_input_path(app_settings or DEFAULT_APP_SETTINGS_PATH)
    except AppError as exc:
        typer.echo(f"오류: {exc.message}")
        typer.echo(exc.next_action)
        return EXIT_INPUT_ERROR

    errors = 0
    try:
        rule_result = check_rule_config_file(rule_path)
        for error in rule_result.errors:
            typer.echo(f"오류 [{rule_path.name}]: {format_field_error(error)}")
        errors += len(rule_result.errors)
        app_result = check_app_settings_file(app_path)
        for error in app_result.errors:
            typer.echo(f"오류 [{app_path.name}]: {format_field_error(error)}")
        errors += len(app_result.errors)
        # #607: 설정이 가리키는 꼬리 질문 파일도 함께 검사한다(인자는 그대로).
        if app_result.settings is not None:
            questions_file = questions_path(app_result.settings.records.sales_questions_file)
            questions_result = check_sales_questions_file(questions_file)
            for error in questions_result.errors:
                typer.echo(f"오류 [{questions_file.name}]: {format_field_error(error)}")
            errors += len(questions_result.errors)
    except AppError as exc:
        for error in exc.fields:
            typer.echo(f"오류: {format_field_error(error)}")
        if not exc.fields:
            typer.echo(f"오류: {exc.message}")
        typer.echo(f"검사 실패. {exc.next_action}")
        return EXIT_INPUT_ERROR

    if errors:
        typer.echo(f"검사 실패: 오류 {errors}건. 위 줄 번호의 항목을 고친 뒤 다시 실행해 주세요.")
        return EXIT_INPUT_ERROR

    assert rule_result.config is not None and app_result.settings is not None
    typer.echo(
        f"규칙 설정 {rule_path.name}: version {rule_result.config.version}, "
        f"해시 {rule_result.config.rule_hash[:12]}… ({rule_result.config.hypothesis_note})"
    )
    typer.echo(
        f"앱 설정 {app_path.name}: 담당자 {len(app_result.settings.staff)}명, "
        f"파일의 묶음 {app_result.settings.active_dataset_kind}, "
        f"LLM {app_result.settings.llm.mode}"
    )

    db_path = database_path()
    if not db_path.exists():
        typer.echo(f"검사 통과 (DB 없음: {db_path} — 버전 등록은 init-db 뒤 다시 실행하면 됩니다)")
        return EXIT_OK
    if not register:
        try:
            with session_scope(db_path) as session:
                settings = read_app_settings(session)
        except (SQLAlchemyError, ValueError):
            typer.echo("DB의 앱 설정 사본을 읽지 못했습니다. 데이터베이스 상태를 확인해 주세요.")
            return EXIT_RUN_FAILED
        if settings is None:
            typer.echo(
                "앱 설정 사본이 아직 없습니다. 첫 요청 때 examples/app-settings.yaml로 만듭니다."
            )
        else:
            typer.echo(
                f"활성 묶음 {settings.active_dataset_kind} (DB 사본 기준, 변경: geosan dataset-set)"
            )
        typer.echo("검사 통과 (파일 모양만 확인. DB의 규칙 버전·앱 설정 사본은 바꾸지 않았습니다)")
        return EXIT_OK
    try:
        with session_scope(db_path) as session:
            runtime = register_config_files(session, rule_path, app_path)
            registered = f"{runtime.rule_version.rule_version} ({runtime.rule_version.status})"
    except AppError as exc:
        typer.echo(f"오류: {exc.message}")
        typer.echo(f"검사는 통과했지만 등록하지 못했습니다. {exc.next_action}")
        return EXIT_INPUT_ERROR
    except Exception as exc:
        typer.echo(f"오류: DB에 등록하지 못했습니다 ({type(exc).__name__}: {exc})")
        typer.echo("데이터베이스 파일과 init-db 적용 여부를 확인해 주세요.")
        return EXIT_RUN_FAILED
    typer.echo(f"검사 통과. 규칙 버전 {registered} 등록, 앱 설정 사본 갱신 ({db_path.name})")
    return EXIT_OK
