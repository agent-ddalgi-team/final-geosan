"""전체 목록으로 내린 후보 판단의 저장·재사용(C6·C9, #373).

소스 이용 확인과 행 범위를 검사하지만 외부 전송 승인은 아니다. 후속 어댑터는
승인된 행 ID로 본문을 직접 읽어야 한다. 이 구성요소는 AI 호출·회사 등록·회차 완료를
하지 않는다. 전체 공정·산업 목록과 PM 지시문은 호출자가 주입한다.
"""

import hashlib
import json
import re
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from pathlib import Path
from typing import Literal

from sqlalchemy import select
from sqlalchemy.exc import SQLAlchemyError

from geosan.config.errors import AppError, InputError, NotFoundError, RunFailedError
from geosan.opportunity.candidate_judgments import (
    CandidateJudgment,
    _labels,
    candidate_criteria_version,
    candidate_product_hash,
    parse_candidate_judgments,
)
from geosan.opportunity.candidate_web_results import safe_public_text
from geosan.opportunity.factory_csv import SOURCE_ID
from geosan.opportunity.factory_store import _context
from geosan.opportunity.ingest_errors import storage_failure
from geosan.opportunity.source_models import CandidateJudgment as StoredJudgment
from geosan.opportunity.source_models import SourceContract, SourceFactoryRow
from geosan.opportunity.web_candidate_store import web_judgment_rows
from geosan.storage.base import new_id, utcnow
from geosan.storage.session import session_scope

_SOURCES = frozenset({SOURCE_ID, "kicox-production-api"})


@dataclass(frozen=True)
class JudgmentRowState:
    row_id: str
    source_id: str
    product_hash: str
    previous_judgment_id: str | None
    content_hash: str


@dataclass(frozen=True)
class JudgmentPlan:
    """판단 전 상태. pending_row_ids는 전송 승인 목록이 아니며 별도 승인이 필요하다."""

    batch_id: str
    criteria_version: str
    process_catalog: tuple[tuple[str, str], ...]
    industry_catalog: tuple[str, ...]
    regions: tuple[str, ...]
    rejudge: bool
    rows: tuple[JudgmentRowState, ...]
    pending_row_ids: tuple[str, ...]
    reused: tuple[CandidateJudgment, ...]
    source_kind: Literal["FACTORY", "WEB"] = "FACTORY"


def _rows(session, row_ids, regions):
    if not row_ids:
        return {}
    found = {
        row.row_id: row
        for row in session.scalars(
            select(SourceFactoryRow).where(SourceFactoryRow.row_id.in_(row_ids))
        )
    }
    if set(found) != set(row_ids):
        raise NotFoundError("판단할 공개 공장 행을 찾을 수 없습니다.")
    for row in found.values():
        if (
            row.source_id not in _SOURCES
            or row.region not in regions
            or row.missing_since is not None
        ):
            raise InputError("회차의 찾기 범위에 있는 현재 공개 공장 행만 판단할 수 있습니다.")
        if row.product_hash != hashlib.sha256(row.product.encode("utf-8")).hexdigest():
            raise RunFailedError("공개 공장 행의 생산품과 저장된 식별값이 맞지 않습니다.")
    for source_id in {row.source_id for row in found.values()}:
        contract = session.get(SourceContract, source_id)
        if contract is None or contract.confirmed_at is None:
            raise InputError("공개 공장 소스의 이용·저장 확인을 먼저 기록해 주세요.")
    return found


def judgment_rows(session, batch, row_ids, regions, source_kind):
    if source_kind == "FACTORY":
        return _rows(session, row_ids, regions)
    if source_kind == "WEB":
        return web_judgment_rows(session, batch, row_ids)
    raise InputError("후보 판단의 출처 종류를 확인해 주세요.")


def _latest(session, row_ids, version, source_kind="FACTORY"):
    latest = {}
    id_column = (
        StoredJudgment.row_id if source_kind == "FACTORY" else StoredJudgment.web_candidate_id
    )
    if row_ids:
        query = (
            select(StoredJudgment)
            .where(
                id_column.in_(row_ids),
                StoredJudgment.criteria_version == version,
            )
            .order_by(
                StoredJudgment.judged_at.desc(),
                StoredJudgment.created_at.desc(),
                StoredJudgment.judgment_id.desc(),
            )
        )
        for row in session.scalars(query):
            latest.setdefault(row.row_id if source_kind == "FACTORY" else row.web_candidate_id, row)
    return latest


