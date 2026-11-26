"""#961: 경기처럼 한 지역 공장 행이 SQLite 한 번 질문 한도(32766)보다 많아도 찾기가 행을 읽는다.

실제 임시 SQLite에 가상 공장 행을 넣고, 나누는 크기를 작게 바꿔 여러 번 나눠 읽는 길을 확인한다.
AI·외부 호출 없음.
"""

from __future__ import annotations

from datetime import date
from types import SimpleNamespace

import pytest

from geosan.config.errors import RunFailedError
from geosan.opportunity.source_models import SourceFactoryRow
from geosan.storage.base import utcnow
from geosan.storage.session import session_scope
from geosan.workflows import flow_ingest


def _rows(count: int, *, region="경기", missing: date | None = None) -> list[str]:
    ids = [f"factory-g{n:05d}" for n in range(count)]
    with session_scope() as session:
        for n, row_id in enumerate(ids):
            session.add(
                SourceFactoryRow(
                    row_id=row_id,
                    source_id="kicox-factory-csv",
                    file_date=date(2025, 12, 31),
                    company_name=f"가상경기{n}",
                    product="볼트",
                    address=f"경기도 {'오산시' if n % 2 else '평택시'} 가상로 {n}",
                    region=region,
                    product_hash="x" * 64,
                    loaded_at=utcnow(),
                    missing_since=missing,
                    is_virtual=True,
                )
            )
    return ids


def _batch(regions):
    return SimpleNamespace(criteria={"regions": regions})


def test_rows_more_than_one_chunk_are_all_read(tmp_db, monkeypatch):
    """Given 나누는 크기 3, 공장 행 8개 / When 검사·시·군 추리기
    Then 8개를 모두 읽어 통과하고 오산시 행만 남긴다(예전에는 한 번에 물어 경기에서 실패)."""
    monkeypatch.setattr(flow_ingest, "_ID_CHUNK", 3)
    ids = _rows(8)
    source = SimpleNamespace(row_ids=tuple(ids), scanned_count=8)
    flow_ingest._validate_source_rows(_batch(["오산시"]), source)
    picked = flow_ingest._selected_row_ids(_batch(["오산시"]), tuple(ids))
    assert picked == tuple(ids[1::2])


def test_missing_or_other_region_rows_are_still_refused_across_chunks(tmp_db, monkeypatch):
    """Given 나눠 읽는 행 가운데 지역 밖 행·없는 번호 / When 검사 / Then 지금처럼 거부한다."""
    monkeypatch.setattr(flow_ingest, "_ID_CHUNK", 2)
    ids = _rows(5, region="충남")
    with pytest.raises(RunFailedError, match="찾기 지역"):
        flow_ingest._validate_source_rows(
            _batch(["오산시"]), SimpleNamespace(row_ids=tuple(ids), scanned_count=5)
        )
    with pytest.raises(RunFailedError, match="찾기 지역"):
        flow_ingest._validate_source_rows(
            _batch(["충남"]),
            SimpleNamespace(row_ids=(*ids, "factory-none"), scanned_count=6),
        )


def test_more_rows_than_sqlite_variable_limit(tmp_db):
    """Given 한 지역 공장 행 33,000개(SQLite 한 번 질문 한도 32,766 초과, 경기 실제 7.8만)
    When 기본 나누기 크기로 검사 / Then "too many SQL variables" 없이 통과한다."""
    from sqlalchemy import insert

    count = 33_000
    now = utcnow()
    ids = [f"factory-big{n:06d}" for n in range(count)]
    with session_scope() as session:
        session.execute(
            insert(SourceFactoryRow),
            [
                {
                    "row_id": row_id,
                    "source_id": "kicox-factory-csv",
                    "file_date": date(2025, 12, 31),
                    "company_name": "가상경기",
                    "product": "볼트",
                    "address": "경기도 오산시 가상로 1",
                    "region": "경기",
                    "product_hash": "x" * 64,
                    "loaded_at": now,
                    "created_at": now,
                    "created_by": "system",
                    "is_virtual": True,
                }
                for row_id in ids
            ],
        )
    source = SimpleNamespace(row_ids=tuple(ids), scanned_count=count)
    flow_ingest._validate_source_rows(_batch(["오산시"]), source)
    assert len(flow_ingest._selected_row_ids(_batch(["오산시"]), tuple(ids))) == count
