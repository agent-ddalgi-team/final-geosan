"""S07·S08 요구 수준·필수 요구 판정 단계."""

from __future__ import annotations

from pathlib import Path

from pytest_bdd import given, then, when
from sqlalchemy import select

from tests import factories
from tests.steps.u1._support import (
    APJEONG_CASE_ID,
    ScenarioContext,
    model,
    require_ok,
    run_cli,
    session_scope,
    write_json,
)
from tests.steps.u1.common import (
    P,
    evaluate,
    import_case_file,
    latest_eval,
    opp_id_for,
    requirement_checks,
    waiting_questions,
)


def current_requirement(name: str):
    requirement = model("opportunity", "Requirement")
    opp_id = opp_id_for(APJEONG_CASE_ID)
    with session_scope() as session:
        rows = session.scalars(
            select(requirement).where(
                requirement.opp_id == opp_id,
                requirement.name == name,
                requirement.superseded_at.is_(None),
            )
        ).all()
        session.expunge_all()
    assert len(rows) == 1, f"요구 '{name}'의 현재 행이 {len(rows)}건"
    return rows[0]


@then(P('A정밀의 요구 "{name}"은 수준 {level:Code}, 단계 {stage:Code}으로 저장되어 있다'))
def _requirement_level(name: str, level: str, stage: str) -> None:
    row = current_requirement(name)
    assert (row.req_level, row.needed_stage) == (level, stage)


@then(P('A정밀의 요구 "{name}"의 proposedBy는 {value:Code}이다'))
def _requirement_proposed_by(name: str, value: str) -> None:
    assert current_requirement(name).proposed_by == value


@then(P('A정밀에 연결된 WAITING 질문은 {count:d}건이고 그 질문은 "{keyword}"에 관한 것이다'))
def _waiting_question(count: int, keyword: str) -> None:
    rows = waiting_questions(opp_id_for(APJEONG_CASE_ID))
    assert len(rows) == count, [r.question_text for r in rows]
    assert keyword in rows[0].question_text, rows[0].question_text


@then(P('A정밀에 연결된 WAITING 질문 중 "{keyword}"에 관한 것이 있다'))
def _waiting_question_about(keyword: str) -> None:
    rows = waiting_questions(opp_id_for(APJEONG_CASE_ID))
    assert any(keyword in r.question_text for r in rows), [r.question_text for r in rows]


@given(P('요구 "{name}"의 수준과 단계를 {value:Code}으로 적은 A정밀 사례 파일을 투입했다'))
def _import_level_variant(ctx: ScenarioContext, tmp_path: Path, name: str, value: str) -> None:
    path = write_json(
        tmp_path, "case-level.json", factories.apjeong_with_requirement_level(name, value, value)
    )
    import_case_file(path, ctx)


# ---------------------------------------------------------------------------
# S08
# ---------------------------------------------------------------------------


@then(
    P(
        'A정밀의 "{name}" 판정은 {result:Code}이고 판정 표시는 {display:Code}이며 '
        '대조한 자격은 "{qual_name}"이다'
    )
)
def _check_with_qualification(name: str, result: str, display: str, qual_name: str) -> None:
    row = requirement_checks(latest_eval().eval_id).get(name)
    assert row is not None, f"요구 '{name}'의 판정 행이 없습니다"
    assert (row.result, row.display_result) == (result, display)
    qualification = model("capability", "Qualification")
    with session_scope() as session:
        qual = session.get(qualification, row.qual_id) if row.qual_id else None
        assert qual is not None and qual.official_name == qual_name, row.qual_id


@given(
    P("ISO 9001 범위에 {code:Code}을 {applicability:Code}로 더한 가상 검수 역량 파일을 투입했다")
)
def _import_scope_variant(
    ctx: ScenarioContext, tmp_path: Path, code: str, applicability: str
) -> None:
    assert applicability == "NOT_APPLIES"
    path = write_json(
        tmp_path,
        "capability-scope.json",
        factories.capability_with_scope_not_applies("ISO 9001", code),
    )
    ctx.last_cli = require_ok(run_cli("import-capability", str(path)), "import-capability")


