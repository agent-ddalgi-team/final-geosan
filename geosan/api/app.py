"""API의 요청 경계와 JSON 로그. 로그에는 본문·연락처·담당자 키를 넣지 않는다."""

from __future__ import annotations

import asyncio
import contextvars
import json
import logging
import re
import sys
import time
from datetime import UTC, datetime
from logging.handlers import TimedRotatingFileHandler
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from starlette.datastructures import MutableHeaders
from starlette.exceptions import HTTPException

from geosan.config.errors import AppError, FieldError, InputError, RunFailedError, new_ref

request_ref = contextvars.ContextVar("geosan_request_ref", default=None)
logger = logging.getLogger("geosan")


class JsonFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        # 자유 문장 메시지는 로그로 전달하지 않는다. 예외 본문도 출력하지 않는다.
        event = str(getattr(record, "event", record.msg))
        event = event if re.fullmatch(r"[a-z0-9_.]+", event) else "application.event"
        result = {
            "ts": datetime.now(UTC).isoformat(),
            "level": record.levelname,
            "event": event,
            "ref": getattr(record, "ref", None) or request_ref.get(),
        }
        for key in ("path", "method", "status", "ms", "batchId", "evalId", "oppId", "caseId"):
            if key in record.__dict__:
                result[key] = record.__dict__[key]
        for key in ("quote", "memo", "reason", "password", "key", "snapshot"):
            if key in record.__dict__:
                result[key] = "[redacted]"
        return json.dumps(result, ensure_ascii=False)


def configure_logging() -> None:
    if any(getattr(handler, "_geosan_json", False) for handler in logger.handlers):
        return
    log_dir = Path(__file__).resolve().parents[2] / "logs"
    log_dir.mkdir(exist_ok=True)
    handlers = [
        logging.StreamHandler(sys.__stdout__),
        TimedRotatingFileHandler(
            log_dir / "geosan.log", when="midnight", backupCount=14, encoding="utf-8", utc=True
        ),
    ]
    for handler in handlers:
        handler.setFormatter(JsonFormatter())
        handler._geosan_json = True
        logger.addHandler(handler)
    logger.setLevel(logging.INFO)
    logger.propagate = False


def error_response(error: AppError, ref: str | None = None) -> JSONResponse:
    error.ref = ref or request_ref.get() or error.ref
    return JSONResponse(error.to_error_body(), status_code=error.status)


class RequestBoundary:
    """본문 크기는 실제 수신 바이트로 제한한다. 요청 본문·원래 URL은 로그에 남기지 않는다."""

    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            return await self.app(scope, receive, send)
        ref = new_ref()
        token = request_ref.set(ref)
        started = time.monotonic()
        status = 500
        response_started = False

        async def logged_send(message):
            nonlocal status, response_started
            if message["type"] == "http.response.start":
                status = message["status"]
                response_started = True
                if scope["path"].startswith("/api/"):
                    MutableHeaders(scope=message)["Cache-Control"] = "no-store"
            await send(message)

        try:
            messages = []
            size = 0
            while True:
                message = await receive()
                if message["type"] == "http.disconnect":
                    return
                size += len(message.get("body", b""))
                if size > 64 * 1024:
                    error = InputError(
                        "요청 본문은 64KB 이내로 넣어 주세요.",
                        fields=[FieldError(path="body", message="본문 크기가 64KB를 넘었습니다.")],
                    )
                    await error_response(error, ref)(scope, receive, logged_send)
                    return
                messages.append(message)
                if not message.get("more_body", False):
                    break
            index = 0

            async def replay():
                nonlocal index
                if index < len(messages):
                    message = messages[index]
                    index += 1
                    return message
                return await receive()

            if scope["method"] == "GET":
                async with asyncio.timeout(10):
                    await self.app(scope, replay, logged_send)
            else:
                await self.app(scope, replay, logged_send)
        except Exception:
            logger.error("http.failed", extra={"ref": ref})
            if response_started:
                raise
            await error_response(RunFailedError(), ref)(scope, receive, logged_send)
        finally:
            route = scope.get("route")
            logger.info(
                "http.request",
                extra={
                    "ref": ref,
                    "path": getattr(route, "path", "/unmatched"),
                    "method": scope["method"],
                    "status": status,
                    "ms": round((time.monotonic() - started) * 1000, 1),
                },
            )
            request_ref.reset(token)


class ScreenFiles(StaticFiles):
    """화면 주소는 React Router에 넘기고 API·파일의 404는 유지한다."""

    async def get_response(self, path, scope):
        parts = Path(path).parts
        first = parts[0] if parts else ""
        if first == "api":
            raise HTTPException(status_code=404)
        screen = first != "assets" and not Path(path).suffix
        try:
            response = await super().get_response(path, scope)
        except HTTPException as error:
            if error.status_code != 404 or not screen:
                raise
        else:
            if response.status_code != 404 or not screen:
                return response
        return await super().get_response("index.html", scope)


def create_app() -> FastAPI:
    configure_logging()
    app = FastAPI(title="거산 영업지원 API", docs_url=None, redoc_url=None, openapi_url=None)
    app.add_middleware(RequestBoundary)

    @app.exception_handler(AppError)
    async def app_error(request: Request, error: AppError):
        return error_response(error)

    @app.exception_handler(RequestValidationError)
    async def validation_error(request: Request, error: RequestValidationError):
        fields = []
        for item in error.errors():
            loc = item["loc"]
            parts = [str(value) for value in loc if value not in {"body", "query", "path"}]
            path = ".".join(parts)
            if not re.fullmatch(r"[a-zA-Z0-9_.]+", path):
                path = "body"
            fields.append(FieldError(path=path, message="형식·길이·허용 값을 확인해 주세요."))
        return error_response(InputError("입력한 항목을 확인해 주세요.", fields=fields))

    @app.exception_handler(HTTPException)
    async def http_error(request: Request, error: HTTPException):
        return error_response(
            AppError(
                "요청한 경로나 접근 권한을 확인해 주세요.",
                "목록에서 다시 선택해 주세요.",
                status=error.status_code,
            )
        )

    from geosan.api.routes import config, opportunities, records, session

    for router in (config.router, opportunities.router, records.router, session.router):
        app.include_router(router, prefix="/api/v1")
    dist = Path(__file__).resolve().parents[2] / "web" / "dist"
    if dist.is_dir():
        app.mount("/", ScreenFiles(directory=dist, html=True), name="web")
    return app
