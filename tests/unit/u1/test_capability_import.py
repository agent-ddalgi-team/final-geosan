"""S01: 역량 파일의 묶음 분리·검수 기록·재투입을 실제 임시 SQLite로 확인한다."""

from __future__ import annotations

import json
from datetime import UTC, date, datetime, timedelta

import pytest
from sqlalchemy import func, select

from geosan.capability.importer import import_capability
from geosan.capability.models import (
    FieldEvidence,
    Process,
    ProcessCapability,
    Qualification,
    QualificationScope,
    QualificationStatus,
)
from geosan.capability.queries import (
    get_process,
    latest_qualification_status,
    list_processes,
)
from geosan.config.errors import InputError, RunFailedError
from geosan.opportunity.importer import import_case
from geosan.storage.session import session_scope
from tests import factories


def _write(tmp_path, data):
    path = tmp_path / "capability.json"
    path.write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")
    return path


def test_datasets_keep_independent_processes_and_review_records(tmp_db, tmp_path):
    """Given 서로 다른 묶음 / When 투입·조회 / Then 각각 9개이며 값이 섞이지 않는다."""
    first = import_capability(_write(tmp_path, factories.capability_file()))
    second = import_capability(_write(tmp_path, factories.brochure_capability_file()))
    assert first.process_count == second.process_count == 9
    assert first.pending_count == 0
    assert second.pending_count > 0
    assert "공정 9건" in first.summary and "자격 3건" in first.summary
    with session_scope() as session:
        virtual = list_processes(session, dataset_kind="VIRTUAL_REVIEWED")
        brochure = list_processes(session, dataset_kind="BROCHURE")
        assert len(virtual) == len(brochure) == 9
        assert {row.review_status for row in virtual} == {"REVIEWED"}
        assert {row.review_status for row in brochure} == {"PENDING"}
        assert {row.process_id for row in virtual}.isdisjoint(row.process_id for row in brochure)
        evidence = session.scalar(
            select(FieldEvidence).where(FieldEvidence.target_id == virtual[0].process_id)
        )
        assert evidence.reviewed_at.isoformat() == "2026-10-20"
        assert evidence.reviewer == "PM(가상 검수)"


def test_reimport_preserves_reviewed_and_increments_versions(tmp_db, tmp_path):
    data = factories.capability_file()
    import_capability(_write(tmp_path, data))
    for process in data["processes"]:
        process["reviewStatus"] = "PENDING"
    result = import_capability(_write(tmp_path, data))
    assert result.warnings and all("검수" in warning for warning in result.warnings)
    with session_scope() as session:
        processes = list_processes(session, dataset_kind="VIRTUAL_REVIEWED")
        assert len(processes) == 9
        assert {row.review_status for row in processes} == {"REVIEWED"}
        row = get_process(session, "ANODIZING", dataset_kind="VIRTUAL_REVIEWED")
        histories = list(
            session.scalars(
                select(FieldEvidence)
                .where(FieldEvidence.target_id == row.process_id)
                .order_by(FieldEvidence.data_version)
            )
        )
        assert [item.data_version for item in histories] == [1, 2]
        assert histories[0].value_snapshot["review_status"] == "REVIEWED"
        assert histories[1].value_snapshot["review_status"] == "REVIEWED"


def test_process_scope_requires_process_code_and_validation_saves_nothing(tmp_db, tmp_path):
    data = factories.capability_file()
    data["qualifications"][0]["scopes"][0]["processCode"] = None
    with pytest.raises(InputError) as error:
        import_capability(_write(tmp_path, data))
    assert any("processCode" in item.path for item in error.value.fields)
    with session_scope() as session:
        assert session.scalar(select(func.count()).select_from(Process)) == 0


@pytest.mark.parametrize(
    ("scope_kind", "error_field", "line_marker"),
    [
        ("CUSTOMER", "customerRef", '"customerRef": "missing-customer"'),
        ("OPPORTUNITY", "scopeKind", '"scopeKind": "OPPORTUNITY"'),
    ],
)
def test_invalid_scope_reports_exact_location_and_rolls_back(
    tmp_db, tmp_path, scope_kind, error_field, line_marker
):
    """Given 연결 불가 자격 / When 투입 / Then 정확한 위치를 알리고 전부 되돌린다."""
    data = factories.capability_file()
    scopes = data["qualifications"][1]["scopes"]
    scopes[:] = [scopes[0], dict(scopes[0])]
    scopes[1].update(scopeKind=scope_kind, processCode=None, customerRef="missing-customer")
    path = tmp_path / "capability.json"
    text = json.dumps(data, ensure_ascii=False, indent=2)
    path.write_text(text, encoding="utf-8")
    expected_line = next(
        number for number, line in enumerate(text.splitlines(), 1) if line_marker in line
    )

    with pytest.raises(InputError) as error:
        import_capability(path)

    assert len(error.value.fields) == 1
    field = error.value.fields[0]
    assert field.path == f"qualifications[1].scopes[1].{error_field}"
    assert field.line == expected_line
    with session_scope() as session:
        for model in (
            Process,
            ProcessCapability,
            Qualification,
            QualificationStatus,
            FieldEvidence,
        ):
            assert session.scalar(select(func.count()).select_from(model)) == 0


