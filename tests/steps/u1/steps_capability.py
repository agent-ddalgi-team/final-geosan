"""S01 거산 역량 파일 등록·검수 상태 단계 (tests/features/u1/s01_capability.feature)."""

from __future__ import annotations

from datetime import date
from pathlib import Path

from pytest_bdd import then, when
from sqlalchemy import select

from tests import factories
from tests.steps.u1._support import (
    ScenarioContext,
    model,
    require_ok,
    run_cli,
    session_scope,
    write_json,
)
from tests.steps.u1.common import P

NINE_CODES = {
    "ZINC_PLATING",
    "ANODIZING",
    "BLACK_OXIDE",
    "CHROMATE",
    "ELECTROPOLISHING",
    "CHROME_PLATING",
    "ELECTROLESS_NICKEL",
    "PHOSPHATE_COATING",
    "PASSIVATION",
}
REVIEW_STATUSES = {"UNAVAILABLE", "PENDING", "REVIEWED", "RECHECK"}


def processes(dataset_kind: str) -> list:
    process = model("capability", "Process")
    with session_scope() as session:
        rows = session.scalars(select(process).where(process.dataset_kind == dataset_kind)).all()
        session.expunge_all()
    return rows


def process_by_code(dataset_kind: str, code: str):
    rows = [p for p in processes(dataset_kind) if p.code == code]
    assert len(rows) == 1, f"{dataset_kind} 묶음에 {code} 공정이 {len(rows)}건"
    return rows[0]


@then(P("투입 명령은 종료 코드 {code:d}으로 끝난다"))
def _cli_exit(ctx: ScenarioContext, code: int) -> None:
    assert ctx.last_cli is not None
    assert ctx.last_cli.exit_code == code, ctx.last_cli.output


@then(P("{kind:Code} 묶음에 공정 9종이 각각 한 건씩 있고 등록 상태는 모두 {registry:Code}이다"))
def _nine_processes(kind: str, registry: str) -> None:
    rows = processes(kind)
    assert sorted(p.code for p in rows) == sorted(NINE_CODES), [p.code for p in rows]
    assert all(p.registry_status == registry for p in rows)


@then(P('공정 {code:Code}에는 "{text}" 가정 메모가 남아 있다'))
def _assumption_note(code: str, text: str) -> None:
    row = process_by_code("VIRTUAL_REVIEWED", code)
    assert row.assumption_note and text in row.assumption_note, row.assumption_note


@then(
    P(
        '{kind:Code} 묶음 {code:Code} 공정의 "{name}" 역량은 최소 {lo:g}, 최대 {hi:g}, '
        '단위 "{unit}"로 저장된다'
    )
)
def _numeric_capability(kind: str, code: str, name: str, lo: float, hi: float, unit: str) -> None:
    capability = model("capability", "ProcessCapability")
    process = process_by_code(kind, code)
    with session_scope() as session:
        row = session.scalar(
            select(capability).where(
                capability.process_id == process.process_id, capability.name == name
            )
        )
        assert row is not None, f"역량 항목 '{name}'이 없습니다"
        assert (float(row.numeric_min), float(row.numeric_max), row.unit) == (lo, hi, unit)


@then(P('{kind:Code} 묶음 {code:Code} 공정의 "{name}" 항목은 {cap_kind:Code}이고 설명용이다'))
def _descriptive_capability(kind: str, code: str, name: str, cap_kind: str) -> None:
    capability = model("capability", "ProcessCapability")
    process = process_by_code(kind, code)
    with session_scope() as session:
        row = session.scalar(
            select(capability).where(
                capability.process_id == process.process_id, capability.name == name
            )
        )
        assert row is not None, f"역량 항목 '{name}'이 없습니다"
        assert row.cap_kind == cap_kind
        assert row.is_descriptive_only is True


def all_capability_rows(dataset_kind: str) -> list:
    rows: list = []
    with session_scope() as session:
        for name in (
            "Process",
            "ProcessCapability",
            "DeliveryRecord",
            "Qualification",
            "QualificationScope",
        ):
            table = model("capability", name)
            rows.extend(
                session.scalars(select(table).where(table.dataset_kind == dataset_kind)).all()
            )
        session.expunge_all()
    return rows


@then(
    "모든 거산 값의 검수 상태는 UNAVAILABLE·PENDING·REVIEWED·RECHECK 중 하나이고 "
    "VIRTUAL_REVIEWED 묶음은 모두 REVIEWED이다"
)
def _review_statuses() -> None:
    rows = all_capability_rows("VIRTUAL_REVIEWED")
    assert rows, "거산 값이 저장되지 않았습니다"
    assert all(r.review_status in REVIEW_STATUSES for r in rows)
    assert all(r.review_status == "REVIEWED" for r in rows)


