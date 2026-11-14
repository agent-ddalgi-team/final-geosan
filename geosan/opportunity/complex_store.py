"""C5·C6: 조회별 공개 행 목록 저장과 기간 내 성공 결과 재사용(#437).

외부 호출은 하지 않는다. 공개 행·조회 기록은 한 번에 저장하고, 호출 장부는 별도로 보존한다.
"""

from __future__ import annotations

import hashlib
import re
from collections import defaultdict
from dataclasses import dataclass
from datetime import datetime, timedelta
from pathlib import Path
from typing import TYPE_CHECKING

from sqlalchemy import select
from sqlalchemy.exc import SQLAlchemyError

from geosan.config.errors import InputError
from geosan.evidence.contacts import scrub_contacts
from geosan.opportunity.complex_rows import ComplexFactoryRow
from geosan.opportunity.factory_csv import SOURCE_ID as CSV_SOURCE_ID
from geosan.opportunity.factory_csv import _region_name
from geosan.opportunity.factory_store import _context
from geosan.opportunity.ingest_errors import storage_failure
from geosan.opportunity.queries import normalize_address, normalize_name
from geosan.opportunity.source_models import (
    ComplexFetch,
    SourceFactoryRow,
    public_source_kinds,
    shares_public_source,
)
from geosan.storage.base import new_id, utcnow
from geosan.storage.session import session_scope

if TYPE_CHECKING:
    from geosan.opportunity.complex_collection import ComplexCollectionResult

API_SOURCE_ID = "kicox-production-api"


@dataclass(frozen=True)
class StoredComplexRows:
    row_ids: tuple[str, ...]
    fetched_count: int
    reused_count: int
    skipped_reason: str | None


@dataclass(frozen=True)
class CachedComplexRows:
    fetch_id: str
    fetched_at: datetime
    rows: tuple[ComplexFactoryRow, ...]
    row_ids: tuple[str, ...]


def _public_row(row):
    values = (row.company_name, row.address, row.product, row.complex_name, row.industry_name)
    if (
        any(not isinstance(value, str) for value in values[:3])
        or any(value is not None and not isinstance(value, str) for value in values)
        or not row.company_name.strip()
        or not row.address.strip()
        or row.product is None
        or any(scrub_contacts(value)[1] for value in values if value)
        or row.product_hash != hashlib.sha256(row.product.encode("utf-8")).hexdigest()
        or row.region != _region_name(row.address.split()[0].rstrip(","))
        or (
            row.factory_manage_no is not None
            and (
                not isinstance(row.factory_manage_no, str)
                or not re.fullmatch(r"[A-Za-z0-9_-]+", row.factory_manage_no)
            )
        )
    ):
        raise InputError("저장할 공개 공장 행의 내용과 지역을 확인해 주세요.")
    return ComplexFactoryRow(
        row.company_name,
        row.complex_name,
        row.product,
        row.address,
        row.region,
        row.product_hash,
        row.industry_name,
        row.factory_manage_no,
    )


def _cached(session, fetch, batch, now):
    if (
        fetch is None
        or fetch.status != "OK"
        or fetch.expires_at <= now
        or fetch.fetched_at > now
        or not shares_public_source(fetch.dataset_kind, batch.dataset_kind)
        or fetch.is_virtual != batch.is_virtual
        or not isinstance(fetch.row_ids, list)
        or any(not isinstance(value, str) or not value for value in fetch.row_ids)
        or len(set(fetch.row_ids)) != len(fetch.row_ids)
        or len(fetch.row_ids) != fetch.row_count
    ):
        return None
    stored = session.scalars(
        select(SourceFactoryRow).where(SourceFactoryRow.row_id.in_(fetch.row_ids))
    ).all()
    by_id = {row.row_id: row for row in stored}
    if len(by_id) != len(fetch.row_ids) or any(
        row.source_id not in (API_SOURCE_ID, CSV_SOURCE_ID)
        or not shares_public_source(row.dataset_kind, batch.dataset_kind)
        or row.is_virtual != batch.is_virtual
        or row.missing_since is not None
        for row in stored
    ):
        return None
    try:
        rows = tuple(_public_row(by_id[value]) for value in fetch.row_ids)
    except (InputError, UnicodeError):
        # 불완전한 과거 기록은 캐시 적중이 아니다. 호출자는 실제 조회로 다시 확인한다.
        return None
    return CachedComplexRows(fetch.fetch_id, fetch.fetched_at, rows, tuple(fetch.row_ids))


