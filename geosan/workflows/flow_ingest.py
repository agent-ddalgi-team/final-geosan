"""#427 회차 번호로 후보 판단·등록·재평가·신규 회사 조사를 순서대로 실행한다.

PM이 #427에서 확정한 규격으로 공개 원본·판단·등록 부품을 연결한다.
검사에서는 외부 통신만 대체하고, 저장과 평가 및 목록 조회는 실제 부품을 쓴다.
"""

from dataclasses import dataclass
from pathlib import Path

from sqlalchemy import select

from geosan.config.errors import InputError, NotFoundError, RunFailedError
from geosan.config.registry import load_runtime_config
from geosan.evaluation.snapshot import _capability_snapshot
from geosan.opportunity.candidate_judgments import select_candidates
from geosan.opportunity.candidate_pick import pick_candidates
from geosan.opportunity.candidate_registration import register_candidates
from geosan.opportunity.complex_collection import collect_complex_rows
from geosan.opportunity.complex_store import store_complex_rows
from geosan.opportunity.factory_csv import SOURCE_ID
from geosan.opportunity.models import Customer, IngestBatch, Opportunity
from geosan.opportunity.source_models import SourceContract, SourceFactoryRow
from geosan.storage.base import utcnow
from geosan.storage.session import session_scope
from geosan.workflows.flow_evaluate import run_evaluation
from geosan.workflows.ingest_conditions import IngestRequest, validate_ingest_conditions
from geosan.workflows.ingest_sources import store_dated_factory_csv
from geosan.workflows.research import research_one


@dataclass(frozen=True)
class SourceRows:
    """원본 부품이 저장한 행 번호와 실제로 읽은 행 수. AI 전송 승인은 별도다."""

    row_ids: tuple[str, ...]
    scanned_count: int
    complex_skipped_reason: str | None = None


def load_source_rows(batch_id: str) -> SourceRows:
    """승인된 경로 설정으로 파일을 저장하고, 켜져 있을 때만 단지 조회를 잇는다."""
    with session_scope() as session:
        settings = load_runtime_config(session).app_settings.ingestion
    path = settings.factory_csv_path
    if not path.strip():
        raise InputError("공장현황 파일 경로 설정을 먼저 준비해 주세요.")
    stored = store_dated_factory_csv(batch_id, Path(path))
    if not settings.complex_list.enabled:
        return SourceRows(stored.row_ids, stored.csv.raw_count, "DISABLED")

    collected = collect_complex_rows(batch_id, stored.csv.rows)
    complex_rows = store_complex_rows(batch_id, collected)
    row_ids = tuple(dict.fromkeys((*stored.row_ids, *complex_rows.row_ids)))
    additional_count = len(set(row_ids) - set(stored.row_ids))
    return SourceRows(row_ids, stored.csv.raw_count + additional_count, complex_rows.skipped_reason)


def _running(session, batch_id):
    batch = session.get(IngestBatch, batch_id)
    if batch is None:
        raise NotFoundError("후보 찾기 회차를 찾을 수 없습니다.")
    if batch.status != "RUNNING":
        raise InputError("실행 중인 후보 찾기 회차만 시작할 수 있습니다.")
    return batch


def _context(batch):
    with session_scope() as session:
        runtime = load_runtime_config(session)
        settings = runtime.app_settings
        if batch.dataset_kind != settings.active_dataset_kind.value:
            raise InputError("후보 찾기 회차와 현재 자료 묶음이 다릅니다.")
        if batch.source_id != SOURCE_ID:
            raise InputError("공장현황 파일을 읽는 회차인지 확인해 주세요.")
        source = session.get(SourceContract, batch.source_id)
        if source is None or source.confirmed_at is None:
            raise InputError("공장현황 소스의 이용·저장 확인을 먼저 기록해 주세요.")
        if not isinstance(batch.criteria, dict) or set(batch.criteria) != {
            "processCodes",
            "regions",
            "industries",
        }:
            raise InputError("회차에 저장된 찾기 조건을 확인해 주세요.")
        codes = {row.code for row in _capability_snapshot(session, batch.dataset_kind).processes}
        body = IngestRequest.model_validate(
            {"sourceId": batch.source_id, "max": batch.max_candidates, **batch.criteria}
        )
        prepared = validate_ingest_conditions(
            body, settings=settings, available_process_codes=set(codes)
        )
        return prepared, settings


def _validate_source_rows(batch, source):
    if (
        type(source.scanned_count) is not int
        or source.scanned_count < 0
        or len(set(source.row_ids)) != len(source.row_ids)
    ):
        raise RunFailedError("읽은 공장 행 번호와 건수를 확인해 주세요.")
    with session_scope() as session:
        rows = session.scalars(
            select(SourceFactoryRow).where(SourceFactoryRow.row_id.in_(source.row_ids))
        ).all()
        if {row.row_id for row in rows} != set(source.row_ids) or any(
            row.region not in batch.criteria["regions"] or row.missing_since is not None
            for row in rows
        ):
            raise RunFailedError("찾기 지역의 현재 공장 행만 판단할 수 있습니다.")


