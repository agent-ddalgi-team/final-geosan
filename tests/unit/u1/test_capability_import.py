"""S01: 역량 파일의 묶음 분리·검수 기록·재투입을 실제 임시 SQLite로 확인한다."""

from __future__ import annotations

import json
import re
from datetime import UTC, date, datetime, timedelta

import pytest
from sqlalchemy import func, select
from typer.testing import CliRunner

from geosan.capability.importer import import_capability
from geosan.capability.models import (
    DeliveryRecord,
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
from geosan.commands.app import app
from geosan.config.errors import InputError, RunFailedError
from geosan.config.file_checks import check_capability_file
from geosan.config.loader import load_document
from geosan.evaluation.file_input import load_file_inputs
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


def _same_date_statuses(status="SUSPENDED", *, reverse=False):
    data = factories.capability_with_status("ISO 9001", status, "2026-10-19")
    histories = factories.find_qualification(data, "ISO 9001")["statuses"]
    for history in histories:
        history.update(occurredAt="2026-10-19", confirmedAt="2026-10-19")
    if reverse:
        histories.reverse()
    return data


def _capability_rows():
    """저장 대상 7개 표의 모든 열을 비교해 추가·변경·삭제를 함께 잡는다."""
    with session_scope() as session:
        return {
            model.__tablename__: [
                tuple(row)
                for row in session.execute(
                    select(model.__table__).order_by(*model.__table__.primary_key.columns)
                )
            ]
            for model in (
                Process,
                ProcessCapability,
                DeliveryRecord,
                Qualification,
                QualificationScope,
                QualificationStatus,
                FieldEvidence,
            )
        }


@pytest.mark.parametrize("status", ["SUSPENDED", "CANCELLED", "ACTIVE"])
@pytest.mark.parametrize("reverse", [False, True])
@pytest.mark.parametrize("existing_data", [False, True])
def test_same_date_status_import_rejects_input_and_preserves_all_rows(
    tmp_db, tmp_path, status, reverse, existing_data
):
    """Given 날짜 중복 이력 / When 빈 DB·기존 DB에 투입 / Then 거부하고 모든 값을 보존한다."""
    if existing_data:
        import_capability(_write(tmp_path, factories.capability_file()))
    before = _capability_rows()
    path = _write(tmp_path, _same_date_statuses(status, reverse=reverse))

    with pytest.raises(InputError) as error:
        import_capability(path)

    assert _capability_rows() == before
    assert any(".statuses[" in field.path for field in error.value.fields)


def test_same_date_status_check_collects_qualification_errors_with_locations(tmp_path):
    """Given 자격 2개의 날짜 중복 / When 검사 / Then 두 자격의 줄·항목·이유를 함께 알린다."""
    data = _same_date_statuses()
    other = data["qualifications"][1]
    other["statuses"].append(dict(other["statuses"][0]))
    path = tmp_path / "duplicate-statuses.json"
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")

    report = check_capability_file(path)

    assert not report.ok
    assert report.capability is None
    document = load_document(path)
    for index in (0, 1):
        fields = [
            field
            for field in report.errors
            if field.path.startswith(f"qualifications[{index}].statuses[")
        ]
        assert fields
        for field in fields:
            assert field.line is not None and field.line > 0
            assert field.line == document.line_of(field.path)
            assert field.message.strip()


def test_same_date_status_import_command_exits_1_and_preserves_existing_rows(tmp_db, tmp_path):
    """Given 기존 자료와 날짜 중복 파일 / When 투입 명령 / Then 입력 오류 1이며 저장하지 않는다."""
    import_capability(_write(tmp_path, factories.capability_file()))
    before = _capability_rows()
    path = tmp_path / "duplicate-statuses.json"
    path.write_text(
        json.dumps(_same_date_statuses(), ensure_ascii=False, indent=2), encoding="utf-8"
    )

    result = CliRunner().invoke(app, ["import-capability", str(path)], catch_exceptions=False)

    assert result.exit_code == 1, result.output
    assert ".statuses[" in result.output
    assert re.search(r"\d+번째 줄", result.output)
    assert _capability_rows() == before


def test_same_date_status_check_command_rejects_without_creating_db(tmp_path, monkeypatch):
    """Given 정상 사례·날짜 중복 역량 / When 검사 명령 / Then 입력 오류이며 DB 생성도 없다."""
    db_path = tmp_path / "must-not-exist.db"
    monkeypatch.setenv("GEOSAN_DB_PATH", str(db_path))
    path = tmp_path / "duplicate-statuses.json"
    path.write_text(
        json.dumps(_same_date_statuses(), ensure_ascii=False, indent=2), encoding="utf-8"
    )
    case_path = tmp_path / "case.json"
    case_path.write_text(json.dumps(factories.apjeong_case(), ensure_ascii=False), encoding="utf-8")

    result = CliRunner().invoke(
        app, ["check-case", str(case_path), "--capability", str(path)], catch_exceptions=False
    )

    assert result.exit_code == 1, result.output
    assert ".statuses[" in result.output
    assert re.search(r"\d+번째 줄", result.output)
    assert not db_path.exists()


def test_same_date_status_file_preview_rejects_capability(tmp_path):
    """Given 정상 사례·날짜 중복 역량 / When 파일 평가 입력 준비 / Then 입력 오류로 중단한다."""
    path = _write(tmp_path, _same_date_statuses())
    cases_dir = tmp_path / "cases"
    cases_dir.mkdir()
    (cases_dir / "case.json").write_text(
        json.dumps(factories.apjeong_case(), ensure_ascii=False), encoding="utf-8"
    )

    with pytest.raises(InputError) as error:
        load_file_inputs(path, cases_dir)

    assert path.name in error.value.message
    assert any(".statuses[" in field.path for field in error.value.fields)


def test_same_date_status_in_different_qualifications_remains_valid(tmp_db, tmp_path):
    """Given 자격마다 단일 이력이며 날짜만 같음 / When 투입 / Then 자격 간 날짜 중복은 허용한다."""
    data = factories.capability_file()
    for qualification in data["qualifications"]:
        for history in qualification["statuses"]:
            history.update(occurredAt="2026-10-19", confirmedAt="2026-10-19")
    path = _write(tmp_path, data)
    report = check_capability_file(path)
    assert report.ok, report.error_lines()

    result = import_capability(path)

    assert result.qualification_count == len(data["qualifications"])
    with session_scope() as session:
        assert session.scalar(select(func.count()).select_from(QualificationStatus)) == len(
            data["qualifications"]
        )