def read_cached_complex(batch_id, name, *, db_path=None):
    """완전한 성공 조회만 읽는다. 빈 성공은 반환하고, 행 목록이 깨진 기록은 재조회한다."""
    with session_scope(db_path) as session:
        batch, _ = _context(session, batch_id)
        now = utcnow()
        fetches = session.scalars(
            select(ComplexFetch)
            .where(
                ComplexFetch.complex_name == name,
                ComplexFetch.status == "OK",
                ComplexFetch.expires_at > now,
                ComplexFetch.dataset_kind.in_(public_source_kinds(batch.dataset_kind)),
                ComplexFetch.is_virtual == batch.is_virtual,
            )
            .order_by(ComplexFetch.fetched_at.desc(), ComplexFetch.fetch_id.desc())
        )
        for fetch in fetches:
            if (cached := _cached(session, fetch, batch, now)) is not None:
                return cached
    return None


def _identity(row):
    return normalize_name(row.company_name), normalize_address(row.address)


def _signature(row):
    return (row.company_name, row.address, row.product, row.complex_name, row.industry_name)


def _file_rows(session, batch, collected):
    files = session.scalars(
        select(SourceFactoryRow).where(
            SourceFactoryRow.source_id == CSV_SOURCE_ID,
            SourceFactoryRow.dataset_kind.in_(public_source_kinds(batch.dataset_kind)),
            SourceFactoryRow.is_virtual == batch.is_virtual,
            SourceFactoryRow.missing_since.is_(None),
        )
    ).all()
    by_identity = defaultdict(list)
    for row in files:
        by_identity[_identity(row)].append(row)
    ids = []
    for row in collected.combined.file_rows:
        matches = [
            old
            for old in by_identity[row.identity_key]
            if (old.product, old.complex_name, old.product_hash, old.region)
            == (row.product, row.complex_name, row.product_hash, row.region)
        ]
        if len(matches) != 1:
            raise InputError("단지 조회 전에 이번 공장 파일 행을 먼저 저장해 주세요.")
        ids.append(matches[0].row_id)
    return by_identity, ids


def _store_row(session, batch, row, fetched_at, files, api_rows, now):
    row = _public_row(row)
    file_matches = files.get(row.identity_key, ())
    if file_matches:
        # 생산품별 원문이 여러 개면 모두 남긴다. 조회 값으로 파일 원문을 덮지 않는다.
        return tuple(file_matches)
    matches = [
        old
        for old in api_rows
        if (
            old.factory_manage_no == row.factory_manage_no
            if row.factory_manage_no
            else old.factory_manage_no is None and _signature(old) == _signature(row)
        )
    ]
    if len(matches) > 1:
        raise InputError("같은 공장 조회 행이 중복 저장되어 있습니다. 저장 자료를 확인해 주세요.")
    stored = matches[0] if matches else None
    if stored is not None and stored.fetched_at is not None and stored.fetched_at > fetched_at:
        raise InputError("더 최근에 받은 공장 행이 있습니다. 이번 조회를 다시 확인해 주세요.")
    if stored is None:
        stored = SourceFactoryRow(
            row_id=new_id("factory"),
            source_id=API_SOURCE_ID,
            created_by=batch.requested_by,
            dataset_kind=batch.dataset_kind,
            is_virtual=batch.is_virtual,
            session_ref=batch.session_ref,
        )
        session.add(stored)
        api_rows.append(stored)
    for key in (
        "company_name",
        "complex_name",
        "product",
        "address",
        "region",
        "product_hash",
        "industry_name",
        "factory_manage_no",
    ):
        setattr(stored, key, getattr(row, key))
    stored.file_date = None
    stored.fetched_at = fetched_at
    stored.loaded_at = now
    stored.missing_since = None
    return (stored,)


