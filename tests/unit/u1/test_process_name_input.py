"""거산 공정 이름(ProcessInput.name)의 파일 → 엔진 입력, DB → 스냅샷 전달 검사.

#161 (#139 배관 3탄).

카드 막는 조건 문장("거산의 아연도금(전기아연도금) 공정이 아직 확인 전")에 역량 파일의 공정 이름을
그대로 쓰기 위한 더하는 변경이다. 모든 데이터는 가상(A정밀·가상 역량 묶음)이다.
"""

from __future__ import annotations

import json
from datetime import date
from pathlib import Path

from geosan.capability.importer import import_capability
from geosan.config.registry import load_runtime_config
from geosan.evaluation.file_input import load_file_inputs
from geosan.evaluation.snapshot import build_snapshot
from geosan.opportunity.importer import import_case
from geosan.rules.engine import evaluate
from geosan.rules.models import EvaluationInput, ProcessInput
from geosan.storage.session import session_scope
from tests import factories

EXAMPLES = Path(__file__).resolve().parents[3] / "examples"
CAPABILITY = EXAMPLES / "capability-geosan.json"


def _write(directory: Path, name: str, data) -> Path:
    directory.mkdir(parents=True, exist_ok=True)
    path = directory / name
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    return path


def _names_by_code(capability_file: dict) -> dict[str, str]:
    return {p["code"]: p["name"] for p in capability_file["processes"]}


def test_file_path_passes_process_names_as_written(tmp_path: Path) -> None:
    """Given 역량 파일 / When 파일 경로로 엔진 입력을 만들면 / Then 공정 이름이 파일 그대로다."""
    cases = tmp_path / "cases"
    _write(cases, "case.json", factories.apjeong_case())
    inputs = load_file_inputs(CAPABILITY, cases, base_date=date(2026, 10, 27))
    processes = inputs.cases[0].evaluation_input.capability.processes
    expected = _names_by_code(json.loads(CAPABILITY.read_text(encoding="utf-8")))
    assert {p.code: p.name for p in processes} == expected
    assert expected["ZINC_PLATING"] == "아연도금(전기아연도금) — 가상"


def test_db_path_passes_process_names_from_stored_capability(tmp_db, tmp_path: Path) -> None:
    """Given 투입된 역량 묶음 / When DB 스냅샷을 만들면 / Then 공정 이름이 저장된 값 그대로 있다."""
    capability_file = factories.capability_file()
    import_capability(_write(tmp_path, "cap.json", capability_file))
    opp_id = import_case(_write(tmp_path, "case.json", factories.apjeong_case())).opp_id
    with session_scope() as session:
        runtime = load_runtime_config(session)
        snapshot = build_snapshot(
            session,
            opp_id,
            base_date=date(2026, 10, 27),
            dataset_kind=runtime.app_settings.active_dataset_kind.value,
            rule_config=runtime.rule_config,
        )
    processes = snapshot.evaluation_input.capability.processes
    assert {p.code: p.name for p in processes} == _names_by_code(capability_file)
    # 재현용 기록(스냅샷 문서)에도 같은 이름이 camelCase 키 없이 그대로 들어간다.
    stored = {p["code"]: p["name"] for p in snapshot.document["capability"]["processes"]}
    assert stored == _names_by_code(capability_file)


def test_inputs_without_process_name_still_validate_and_score_the_same() -> None:
    """Given 이름 칸이 없는 기존 입력 / When 검증·평가하면 / Then 통과하고 점수는 그대로다."""
    assert (
        ProcessInput.model_validate(
            {
                "processId": "p1",
                "code": "ZINC_PLATING",
                "materialCodes": ["FE"],
                "performanceTags": ["CORROSION"],
                "reviewStatus": "REVIEWED",
                "datasetKind": "VIRTUAL_REVIEWED",
            }
        ).name
        is None
    )

    raw = factories.load_data_json("apjeong-input.json")
    data = EvaluationInput.model_validate(_strip_private(raw))
    assert all(p.name is None for p in data.capability.processes)
    before = evaluate(data)
    for process in data.capability.processes:
        process.name = f"{process.code} 이름"
    after = evaluate(data)
    assert after.totals == before.totals
    assert after.classification_code == before.classification_code
    assert after.display == before.display


def _strip_private(value):
    if isinstance(value, dict):
        return {k: _strip_private(v) for k, v in value.items() if not k.startswith("_")}
    if isinstance(value, list):
        return [_strip_private(v) for v in value]
    return value