def public_row_content_hash(row):
    """전송 직전·저장 직전에 공개 본문이 바뀌지 않았는지 확인한다."""
    value = json.dumps(
        [
            row.company_name,
            row.complex_name,
            row.product,
            row.industry_name,
            row.address,
            *([row.source_url] if hasattr(row, "source_url") else []),
        ],
        ensure_ascii=False,
        separators=(",", ":"),
    )
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def _as_response(row, source_kind="FACTORY"):
    return {
        "rowId": row.row_id if source_kind == "FACTORY" else row.web_candidate_id,
        "isManufacturer": row.is_manufacturer,
        "processCodes": row.process_codes,
        "industries": row.industries,
        "reason": row.reason,
        "fitLevel": row.fit_level,
        "ownPlatingLineSuspected": row.own_plating_line_suspected,
        "ownPlatingLineBasis": row.own_plating_line_basis,
    }


def _check_web_judgment_text(judgments, source_kind):
    if source_kind == "WEB" and any(
        not safe_public_text(value)
        for judgment in judgments
        for value in (judgment.reason, judgment.own_plating_line_basis)
        if value is not None
    ):
        raise AppError(
            "웹 후보 판단에 사람 정보가 있어 저장할 수 없습니다.",
            "공개 생산품 근거를 확인해 주세요.",
            status=503,
            kind="LLM_FAILED",
        )


def prepare_candidate_judgments(
    batch_id: str,
    row_ids: Sequence[str],
    *,
    process_catalog: Mapping[str, str],
    industry_catalog: Sequence[str],
    prompt: str,
    db_path: Path | str | None = None,
    source_kind: Literal["FACTORY", "WEB"] = "FACTORY",
) -> JudgmentPlan:
    """행별 최신 판단을 비교한다. 새로 판단할 행과 재사용할 결과를 입력 순서로 돌려준다."""
    if not isinstance(batch_id, str) or not batch_id.strip():
        raise InputError("후보 찾기 회차 번호를 확인해 주세요.")
    ids = _labels(row_ids)
    version = candidate_criteria_version(
        process_catalog=process_catalog,
        industry_catalog=industry_catalog,
        prompt=prompt,
    )
    try:
        with session_scope(db_path) as session:
            # 읽은 행·판단·회차가 서로 다른 시점으로 섞이지 않게 읽기 트랜잭션을 명시한다.
            session.connection().exec_driver_sql("BEGIN")
            batch, regions = _context(session, batch_id)
            found = judgment_rows(session, batch, ids, regions, source_kind)
            if any(
                row.dataset_kind != batch.dataset_kind or row.is_virtual != batch.is_virtual
                for row in found.values()
            ):
                raise InputError("이번 회차의 자료 묶음에 있는 공개 공장 행만 판단할 수 있습니다.")
            latest = _latest(session, ids, version, source_kind)
            states, pending, cached = [], [], []
            for row_id in ids:
                row = found[row_id]
                old = latest.get(row_id)
                states.append(
                    JudgmentRowState(
                        row_id,
                        row.source_id,
                        candidate_product_hash(row.product, row.industry_name),
                        old.judgment_id if old else None,
                        public_row_content_hash(row),
                    )
                )
                if (
                    not batch.rejudge
                    and old is not None
                    and old.product_hash == candidate_product_hash(row.product, row.industry_name)
                ):
                    cached.append(_as_response(old, source_kind))
                else:
                    pending.append(row_id)
            try:
                reused = (
                    parse_candidate_judgments(
                        json.dumps(cached, ensure_ascii=False),
                        approved_row_ids=[row["rowId"] for row in cached],
                        process_catalog=process_catalog,
                        industry_catalog=industry_catalog,
                    )
                    if cached
                    else ()
                )
                _check_web_judgment_text(reused, source_kind)
            except AppError:
                raise RunFailedError("저장된 후보 판단이 현재 약속과 맞지 않습니다.") from None
            return JudgmentPlan(
                batch_id,
                version,
                tuple(sorted(process_catalog.items())),
                tuple(sorted(industry_catalog)),
                tuple(regions),
                batch.rejudge,
                tuple(states),
                tuple(pending),
                reused,
                source_kind,
            )
    except SQLAlchemyError as exc:
        raise storage_failure(
            exc,
            operation="judgment",
            message="저장된 후보 판단을 읽지 못했습니다.",
        ) from None


