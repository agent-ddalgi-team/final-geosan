"""#426: 고른 공개 공장 행을 회사·기회·AI 공정 연결로 등록한다(C5·C6).

호출자가 등록과 회차 집계를 같은 트랜잭션으로 확정한다. 여기서는 커밋·평가·조사를
하지 않는다. 기존 고객은 고치지 않으며 같은 이름 또는 주소는 사람의 확인 대상으로 둔다.
"""

from __future__ import annotations

import json
from collections.abc import Sequence
from dataclasses import dataclass
from typing import Literal

from sqlalchemy import select
from sqlalchemy.orm import Session

from geosan.capability.models import Process
from geosan.config.app_settings import (
    DEFAULT_APP_SETTINGS_PATH,
    load_app_settings,
    read_app_settings,
)
from geosan.config.errors import InputError
from geosan.evidence.contacts import scrub_contacts
from geosan.opportunity.candidate_judgments import (
    CandidateJudgment,
    _labels,
    parse_candidate_judgments,
    select_candidates,
)
from geosan.opportunity.factory_csv import SOURCE_ID
from geosan.opportunity.factory_store import _context
from geosan.opportunity.judgment_store import _rows
from geosan.opportunity.models import (
    Customer,
    DiscoveryPath,
    MergeCandidate,
    Opportunity,
    OppProcessLink,
)
from geosan.opportunity.queries import normalize_address, normalize_name
from geosan.opportunity.source_models import SourceFactoryRow
from geosan.opportunity.web_candidate_store import web_judgment_rows
from geosan.storage.base import new_id, utcnow


@dataclass(frozen=True)
class RegistrationResult:
    new_count: int
    skipped_count: int
    merge_candidate_count: int


def registered_row_ids(
    session,
    batch_id: str,
    judgments,
    *,
    source_kind: Literal["FACTORY", "WEB"] = "FACTORY",
) -> set[str]:
    """이름·주소가 모두 같은 기존 회사의 후보 번호(#528·#532). 등록·합치기는 하지 않는다.

    WEB은 유효한 보관 후보만 읽는다. 주소가 없으면 같은 회사라고 단정해 제외하지 않는다.
    반환한 번호를 최대 건수 선택 전에 빼되, 기존 회사의 값과 판단 연결은 보존한다.
    """
    if source_kind not in ("FACTORY", "WEB"):
        raise InputError("기존 회사 확인에 사용할 후보의 출처 종류를 확인해 주세요.")
    batch, _ = _context(session, batch_id)
    known = registered_company_keys(session, is_virtual=batch.is_virtual)
    if source_kind == "WEB":
        ids = _labels([item.row_id for item in judgments])
        found = web_judgment_rows(session, batch, ids)
        rows = (
            row
            for row in found.values()
            if normalize_name(row.company_name) and normalize_address(row.address)
        )
    else:
        rows = session.scalars(
            select(SourceFactoryRow).where(
                SourceFactoryRow.row_id.in_([item.row_id for item in judgments])
            )
        )
    return {row.row_id for row in rows if company_key(row.company_name, row.address) in known}


def company_key(company_name: str, address: str) -> tuple[str, str]:
    """같은 회사를 가리는 이름·주소 짝. 등록 때 건너뛰는 기준과 같다(#528)."""
    return normalize_name(company_name), normalize_address(address)


def registered_company_keys(session, *, is_virtual: bool) -> set[tuple[str, str]]:
    """이미 목록에 있는 회사의 이름·주소 짝. 회차 없이 들어온 곳을 셀 때도 쓴다(#549)."""
    return {
        (customer.normalized_name, customer.normalized_address)
        for customer in session.scalars(select(Customer).where(Customer.is_virtual == is_virtual))
    }


