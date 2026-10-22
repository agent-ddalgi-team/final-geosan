"""경계 파일 `geosan/api/schemas.py` 회귀 테스트 (이슈 #33).

점수 키는 약속 C1·화면 예시(`web/src/test/fixtures/opportunity-detail-apjeong.json`)대로
대문자 `E/P/S/R/C`여야 한다. 공통 camelCase 변환이 한 글자 키를 소문자로 바꾸던 문제를 막는다.
"""

from __future__ import annotations

from datetime import UTC, datetime

from geosan.api.schemas import Scores
from geosan.rules.codes import DatasetKind


def _scores() -> Scores:
    return Scores(
        E=77,
        P=95,
        S=81.1,
        R=82,
        C=87.5,
        items=[],
        rule_version="v1",
        dataset_kind=DatasetKind.VIRTUAL_REVIEWED,
        batch_id="batch-1",
        evaluated_at=datetime(2026, 10, 20, tzinfo=UTC),
    )


def test_scores_json_keys_are_uppercase_single_letters() -> None:
    """응답 JSON의 점수 키가 `E/P/S/R/C`(대문자)로 나가고 소문자 키는 없다."""
    data = _scores().model_dump(by_alias=True)
    assert {"E", "P", "S", "R", "C"} <= data.keys()
    assert not {"e", "p", "s", "r", "c"} & data.keys()
    assert data["E"] == 77 and data["S"] == 81.1


def test_scores_other_keys_stay_camel_case() -> None:
    """나머지 키는 전처럼 camelCase다(ruleVersion·datasetKind·batchId·evaluatedAt)."""
    data = _scores().model_dump(by_alias=True)
    assert {"ruleVersion", "datasetKind", "batchId", "evaluatedAt"} <= data.keys()


def test_scores_accepts_uppercase_keys_from_json() -> None:
    """대문자 키가 든 JSON을 읽어도 같은 모델이 된다(화면 예시 파일과 왕복)."""
    data = _scores().model_dump(by_alias=True, mode="json")
    again = Scores.model_validate(data)
    assert again.E == 77 and again.P == 95 and again.R == 82