def store_complex_rows(
    batch_id: str, collected: ComplexCollectionResult, *, db_path: Path | str | None = None
) -> StoredComplexRows:
    """collect_complex_rows 뒤 호출한다. 모든 지역을 저장하고 선택 지역의 ID만 반환한다.

    CSV는 먼저 store_factory_csv로 저장돼 있어야 한다. 실패하면 공개 행·조회 기록을 함께
    되돌리고 재시도하지 않는다. 외부 호출 기록·AI·회차 상태는 바꾸지 않는다.
    """
    from geosan.opportunity.complex_collection import ComplexCollectionResult
    from geosan.opportunity.complex_source import complex_settings_in_session

    if not isinstance(collected, ComplexCollectionResult) or collected.batch_id != batch_id:
        raise InputError("이번 회차에서 모은 단지 조회 결과를 넘겨 주세요.")
    try:
        with session_scope(db_path) as session:
            session.connection().exec_driver_sql("BEGIN IMMEDIATE")
            batch, _ = _context(session, batch_id)
            regions, config = complex_settings_in_session(session, batch_id)
            if (
                set(regions) != set(collected.regions)
                or tuple(config.extra_names) != collected.extra_names
            ):
                raise InputError("단지 조회 후 찾기 지역이나 추가 단지 설정이 바뀌었습니다.")
            files, ids = _file_rows(session, batch, collected)
            if not config.enabled:
                return StoredComplexRows(tuple(dict.fromkeys(ids)), 0, 0, "DISABLED")
            api_rows = list(
                session.scalars(
                    select(SourceFactoryRow).where(
                        SourceFactoryRow.source_id == API_SOURCE_ID,
                        SourceFactoryRow.dataset_kind.in_(public_source_kinds(batch.dataset_kind)),
                        SourceFactoryRow.is_virtual == batch.is_virtual,
                    )
                )
            )
            now = utcnow()
            fetched_ids, reused_ids = set(), set()
            for name, result in collected.lookups:
                if result.cached_fetch_id:
                    fetch = session.get(ComplexFetch, result.cached_fetch_id)
                    cached = _cached(session, fetch, batch, now)
                    if cached is None or fetch.complex_name != name:
                        raise InputError(
                            "단지 조회의 저장 목록이 바뀌었거나 만료됐습니다. 다시 조회해 주세요."
                        )
                    chosen = []
                    for row, row_id in zip(cached.rows, cached.row_ids, strict=True):
                        matches = files.get(row.identity_key, ())
                        if matches:
                            chosen.extend(old.row_id for old in matches if old.region in regions)
                        elif row.region in regions:
                            chosen.append(row_id)
                    reused_ids.update(chosen)
                else:
                    if (
                        result.all_rows is None
                        or result.fetched_at is None
                        or result.fetched_at.tzinfo is None
                        or result.fetched_at > now
                    ):
                        raise InputError(
                            "모든 지역을 읽은 단지 조회 결과와 받은 시각을 확인해 주세요."
                        )
                    all_ids, chosen = [], []
                    for row in result.all_rows:
                        for stored in _store_row(
                            session, batch, row, result.fetched_at, files, api_rows, now
                        ):
                            all_ids.append(stored.row_id)
                            if stored.region in regions:
                                chosen.append(stored.row_id)
                    all_ids = list(dict.fromkeys(all_ids))
                    session.add(
                        ComplexFetch(
                            fetch_id=new_id("complex"),
                            complex_name=name,
                            fetched_at=result.fetched_at,
                            expires_at=result.fetched_at + timedelta(days=config.cache_days),
                            row_count=len(all_ids),
                            row_ids=all_ids,
                            status="FAILED" if result.skipped_reason else "OK",
                            created_by=batch.requested_by,
                            dataset_kind=batch.dataset_kind,
                            is_virtual=batch.is_virtual,
                            session_ref=batch.session_ref,
                        )
                    )
                    fetched_ids.update(chosen)
                ids.extend(chosen)
            session.flush()
            return StoredComplexRows(
                tuple(dict.fromkeys(ids)),
                len(fetched_ids),
                len(reused_ids - fetched_ids),
                collected.skipped_reason,
            )
    except SQLAlchemyError as error:
        raise storage_failure(
            error, operation="factory", message="단지 조회 결과를 저장하지 못했습니다."
        ) from None