def save_candidate_judgments(
    plan: JudgmentPlan,
    response_text: str,
    *,
    model: str,
    db_path: Path | str | None = None,
) -> tuple[str, ...]:
    """검사한 응답 전부를 저장한다. 저장 재시도·부분 성공·회차 완료 처리는 하지 않는다.

    각 호출 묶음은 prepare로 만든 plan 하나에 대응한다. 같은 plan의 이중 저장이나
    뒤늦게 도착한 응답은 쓰기 잠금 안에서 이전 판단 ID를 비교해 거부한다.
    AI 사용량 확정은 이 트랜잭션 밖에서 먼저 수행해야 저장 실패 때도 비용이 남는다.
    """
    if not isinstance(plan, JudgmentPlan) or not plan.pending_row_ids:
        raise InputError("저장할 후보 판단 대상이 없습니다.")
    if (
        not isinstance(model, str)
        or not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._:/-]*", model)
        or len(model) > StoredJudgment.__table__.c.model.type.length
    ):
        raise InputError("판단에 사용한 모델 이름을 확인해 주세요.")
    judgments = parse_candidate_judgments(
        response_text,
        approved_row_ids=plan.pending_row_ids,
        process_catalog=dict(plan.process_catalog),
        industry_catalog=plan.industry_catalog,
    )
    _check_web_judgment_text(judgments, plan.source_kind)
    try:
        with session_scope(db_path) as session:
            session.connection().exec_driver_sql("BEGIN IMMEDIATE")
            batch, regions = _context(session, plan.batch_id)
            if set(regions) != set(plan.regions) or batch.rejudge != plan.rejudge:
                raise InputError("판단하는 동안 회차의 찾기 범위나 다시 판단 여부가 바뀌었습니다.")
            ids = [row.row_id for row in plan.rows]
            found = judgment_rows(session, batch, ids, regions, plan.source_kind)
            latest = _latest(session, ids, plan.criteria_version, plan.source_kind)
            for before in plan.rows:
                row = found[before.row_id]
                previous = latest.get(before.row_id)
                if (
                    public_row_content_hash(row) != before.content_hash
                    or row.source_id != before.source_id
                    or row.dataset_kind != batch.dataset_kind
                    or row.is_virtual != batch.is_virtual
                ):
                    raise InputError(
                        "판단하는 동안 공개 공장 자료가 바뀌었습니다. 다시 확인해 주세요."
                    )
                if (previous.judgment_id if previous else None) != before.previous_judgment_id:
                    raise AppError(
                        "다른 후보 판단이 먼저 저장됐습니다.",
                        "최신 판단을 다시 읽어 주세요.",
                        status=409,
                    )
            now = utcnow()
            stored_ids = []
            for judgment in judgments:
                judgment_id = new_id("judgment")
                session.add(
                    StoredJudgment(
                        judgment_id=judgment_id,
                        row_id=judgment.row_id if plan.source_kind == "FACTORY" else None,
                        web_candidate_id=judgment.row_id if plan.source_kind == "WEB" else None,
                        criteria_version=plan.criteria_version,
                        product_hash=candidate_product_hash(
                            found[judgment.row_id].product, found[judgment.row_id].industry_name
                        ),
                        is_manufacturer=judgment.is_manufacturer,
                        process_codes=judgment.process_codes,
                        industries=judgment.industries,
                        reason=judgment.reason,
                        fit_level=judgment.fit_level,
                        own_plating_line_suspected=judgment.own_plating_line_suspected,
                        own_plating_line_basis=judgment.own_plating_line_basis,
                        judged_at=now,
                        model=model,
                        created_by=batch.requested_by,
                        is_virtual=batch.is_virtual,
                        dataset_kind=batch.dataset_kind,
                        session_ref=batch.session_ref,
                    )
                )
                stored_ids.append(judgment_id)
            session.flush()
        return tuple(stored_ids)
    except SQLAlchemyError as exc:
        raise storage_failure(
            exc,
            operation="judgment",
            message="후보 판단을 저장하지 못했습니다.",
        ) from None
