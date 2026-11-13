"""#427: 운영자가 조건을 넣으면 회차를 예약하고 같은 실행 함수를 바로 이어서 부른다."""

import typer
from pydantic import ValidationError
from sqlalchemy import select

from geosan.capability.models import Process
from geosan.config.errors import AppError, InputError, RunFailedError, exit_code_for
from geosan.config.registry import load_runtime_config
from geosan.opportunity.factory_csv import SOURCE_ID
from geosan.opportunity.ingest_preview import ingest_budget, over_budget_error
from geosan.opportunity.models import IngestBatch
from geosan.storage.base import new_id, utcnow
from geosan.storage.engine import database_path
from geosan.storage.session import session_scope
from geosan.workflows.flow_ingest import run_ingest
from geosan.workflows.ingest_conditions import IngestRequest, validate_ingest_conditions


def reserve_command_batch(source_id, processes, regions, industries, maximum, rejudge):
    if source_id != SOURCE_ID:
        raise InputError("이 명령은 공장현황 파일 소스만 받습니다.")
    if type(rejudge) is not bool:
        raise InputError("다시 판단 여부를 확인해 주세요.")
    if not database_path().is_file():
        raise InputError("데이터베이스가 없습니다. 먼저 geosan init-db를 실행해 주세요.")
    try:
        body = IngestRequest.model_validate(
            {
                "sourceId": source_id,
                "processCodes": processes,
                "regions": regions,
                "industries": industries,
                "max": maximum,
            }
        )
    except ValidationError:
        raise InputError("공정·지역·산업·최대 건수를 확인해 주세요.") from None
    with session_scope() as session:
        session.connection().exec_driver_sql("BEGIN IMMEDIATE")
        runtime = load_runtime_config(session)
        dataset = runtime.app_settings.active_dataset_kind.value
        codes = session.scalars(select(Process.code).where(Process.dataset_kind == dataset)).all()
        prepared = validate_ingest_conditions(
            body, settings=runtime.app_settings, available_process_codes=set(codes)
        )
        if session.scalar(select(IngestBatch.batch_id).where(IngestBatch.status == "RUNNING")):
            raise AppError(
                "지금 가져오는 중입니다.",
                "현재 찾기가 끝난 뒤 다시 실행해 주세요.",
                status=409,
                kind="INGEST_RUNNING",
            )
        # 화면·API와 같은 예상 금액 검사. 넘으면 회차를 만들지 않는다(C8 #549, 우회 인자 없음).
        budget = ingest_budget(
            session,
            process_codes=prepared.process_codes,
            regions=prepared.regions,
            industries=prepared.industries,
            max_candidates=prepared.max_candidates,
            settings=runtime.app_settings,
            rejudge=rejudge,
        )
        if budget.blocked is not None:
            raise over_budget_error()
        now = utcnow()
        batch_id = new_id("batch")
        session.add(
            IngestBatch(
                batch_id=batch_id,
                source_id=prepared.source_id,
                requested_by="SYSTEM",
                started_at=now,
                status="RUNNING",
                max_candidates=prepared.max_candidates,
                rejudge=rejudge,
                estimated_usd=budget.estimate.total_usd,
                dataset_kind=dataset,
                is_virtual=dataset == "VIRTUAL_REVIEWED",
                created_by="SYSTEM",
                created_at=now,
                criteria={
                    "processCodes": list(prepared.process_codes),
                    "regions": prepared.regions,
                    "industries": prepared.industries,
                },
            )
        )
    return batch_id


def _summary(batch_id):
    with session_scope() as session:
        row = session.get(IngestBatch, batch_id)
        if row is None or row.status not in {"DONE", "FAILED"}:
            raise RunFailedError("후보 찾기 완료 상태를 확인하지 못했습니다.")
        text = (
            f"후보 찾기 {row.status}: 읽은 행 {row.scanned_count}건, 판단 {row.judged_count}건, "
            f"선정 {row.picked_count}건, 등록 {row.new_count}곳, "
            f"건너뜀 {row.skipped_count}건, 같은 회사 확인 {row.merge_candidate_count}건"
        )
        if row.status == "FAILED":
            text += f". 실패 사유: {row.failure_reason}"
        typer.echo(text)
        return row.status == "DONE"


def run_ingest_command(source_id, *, processes, regions, industries, maximum, rejudge):
    batch_id = None
    try:
        batch_id = reserve_command_batch(
            source_id, processes, regions, industries, maximum, rejudge
        )
        run_ingest(batch_id)
        return 0 if _summary(batch_id) else 2
    except AppError as error:
        if batch_id is not None:
            try:
                _summary(batch_id)
            except Exception:
                typer.echo("후보 찾기 실패 기록도 읽지 못했습니다. 저장소 상태를 확인해 주세요.")
                return 2
        else:
            typer.echo(f"후보 찾기 실패: {error.message} {error.next_action}")
        return exit_code_for(error)
    except Exception:
        typer.echo("후보 찾기 명령을 완료하지 못했습니다. 자료와 저장소 상태를 확인해 주세요.")
        return 2