@then(P('{kind:Code} 묶음의 모든 공정에 검수자 "{reviewer}"와 검수일 {day}의 검수 기록이 있다'))
def _field_evidence(kind: str, reviewer: str, day: str) -> None:
    evidence = model("capability", "FieldEvidence")
    with session_scope() as session:
        for process in processes(kind):
            rows = session.scalars(
                select(evidence).where(
                    evidence.target_table == "cap_process", evidence.target_id == process.process_id
                )
            ).all()
            assert rows, f"공정 {process.code}의 검수 기록이 없습니다"
            latest = max(rows, key=lambda r: r.data_version)
            assert latest.reviewer == reviewer
            assert latest.reviewed_at == date.fromisoformat(day)


def scope_process_codes(kind: str, official_name: str) -> set[str]:
    qualification = model("capability", "Qualification")
    scope = model("capability", "QualificationScope")
    process = model("capability", "Process")
    with session_scope() as session:
        qual = session.scalar(
            select(qualification).where(
                qualification.dataset_kind == kind, qualification.official_name == official_name
            )
        )
        assert qual is not None, f"자격 '{official_name}'이 없습니다"
        rows = session.execute(
            select(process.code)
            .join(scope, scope.process_id == process.process_id)
            .where(scope.qual_id == qual.qual_id, scope.scope_kind == "PROCESS")
        ).all()
    return {code for (code,) in rows}


@then(P('{kind:Code} 묶음 자격 "{name}"의 적용 범위는 {codes} 4개 공정뿐이다'))
def _scopes_four(kind: str, name: str, codes: str) -> None:
    expected = {c.strip() for c in codes.split(",")}
    assert scope_process_codes(kind, name) == expected


@then(P('{kind:Code} 묶음 {code:Code} 공정에는 "{name}" 범위 행이 없다'))
def _no_scope(kind: str, code: str, name: str) -> None:
    assert code not in scope_process_codes(kind, name)


@then(P("{kind:Code} 묶음의 모든 거산 값은 {status:Code}이다"))
def _all_status(kind: str, status: str) -> None:
    rows = all_capability_rows(kind)
    assert rows, f"{kind} 묶음에 거산 값이 없습니다"
    assert all(r.review_status == status for r in rows), {r.review_status for r in rows}


@then(P('{kind:Code} 묶음 자격 "{name}"의 현재 상태는 {status:Code}이다'))
def _current_status(kind: str, name: str, status: str) -> None:
    qualification = model("capability", "Qualification")
    status_model = model("capability", "QualificationStatus")
    with session_scope() as session:
        qual = session.scalar(
            select(qualification).where(
                qualification.dataset_kind == kind, qualification.official_name == name
            )
        )
        assert qual is not None, f"자격 '{name}'이 없습니다"
        rows = session.scalars(
            select(status_model)
            .where(status_model.qual_id == qual.qual_id)
            .order_by(status_model.created_at.desc(), status_model.status_id.desc())
        ).all()
        assert rows, "상태 이력이 없습니다"
        assert rows[0].status == status


@then(P("{kind:Code} 묶음에는 공정이 하나도 없다"))
def _no_processes(kind: str) -> None:
    assert processes(kind) == []


@when("검수 상태를 PENDING으로 바꾼 가상 검수 역량 파일을 다시 투입하면")
def _reimport_pending(ctx: ScenarioContext, tmp_path: Path) -> None:
    path = write_json(
        tmp_path, "capability-pending.json", factories.capability_with_pending_status()
    )
    ctx.last_cli = run_cli("import-capability", str(path))
    require_ok(ctx.last_cli, "import-capability(재투입)")


@then(P('투입 명령은 종료 코드 {code:d}으로 끝나고 출력에 "{word}" 유지 경고가 있다'))
def _warning_in_output(ctx: ScenarioContext, code: int, word: str) -> None:
    assert ctx.last_cli is not None
    assert ctx.last_cli.exit_code == code, ctx.last_cli.output
    assert "경고" in ctx.last_cli.output and word in ctx.last_cli.output, ctx.last_cli.output


@then(
    P(
        "{kind:Code} 묶음 공정 9종의 검수 상태는 그대로 {status:Code}이고 "
        "공정은 여전히 {count:d}건이다"
    )
)
def _status_kept(kind: str, status: str, count: int) -> None:
    rows = processes(kind)
    assert len(rows) == count
    assert all(r.review_status == status for r in rows), {r.review_status for r in rows}


@then(P("{kind:Code} 묶음 {code:Code} 공정의 검수 기록은 dataVersion {v1:d}과 {v2:d}의 두 행이다"))
def _two_versions(kind: str, code: str, v1: int, v2: int) -> None:
    evidence = model("capability", "FieldEvidence")
    process = process_by_code(kind, code)
    with session_scope() as session:
        versions = sorted(
            session.scalars(
                select(evidence.data_version).where(
                    evidence.target_table == "cap_process",
                    evidence.target_id == process.process_id,
                    evidence.target_field == "reviewStatus",
                )
            ).all()
        )
    assert versions == [v1, v2], versions
