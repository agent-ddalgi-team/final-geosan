"""시나리오 단계 공용 도우미 (Step 9, PM 세션).

원칙(Testing Contract custom, AGENTS.md ④): 아직 없는 구현은 **진짜 모듈 경로**를 지연 import해서
부른다. 구현이 없으면 가짜로 통과시키지 않고 `pytest.fail("아직 구현되지 않음: …")`로 명시적으로
실패한다. 세 트랙(규칙 엔진·투입/API·화면)이 합쳐지면 이 파일을 고치지 않고 그대로 초록이
되어야 한다.

여기서 기대하는 구현 경로(계약 C2·C3·C8, 작업 지시서):
- 명령: `geosan.commands.app.app` (Typer) — `init-db`, `import-capability`, `import-case`,
  `evaluate`, `verify-case`. 종료 코드 0/1/2, 마지막 줄 쉬운 한국어 요약.
- 평가 흐름: `geosan.workflows.flow_evaluate.run_evaluation(opp_ids, base_date, requested_by)`
  → `FlowResult`
- 규칙 엔진: `geosan.rules.engine.evaluate(EvaluationInput) -> EvaluationOutput`
- 웹 API: `geosan.api.app.create_app()` (없으면 모듈 속성 `app`) — `/api/v1/opportunities`,
  `/api/v1/opportunities/{oppId}`, `POST /api/v1/opportunities/{oppId}/opinions`
- 저장소·모델·설정: PM 세션(Step 10·11) — `geosan.storage.session.session_scope`,
  각 부품 `models.py`, `geosan.config.registry.set_active_dataset_kind`.
"""

from __future__ import annotations

import importlib
import json
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import pytest
from typer.testing import CliRunner

ROOT_DIR = Path(__file__).resolve().parents[3]
EXAMPLES_DIR = ROOT_DIR / "examples"
DATA_DIR = ROOT_DIR / "tests" / "data"
APJEONG_CASE_ID = "apjeong-valve-anodizing"


def lazy_attr(module_path: str, attr: str, owner: str) -> Any:
    """모듈의 속성을 지연 import한다. 없으면 어느 단계·누가 구현할 것인지와 함께 실패한다."""
    try:
        module = importlib.import_module(module_path)
    except ImportError as exc:
        pytest.fail(f"아직 구현되지 않음: {module_path} — {owner} ({exc})")
    obj = getattr(module, attr, None)
    if obj is None:
        pytest.fail(f"아직 구현되지 않음: {module_path}.{attr} — {owner}")
    return obj


# ---------------------------------------------------------------------------
# 명령(C8)
# ---------------------------------------------------------------------------


@dataclass
class CliResult:
    exit_code: int
    output: str


def run_cli(*args: str) -> CliResult:
    """`geosan <args>`를 같은 프로세스에서 실행한다(GEOSAN_DB_PATH는 tmp_db 픽스처가 넣는다)."""
    app = lazy_attr("geosan.commands.app", "app", "Part A")
    result = CliRunner().invoke(app, list(args), catch_exceptions=False)
    return CliResult(exit_code=result.exit_code, output=result.output)


def require_ok(result: CliResult, what: str) -> CliResult:
    if result.exit_code != 0:
        pytest.fail(f"{what} 명령이 종료 코드 {result.exit_code}로 끝났습니다:\n{result.output}")
    return result


# ---------------------------------------------------------------------------
# 저장소(Step 10, PM 세션)
# ---------------------------------------------------------------------------


def session_scope():
    return lazy_attr("geosan.storage.session", "session_scope", "Step 10 (PM 세션)")()


def model(component: str, name: str) -> Any:
    """`geosan.<component>.models.<name>` 모델 클래스."""
    return lazy_attr(f"geosan.{component}.models", name, "Step 10 (PM 세션)")


def init_db(db_path: Path) -> None:
    lazy_attr("geosan.storage.init_db", "init_db", "Step 10 (PM 세션)")(db_path)


# ---------------------------------------------------------------------------
# 파일 변형 도우미
# ---------------------------------------------------------------------------


def write_json(directory: Path, name: str, data: dict[str, Any]) -> Path:
    path = directory / name
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    return path


# ---------------------------------------------------------------------------
# 웹 API(C1, Step 20 이강욱)
# ---------------------------------------------------------------------------


def api_client():
    from fastapi.testclient import TestClient

    try:
        module = importlib.import_module("geosan.api.app")
    except ImportError as exc:
        pytest.fail(f"아직 구현되지 않음: geosan.api.app — Step 20 (이강욱) ({exc})")
    factory = getattr(module, "create_app", None)
    app = factory() if callable(factory) else getattr(module, "app", None)
    if app is None:
        pytest.fail("아직 구현되지 않음: geosan.api.app.create_app() 또는 app — Step 20 (이강욱)")
    return TestClient(app)


# ---------------------------------------------------------------------------
# 시나리오 문맥
# ---------------------------------------------------------------------------


@dataclass
class ScenarioContext:
    """시나리오 하나 동안 단계들이 주고받는 값."""

    last_cli: CliResult | None = None
    eval_ids: list[str] = field(default_factory=list)
    remembered_eval_id: str | None = None
    list_response: Any = None
    detail_response: Any = None
    opinion_response: Any = None
    engine_input: Any = None
    engine_outputs: list[Any] = field(default_factory=list)
    extra: dict[str, Any] = field(default_factory=dict)
