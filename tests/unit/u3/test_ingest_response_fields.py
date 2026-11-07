"""#342: 후보 찾기 응답 칸이 약속(C1·C0) 이름·값 그대로 공통 응답 모델에 있는지 확인한다.

응답 모델의 모양만 본다. 창구가 값을 채워 보내는 것(#317)과 화면 표시(#316)의 검사는 아니다.
회차 요약은 임시 파일 DB에 실제로 저장한 회차 행에서 만들어, 표의 칸 이름과 맞는지 함께 본다.
"""

from __future__ import annotations

from datetime import UTC, datetime
from pathlib import Path

import pytest
from pydantic import ValidationError

from geosan.api.schemas import DetailHeader, LatestIngest, Meta, OpportunityCard
from geosan.opportunity.models import Customer, IngestBatch
from geosan.rules.codes import DiscoverySource, FitLevel
from geosan.storage.base import new_id
from geosan.storage.session import session_scope

# 약속 요약 C1 `meta.latestIngest`에 적힌 칸 전부(2026-11-04 ~ 2026-11-06 줄).
LATEST_INGEST_KEYS = {
    "batchId",
    "sourceId",
    "startedAt",
    "finishedAt",
    "status",
    "criteria",
    "newCount",
    "mergeCandidateCount",
    "researchDoneCount",
    "scannedCount",
    "judgedCount",
    "pickedCount",
    "judgePendingCount",
    "webSearchUsed",
    "webCandidateCount",
    "webDroppedCount",
    "webFromCache",
    "webSkippedReason",
    "complexListSkippedReason",
    "failureReason",  # (#347) 찾기 실패 사유 한 줄
}
# 약속 요약 C1 "카드·상세에 더하는 칸"(#313·#319).
FOUND_COMPANY_KEYS = {
    "discoverySource",
    "discoverySourceUrl",
    "registryStatus",
    "fitLevel",
    "pickReason",
    "ownPlatingLineSuspected",
    "ownPlatingLineBasis",
}
# 약속 요약 C1 카드에만 있는 칸(2026-11-04 PM 결정 ①).
CARD_ONLY_KEYS = {"ingestBatchId", "ingestedAt", "isNewInLatestBatch"}


def _saved_batch(tmp_db: Path, **overrides: object) -> str:
    values: dict[str, object] = {
        "batch_id": new_id("batch"),
        "source_id": "kicox-factory-csv",
        "requested_by": "SYSTEM",
        "started_at": datetime(2026, 11, 6, 9, 0, tzinfo=UTC),
        "status": "RUNNING",
        "is_virtual": True,
    }
    values.update(overrides)
    with session_scope(tmp_db) as session:
        session.add(IngestBatch(**values))
    return str(values["batch_id"])


def _aliases(model: type) -> set[str]:
    return {field.alias or name for name, field in model.model_fields.items()}


def test_latest_ingest_is_built_from_a_saved_batch_row(tmp_db: Path) -> None:
    """Given 판단 100곳 끝난 회차 / When 회차 행으로 요약을 만듦 / Then 약속의 칸이 다 나온다."""
    batch_id = _saved_batch(
        tmp_db,
        criteria={
            "processCodes": ["ZINC_ELECTRO"],
            "regions": ["아산시"],
            "industries": [],
        },
        scanned_count=17365,
        judged_count=100,
        picked_count=12,
        judge_pending_count=0,
    )
    with session_scope(tmp_db) as session:
        row = session.get(IngestBatch, batch_id)
        summary = LatestIngest.model_validate(row, from_attributes=True)
    data = Meta(latest_ingest=summary).model_dump(by_alias=True, mode="json", exclude_unset=True)

    latest = data["latestIngest"]
    assert set(latest) == LATEST_INGEST_KEYS
    assert (latest["scannedCount"], latest["judgedCount"], latest["pickedCount"]) == (
        17365,
        100,
        12,
    )
    assert latest["status"] == "RUNNING"
    assert latest["finishedAt"] is None
    assert latest["criteria"] == {
        "processCodes": ["ZINC_ELECTRO"],
        "regions": ["아산시"],
        "industries": [],
    }
    # 안 돌린 웹 검색·산단공 조회는 "안 씀·이유 없음"으로 그대로 나온다(없는 칸이 아니다).
    assert (latest["webSearchUsed"], latest["webSkippedReason"]) == (False, None)
    assert latest["complexListSkippedReason"] is None
    # 실패하지 않은 회차의 실패 사유는 빈 값으로 나온다(#347).
    assert latest["failureReason"] is None


