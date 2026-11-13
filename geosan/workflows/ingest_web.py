"""#688(#314): 후보 찾기의 웹 검색 갈래. 공공자료 갈래의 등록·평가가 끝난 뒤에만 부른다(C1).

검색(저장 결과가 있으면 다시 씀) → "조회 대기"로 보관 → 공장등록 조회 → 확인된 회사만
AI 판단·등록 순서다. 등록 자료에서 못 찾은 회사를 목록에 넣는 일은 이 조각에 없다.
오류를 빈 성공으로 바꾸지 않는다. 건너뜀으로 적는 것은 약속의 두 가지(꺼짐·하루 한도)뿐이다.
"""

from sqlalchemy import select

from geosan.config.errors import InputError, RunFailedError
from geosan.opportunity.candidate_judgments import rank_candidates, select_candidates
from geosan.opportunity.candidate_pick import pick_candidates
from geosan.opportunity.candidate_registration import register_candidates, registered_row_ids
from geosan.opportunity.candidate_registry import lookup_candidate_registry
from geosan.opportunity.candidate_web import load_search_context, search_candidates
from geosan.opportunity.candidate_web_results import WebSearchCandidate
from geosan.opportunity.complex_store import API_SOURCE_ID
from geosan.opportunity.models import Customer, IngestBatch, Opportunity
from geosan.opportunity.queries import normalize_name
from geosan.opportunity.source_models import SourceContract, WebCandidate, WebSearchRun
from geosan.opportunity.web_candidate_store import (
    address_in_regions,
    find_cached_web_search,
    save_web_search,
)
from geosan.storage.session import session_scope

# src_web_candidate.droppedReason에 남기는 글(40자 안). 화면에는 나가지 않는다.
DROP_OUT_OF_REGION = "선택 지역 밖"
DROP_ADDRESS_MISMATCH = "등록 주소 불일치"
DROP_NO_ADDRESS = "주소 없음 · 확인 필요"
DROP_NO_PRODUCT = "생산품 요약 확인 불가"
# 한도·꺼짐은 남은 후보도 같은 결과라 조회를 멈춘다. 그 밖의 실패는 그 후보만 조회 대기로 둔다.
_STOP_LOOKUP = {"DAILY_LIMIT", "DISABLED"}


def _batch(session, batch_id):
    batch = session.get(IngestBatch, batch_id)
    if batch is None or batch.status != "RUNNING":
        raise InputError("실행 중인 후보 찾기 회차만 웹 후보를 찾을 수 있습니다.")
    return batch


def _skip(batch_id, reason):
    with session_scope() as session:
        batch = _batch(session, batch_id)
        batch.web_search_used = False
        batch.web_skipped_reason = reason


def _mark(candidate_id, *, status=None, dropped=None):
    with session_scope() as session:
        row = session.get(WebCandidate, candidate_id)
        if status is not None:
            row.registry_status = status
        if dropped is not None:
            row.dropped_reason = dropped


def _open_rows(run_id, status):
    with session_scope() as session:
        rows = session.scalars(
            select(WebCandidate)
            .where(
                WebCandidate.run_id == run_id,
                WebCandidate.registry_status == status,
                WebCandidate.dropped_reason.is_(None),
            )
            .order_by(WebCandidate.candidate_id)
        ).all()
        return [
            (
                row.candidate_id,
                WebSearchCandidate(row.company_name, row.address, row.source_url, row.snippet),
            )
            for row in rows
        ]


def _lookup_pending(batch_id, run_id, regions):
    """조회 대기 후보를 공장등록 조회로 확인한다. 끝내지 못한 후보는 조회 대기로 남는다."""
    for candidate_id, candidate in _open_rows(run_id, "PENDING"):
        if not address_in_regions(candidate.address, regions):
            _mark(candidate_id, dropped=DROP_OUT_OF_REGION)
            continue
        result = lookup_candidate_registry(batch_id, candidate)
        if result.skipped_reason in _STOP_LOOKUP:
            break
        if result.skipped_reason is not None:
            continue
        if result.registry_status is not None:
            _mark(candidate_id, status=result.registry_status)
            continue
        # 조회는 끝났지만 한 곳으로 확정하지 못했다. 같은 이름이 등록돼 있으면 다른 회사일 수
        # 있어 넣지 않고 이유만 남긴다(PM 결정 2026-11-13). 이름이 다르면 등록 자료에 없는 것이다.
        name = normalize_name(candidate.company_name)
        same_name = any(normalize_name(row.company_name) == name for row in result.rows)
        has_address = bool(candidate.address and candidate.address.strip())
        _mark(
            candidate_id,
            status="NOT_FOUND",
            dropped=(DROP_ADDRESS_MISMATCH if has_address else DROP_NO_ADDRESS)
            if same_name
            else None,
        )