def register_candidates(
    session: Session, batch_id: str, judgments: Sequence[CandidateJudgment]
) -> RegistrationResult:
    """선정 결과만 받는다. 새 회사 수·건너뛴 행 수·확인할 고객 쌍 수를 돌려준다.

    공개 행·판단 전체를 검사한 뒤 쓰기 시작한다. 저장 오류는 그대로 올려 호출자가
    회차 집계와 함께 되돌리게 한다. 동일 입력 재실행은 새 회사·확인 쌍을 만들지 않는다.
    """
    connection = session.connection()
    if not connection.connection.driver_connection.in_transaction:
        connection.exec_driver_sql("BEGIN IMMEDIATE")
    batch, regions = _context(session, batch_id)
    settings = read_app_settings(session) or load_app_settings(DEFAULT_APP_SETTINGS_PATH)
    if batch.dataset_kind != settings.active_dataset_kind:
        raise InputError("회차의 자료 묶음과 현재 거산 값 묶음이 다릅니다.")
    ids = _labels([judgment.row_id for judgment in judgments])
    if not ids:
        return RegistrationResult(0, 0, 0)
    rows = _rows(session, ids, regions)
    processes = dict(
        session.execute(
            select(Process.code, Process.name).where(Process.dataset_kind == batch.dataset_kind)
        ).all()
    )
    checked = parse_candidate_judgments(
        json.dumps([judgment.model_dump(by_alias=True) for judgment in judgments]),
        approved_row_ids=ids,
        process_catalog=processes,
        industry_catalog=settings.industries,
    )
    selected = select_candidates(
        checked,
        process_codes=batch.criteria.get("processCodes", []),
        industries=batch.criteria.get("industries", []),
    )
    if len(selected) != len(checked):
        raise InputError("이번 회차의 조건으로 고른 제조업 판단만 등록할 수 있습니다.")
    for row in rows.values():
        if row.dataset_kind != batch.dataset_kind or row.is_virtual != batch.is_virtual:
            raise InputError("이번 회차의 자료 묶음에 있는 공개 공장 행만 등록할 수 있습니다.")
        if not normalize_name(row.company_name) or not normalize_address(row.address):
            raise InputError("공개 공장 행의 회사명과 주소를 확인해 주세요.")
        if any(
            scrub_contacts(value)[1]
            for value in (row.company_name, row.address, row.product, row.industry_name or "")
        ):
            raise InputError("공개 공장 행에 연락처가 있어 등록하지 않았습니다.")

    # 검수 전환은 거산 값의 활성 묶음만 바꾸고 고객의 원본 묶음은 보존한다(#212).
    # 같은 실제 회사를 BROCHURE/COMPANY_CONFIRMED로 나누지 않는다. 가상 고객은 분리한다.
    customers = list(
        session.scalars(select(Customer).where(Customer.is_virtual == batch.is_virtual))
    )
    common = dict(
        created_by=batch.requested_by,
        session_ref=batch.session_ref,
        dataset_kind=batch.dataset_kind,
        is_virtual=batch.is_virtual,
    )
    now = utcnow()
    new_count = skipped_count = merge_count = 0
    # 파일·조회 양쪽에 있는 새 회사는 파일 출처를 우선한다(C5).
    for judgment in sorted(checked, key=lambda item: rows[item.row_id].source_id != SOURCE_ID):
        row = rows[judgment.row_id]
        name, address = normalize_name(row.company_name), normalize_address(row.address)
        if any(c.normalized_name == name and c.normalized_address == address for c in customers):
            skipped_count += 1
            continue
        similar = [
            c for c in customers if c.normalized_name == name or c.normalized_address == address
        ]
        industry_match = row.industry_name and any(
            word in row.industry_name
            for word in settings.ingestion.ai_pick.surface_treatment_industry_names
        )
        suspected = judgment.own_plating_line_suspected or bool(industry_match)
        basis = source = None
        if judgment.own_plating_line_suspected:
            basis, source = judgment.own_plating_line_basis, "AI"
        elif industry_match:
            basis, source = f"공장등록 업종명: {row.industry_name}", "INDUSTRY_NAME"
        customer = Customer(
            customer_id=new_id("cust"),
            name=row.company_name,
            normalized_name=name,
            address=row.address,
            normalized_address=address,
            identity_basis="공개 공장 자료의 회사명과 공장주소",
            relation_status="UNCONFIRMED",
            security_grade="PUBLIC",
            discovery_source="FACTORY_FILE" if row.source_id == SOURCE_ID else "FACTORY_API",
            fit_level=judgment.fit_level,
            pick_reason=judgment.reason,
            industries=list(judgment.industries),
            industries_source="AI",
            ingest_batch_id=batch_id,
            ingested_at=now,
            own_plating_line_suspected=suspected,
            own_plating_line_basis=basis,
            own_plating_line_source=source,
            **common,
        )
        session.add(customer)
        session.flush()
        opportunity = Opportunity(
            opp_id=new_id("opp"),
            customer_id=customer.customer_id,
            item=row.product,
            purpose="NEW_PROPOSAL",
            card_reason=judgment.reason,
            **common,
        )
        session.add(opportunity)
        session.flush()
        session.add(
            DiscoveryPath(
                path_id=new_id("path"),
                opp_id=opportunity.opp_id,
                path_kind="PROCESS_DEMAND",
                source_id=row.source_id,
                origin_key=row.row_id,
                discovered_at=now.date(),
                **common,
            )
        )
        for code in judgment.process_codes:
            session.add(
                OppProcessLink(
                    link_id=new_id("link"),
                    opp_id=opportunity.opp_id,
                    process_code=code,
                    source="AI",
                    state="PENDING",
                    **common,
                )
            )
        for other in similar:
            session.add(
                MergeCandidate(
                    merge_candidate_id=new_id("merge"),
                    customer_id_a=other.customer_id,
                    customer_id_b=customer.customer_id,
                    match_basis=(
                        "회사명은 같고 공장주소가 달라 확인 필요"
                        if other.normalized_name == name
                        else "공장주소는 같고 회사명이 달라 확인 필요"
                    ),
                    status="PENDING",
                    batch_id=batch_id,
                    **common,
                )
            )
        customers.append(customer)
        new_count += 1
        merge_count += len(similar)
    session.flush()
    return RegistrationResult(new_count, skipped_count, merge_count)
