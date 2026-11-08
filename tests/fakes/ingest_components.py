"""PM #427 허용: 실제 DB 저장을 쓰는 가상 판단·등록. 운영 코드에서는 불러오지 않는다."""

import json
from dataclasses import dataclass

from sqlalchemy import select

from geosan.capability.models import Process
from geosan.config.registry import load_runtime_config
from geosan.opportunity.candidate_judgments import parse_candidate_judgments
from geosan.opportunity.judgment_store import prepare_candidate_judgments, save_candidate_judgments
from geosan.opportunity.models import Customer, IngestBatch, Opportunity, OppProcessLink
from geosan.opportunity.queries import normalize_address, normalize_name
from geosan.opportunity.source_models import SourceFactoryRow
from geosan.storage.base import new_id, utcnow
from geosan.storage.session import session_scope


class FakeCandidatePicker:
    def __init__(self):
        self.calls = 0

    def __call__(self, batch_id, row_ids):
        with session_scope() as session:
            batch = session.get(IngestBatch, batch_id)
            settings = load_runtime_config(session).app_settings
            catalog = dict(
                session.execute(
                    select(Process.code, Process.name).where(
                        Process.dataset_kind == batch.dataset_kind
                    )
                ).all()
            )
        options = dict(
            process_catalog=catalog, industry_catalog=settings.industries, prompt="가상 검사"
        )
        plan = prepare_candidate_judgments(batch_id, row_ids, **options)
        fresh = ()
        if plan.pending_row_ids:
            self.calls += 1
            with session_scope() as session:
                rows = session.scalars(
                    select(SourceFactoryRow).where(
                        SourceFactoryRow.row_id.in_(plan.pending_row_ids)
                    )
                ).all()
                response = [
                    {
                        "rowId": row.row_id,
                        "isManufacturer": row.product != "가상 사무 서비스",
                        "processCodes": [
                            "ANODIZING" if row.product == "가상 패널" else "ZINC_PLATING"
                        ],
                        "industries": [],
                        "reason": "가상 검사에서만 사용하는 판단",
                        "fitLevel": "HIGH",
                        "ownPlatingLineSuspected": False,
                        "ownPlatingLineBasis": None,
                    }
                    for row in rows
                ]
            save_candidate_judgments(
                plan, json.dumps(response, ensure_ascii=False), model="fake-ingest"
            )
            fresh = parse_candidate_judgments(
                json.dumps(response, ensure_ascii=False),
                approved_row_ids=plan.pending_row_ids,
                process_catalog=catalog,
                industry_catalog=settings.industries,
            )
        by_id = {row.row_id: row for row in (*plan.reused, *fresh)}
        return [by_id[row_id] for row_id in row_ids]


@dataclass(frozen=True)
class FakeRegistrationResult:
    new_count: int
    skipped_count: int
    merge_candidate_count: int = 0


def fake_register_candidates(session, batch_id, judgments):
    """커밋하지 않아 호출자 트랜잭션의 원자성을 검사할 수 있다."""
    batch = session.get(IngestBatch, batch_id)
    common = dict(dataset_kind=batch.dataset_kind, is_virtual=batch.is_virtual, created_by="system")
    new_count = skipped = 0
    for judgment in judgments:
        row = session.get(SourceFactoryRow, judgment.row_id)
        normalized_name = normalize_name(row.company_name)
        normalized_address = normalize_address(row.address)
        existing = session.scalar(
            select(Customer).where(
                Customer.dataset_kind == batch.dataset_kind,
                Customer.normalized_name == normalized_name,
                Customer.normalized_address == normalized_address,
            )
        )
        if existing:
            skipped += 1
            continue
        customer = Customer(
            customer_id=new_id("cust"),
            name=row.company_name,
            normalized_name=normalized_name,
            address=row.address,
            normalized_address=normalized_address,
            relation_status="UNCONFIRMED",
            security_grade="PUBLIC",
            ingest_batch_id=batch_id,
            ingested_at=utcnow(),
            discovery_source="FACTORY_FILE",
            fit_level=judgment.fit_level,
            pick_reason=judgment.reason,
            **common,
        )
        session.add(customer)
        session.flush()
        opp = Opportunity(
            opp_id=new_id("opp"),
            customer_id=customer.customer_id,
            item=row.product,
            purpose="NEW_PROPOSAL",
            **common,
        )
        session.add(opp)
        session.flush()
        for code in judgment.process_codes:
            session.add(
                OppProcessLink(
                    link_id=new_id("link"),
                    opp_id=opp.opp_id,
                    process_code=code,
                    source="AI",
                    state="PENDING",
                    **common,
                )
            )
        new_count += 1
    return FakeRegistrationResult(new_count, skipped)
