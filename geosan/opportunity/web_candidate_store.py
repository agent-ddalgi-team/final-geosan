"""#499: 검색 결과·생산품 요약의 원자적 저장과 보관 결과 조회(C6·C9).

등록 조회 전 상태는 아직 계약에 없으므로, 호출자가 실제 확인한 FOUND/NOT_FOUND를 받는다.
이 부품은 등록 여부를 추정하거나 회사를 등록하지 않는다. 외부 호출·저장 재시도도 없다.
"""

from dataclasses import dataclass
from datetime import timedelta
from urllib.parse import urlsplit

from sqlalchemy import select
from sqlalchemy.exc import SQLAlchemyError

from geosan.config.errors import InputError, NotFoundError, RunFailedError
from geosan.opportunity.candidate_judgments import _labels
from geosan.opportunity.candidate_web import CandidateSearchResult, load_search_context
from geosan.opportunity.candidate_web_results import (
    WebSearchCandidate,
    can_reuse_search,
    safe_public_text,
    source_url,
)
from geosan.opportunity.factory_csv import _region_name, parent_regions, row_in_selected_regions
from geosan.opportunity.ingest_errors import storage_failure
from geosan.opportunity.models import IngestBatch
from geosan.opportunity.source_models import (
    WebCandidate,
    WebSearchRun,
    public_source_kinds,
    shares_public_source,
)
from geosan.storage.base import new_id, utcnow
from geosan.storage.session import session_scope


@dataclass(frozen=True)
class StoredWebSearch:
    run_id: str
    candidate_ids: tuple[str, ...]
    dropped_count: int
    from_cache: bool


@dataclass(frozen=True)
class WebJudgmentRow:
    """C9와 같은 입력의 임시 자료. 공공 공장 표에는 행을 만들지 않는다."""

    row_id: str
    company_name: str
    address: str | None
    product: str | None
    source_url: str
    dataset_kind: str
    is_virtual: bool
    source_id: str = "WEB_SEARCH"
    complex_name: None = None
    industry_name: None = None


def _check_candidate(candidate, context):
    if (
        not isinstance(candidate.company_name, str)
        or not candidate.company_name.strip()
        or len(candidate.company_name) > WebCandidate.__table__.c.company_name.type.length
        or any(
            value is not None and not isinstance(value, str)
            for value in (candidate.address, candidate.snippet)
        )
        or (
            candidate.address is not None
            and len(candidate.address) > WebCandidate.__table__.c.address.type.length
        )
        or any(
            not safe_public_text(value)
            for value in (candidate.company_name, candidate.address, candidate.snippet)
            if value
        )
    ):
        raise InputError("웹 후보의 공개 본문에 인명·연락처나 잘못된 값이 있습니다.")
    url = source_url(candidate.source_url, context.blocked_domains)
    if (
        url is None
        or len(urlsplit(url).hostname) > WebCandidate.__table__.c.source_domain.type.length
    ):
        raise InputError("웹 후보의 공개 출처 주소를 확인해 주세요.")
    return url


def _fresh(run, context, batch, now):
    return (
        shares_public_source(run.dataset_kind, batch.dataset_kind)
        and run.is_virtual == batch.is_virtual
        and can_reuse_search(
            stored_hash=run.criteria_hash,
            current_hash=context.criteria_hash,
            searched_at=run.searched_at,
            expires_at=run.expires_at,
            cache_days=context.cache_days,
            now=now,
        )
    )


def _validated_rows(session, run, context, batch):
    rows = session.scalars(
        select(WebCandidate)
        .where(WebCandidate.run_id == run.run_id)
        .order_by(WebCandidate.candidate_id)
    ).all()
    if (
        type(run.result_count) is not int
        or run.result_count != len(rows)
        or run.result_count > context.maximum
        or type(run.dropped_count) is not int
        or run.dropped_count < 0
    ):
        raise RunFailedError("보관한 웹 검색의 후보 목록과 건수가 맞지 않습니다.")
    for row in rows:
        url = _check_candidate(row, context)
        if (
            not shares_public_source(row.dataset_kind, batch.dataset_kind)
            or row.is_virtual != batch.is_virtual
            or row.source_domain != urlsplit(url).hostname
            or row.registry_status not in {"FOUND", "NOT_FOUND"}
        ):
            raise InputError("웹 후보의 자료 묶음·출처·등록 확인 상태를 확인해 주세요.")
    return rows


def _cached(session, context, batch):
    run = session.scalars(
        select(WebSearchRun)
        .where(
            WebSearchRun.criteria_hash == context.criteria_hash,
            WebSearchRun.dataset_kind.in_(public_source_kinds(batch.dataset_kind)),
            WebSearchRun.is_virtual == batch.is_virtual,
        )
        .order_by(WebSearchRun.searched_at.desc(), WebSearchRun.run_id.desc())
    ).first()
    if run is None or not _fresh(run, context, batch, utcnow()):
        return None
    rows = _validated_rows(session, run, context, batch)
    return StoredWebSearch(
        run.run_id, tuple(row.candidate_id for row in rows), run.dropped_count, True
    )


def find_cached_web_search(batch_id: str, *, db_path=None) -> StoredWebSearch | None:
    """빈 성공도 재사용한다. 망가진 보관 결과는 빈 성공으로 취급하지 않는다."""
    try:
        with session_scope(db_path) as session:
            session.connection().exec_driver_sql("BEGIN")
            context = load_search_context(batch_id, session=session)
            if not context.enabled:
                return None
            return _cached(session, context, session.get(IngestBatch, batch_id))
    except SQLAlchemyError as error:
        raise storage_failure(
            error, operation="web", message="보관한 웹 검색 결과를 읽지 못했습니다."
        ) from None