def _found_ids(run_id):
    """등록 확인이 끝난 후보 가운데 판단·등록에 쓸 수 있는 것. 생산품 요약이 없으면 뺀다."""
    limit = Opportunity.__table__.c.item.type.length
    ids = []
    for candidate_id, candidate in _open_rows(run_id, "FOUND"):
        snippet = (candidate.snippet or "").strip()
        if not snippet or len(candidate.snippet) > limit:
            _mark(candidate_id, dropped=DROP_NO_PRODUCT)
            continue
        ids.append(candidate_id)
    return ids


def _new_opportunities(session, batch):
    return set(
        session.scalars(
            select(Opportunity.opp_id)
            .join(Customer, Customer.customer_id == Opportunity.customer_id)
            .where(
                Customer.ingest_batch_id == batch.batch_id,
                Opportunity.dataset_kind == batch.dataset_kind,
            )
        )
    )


def _register(batch_id, matched, maximum):
    with session_scope() as session:
        session.connection().exec_driver_sql("BEGIN IMMEDIATE")
        batch = _batch(session, batch_id)
        registered = registered_row_ids(session, batch_id, matched, source_kind="WEB")
        fresh = [item for item in matched if item.row_id not in registered]
        known = [item for item in matched if item.row_id in registered]
        # 최대 건수는 회차 전체의 것이다. 공공자료 갈래가 쓰고 남은 자리만 웹 후보로 채운다.
        room = max(maximum - batch.new_count, 0)
        selected = [*rank_candidates(fresh)[:room], *known]
        before = _new_opportunities(session, batch)
        result = register_candidates(session, batch_id, selected, source_kind="WEB")
        counts = (result.new_count, result.skipped_count, result.merge_candidate_count)
        if any(type(value) is not int or value < 0 for value in counts):
            raise RunFailedError("웹 후보 등록 결과의 건수를 확인해 주세요.")
        session.flush()
        affected = sorted(_new_opportunities(session, batch) - before)
        batch.new_count += result.new_count
        batch.skipped_count += result.skipped_count
        batch.merge_candidate_count += result.merge_candidate_count
        return affected


def _record(batch_id, run_id, from_cache):
    with session_scope() as session:
        batch = _batch(session, batch_id)
        run = session.get(WebSearchRun, run_id)
        dropped = len(
            session.scalars(
                select(WebCandidate.candidate_id).where(
                    WebCandidate.run_id == run_id, WebCandidate.dropped_reason.is_not(None)
                )
            ).all()
        )
        batch.web_search_used = True
        batch.web_skipped_reason = None
        batch.web_candidate_count = run.result_count
        batch.web_dropped_count = run.dropped_count + dropped
        batch.web_from_cache = from_cache


def run_web_branch(batch_id: str, *, process_codes, industries, max_candidates: int) -> list[str]:
    """웹 갈래를 한 번 돌리고, 이번에 새로 들어온 회사의 기회 번호를 돌려준다."""
    context = load_search_context(batch_id)
    if not context.enabled:
        _skip(batch_id, "DISABLED")
        return []
    # 검색 비용을 쓰기 전에 등록 확인에 쓸 소스의 이용 확인부터 본다.
    with session_scope() as session:
        contract = session.get(SourceContract, API_SOURCE_ID)
        if contract is None or contract.confirmed_at is None:
            raise InputError("공장등록 조회 소스의 이용·저장 확인을 먼저 기록해 주세요.")
    stored = find_cached_web_search(batch_id)
    if stored is None:
        result = search_candidates(batch_id)
        if result.skipped_reason is not None:
            _skip(batch_id, result.skipped_reason)
            return []
        stored = save_web_search(
            batch_id, result, registry_statuses=["PENDING"] * len(result.candidates)
        )
    _lookup_pending(batch_id, stored.run_id, context.regions)
    found = _found_ids(stored.run_id)
    affected: list[str] = []
    if found:
        judgments = pick_candidates(batch_id, found, source_kind="WEB")
        if {row.row_id for row in judgments} != set(found):
            raise RunFailedError("요청한 웹 후보 전체의 판단을 받지 못했습니다.")
        matched = select_candidates(judgments, process_codes=process_codes, industries=industries)
        if matched:
            affected = _register(batch_id, matched, max_candidates)
    _record(batch_id, stored.run_id, stored.from_cache)
    return affected
