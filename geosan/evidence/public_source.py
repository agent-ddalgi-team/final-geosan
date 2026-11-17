"""C6·C9: 공장등록 조회 직전에 하루 한도를 확인하고 본문 없이 요청 1건을 기록한다.

단지명·회사명 조회, 쪽 넘김·재시도 모두 이 진입점을 쓴다(#393). 실제 HTTP·재시도·캐시는
호출자 책임이다. 한 번 예약한 호출은 실패해도 되돌리지 않는다. 저장 실패는 재시도하지 않고
전파하므로, 기록이 안 됐는데 외부 조회만 실행하는 일이 없어야 한다.
"""

from datetime import UTC, timedelta
from decimal import Decimal
from pathlib import Path

from sqlalchemy import func, select

from geosan.config.errors import AppError, InputError, NotFoundError
from geosan.evidence.transfer import KST, TransferLog
from geosan.opportunity.models import IngestBatch, Opportunity
from geosan.opportunity.source_models import SourceContract
from geosan.rules.codes import TransferKind, TransferPurpose
from geosan.storage.base import new_id, utcnow
from geosan.storage.session import session_scope

# 점수 규칙이 아니라 C9 ExternalSourceApi의 제공처 호출 상한이다.
_DAILY_LIMIT = 1000
_SOURCE_ID = "kicox-production-api"


class FactoryRegistryLimitError(AppError):
    """회차 실행자가 받은 데까지 쓰고 DAILY_LIMIT을 남길 수 있는 내부 오류."""

    skipped_reason = "DAILY_LIMIT"

    def __init__(self):
        super().__init__(
            "오늘 공장등록 조회 한도에 도달했습니다.",
            "받은 자료까지 쓰고 다음 날 다시 조회해 주세요.",
            status=503,
        )


def reserve_factory_registry(
    *,
    batch_id: str | None = None,
    opp_id: str | None = None,
    requested_by: str = "system",
    db_path: Path | str | None = None,
) -> str:
    """호출 직전 한 자리를 예약하고 기록 번호를 반환한다. 한도 초과는 기록 뒤 예외.

    회차 안의 목록·정보 채움은 batch_id, 회차 밖 조사는 opp_id 하나만 넘긴다.
    키·소스 설정·입력의 준비를 마친 호출자가 HTTP 시도마다 한 번씩 불러야 한다.
    HTTP를 실행하거나 설정의 enabled를 판단하지 않는다(회사명 조회와도 공유).
    """
    references = [value for value in (batch_id, opp_id) if value is not None]
    if len(references) != 1 or not isinstance(references[0], str) or not references[0].strip():
        raise InputError("후보 찾기 회차 번호 또는 영업기회 번호 하나를 넣어 주세요.")
    if not isinstance(requested_by, str) or not requested_by.strip():
        raise InputError("조회 요청자를 확인해 주세요.")
    with session_scope(db_path) as session:
        # 세기와 기록을 같은 쓰기 잠금 안에서 처리한다. 다른 실행과 마지막 한 자리를 공유.
        session.connection().exec_driver_sql("BEGIN IMMEDIATE")
        contract = session.get(SourceContract, _SOURCE_ID)
        if contract is None or contract.confirmed_at is None:
            raise InputError("공장등록 조회 소스의 이용·저장 확인을 먼저 기록해 주세요.")
        if batch_id is not None:
            reference = session.get(IngestBatch, batch_id)
            if reference is None:
                raise NotFoundError("후보 찾기 회차를 찾을 수 없습니다.")
            if reference.status != "RUNNING":
                raise AppError(
                    "실행 중인 후보 찾기 회차가 아닙니다.",
                    "현재 찾기 상태를 확인해 주세요.",
                    status=409,
                )
            requested_by = reference.requested_by
        else:
            reference = session.get(Opportunity, opp_id)
            if reference is None:
                raise NotFoundError("영업기회를 찾을 수 없습니다.")
        # 잠금을 기다리는 사이 자정이 지날 수 있어, 잠금 취득 뒤 시각을 읽는다.
        now = utcnow()
        start = now.astimezone(KST).replace(hour=0, minute=0, second=0, microsecond=0)
        calls = session.scalar(
            select(func.coalesce(func.sum(TransferLog.call_count), 0)).where(
                TransferLog.purpose == TransferPurpose.PUBLIC_SOURCE,
                TransferLog.decision == "ALLOW",
                TransferLog.occurred_at >= start.astimezone(UTC),
                TransferLog.occurred_at < (start + timedelta(days=1)).astimezone(UTC),
            )
        )
        rejected = calls >= _DAILY_LIMIT
        log_id = new_id("transfer")
        session.add(
            TransferLog(
                transfer_log_id=log_id,
                occurred_at=now,
                batch_id=batch_id,
                opp_id=opp_id,
                purpose=TransferPurpose.PUBLIC_SOURCE,
                kind=TransferKind.FACTORY_REGISTRY,
                mode="NONE",
                model=None,
                security_grade="PUBLIC",
                decision="REJECT" if rejected else "ALLOW",
                reject_reason="DAILY_LIMIT" if rejected else None,
                requested_by=requested_by,
                call_count=1,
                input_tokens=None,
                output_tokens=None,
                web_search_calls=None,
                cost_usd=Decimal(0),
                created_by=requested_by,
                is_virtual=reference.is_virtual,
                dataset_kind=reference.dataset_kind,
                session_ref=reference.session_ref,
            )
        )
    if rejected:
        raise FactoryRegistryLimitError()
    return log_id