def save_web_search(
    batch_id: str, result: CandidateSearchResult, *, registry_statuses, db_path=None
) -> StoredWebSearch:
    """호출자가 조회한 등록 여부를 결과 순서대로 받는다. 실패 시 결과 전체를 되돌린다."""
    if not isinstance(result, CandidateSearchResult) or result.skipped_reason is not None:
        raise InputError("성공한 웹 검색 결과만 저장할 수 있습니다.")
    if (
        not isinstance(registry_statuses, (list, tuple))
        or len(registry_statuses) != len(result.candidates)
        or any(
            not isinstance(value, str) or value not in {"FOUND", "NOT_FOUND"}
            for value in registry_statuses
        )
        or any(not isinstance(value, WebSearchCandidate) for value in result.candidates)
        or type(result.dropped_count) is not int
        or result.dropped_count < 0
    ):
        raise InputError("각 웹 후보의 실제 등록 조회 결과를 확인해 주세요.")
    try:
        with session_scope(db_path) as session:
            session.connection().exec_driver_sql("BEGIN IMMEDIATE")
            context = load_search_context(batch_id, session=session)
            batch = session.get(IngestBatch, batch_id)
            if (
                not context.enabled
                or len(result.candidates) > context.maximum
                or not can_reuse_search(
                    stored_hash=result.criteria_hash,
                    current_hash=context.criteria_hash,
                    searched_at=result.searched_at,
                    expires_at=result.expires_at,
                    cache_days=context.cache_days,
                    now=utcnow(),
                )
            ):
                raise InputError("검색 이후 조건이 바뀌었거나 보관 기간이 끝났습니다.")
            urls = [_check_candidate(row, context) for row in result.candidates]
            cached = _cached(session, context, batch)
            if cached is not None:
                return cached
            common = dict(
                created_by=batch.requested_by,
                dataset_kind=batch.dataset_kind,
                is_virtual=batch.is_virtual,
                session_ref=batch.session_ref,
            )
            run_id = new_id("websearch")
            session.add(
                WebSearchRun(
                    run_id=run_id,
                    criteria=batch.criteria,
                    criteria_hash=result.criteria_hash,
                    searched_at=result.searched_at,
                    expires_at=min(
                        result.expires_at, result.searched_at + timedelta(days=context.cache_days)
                    ),
                    result_count=len(result.candidates),
                    dropped_count=result.dropped_count,
                    requested_by=batch.requested_by,
                    **common,
                )
            )
            session.flush()
            ids = []
            for candidate, url, status in zip(
                result.candidates, urls, registry_statuses, strict=True
            ):
                candidate_id = new_id("webcandidate")
                session.add(
                    WebCandidate(
                        candidate_id=candidate_id,
                        run_id=run_id,
                        company_name=candidate.company_name,
                        address=candidate.address,
                        source_url=url,
                        source_domain=urlsplit(url).hostname,
                        snippet=candidate.snippet,
                        registry_status=status,
                        **common,
                    )
                )
                ids.append(candidate_id)
            session.flush()
            return StoredWebSearch(run_id, tuple(sorted(ids)), result.dropped_count, False)
    except SQLAlchemyError as error:
        raise storage_failure(
            error, operation="web", message="웹 검색 결과를 저장하지 못했습니다."
        ) from None


def web_judgment_rows(session, batch, ids):
    """현재 회차 조건의 유효한 검색 결과에 속한 ID만 판단에 승인한다."""
    ids = _labels(ids)
    context = load_search_context(batch.batch_id, session=session)
    if not context.enabled:
        raise InputError("웹 후보 검색 설정이 꺼져 있습니다.")
    rows = {
        row.candidate_id: row
        for row in session.scalars(select(WebCandidate).where(WebCandidate.candidate_id.in_(ids)))
    }
    if set(rows) != set(ids):
        raise NotFoundError("판단할 웹 후보를 찾을 수 없습니다.")
    for run_id in {row.run_id for row in rows.values()}:
        run = session.get(WebSearchRun, run_id)
        if run is None or not _fresh(run, context, batch, utcnow()):
            raise InputError("현재 조건의 보관 기간 안에 있는 웹 후보만 판단할 수 있습니다.")
        _validated_rows(session, run, context, batch)
    if any(row.dropped_reason is not None for row in rows.values()):
        raise InputError("제외한 웹 후보는 판단할 수 없습니다.")
    # 검색 조건이 맞아도 답에는 다른 지역이 섞일 수 있다(#529). 저장·재사용·전송의
    # 공통 승인 단계에서 원래 선택(시·군 포함)을 검사한다. C9의 빈 주소는 채우지 않는다.
    parents = parent_regions(context.regions)
    for row in rows.values():
        if row.address and row.address.strip():
            region = _region_name(row.address.split()[0])
            if region not in parents or not row_in_selected_regions(
                region, row.address, context.regions
            ):
                raise InputError("웹 후보의 주소가 이번 회차의 선택 지역인지 확인해 주세요.")
    return {
        key: WebJudgmentRow(
            key,
            row.company_name,
            row.address,
            row.snippet,
            row.source_url,
            row.dataset_kind,
            row.is_virtual,
        )
        for key, row in rows.items()
    }
