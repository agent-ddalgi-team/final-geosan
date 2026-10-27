"""#160 막는 조건의 파일 출력·SQLite·API 연결 검사. 입력은 가상 사례만 쓴다."""

import json
from datetime import date
from pathlib import Path

from fastapi.testclient import TestClient

from geosan.api.app import create_app
from geosan.capability.importer import import_capability
from geosan.commands.demo_report import build_report, render_all
from geosan.config.registry import register_config_files
from geosan.opportunity.importer import import_case
from geosan.storage.session import session_scope
from geosan.workflows.flow_evaluate import run_evaluation
from tests import factories

ROOT = Path(__file__).resolve().parents[3]


def test_blocker_matches_in_export_and_real_database_api(tmp_db, tmp_path):
    """Given 소개서·관계·필수 요구 미확인, When 출력·투입·평가, Then 같은 문장·승인값이다."""
    capability = ROOT / "tests/data/capability-brochure.json"
    cases = tmp_path / "cases"
    cases.mkdir()
    raw = factories.brochure_case("blocker-paths")
    raw["customer"]["relationStatus"] = "UNCONFIRMED"
    raw["customer"]["relationConfirmedAt"] = None
    case_path = cases / "case.json"
    case_path.write_text(json.dumps(raw, ensure_ascii=False), encoding="utf-8")
    report = build_report(capability, cases, base_date=date(2026, 10, 27))
    row = report.rows[0]
    expected = "거래 여부와 거산의 아노다이징 — 가상 소개서 표기 공정과 ISO 9001이 아직 확인 전"
    assert row.output.display.blocker_text == expected
    assert row.output.display.blocks_approval is True
    exported = render_all(report).files
    assert expected in exported["ranking.csv"]
    assert expected in exported["ranking.html"]
    assert expected in next(text for name, text in exported.items() if name.startswith("facts/"))
    for name, text in exported.items():
        # 요구 판정표의 '확인 대기 (승인 막힘)' 표시는 #160 변경 대상이 아니다.
        # 목록과 기업 문서의 '막는 조건' 문장 끝에서만 꼬리표 제거를 확인한다.
        blocker_lines = (
            [text]
            if name.startswith("ranking.")
            else [line for line in text.splitlines() if line.startswith("- 막는 조건:")]
        )
        assert all("(승인 막힘)" not in line for line in blocker_lines)
        assert all("(승인은 막지 않음)" not in line for line in blocker_lines)

    with session_scope() as session:
        register_config_files(
            session, ROOT / "examples/rule-config.yaml", ROOT / "examples/app-settings.yaml"
        )
    import_capability(capability)
    opp_id = import_case(case_path).opp_id
    evaluated = run_evaluation(base_date=date(2026, 10, 27))
    assert evaluated.ok, evaluated.summary
    with TestClient(create_app()) as client:
        response = client.get("/api/v1/opportunities")
        assert response.status_code == 200
        card = response.json()["data"][0]
        detail_response = client.get(f"/api/v1/opportunities/{opp_id}")
        assert detail_response.status_code == 200
    assert card["blocker"] == {"text": expected, "blocksApproval": True}
    assert card["rank"] == row.rank
    assert card["classificationCode"] == row.output.classification_code
    for key in ("E", "P", "S", "R", "C"):
        assert detail_response.json()["data"]["scores"][key] == getattr(row.output.totals, key)