def test_latest_ingest_without_criteria_keeps_null(tmp_db: Path) -> None:
    """Given 조건 없이 돌린 끝난 회차 / When 요약을 만듦 / Then 조건은 null, 끝난 시각이 나온다."""
    finished = datetime(2026, 11, 6, 9, 30, tzinfo=UTC)
    batch_id = _saved_batch(tmp_db, status="DONE", finished_at=finished, new_count=7)
    with session_scope(tmp_db) as session:
        row = session.get(IngestBatch, batch_id)
        summary = LatestIngest.model_validate(row, from_attributes=True)
    assert summary.criteria is None
    assert summary.finished_at == finished
    assert summary.new_count == 7


def test_latest_ingest_carries_failure_reason_of_a_failed_batch(tmp_db: Path) -> None:
    """Given 실패로 끝난 회차 / When 요약을 만듦 / Then 사유 한 줄이 그대로 나온다(#347)."""
    reason = "공장현황 파일을 읽지 못했습니다"
    batch_id = _saved_batch(
        tmp_db,
        status="FAILED",
        finished_at=datetime(2026, 11, 6, 9, 5, tzinfo=UTC),
        failure_reason=reason,
    )
    with session_scope(tmp_db) as session:
        row = session.get(IngestBatch, batch_id)
        summary = LatestIngest.model_validate(row, from_attributes=True)
    latest = Meta(latest_ingest=summary).model_dump(by_alias=True, mode="json", exclude_unset=True)[
        "latestIngest"
    ]
    assert (latest["status"], latest["failureReason"]) == ("FAILED", reason)
    # 공공자료 갈래가 실패한 회차는 웹 검색을 돌리지 않고, 건너뛴 이유 칸은 비워 둔다(#345).
    assert (latest["webSearchUsed"], latest["webSkippedReason"]) == (False, None)


def test_latest_ingest_rejects_missing_counts() -> None:
    """Given 건수를 안 채운 요약 / When 만듦 / Then 0으로 채우지 않고 오류가 난다."""
    with pytest.raises(ValidationError) as caught:
        LatestIngest(
            batch_id="batch-1",
            source_id="kicox-factory-csv",
            started_at=datetime(2026, 11, 6, tzinfo=UTC),
            finished_at=None,
            status="RUNNING",
        )
    missing = {error["loc"][0] for error in caught.value.errors() if error["type"] == "missing"}
    assert {"judgedCount", "scannedCount", "pickedCount", "judgePendingCount"} <= missing


def test_latest_ingest_rejects_status_outside_contract() -> None:
    """Given 약속에 없는 상태 값 / When 요약을 만듦 / Then 거부한다."""
    with pytest.raises(ValidationError) as caught:
        LatestIngest.model_validate({"status": "PAUSED"})
    wrong_value = {error["loc"][0] for error in caught.value.errors() if error["type"] != "missing"}
    assert wrong_value == {"status"}


def test_meta_without_search_has_no_latest_ingest_key() -> None:
    """Given 찾기와 무관한 응답 / When 안 채운 칸을 빼고 내보냄 / Then 회차 요약 칸이 없다."""
    data = Meta(total=18).model_dump(by_alias=True, exclude_unset=True)
    assert data == {"total": 18}


def test_card_and_detail_header_have_the_contract_field_names() -> None:
    """Given 응답 모델 / When 칸 이름을 봄 / Then 카드·상세 머리에 약속의 이름이 그대로 있다."""
    assert FOUND_COMPANY_KEYS | CARD_ONLY_KEYS <= _aliases(OpportunityCard)
    assert FOUND_COMPANY_KEYS <= _aliases(DetailHeader)
    # 들어온 회차·"이번에 들어옴"은 약속대로 카드에만 둔다.
    assert not CARD_ONLY_KEYS & _aliases(DetailHeader)


def test_found_company_fields_accept_only_contract_values() -> None:
    """Given 들어온 길·적합도·등록 확인 / When 약속 밖 값을 넣음 / Then 거부한다."""
    fields = OpportunityCard.model_fields
    assert fields["discovery_source"].annotation is DiscoverySource
    assert fields["fit_level"].annotation == FitLevel | None
    for name, bad in (
        ("discoverySource", "JOB_SITE"),
        ("fitLevel", "VERY_HIGH"),
        ("registryStatus", "MAYBE"),
    ):
        with pytest.raises(ValidationError) as caught:
            DetailHeader.model_validate({name: bad})
        assert name in {error["loc"][0] for error in caught.value.errors()}


def test_code_table_matches_contract_and_saved_default() -> None:
    """Given 코드표 / When 값을 봄 / Then 약속 C0와 같고, 기존 회사의 저장 기본값이 그 안에 있다."""
    assert {item.value for item in DiscoverySource} == {
        "CASE_FILE",
        "FACTORY_FILE",
        "FACTORY_API",
        "WEB_SEARCH",
    }
    assert [item.value for item in FitLevel] == ["HIGH", "MEDIUM", "LOW"]
    assert Customer.__table__.c.discovery_source.default.arg == DiscoverySource.CASE_FILE
    assert OpportunityCard.model_fields["discovery_source"].default is DiscoverySource.CASE_FILE
