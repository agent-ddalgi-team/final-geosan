"""역량 투입 명령과 두 투입 명령의 공통 오류 출력."""

from __future__ import annotations

from collections.abc import Callable
from pathlib import Path

import typer

from geosan.api.app import configure_logging, logger, request_ref
from geosan.capability.importer import import_capability
from geosan.config.errors import AppError, RunFailedError, exit_code_for, new_ref
from geosan.config.paths import normalize_input_path


def run_import(file: Path, store: Callable, event: str) -> int:
    ref = new_ref()
    token = request_ref.set(ref)
    try:
        configure_logging()
        result = store(normalize_input_path(file))
        for warning in result.warnings:
            typer.echo(f"경고: {warning}")
        logger.info(event + ".done")
        typer.echo(f"{result.summary} (문의 시 이 번호: {ref})")
        return 0
    except Exception as exc:
        error = exc if isinstance(exc, AppError) else RunFailedError("파일을 저장하지 못했습니다.")
        error.ref = ref
        logger.error(event + ".failed", extra={"ref": ref})
        for field in error.fields:
            line = f"{field.line}번째 줄 " if field.line is not None else ""
            typer.echo(f"오류: {line}{field.path}: {field.message}")
        typer.echo(f"{error.message} {error.next_action} (문의 시 이 번호: {ref})")
        return exit_code_for(error)
    finally:
        request_ref.reset(token)


def run_import_capability(file: Path) -> int:
    return run_import(file, import_capability, "cmd.import_capability")
