"""#477: 실제 검수 전환 명령 이후 원본 고객·평가와 실제/가상 구분을 보존한다."""

from datetime import date

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select
from typer.testing import CliRunner

from geosan.api.app import create_app
from geosan.capability.importer import import_capability
from geosan.commands.app import app
from geosan.config.app_settings import set_active_dataset_kind
from geosan.evaluation.models import EvaluationRun
from geosan.opportunity.candidate_registration import RegistrationResult, register_candidates
from geosan.opportunity.importer import import_case
from geosan.opportunity.models import Customer, IngestBatch, MergeCandidate, Opportunity
from geosan.opportunity.source_models import SourceContract, SourceFactoryRow
from geosan.storage.base import utcnow
from geosan.storage.session import session_scope
from tests.factories import brochure_case
from tests.unit.u1.test_snapshot_ledger import _write
from tests.unit.u3.test_candidate_registration import existing, judgment, public_row, rows, snapshot

BATCH = "review-registration"


@pytest.fixture
def reviewed_registration(tmp_db, tmp_path):
    import_capability("tests/data/capability-brochure.json")
    with session_scope() as session:
        set_active_dataset_kind(session, "BROCHURE")
    for index in range(18):
        case = brochure_case(f"review-customer-{index}")
        import_case(_write(tmp_path, f"case-{index}.json", case))
    result = CliRunner().invoke(
        app,
        ["review-set", "--all", "REVIEWED", "--by", "검사", "--basis", "가상 검수 전환 검사"],
    )
    assert result.exit_code == 0, result.output
    assert "COMPANY_CONFIRMED" in result.output
    with session_scope() as session:
        session.add(
            SourceContract(
                source_id="kicox-factory-csv",
                source_name="검사",
                allowed_use="검사",
                allowed_storage="검사",
                confirmed_at=date(2026, 11, 8),
            )
        )
        session.add(batch(BATCH, "COMPANY_CONFIRMED"))
        customers = session.scalars(select(Customer).order_by(Customer.customer_id)).all()
        ids = []
        for index, customer in enumerate(customers):
            assert customer.dataset_kind == "BROCHURE" and not customer.is_virtual
            row_id = f"review-row-{index}"
            ids.append(row_id)
            session.add(
                public_row(
                    row_id,
                    company_name=customer.name,
                    address=customer.address,
                    dataset_kind="COMPANY_CONFIRMED",
                    is_virtual=False,
                )
            )
    return ids


def batch(batch_id, dataset):
    return IngestBatch(
        batch_id=batch_id,
        source_id="kicox-factory-csv",
        requested_by="park-lee",
        started_at=utcnow(),
        status="RUNNING",
        dataset_kind=dataset,
        is_virtual=False,
        criteria={
            "regions": ["충남"],
            "processCodes": ["ZINC_PLATING", "ANODIZING"],
            "industries": [],
        },
    )


def register_ids(ids, *, batch_id=BATCH):
    with session_scope() as session:
        return register_candidates(session, batch_id, [judgment(row_id) for row_id in ids])


def listed(client):
    response = client.get("/api/v1/opportunities", params={"pageSize": 50})
    assert response.status_code == 200, response.text
    return response.json()["data"]


def test_reviewed_18_keep_original_customer_fields_evaluations_and_api_ranks(reviewed_registration):
    before = {model: snapshot(model) for model in (Customer, Opportunity, EvaluationRun)}
    with TestClient(create_app()) as client:
        cards = listed(client)
        assert len(cards) == 18
        assert register_ids(reviewed_registration) == RegistrationResult(0, 18, 0)
        assert listed(client) == cards
    assert {model: snapshot(model) for model in before} == before
    assert not rows(MergeCandidate)


@pytest.mark.parametrize("changed_field", ["company_name", "address"])
def test_partial_match_still_refers_to_original_customer_after_review(
    reviewed_registration, changed_field
):
    original_customers = snapshot(Customer)
    row_id = reviewed_registration[0]
    with session_scope() as session:
        row = session.get(SourceFactoryRow, row_id)
        original = session.scalar(select(Customer).where(Customer.name == row.company_name))
        original_id = original.customer_id
        setattr(
            row,
            changed_field,
            "다른 가상 회사" if changed_field == "company_name" else "충남 가상 공장주소",
        )
    assert register_ids([row_id]) == RegistrationResult(1, 0, 1)
    (pair,) = rows(MergeCandidate)
    assert pair.customer_id_a == original_id and pair.status == "PENDING"
    assert pair.customer_id_b != original_id and pair.batch_id == BATCH
    assert snapshot(Customer)[:18] == original_customers


def test_previous_factory_source_and_batch_are_preserved_after_review(reviewed_registration):
    row_id = reviewed_registration[0]
    with session_scope() as session:
        row = session.get(SourceFactoryRow, row_id)
        original = session.scalar(select(Customer).where(Customer.name == row.company_name))
        original.discovery_source = "FACTORY_FILE"
        original.ingest_batch_id = "previous-batch"
        original.ingested_at = utcnow()
        original.pick_reason = "앞 회차에서 고른 이유"
    before = snapshot(Customer)
    assert register_ids([row_id]) == RegistrationResult(0, 1, 0)
    assert snapshot(Customer) == before


def test_switching_back_to_brochure_also_skips_confirmed_dataset_customer(reviewed_registration):
    with session_scope() as session:
        session.add(
            public_row(
                "new",
                company_name="새 가상 회사",
                address="충남 새 가상길",
                dataset_kind="COMPANY_CONFIRMED",
                is_virtual=False,
            )
        )
    assert register_ids(["new"]) == RegistrationResult(1, 0, 0)
    before = snapshot(Customer)
    with session_scope() as session:
        session.get(IngestBatch, BATCH).status = "DONE"
        set_active_dataset_kind(session, "BROCHURE")
        session.add(batch("back-to-brochure", "BROCHURE"))
        session.add(
            public_row(
                "again",
                company_name="새 가상 회사",
                address="충남 새 가상길",
                dataset_kind="BROCHURE",
                is_virtual=False,
            )
        )
    assert register_ids(["again"], batch_id="back-to-brochure") == RegistrationResult(0, 1, 0)
    assert snapshot(Customer) == before


def test_real_candidate_does_not_skip_or_merge_with_virtual_customer(reviewed_registration):
    existing(name="가상과 같은 이름", address="충남 가상과 같은 주소")
    with session_scope() as session:
        session.add(
            public_row(
                "real",
                company_name="가상과 같은 이름",
                address="충남 가상과 같은 주소",
                dataset_kind="COMPANY_CONFIRMED",
                is_virtual=False,
            )
        )
    assert register_ids(["real"]) == RegistrationResult(1, 0, 0)
    assert len(rows(Customer)) == 20 and not rows(MergeCandidate)