def _new_opportunities(session, batch):
    return list(
        session.scalars(
            select(Opportunity.opp_id)
            .join(Customer, Customer.customer_id == Opportunity.customer_id)
            .where(
                Customer.ingest_batch_id == batch.batch_id,
                Opportunity.dataset_kind == batch.dataset_kind,
            )
            .order_by(Opportunity.opp_id)
        )
    )


def _register(batch_id, selected):
    with session_scope() as session:
        session.connection().exec_driver_sql("BEGIN IMMEDIATE")
        batch = _running(session, batch_id)
        before = set(_new_opportunities(session, batch))
        result = register_candidates(session, batch_id, selected)
        counts = (result.new_count, result.skipped_count, result.merge_candidate_count)
        if any(type(value) is not int or value < 0 for value in counts):
            raise RunFailedError("후보 등록 결과의 건수를 확인해 주세요.")
        session.flush()
        affected = [opp_id for opp_id in _new_opportunities(session, batch) if opp_id not in before]
        batch.new_count += result.new_count
        batch.skipped_count += result.skipped_count
        batch.merge_candidate_count += result.merge_candidate_count
        return affected


def _failed(batch_id, message):
    # 실패 기록 자체의 저장 실패는 숨기거나 저장 재시도하지 않는다.
    with session_scope() as session:
        batch = session.get(IngestBatch, batch_id)
        if batch is None:
            raise NotFoundError("후보 찾기 회차를 찾을 수 없습니다.")
        batch.status = "FAILED"
        batch.failure_reason = message
        batch.finished_at = utcnow()


def run_ingest(batch_id: str) -> None:
    """회차 조건을 다시 읽고 등록·회차 집계만 함께 확정한다(PM #427 결정)."""
    if not isinstance(batch_id, str) or not batch_id.strip():
        raise InputError("후보 찾기 회차 번호를 확인해 주세요.")
    with session_scope() as session:
        batch = _running(session, batch_id)
    stage = "찾기 조건 확인"
    try:
        prepared, settings = _context(batch)
        stage = "공공자료 읽기"
        # 공공자료 읽기가 실패하면 뒤 단계와 웹 검색(#314)은 실행하지 않는다.
        source = load_source_rows(batch_id)
        _validate_source_rows(batch, source)
        with session_scope() as session:
            current = _running(session, batch_id)
            current.scanned_count = source.scanned_count
            current.judge_pending_count = len(source.row_ids)
            current.complex_list_skipped_reason = source.complex_skipped_reason
        stage = "AI 후보 판단"
        judgments = pick_candidates(batch_id, source.row_ids) if source.row_ids else []
        if len(judgments) != len(source.row_ids) or {row.row_id for row in judgments} != set(
            source.row_ids
        ):
            raise RunFailedError("요청한 공장 행 전체의 판단을 받지 못했습니다.")
        by_id = {row.row_id: row for row in judgments}
        judgments = [by_id[row_id] for row_id in source.row_ids]
        with session_scope() as session:
            current = _running(session, batch_id)
            current.judged_count = len(judgments)
            current.judge_pending_count = 0
        selected = select_candidates(
            judgments, process_codes=prepared.process_codes, industries=prepared.industries
        )[: prepared.max_candidates]
        with session_scope() as session:
            _running(session, batch_id).picked_count = len(selected)
        stage = "후보 등록"
        affected = _register(batch_id, selected)
        stage = "새 후보 재평가"
        if affected:
            result = run_evaluation(opp_ids=affected, requested_by=batch.requested_by)
            if not result.ok:
                raise RunFailedError("새 후보의 재평가를 완료하지 못했습니다.")
        with session_scope() as session:
            current = _running(session, batch_id)
            current.status = "DONE"
            current.failure_reason = None
            current.finished_at = utcnow()
        stage = "새 후보 홈페이지 조사"
        if settings.homepage_discovery.auto_research and not batch.is_virtual:
            for opp_id in affected:
                result = research_one(opp_id)
                if result.error is not None or result.usage_unconfirmed:
                    raise RunFailedError("새 후보 홈페이지 조사를 완료하지 못했습니다.")
                with session_scope() as session:
                    current = session.get(IngestBatch, batch_id)
                    current.research_done_count += 1
                    current.finished_at = utcnow()
    except Exception as error:
        message = (
            error.message
            if isinstance(error, (InputError, RunFailedError))
            else f"{stage}을 마치지 못했습니다. 자료와 설정을 확인해 주세요."
        )
        _failed(batch_id, message)
        raise RunFailedError(message) from None
