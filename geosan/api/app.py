"""API의 요청 경계와 JSON 로그. 로그에는 본문·연락처·담당자 키를 넣지 않는다."""

from __future__ import annotations

import contextvars
import json
import logging
import re
import sys
from datetime import UTC, datetime
from logging.handlers import TimedRotatingFileHandler
from pathlib import Path

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
