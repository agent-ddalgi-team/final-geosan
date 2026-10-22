"""`geosan verify-case <file.json>` 본문 (계약 C8, 기능 명세 W4, BR11.2).

파일의 caseId로 기회를 찾아 파일의 baseDate로 **그 기회 하나만** 평가(PARTIAL 묶음)한 뒤,
파일의 `expected`와 항목별로 비교해 일치/불일치 표를 낸다. 목록 순위는 최신 FULL 묶음 기준이라
이 명령이 목록 구성원을 바꾸지 않는다(BR10.1).

비교 항목: E·P·R(정수), S·C(소수 첫째 자리), filterState, coreEvidenceMet, classificationCode,
requirementResults(요구 이름 → 판정 표시). 모두 일치면 "검증 통과" 종료 코드 0, 하나라도 다르면 2.
입력 오류(파일 없음·expected 없음·먼저 투입 필요)는 1.
"""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path

import typer
from sqlalchemy import select

from geosan.api.app import configure_logging, logger, request_ref
from geosan.commands.evaluate import print_error
from geosan.config.errors import AppError, InputError, RunFailedError, exit_code_for, new_ref
from geosan.config.file_checks import check_case_file
from geosan.config.paths import normalize_input_path
from geosan.config.schemas import CaseFile
from geosan.evaluation.ledger import latest_confirmed_evaluation
from geosan.evaluation.models import EvaluationRun, RequirementCheck
from geosan.opportunity.models import Requirement
from geosan.opportunity.queries import find_case
from geosan.storage.session import session_scope
from geosan.workflows.flow_evaluate import run_evaluation

EXIT_OK = 0
EXIT_MISMATCH = 2


@dataclass(frozen=True)
class CompareRow:
    item: str
    expected: str
    actual: str

    @property
    def ok(self) -> bool:
        return self.expected == self.actual

    def line(self) -> str:
        mark = "일치" if self.ok else "불일치"
        return f"| {self.item} | {self.expected} | {self.actual} | {mark} |"


def _one_decimal(value: float | None) -> str:
    return "-" if value is None else f"{round(value, 1):.1f}"


def compare_rows(
    case: CaseFile, run: EvaluationRun, requirement_results: dict[str, str]
) -> list[CompareRow]:
    """파일의 expected와 저장된 평가를 항목별로 비교한다(BR11.2)."""
    expected = case.expected
    assert expected is not None
    rows = [
        CompareRow("E", str(expected.e), str(run.score_e)),
        CompareRow("P", str(expected.p), str(run.score_p)),
        CompareRow("S", _one_decimal(expected.s), _one_decimal(run.score_s)),
        CompareRow("R", str(expected.r), str(run.score_r)),
        CompareRow("C", _one_decimal(expected.c), _one_decimal(run.completion_c)),
        CompareRow("filterState", str(expected.filter_state), str(run.filter_state)),
        CompareRow("coreEvidenceMet", str(expected.core_evidence_met), str(run.core_evidence_met)),
        CompareRow(
            "classificationCode", str(expected.classification_code), str(run.classification_code)
        ),
    ]
    for name, display in expected.requirement_results.items():
        actual = requirement_results.get(name.strip(), "(판정 없음)")
        rows.append(CompareRow(f"요구 '{name}'", str(display), str(actual)))
    return rows


def _requirement_results(session, run: EvaluationRun) -> dict[str, str]:
    """이 평가의 요구 판정 표시값을 요구 이름으로 모은다."""
    checks = session.scalars(
        select(RequirementCheck).where(RequirementCheck.eval_id == run.eval_id)
    ).all()
    results: dict[str, str] = {}
    for check in checks:
        requirement = session.get(Requirement, check.req_id)
        if requirement is not None:
            results[requirement.name.strip()] = check.display_result
    return results


def run_verify_case(file: Path, echo: Callable[[str], None] = typer.echo) -> int:
    """명령 본문. 출력하고 종료 코드를 돌려준다(typer.Exit은 app.py가 던진다)."""
    ref = new_ref()
    token = request_ref.set(ref)
    try:
        configure_logging()
        try:
            path = normalize_input_path(file)
            report = check_case_file(path)
            if not report.ok or report.case is None:
                raise InputError(
                    message=f"사례 파일 검사 실패: {path.name}에 오류 {len(report.errors)}건",
                    next_action="geosan check-case로 먼저 고친 뒤 다시 실행해 주세요.",
                    fields=report.errors,
                )
            case = report.case
            if case.expected is None:
                raise InputError(
                    message=f"{path.name}에 expected 블록이 없어 비교할 기대값이 없습니다",
                    next_action=(
                        "기대값이 있는 가상 사례 파일(예: examples/case-apjeong.json)로 "
                        "실행해 주세요."
                    ),
                )
            with session_scope() as session:
                opportunity = find_case(session, case.case_id)
                opp_id = opportunity.opp_id if opportunity is not None else None
            if opp_id is None:
                raise InputError(
                    message=f"caseId '{case.case_id}'의 기회가 데이터베이스에 없습니다",
                    next_action=f"먼저 geosan import-case {path.name}으로 투입해 주세요.",
                )
        except AppError as exc:
            logger.error("cmd.verify_case.failed", extra={"ref": ref})
            print_error(exc, ref, echo)
            return exit_code_for(exc)

        result = run_evaluation(opp_ids=[opp_id], base_date=case.base_date, requested_by="cli")
        if not result.ok:
            error = result.error or RunFailedError("평가하지 못했습니다.")
            logger.error("cmd.verify_case.failed", extra={"ref": ref})
            print_error(error, ref, echo)
            return exit_code_for(error)

        with session_scope() as session:
            run = latest_confirmed_evaluation(session, opp_id)
            if run is None:
                error = RunFailedError("평가는 끝났는데 확정 평가를 찾지 못했습니다.")
                logger.error("cmd.verify_case.failed", extra={"ref": ref})
                print_error(error, ref, echo)
                return exit_code_for(error)
            rows = compare_rows(case, run, _requirement_results(session, run))
            eval_id = run.eval_id

        echo(f"기준일 {case.base_date} · 평가 {eval_id}")
        echo("| 항목 | 기대값 | 실제값 | 결과 |")
        echo("|---|---|---|---|")
        for row in rows:
            echo(row.line())
        mismatched = [row for row in rows if not row.ok]
        if mismatched:
            logger.error("cmd.verify_case.mismatch", extra={"ref": ref})
            names = ", ".join(row.item for row in mismatched)
            echo(
                f"검증 실패: {path.name} 항목 {len(rows)}개 중 {len(mismatched)}개 불일치"
                f"({names}). "
                f"규칙 설정이나 사례 파일을 확인해 주세요. (문의 시 이 번호: {ref})"
            )
            return EXIT_MISMATCH
        logger.info("cmd.verify_case.done")
        echo(
            f"검증 통과: {path.name} 항목 {len(rows)}개 모두 기대값과 일치 (문의 시 이 번호: {ref})"
        )
        return EXIT_OK
    finally:
        request_ref.reset(token)
