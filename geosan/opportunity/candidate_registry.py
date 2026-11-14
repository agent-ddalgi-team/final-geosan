"""#512: 웹 후보 회사명 조회와 보수적인 등록 대조(C9·#314).

공식 명세: https://www.data.go.kr/data/15087611/openapi.do
기존 단지 조회의 HTTPS·XML·하루 한도를 재사용한다. 원문·개인정보는 보관하지 않는다.
등록을 확정하지 못한 None은 이 함수 안의 결과일 뿐 DB 상태값으로 저장하지 않는다.
회사 등록·공식 홈페이지 확인·웹 결과 저장은 호출자의 후속 흐름이다.
"""

import http.client
import os
from dataclasses import dataclass
from typing import Literal

from sqlalchemy.exc import SQLAlchemyError

from geosan.config.errors import InputError
from geosan.evidence.public_source import FactoryRegistryLimitError, reserve_factory_registry
from geosan.opportunity import complex_source as transport
from geosan.opportunity.candidate_web import load_search_context
from geosan.opportunity.candidate_web_results import WebSearchCandidate, safe_public_text
from geosan.opportunity.complex_rows import (
    ComplexFactoryRow,
    ComplexSourceError,
    combine_factory_rows,
    parse_complex_page,
)
from geosan.opportunity.factory_csv import _region_name, address_district
from geosan.opportunity.ingest_errors import storage_failure
from geosan.opportunity.queries import normalize_address, normalize_name
from geosan.opportunity.source_models import SourceContract
from geosan.opportunity.web_candidate_store import _check_candidate
from geosan.storage.session import session_scope


@dataclass(frozen=True)
class RegistryLookupResult:
    """완료된 조회만 FOUND/NOT_FOUND. 미완료·동명이사는 저장할 확정값이 없다."""

    rows: tuple[ComplexFactoryRow, ...] = ()
    raw_count: int = 0
    pages_read: int = 0
    registry_status: Literal["FOUND", "NOT_FOUND"] | None = None
    matched_row: ComplexFactoryRow | None = None
    needs_confirmation: bool = False
    skipped_reason: str | None = None


def _unchanged(batch_id, context, db_path):
    with session_scope(db_path) as session:
        if load_search_context(batch_id, session=session) != context:
            raise InputError("등록 조회 중 웹 후보 찾기 설정이나 조건이 바뀌었습니다.")
        contract = session.get(SourceContract, transport.SOURCE_ID)
        if contract is None or contract.confirmed_at is None:
            raise InputError("공장등록 조회 소스의 이용·저장 확인을 먼저 기록해 주세요.")


def _page(batch_id, name, key, page_no, context, db_path):
    for attempt in range(2):
        _unchanged(batch_id, context, db_path)
        # 저장 실패는 HTTP 재시도에 섞지 않는다. 쪽 넘김·재시도도 각각 한 자리다.
        reserve_factory_registry(batch_id=batch_id, db_path=db_path)
        try:
            return transport._request_page(name, key, page_no, company_lookup=True)
        except transport._HttpError as error:
            if error.status not in (408, 429) and not 500 <= error.status < 600:
                raise ComplexSourceError() from None
        except (OSError, http.client.HTTPException):
            pass  # 한 번만 다시 읽으며 실패하면 미완료로 전달한다.
        if attempt == 1:
            raise ComplexSourceError() from None


def _result(candidate, context, rows, raw_count, pages_read, reason):
    if reason:
        return RegistryLookupResult(rows, raw_count, pages_read, skipped_reason=reason)
    named = [
        r for r in rows if normalize_name(r.company_name) == normalize_name(candidate.company_name)
    ]
    if not rows:
        return RegistryLookupResult(rows, raw_count, pages_read, registry_status="NOT_FOUND")
    # #706 PM 결정 2026-11-13: 이름과 시·군이 같은 등록 행이 고른 지역 안에 하나면 확인됨.
    # 같은 시·군에 둘 이상이면 전체 주소가 똑같은 한 곳만 인정하고, 가릴 수 없으면 넘긴다.
    district = address_district(candidate.address)
    regions = {_region_name(region) for region in context.regions}
    nearby = [
        row
        for row in named
        if district and address_district(row.address) == district and row.region in regions
    ]
    address = normalize_address(candidate.address)
    exact = [row for row in nearby if normalize_address(row.address) == address]
    matched = exact if len(exact) == 1 else nearby
    if len(matched) == 1:
        return RegistryLookupResult(rows, raw_count, pages_read, "FOUND", matched[0])
    return RegistryLookupResult(rows, raw_count, pages_read, needs_confirmation=True)


def lookup_candidate_registry(batch_id: str, candidate: WebSearchCandidate, *, db_path=None):
    """검사한 웹 후보 한 곳을 끝까지 조회한다. 오류를 '등록 안 됨'으로 바꾸지 않는다.

    단지 조회 설정과 별개로 웹 후보 설정을 따른다. 이름·전체 주소가 일치하는 단일 행만
    확인한다. 주소 없음·주소 다름·같은 주소 여러 공장은 담당자가 확인할 대상으로 남긴다.
    부분 이름 일치·다른 지역을 자동으로 병합하지 않고 공개 원본 행도 만들지 않는다.
    """
    if not isinstance(candidate, WebSearchCandidate):
        raise InputError("검사를 마친 웹 후보를 넣어 주세요.")
    try:
        context = load_search_context(batch_id, db_path)
        _check_candidate(candidate, context)
        try:
            name = transport.validate_complex_name(candidate.company_name)
        except InputError:
            raise InputError("조회할 공개 회사 이름을 확인해 주세요.") from None
        if not context.enabled:
            return RegistryLookupResult(skipped_reason="DISABLED")
        key = os.environ.get("DATA_GO_KR_SERVICE_KEY", "").strip()
        if not key or not key.isascii() or not key.isprintable() or any(c.isspace() for c in key):
            return RegistryLookupResult(skipped_reason="SOURCE_ERROR")
        rows, raw_count, pages_read, total, reason = (), 0, 0, None, None
        while True:
            page_no = pages_read + 1
            try:
                xml = _page(batch_id, name, key, page_no, context, db_path)
                page = parse_complex_page(
                    xml,
                    regions=context.regions,
                    expected_page=page_no,
                    page_size=transport.PAGE_SIZE,
                    all_regions=True,
                )
                if total is not None and page.total_count != total:
                    raise ComplexSourceError()
                # 허용한 열 안에 인명 표제·연락처가 섞여 와도 결과로 넘기지 않는다.
                if page.skipped_rows or any(
                    value and not safe_public_text(value)
                    for row in page.rows
                    for value in (
                        row.company_name,
                        row.address,
                        row.product,
                        row.industry_name,
                        row.complex_name,
                    )
                ):
                    raise ComplexSourceError()
                combined = combine_factory_rows((), (*rows, *page.rows))
                # 쪽이 반복되거나 겹치면 전체 조회 완료라고 할 수 없다.
                if combined.duplicate_count:
                    raise ComplexSourceError()
                rows = combined.added_rows
                total = page.total_count
                raw_count += page.raw_count
                pages_read += 1
            except FactoryRegistryLimitError:
                reason = "DAILY_LIMIT"
                break
            except ComplexSourceError as error:
                reason = error.skipped_reason
                break
            if not page.has_more:
                break
        _unchanged(batch_id, context, db_path)
        return _result(candidate, context, rows, raw_count, pages_read, reason)
    except SQLAlchemyError as error:
        raise storage_failure(
            error, operation="web", message="웹 후보 공장등록 조회 기록을 저장하지 못했습니다."
        ) from None
