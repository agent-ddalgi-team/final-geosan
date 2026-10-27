"""부품(geosan/ 아래 폴더) 사이의 import 방향이 설계 경계를 지키는지 검사한다 (#157).

코드를 실행하지 않고 파일의 import 문만 읽는다. 팀원이 병렬로 작업하다 모르고 경계를 넘으면
(예: 규칙 엔진이 DB를 가져오거나, 어떤 부품이 명령·API를 거꾸로 가져오면) 여기서 바로 실패한다.

규칙 세 가지
  ① 규칙 엔진 `rules`는 geosan의 다른 부품을 하나도 가져오지 않는다(순수 계산, 계약 C3).
  ② 진입 부품 `commands`·`api`는 아무도 가져오지 않는다
     (`commands`는 `__main__`만, `api`는 `commands`만).
  ③ 부품 간 의존은 아래 허용표에 있는 것만 둔다. 새 의존이 필요하면 PM 확인 뒤
     허용표에 한 줄 더한다. 허용표에 "11월 정리 대상"으로 표시한 줄은 2026-10-27 점검 때
     발견한 순환 의존이다. 정리되면 줄을 지운다.
"""

from __future__ import annotations

import ast
from pathlib import Path

PACKAGE = Path(__file__).resolve().parents[3] / "geosan"
ROOT = "(루트)"

# 허용표: 가져오는 쪽 → 가져와도 되는 부품. (2026-10-27 실제 의존을 그대로 적음)
ALLOWED: dict[str, set[str]] = {
    ROOT: {"commands"},
    "commands": {
        "api",
        "capability",
        "config",
        "evaluation",
        "opportunity",
        "rules",
        "storage",
        "workflows",
    },
    "api": {
        "capability",
        "config",
        "evaluation",
        "evidence",
        "opportunity",
        "questions",
        "records",
        "rules",
        "storage",
    },
    "workflows": {"config", "evaluation", "opportunity", "questions", "rules", "storage"},
    "config": {"rules", "storage"},
    "records": {"storage"},
    "rules": set(),
    # ── 아래 넷은 서로 물려 있다(capability ↔ opportunity ↔ evaluation ↔ questions).
    #    11월 정리 대상. 정리되면 주석의 부품을 집합에서 지운다.
    "capability": {"config", "rules", "storage", "opportunity"},  # opportunity: 정리 대상
    "opportunity": {
        "config",
        "rules",
        "storage",
        "capability",
        "evaluation",
        "evidence",
        "questions",
    },  # capability·evaluation·questions: 11월 정리 대상
    "evaluation": {
        "config",
        "rules",
        "storage",
        "capability",
        "evidence",
        "opportunity",
        "questions",
    },  # questions: 11월 정리 대상
    "questions": {
        "config",
        "rules",
        "storage",
        "evaluation",
        "opportunity",
    },  # evaluation·opportunity: 11월 정리 대상
    "evidence": {"config", "rules", "storage", "opportunity"},
    # storage/metadata.py가 모든 부품의 모델을 모아 표를 등록한다. 모델은 storage.base를
    # 쓰므로 형식상 순환. 11월 정리 대상.
    "storage": {
        "capability",
        "config",
        "evaluation",
        "evidence",
        "opportunity",
        "questions",
        "records",
    },
}

ENTRY_POINTS = {"commands": {ROOT}, "api": {"commands"}}


def _component_of(path: Path) -> str:
    rel = path.relative_to(PACKAGE)
    return rel.parts[0] if len(rel.parts) > 1 else ROOT


def _imported_components(path: Path) -> set[str]:
    tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
    found: set[str] = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.ImportFrom) and node.module and node.module.startswith("geosan."):
            found.add(node.module.split(".")[1])
        elif isinstance(node, ast.Import):
            for alias in node.names:
                if alias.name.startswith("geosan."):
                    found.add(alias.name.split(".")[1])
    return found


def _dependency_edges() -> dict[tuple[str, str], list[str]]:
    """(가져오는 부품, 가져오는 대상) → 그 import가 있는 파일 목록."""
    edges: dict[tuple[str, str], list[str]] = {}
    for path in sorted(PACKAGE.rglob("*.py")):
        if "__pycache__" in path.parts:
            continue
        src = _component_of(path)
        for dst in _imported_components(path):
            if dst != src:
                edges.setdefault((src, dst), []).append(str(path.relative_to(PACKAGE.parent)))
    return edges


def test_rules_engine_imports_nothing_from_other_components():
    """Given 규칙 엔진 폴더 / When import 문을 읽으면 / Then geosan의 다른 부품이 하나도 없다."""
    offenders = {edge: files for edge, files in _dependency_edges().items() if edge[0] == "rules"}
    assert not offenders, (
        "규칙 엔진은 순수 계산이라 다른 부품을 가져오면 안 됩니다(DB·설정·저장 금지, 계약 C3). "
        f"발견: {offenders}"
    )


def test_entry_points_are_not_imported_by_components():
    """Given 명령·API 진입 부품 / When 누가 가져오는지 보면 / Then 허용된 진입 경로뿐이다."""
    edges = _dependency_edges()
    for entry, allowed_sources in ENTRY_POINTS.items():
        offenders = {
            edge: files
            for edge, files in edges.items()
            if edge[1] == entry and edge[0] not in allowed_sources
        }
        assert not offenders, (
            f"진입 부품 `{entry}`은(는) 다른 부품이 거꾸로 가져오면 안 됩니다"
            f"(ADR-006: 후속 촉발은 진입 부품이 조정). 발견: {offenders}"
        )


def test_component_dependencies_are_in_allowed_table():
    """Given 부품 간 실제 의존 / When 허용표와 비교하면 / Then 허용표 밖의 새 의존이 없다."""
    edges = _dependency_edges()
    new_edges = {
        edge: files for edge, files in edges.items() if edge[1] not in ALLOWED.get(edge[0], set())
    }
    assert not new_edges, (
        "허용표에 없는 부품 간 의존이 생겼습니다. 정말 필요하면 PM 확인 뒤 "
        "tests/unit/u1/test_dependency_rules.py 의 ALLOWED에 한 줄 더합니다. "
        f"발견: {new_edges}"
    )


def test_allowed_table_has_no_stale_rows():
    """Given 허용표 / When 실제 의존과 비교하면 / Then 쓰이지 않는 허용 줄이 없다."""
    edges = _dependency_edges()
    stale = {(src, dst) for src, dsts in ALLOWED.items() for dst in dsts if (src, dst) not in edges}
    assert not stale, (
        "실제로는 없는 의존이 허용표에 남아 있습니다. 의존을 정리했으면 허용표에서도 지웁니다. "
        f"남은 줄: {sorted(stale)}"
    )
