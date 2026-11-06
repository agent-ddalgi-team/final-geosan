"""공개 CSV 행을 PM의 src_factory_row에 저장한다(C5·C6, #366).

읽기·갱신은 하나의 저장 묶음이다. 회사 등록·판단 저장·AI 호출은 하지 않는다.
반환한 행 ID는 전송 승인 결과가 아니다. 실제 어댑터가 승인과 본문 조회를 맡는다.
"""

from collections import defaultdict
from dataclasses import dataclass
from datetime import date
from pathlib import Path

from sqlalchemy import select
from sqlalchemy.exc import SQLAlchemyError

from geosan.config.app_settings import (
    DEFAULT_APP_SETTINGS_PATH,
    load_app_settings,
    read_app_settings,
)
from geosan.config.errors import AppError, InputError, NotFoundError, RunFailedError
from geosan.opportunity.factory_csv import SOURCE_ID, FactoryCsvResult, read_factory_csv
from geosan.opportunity.models import IngestBatch
from geosan.opportunity.queries import normalize_address, normalize_name
from geosan.opportunity.source_models import SourceContract, SourceFactoryRow
from geosan.storage.base import new_id, utcnow
from geosan.storage.session import session_scope


@dataclass(frozen=True)
class StoredFactoryCsv:
    """원본 읽기 집계와 저장한 고유 행 ID. 읽기 성공은 후보 등록 성공이 아니다."""

    row_ids: tuple[str, ...]
    csv: FactoryCsvResult


def _context(session, batch_id):
    batch = session.get(IngestBatch, batch_id)
    if batch is None:
        raise NotFoundError("후보 찾기 회차를 찾을 수 없습니다.")
    if batch.status != "RUNNING":
        raise AppError(
            "실행 중인 후보 찾기 회차가 아닙니다.", "찾기 상태를 확인해 주세요.", status=409
        )
    if batch.source_id != SOURCE_ID:
        raise InputError("공장현황 파일을 읽는 회차인지 확인해 주세요.")
    contract = session.get(SourceContract, SOURCE_ID)
    if contract is None or contract.confirmed_at is None:
        raise InputError("공장현황 소스의 이용·저장 확인을 먼저 기록해 주세요.")
    regions = batch.criteria.get("regions") if isinstance(batch.criteria, dict) else None
    settings = read_app_settings(session) or load_app_settings(DEFAULT_APP_SETTINGS_PATH)
    if (
        not isinstance(regions, list)
        or not regions
        or any(not isinstance(value, str) or not value.strip() for value in regions)
        or len(set(regions)) != len(regions)
        or not set(regions) <= set(settings.ingestion.regions)
    ):
        raise InputError("회차에 저장된 찾기 지역을 확인해 주세요.")
    return batch, regions


def _unique_rows(rows):
    """같은 이름·주소라도 생산품·단지가 다르면 원문을 각각 남긴다."""
    unique = {}
    for row in rows:
        key = (*row.identity_key, row.product, row.complex_name)
        unique.setdefault(key, row)
    return tuple(unique.values())


def _match_rows(existing, incoming):
    """원문이 같은 행부터 맞추고, 남은 행이 양쪽 하나씩일 때만 변경으로 본다.

    같은 이름·주소에 서로 다른 원문이 여러 개면 임의로 하나를 덮어쓰지 않는다.
    새 원문을 별도 행으로 보존하고 예전 행의 누락 처리는 새 파일 규칙에 맡긴다.
    """
    old_groups = defaultdict(list)
    new_groups = defaultdict(list)
    for row in existing:
        old_groups[(normalize_name(row.company_name), normalize_address(row.address))].append(row)
    for row in incoming:
        new_groups[row.identity_key].append(row)
    matches = {}
    for key, rows in new_groups.items():
        remaining = list(old_groups[key])
        unmatched = []
        for row in rows:
            exact = [
                old
                for old in remaining
                if (old.product, old.complex_name) == (row.product, row.complex_name)
            ]
            if len(exact) > 1:
                raise InputError(
                    "같은 공장 원문이 저장소에 중복돼 있습니다. 저장 자료를 확인해 주세요."
                )
            if exact:
                matches[row] = exact[0]
                remaining.remove(exact[0])
            else:
                unmatched.append(row)
        if len(remaining) == len(unmatched) == 1:
            matches[unmatched[0]] = remaining[0]
    return matches


def store_factory_csv(
    batch_id: str, path: Path, file_date: date, *, db_path: Path | str | None = None
) -> StoredFactoryCsv:
    """회차의 선택 지역에 해당하는 공개 원문을 저장하고 ID를 돌려준다.

    같은 원본의 재입력·순번 변경은 ID를 바꾸지 않는다. 더 오래된 파일은 거부한다.
    완전히 읽은 새 파일에서 사라진 행은 지우지 않고 missing_since를 채운다.
    건너뛴 오류 행이 있으면 사라졌다고 단정할 수 없어 누락 표시는 보류하고,
    호출자에게 csv.skipped_rows를 그대로 돌려준다. 다른 지역·소스는 건드리지 않는다.
    상태·선정 건수·회사 등록 성공 처리는 후속 run_ingest의 책임이다.
    """
    if not isinstance(batch_id, str) or not batch_id.strip() or type(file_date) is not date:
        raise InputError("후보 찾기 회차 번호와 원본 파일 기준일을 확인해 주세요.")
    try:
        path = Path(path)
    except (TypeError, ValueError):
        raise InputError("공장현황 파일 위치를 확인해 주세요.") from None
    try:
        with session_scope(db_path) as session:
            # 승인·회차 확인과 원본 갱신을 한 쓰기 잠금으로 묶는다. HTTP 호출은 없다.
            session.connection().exec_driver_sql("BEGIN IMMEDIATE")
            batch, regions = _context(session, batch_id)
            result = read_factory_csv(path, regions=regions)
            incoming = _unique_rows(result.rows)
            existing = session.scalars(
                select(SourceFactoryRow).where(
                    SourceFactoryRow.source_id == SOURCE_ID,
                    SourceFactoryRow.region.in_(regions),
                )
            ).all()
            if any(
                row.file_date is None
                or row.file_date > file_date
                or (row.missing_since is not None and row.missing_since > file_date)
                for row in existing
            ):
                raise InputError("저장된 공장 자료보다 오래되었거나 기준일이 맞지 않는 파일입니다.")
            matches = _match_rows(existing, incoming)
            now = utcnow()
            stored_ids = []
            for row in incoming:
                stored = matches.get(row)
                if stored is None:
                    stored = SourceFactoryRow(
                        row_id=new_id("factory"),
                        source_id=SOURCE_ID,
                        created_by=batch.requested_by,
                        is_virtual=batch.is_virtual,
                        dataset_kind=batch.dataset_kind,
                        session_ref=batch.session_ref,
                    )
                    session.add(stored)
                stored.company_name = row.company_name
                stored.complex_name = row.complex_name
                stored.product = row.product
                stored.address = row.address
                stored.region = row.region
                stored.product_hash = row.product_hash
                stored.file_date = file_date
                stored.loaded_at = now
                stored.missing_since = None
                stored_ids.append(stored.row_id)
            if not result.skipped_rows:
                seen = set(stored_ids)
                for row in existing:
                    if (
                        row.row_id not in seen
                        and row.file_date < file_date
                        and row.missing_since is None
                    ):
                        row.missing_since = file_date
            session.flush()
        return StoredFactoryCsv(tuple(stored_ids), result)
    except SQLAlchemyError:
        raise RunFailedError("공개 공장 행을 저장하지 못했습니다.") from None