@pytest.fixture
def imported_customer(tmp_db, tmp_path):
    import_capability(_write(tmp_path, factories.capability_file()))
    path = tmp_path / "customer-case.json"
    path.write_text(json.dumps(factories.apjeong_case(), ensure_ascii=False), encoding="utf-8")
    return import_case(path)


def _customer_capability(reference):
    data = factories.capability_file()
    data["qualifications"][0]["scopes"][0].update(
        scopeKind="CUSTOMER", processCode=None, customerRef=reference
    )
    return data


@pytest.mark.parametrize("reference", ["A정밀", " (주) A 정밀 ", "Ａ정밀"])
def test_customer_scope_uses_normalized_company_name(imported_customer, tmp_path, reference):
    """Given 상호명 표기 차이 / When 자격 투입 / Then 사례와 같은 정규화로 고객에 연결한다."""
    import_capability(_write(tmp_path, _customer_capability(reference)))
    with session_scope() as session:
        scope = session.scalar(
            select(QualificationScope).where(QualificationScope.scope_kind == "CUSTOMER")
        )
        assert scope.customer_id == imported_customer.customer_id
        assert scope.opp_id is None and scope.process_id is None


def test_customer_scope_does_not_interpret_database_id_as_company_name(imported_customer, tmp_path):
    """Given 상호명 대신 DB ID / When 자격 투입 / Then 연결을 거부하고 이전 기록을 보존한다."""
    with session_scope() as session:
        before = session.scalar(select(func.count()).select_from(FieldEvidence))
    with pytest.raises(InputError) as error:
        import_capability(_write(tmp_path, _customer_capability(imported_customer.customer_id)))
    assert error.value.fields[0].path == "qualifications[0].scopes[0].customerRef"
    with session_scope() as session:
        assert session.scalar(select(func.count()).select_from(FieldEvidence)) == before
        assert (
            session.scalar(
                select(func.count())
                .select_from(QualificationScope)
                .where(QualificationScope.scope_kind == "CUSTOMER")
            )
            == 0
        )


def test_ambiguous_customer_name_never_selects_an_arbitrary_customer(imported_customer, tmp_path):
    """Given 상호가 같은 서로 다른 고객 / When 자격 투입 / Then 임의 연결 없이 거부한다."""
    data = factories.apjeong_case()
    data["caseId"] = "same-name-other-address"
    data["customer"]["address"] = "충남 아산시 (가상)"
    path = tmp_path / "other-customer.json"
    path.write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")
    other = import_case(path)
    assert other.customer_id != imported_customer.customer_id
    with session_scope() as session:
        before = session.scalar(select(func.count()).select_from(FieldEvidence))
    with pytest.raises(InputError) as error:
        import_capability(_write(tmp_path, _customer_capability("A정밀")))
    assert error.value.fields[0].path == "qualifications[0].scopes[0].customerRef"
    assert "여러" in error.value.fields[0].message
    with session_scope() as session:
        assert session.scalar(select(func.count()).select_from(FieldEvidence)) == before


def test_latest_status_is_new_row_and_old_status_is_preserved(tmp_db, tmp_path):
    data = factories.capability_file()
    import_capability(_write(tmp_path, data))
    data["qualifications"][0]["statuses"][0]["status"] = "SUSPENDED"
    import_capability(_write(tmp_path, data))
    with session_scope() as session:
        qualification = session.scalar(
            select(Qualification).where(
                Qualification.official_name == data["qualifications"][0]["officialName"]
            )
        )
        status = latest_qualification_status(
            session, qualification.qual_id, dataset_kind="VIRTUAL_REVIEWED"
        )
        assert status.status == "SUSPENDED"
        assert (
            latest_qualification_status(session, qualification.qual_id, dataset_kind="BROCHURE")
            is None
        )
        assert (
            session.scalar(
                select(func.count())
                .select_from(QualificationStatus)
                .where(QualificationStatus.qual_id == qualification.qual_id)
            )
            == 2
        )


