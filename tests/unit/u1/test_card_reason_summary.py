"""카드 추천 이유(cardReason)와 항목별 쉬운 요약(summary)의 파일 → 저장 → 엔진 → API 전달 검사.

#139 배관 2탄(더하는 변경 2026-10-26 PM). 모든 데이터는 가상(A정밀)이다.
"""

from __future__ import annotations

import json
from datetime import date
from pathlib import Path

from fastapi.testclient import TestClient
from sqlalchemy import select

from geosan.api.app import create_app
from geosan.capability.importer import import_capability
from geosan.config.file_checks import check_case_file
from geosan.evaluation.file_input import load_file_inputs
from geosan.evaluation.models import ItemJudgment, ItemJudgmentInput
from geosan.opportunity.importer import import_case
from geosan.opportunity.models import Opportunity
from geosan.rules.engine import evaluate
from geosan.storage.session import session_scope
from geosan.workflows.flow_evaluate import run_evaluation
from tests import factories

EXAMPLES = Path(__file__).resolve().parents[3] / "examples"
CAPABILITY = EXAMPLES / "capability-geosan.json"
CARD = "표면처리가 필요한 가상 부품을 만들고 소재가 철계라 아연도금과 맞음 (홈페이지)"
SUMMARY = (
    "가상 부품에 도금 사양이 적혀 있어 표면처리가 필요한 부품입니다. 외주 여부는 확인 전입니다."
)


def _write(directory: Path, name: str, data) -> Path:
    directory.mkdir(parents=True, exist_ok=True)
    path = directory / name
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    return path


def _case(card: str | None = CARD, summary: str | None = SUMMARY):
    data = factories.apjeong_case()
    if card is not None:
        data["opportunity"]["cardReason"] = card
    if summary is not None:
        data["itemInputs"][0]["summary"] = summary
    return data


def test_check_case_warns_only_when_card_reason_exceeds_80_chars(tmp_path: Path) -> None:
    """Given 80자 넘는 카드 문장 / When 검사 / Then 경고만 있고 통과. 80자 안이면 경고 없음."""
    long_card = "가" * 81 + " (홈페이지)"
    report = check_case_file(_write(tmp_path, "long.json", _case(card=long_card)))
    assert report.errors == []
    assert any("opportunity.cardReason" in w and "81자" in w for w in report.warnings)
    report = check_case_file(_write(tmp_path, "ok.json", _case(card="가" * 80 + " (홈페이지)")))
    assert report.errors == [] and not any("cardReason" in w for w in report.warnings)


def test_file_path_passes_card_reason_and_summary(tmp_path: Path) -> None:
    """Given 두 칸이 있는 사례 파일 / When 파일 경로로 변환·평가 / Then 입력·결과에 그대로 있다."""
    cases = tmp_path / "cases"
    _write(cases, "case.json", _case())
    inputs = load_file_inputs(CAPABILITY, cases, base_date=date(2026, 10, 27))
    ei = inputs.cases[0].evaluation_input
    assert ei.opportunity.card_reason == CARD
    first_code = ei.item_inputs[0].item_code
    assert ei.item_inputs[0].summary == SUMMARY
    output = evaluate(ei)
    by_code = {item.item_code: item for item in output.items}
    assert by_code[first_code].summary == SUMMARY
    assert all(item.summary is None for code, item in by_code.items() if code != first_code)


def test_db_path_stores_and_serves_card_reason_and_summary(tmp_db, tmp_path: Path) -> None:
    """Given 투입·평가 / When 상세 API / Then 저장 표 세 곳과 점수 항목 응답에 요약이 있다."""
    import_capability(_write(tmp_path, "cap.json", factories.capability_file()))
    opp_id = import_case(_write(tmp_path, "case.json", _case())).opp_id
    with session_scope() as session:
        assert session.get(Opportunity, opp_id).card_reason == CARD
        inputs = list(
            session.scalars(select(ItemJudgmentInput).where(ItemJudgmentInput.opp_id == opp_id))
        )
        assert sorted(row.summary for row in inputs if row.summary) == [SUMMARY]
    evaluation = run_evaluation()
    assert evaluation.ok, evaluation.summary
    with session_scope() as session:
        judged = list(
            session.scalars(
                select(ItemJudgment).where(ItemJudgment.eval_id == evaluation.new_eval_ids[0])
            )
        )
        assert sorted(row.summary for row in judged if row.summary) == [SUMMARY]
    with TestClient(create_app()) as client:
        data = client.get(f"/api/v1/opportunities/{opp_id}").json()["data"]
    items = data["scores"]["items"]
    assert [row["summary"] for row in items if row["summary"]] == [SUMMARY]
    assert all("summary" in row for row in items)


def test_fields_are_optional_and_default_to_null(tmp_db, tmp_path: Path) -> None:
    """Given 두 칸이 없는 기존 사례 파일 / Then 그대로 투입되고 값은 비어 있다."""
    import_capability(_write(tmp_path, "cap.json", factories.capability_file()))
    opp_id = import_case(_write(tmp_path, "case.json", _case(card=None, summary=None))).opp_id
    with session_scope() as session:
        assert session.get(Opportunity, opp_id).card_reason is None