@given(P("공정 연결을 {code:Code}로 바꾼 A정밀 사례 파일을 투입했다"))
def _import_link_variant(ctx: ScenarioContext, tmp_path: Path, code: str) -> None:
    path = write_json(tmp_path, "case-link.json", factories.apjeong_with_process_link(code, "FE"))
    import_case_file(path, ctx)


@given(P("ISO 9001의 유효기간 끝을 {day}로 바꾼 가상 검수 역량 파일을 투입했다"))
def _import_valid_to(ctx: ScenarioContext, tmp_path: Path, day: str) -> None:
    path = write_json(
        tmp_path, "capability-validto.json", factories.capability_with_valid_to("ISO 9001", day)
    )
    ctx.last_cli = require_ok(run_cli("import-capability", str(path)), "import-capability")


@when(P("ISO 9001의 현재 상태를 {status:Code}로 바꾼 가상 검수 역량 파일을 다시 투입하고 평가하면"))
def _reimport_status_and_evaluate(ctx: ScenarioContext, tmp_path: Path, status: str) -> None:
    path = write_json(
        tmp_path,
        "capability-status.json",
        factories.capability_with_status("ISO 9001", status, "2026-10-19"),
    )
    ctx.last_cli = require_ok(run_cli("import-capability", str(path)), "import-capability(재투입)")
    evaluate(ctx)


@then(P('A정밀의 "{name}" 판정은 {result:Code}가 아니다'))
def _check_not(name: str, result: str) -> None:
    row = requirement_checks(latest_eval().eval_id).get(name)
    assert row is not None, f"요구 '{name}'의 판정 행이 없습니다"
    assert row.result != result, row.result


@given(P('요구 "{name}"의 단계를 {stage:Code}으로 바꾼 A정밀 사례 파일을 투입했다'))
def _import_stage_variant(ctx: ScenarioContext, tmp_path: Path, name: str, stage: str) -> None:
    path = write_json(
        tmp_path, "case-stage.json", factories.apjeong_with_requirement_stage(name, stage)
    )
    import_case_file(path, ctx)


@given("공정 연결 ANODIZING의 소재를 SUS로 바꾸고 CHROMATE 연결을 더한 A정밀 사례 파일을 투입했다")
def _import_material_mismatch(ctx: ScenarioContext, tmp_path: Path) -> None:
    path = write_json(tmp_path, "case-material.json", factories.apjeong_with_material_mismatch())
    import_case_file(path, ctx)


@then(P("A정밀의 공정 연결 {code1:Code} 결과는 {r1:Code}이고 {code2:Code} 결과는 {r2:Code}이다"))
def _link_results(code1: str, r1: str, code2: str, r2: str) -> None:
    link = model("opportunity", "OppProcessLink")
    opp_id = opp_id_for(APJEONG_CASE_ID)
    with session_scope() as session:
        rows = session.scalars(
            select(link).where(link.opp_id == opp_id, link.superseded_at.is_(None))
        ).all()
        results = {row.process_code: row.current_result for row in rows}
    assert results.get(code1) == r1 and results.get(code2) == r2, results


@then(P("A정밀의 필터 상태는 {filter_state:Code}이고 제외 범위는 {scope:Code}이다"))
def _filter_and_scope(filter_state: str, scope: str) -> None:
    run = latest_eval()
    assert (run.filter_state, run.exclusion_scope) == (filter_state, scope)


@given(P('수량·납기 요구 "{name}"을 더한 A정밀 사례 파일을 투입했다'))
def _import_quantity(ctx: ScenarioContext, tmp_path: Path, name: str) -> None:
    path = write_json(
        tmp_path, "case-quantity.json", factories.apjeong_with_quantity_requirement(name)
    )
    import_case_file(path, ctx)