@pytest.mark.parametrize("latest_status", ["SUSPENDED", "CANCELLED", "ACTIVE"])
@pytest.mark.parametrize("reverse_input", [False, True])
@pytest.mark.parametrize("older_id_is_larger", [False, True])
def test_latest_status_uses_event_dates_when_storage_times_tie(
    tmp_db, tmp_path, latest_status, reverse_input, older_id_is_larger
):
    """Given 같은 저장 시각·임의 ID / When 역순 이력도 조회 / Then 최근 상태를 고른다."""
    data = factories.capability_with_status("ISO 9001", latest_status, "2026-10-19")
    if latest_status == "ACTIVE":
        factories.find_qualification(data, "ISO 9001")["statuses"][0]["status"] = "SUSPENDED"
    if reverse_input:
        factories.find_qualification(data, "ISO 9001")["statuses"].reverse()
    import_capability(_write(tmp_path, data))
    same_time = datetime(2026, 10, 22, 7, 40, 18, 361265, tzinfo=UTC)
    smaller_id = "qs-01M5H8VF1S6B9AG53TNSE0R9M4"
    larger_id = "qs-01M5H8VF1SQNTXJVKW2D4JSMV5"
    with session_scope() as session:
        qualification = session.scalar(
            select(Qualification).where(Qualification.official_name == "ISO 9001")
        )
        rows = list(
            session.scalars(
                select(QualificationStatus).where(
                    QualificationStatus.qual_id == qualification.qual_id
                )
            )
        )
        assert len(rows) == 2
        for row in rows:
            row.created_at = same_time
            row.status_id = (
                larger_id
                if (row.occurred_at == date(2024, 3, 1)) == older_id_is_larger
                else smaller_id
            )
        session.flush()

        current = latest_qualification_status(
            session, qualification.qual_id, dataset_kind="VIRTUAL_REVIEWED"
        )

        assert current.status == latest_status
        assert current.occurred_at.isoformat() == "2026-10-19"
        assert (
            latest_qualification_status(session, qualification.qual_id, dataset_kind="BROCHURE")
            is None
        )
        assert (
            session.scalar(
                select(func.count())
                .select_from(QualificationStatus)
                .where(QualificationStatus.qual_id == qualification.qual_id)
            )
            == 2
        )


@pytest.mark.parametrize(
    ("older_event", "older_confirmation", "newer_event", "newer_confirmation"),
    [
        ("2024-03-01", "2026-10-20", "2026-10-19", "2026-10-19"),
        ("2026-10-19", None, "2026-10-19", "2026-10-20"),
        (None, "2026-10-20", "2026-10-19", None),
        (None, None, None, "2026-10-20"),
    ],
)
def test_latest_status_date_priority_and_missing_dates(
    tmp_db, tmp_path, older_event, older_confirmation, newer_event, newer_confirmation
):
    """Given 날짜 일부 누락·과거 이력 재저장 / When 조회 / Then 발생일과 확인일 순으로 고른다."""
    data = factories.capability_with_status("ISO 9001", "SUSPENDED", "2026-10-19")
    statuses = factories.find_qualification(data, "ISO 9001")["statuses"]
    statuses[0].update(occurredAt=older_event, confirmedAt=older_confirmation)
    statuses[1].update(occurredAt=newer_event, confirmedAt=newer_confirmation)
    import_capability(_write(tmp_path, data))
    with session_scope() as session:
        qualification = session.scalar(
            select(Qualification).where(Qualification.official_name == "ISO 9001")
        )
        rows = list(
            session.scalars(
                select(QualificationStatus).where(
                    QualificationStatus.qual_id == qualification.qual_id
                )
            )
        )
        stored_at = datetime(2026, 10, 22, tzinfo=UTC)
        for row in rows:
            # 과거 ACTIVE를 나중에 저장해도 실제 이력 날짜가 더 최근인 정지가 현재 상태다.
            row.created_at = stored_at + timedelta(days=row.status == "ACTIVE")
        session.flush()

        assert (
            latest_qualification_status(
                session, qualification.qual_id, dataset_kind="VIRTUAL_REVIEWED"
            ).status
            == "SUSPENDED"
        )


def test_query_repairs_review_copy_from_evidence(tmp_db, tmp_path, caplog):
    import_capability(_write(tmp_path, factories.capability_file()))
    with session_scope() as session:
        row = session.scalar(select(Process).where(Process.code == "ANODIZING"))
        row.review_status = "PENDING"
    with session_scope() as session:
        row = get_process(session, "ANODIZING", dataset_kind="VIRTUAL_REVIEWED")
        assert row.review_status == "REVIEWED"
    assert "사본 불일치" in caplog.text


def test_numeric_spec_and_equipment_are_stored_without_inferred_capacity(tmp_db, tmp_path):
    import_capability(_write(tmp_path, factories.capability_file()))
    with session_scope() as session:
        spec = session.scalar(
            select(ProcessCapability).where(ProcessCapability.name == "피막 두께")
        )
        equipment = session.scalar(
            select(ProcessCapability).where(ProcessCapability.cap_kind == "EQUIPMENT")
        )
        assert (spec.numeric_min, spec.numeric_max, spec.unit) == (5, 25, "μm")
        assert equipment.is_descriptive_only is True
        process = get_process(session, "BLACK_OXIDE", dataset_kind="VIRTUAL_REVIEWED")
        assert "거산 확인 전" in process.assumption_note


def test_late_database_failure_rolls_back_whole_capability_import(tmp_db, tmp_path, monkeypatch):
    from sqlalchemy.exc import IntegrityError

    import geosan.capability.importer as importer

    original = importer._upsert

    def fail_on_qualification(session, cls, *args):
        if cls is Qualification:
            raise IntegrityError("test", {}, Exception("가상 저장 실패"))
        return original(session, cls, *args)

    monkeypatch.setattr(importer, "_upsert", fail_on_qualification)
    with pytest.raises(RunFailedError):
        import_capability(_write(tmp_path, factories.capability_file()))
    with session_scope() as session:
        assert session.scalar(select(func.count()).select_from(Process)) == 0
        assert session.scalar(select(func.count()).select_from(FieldEvidence)) == 0
