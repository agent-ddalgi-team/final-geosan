"""`geosan seed-demo-records [demo-records.yaml]` 본문 (계약 C8, #274 — PM 결정 2026-11-04).

발표 시연용 DB에 가상 회사의 영업 기록(접촉·꼬리 질문 답·성사/거절)을 넣는다.

- 시연 표시(앱 설정 사본 `brand.demo`)가 있는 DB에서만 동작한다. 실제 DB에 가상 기록이 섞이지
  않게 하는 잠금이다. 표시가 없으면 아무것도 넣지 않고 종료 코드 1.
- 기록은 표에 직접 쓰지 않고 화면 창구와 같은 저장 본체(`record_outcome`)를 부른다. 그래서 큰 단계·
  세부 단계·관심·통화 신호·재평가가 화면에서 넣은 것과 같게 따라온다.
- 회사 하나가 한 트랜잭션이다. 이미 영업 기록이 있는 회사는 건너뛰므로 두 번 실행해도 늘지 않는다.
- 기록 내용은 코드가 아니라 `examples/demo-records.yaml`(계약 C7)에 있다. 연락처 패턴이 있으면 거부.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import timedelta
from pathlib import Path
from typing import Literal

import typer
from pydantic import Field, ValidationError
from sqlalchemy import select
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from geosan.api.deps import runtime_for
from geosan.api.routes.records import latest_outcome, record_outcome
from geosan.api.schemas import OutcomeAnswerInput, OutcomeRequest
from geosan.config.app_settings import is_demo_database
from geosan.config.errors import AppError, FieldError
from geosan.config.loader import load_document
from geosan.config.paths import normalize_input_path
from geosan.config.registry import REPO_ROOT
from geosan.config.schemas import STAFF_KEY_PATTERN, FileModel
from geosan.config.validators import format_field_error, pydantic_errors_to_fields, scan_contacts
from geosan.opportunity.models import Opportunity
from geosan.storage.engine import database_path
from geosan.storage.session import session_scope
from geosan.workflows.flow_evaluate import today_in_seoul

EXIT_OK = 0
EXIT_INPUT_ERROR = 1
EXIT_RUN_FAILED = 2

DEFAULT_DEMO_RECORDS_PATH = REPO_ROOT / "examples" / "demo-records.yaml"
NOT_DEMO_MESSAGE = "시연 표시가 없는 DB에는 가상 기록을 넣지 않습니다."
STATUS_LABELS = {"WON": "성사", "LOST": "거절", "ON_HOLD": "보류"}


class DemoAnswer(FileModel):
    question_id: str = Field(min_length=1)
    answer_id: str = Field(min_length=1)


class DemoContact(FileModel):
    # 넣는 날 기준 며칠 전 접촉인지. 날짜를 박아 두면 "최근 12개월"에서 밀려나므로 일수로 적는다.
    days_ago: int = Field(ge=0, strict=True)
    method: Literal["CALL", "EMAIL", "VISIT"]
    result: Literal["REACHED", "ABSENT", "DECLINED"]
    memo: str | None = None
    reason: str | None = None
    answers: list[DemoAnswer] = Field(default_factory=list)


class DemoCompany(FileModel):
    case_id: str = Field(min_length=1)
    contacts: list[DemoContact] = Field(min_length=1)


class DemoRecords(FileModel):
    version: int = Field(ge=1, strict=True)
    staff_key: str = Field(pattern=STAFF_KEY_PATTERN)
    companies: list[DemoCompany] = Field(min_length=1)


@dataclass
class DemoRecordsCheck:
    records: DemoRecords | None
    errors: list[FieldError]


def check_demo_records_file(path: Path | str) -> DemoRecordsCheck:
    """연락처 → 모양(모르는 키 거부) → 뜻(같은 회사 두 번) 순으로 검사한다. 저장하지 않는다."""
    try:
        document = load_document(path)
    except AppError as exc:
        return DemoRecordsCheck(None, exc.fields or [FieldError(path="", message=exc.message)])
    errors = scan_contacts(document.data, document=document)
    if errors:
        return DemoRecordsCheck(None, errors)
    try:
        records = DemoRecords.model_validate(document.data)
    except ValidationError as exc:
        return DemoRecordsCheck(None, pydantic_errors_to_fields(exc, document.data, document))
    seen: set[str] = set()
    for index, company in enumerate(records.companies):
        if company.case_id in seen:
            path_text = f"companies[{index}].caseId"
            errors.append(
                FieldError(
                    path=path_text,
                    message=f"같은 회사 '{company.case_id}'가 두 번 있습니다",
                    line=document.line_of(path_text),
                )
            )
        seen.add(company.case_id)
    return DemoRecordsCheck(None if errors else records, errors)


def _targets(session: Session, records: DemoRecords) -> tuple[dict[str, str], list[str]]:
    """파일의 회사를 DB에서 찾는다. {caseId: oppId}와 문제 목록(없음·가상 아님)."""
    found: dict[str, str] = {}
    problems: list[str] = []
    for company in records.companies:
        opportunity = session.scalar(
            select(Opportunity).where(Opportunity.case_id == company.case_id)
        )
        if opportunity is None:
            problems.append(
                f"'{company.case_id}' 사례가 DB에 없습니다. 먼저 import-case로 넣어 주세요."
            )
        elif not opportunity.is_virtual:
            problems.append(
                f"'{company.case_id}'는 가상 사례가 아니어서 가상 기록을 넣지 않습니다."
            )
        else:
            found[company.case_id] = opportunity.opp_id
    return found, problems


def _seed_company(db_path: Path, opp_id: str, company: DemoCompany, staff: str) -> str | None:
    """회사 한 곳을 한 트랜잭션으로 넣는다. 이미 기록이 있으면 None, 넣었으면 마지막 큰 단계."""
    today = today_in_seoul()
    with session_scope(db_path) as session:
        # 화면의 "현재 영업 기록"과 같은 조회를 쓴다(잘못 입력으로 표시한 행은 세지 않는다).
        if latest_outcome(session, opp_id) is not None:
            return None
        status = "IN_PROGRESS"
        for contact in company.contacts:
            body = OutcomeRequest(
                status=status,
                method=contact.method,
                result=contact.result,
                attempted_at=today - timedelta(days=contact.days_ago),
                memo=contact.memo,
                reason=contact.reason,
                answers=[
                    OutcomeAnswerInput(question_id=item.question_id, answer_id=item.answer_id)
                    for item in contact.answers
                ],
            )
            # 화면 창구와 같은 저장 본체. 답이 틀리거나 재평가가 실패하면 이 회사만 취소된다.
            status = record_outcome(session, opp_id, body, staff).row.status
        return str(status)


def run_seed_demo_records(file: Path | None) -> int:
    try:
        path = normalize_input_path(file or DEFAULT_DEMO_RECORDS_PATH)
    except AppError as exc:
        typer.echo(f"오류: {exc.message}")
        typer.echo(exc.next_action)
        return EXIT_INPUT_ERROR
    check = check_demo_records_file(path)
    if check.records is None:
        for error in check.errors:
            typer.echo(f"오류 [{path.name}]: {format_field_error(error)}")
        typer.echo(f"검사 실패: 오류 {len(check.errors)}건. 아무것도 넣지 않았습니다.")
        return EXIT_INPUT_ERROR
    records = check.records

    db_path = database_path()
    if not db_path.exists():
        typer.echo(f"오류: 데이터베이스 파일이 없습니다 ({db_path}).")
        typer.echo("먼저 `geosan init-db`를 실행해 주세요.")
        return EXIT_INPUT_ERROR
    try:
        with session_scope(db_path) as session:
            # 잠금: 시연 표시가 없는 DB(실제 DB)에는 가상 기록을 절대 넣지 않는다.
            if not is_demo_database(session):
                typer.echo(f"오류: {NOT_DEMO_MESSAGE}")
                typer.echo(
                    f"{db_path.name}에는 시연 표시가 없습니다. 시연 DB는 GEOSAN_DB_PATH를 바꾸고 "
                    "시연용 설정(examples/app-settings-demo.yaml)을 check-config로 등록해 주세요."
                )
                return EXIT_INPUT_ERROR
            if not runtime_for(session).app_settings.is_recording_staff(records.staff_key):
                typer.echo(f"오류: '{records.staff_key}'는 설정에 등록된 기록 담당자가 아닙니다.")
                return EXIT_INPUT_ERROR
            targets, problems = _targets(session, records)
        if problems:
            for problem in problems:
                typer.echo(f"오류: {problem}")
            typer.echo("아무것도 넣지 않았습니다.")
            return EXIT_INPUT_ERROR

        seeded = skipped = 0
        closed = dict.fromkeys(STATUS_LABELS, 0)
        for company in records.companies:
            try:
                status = _seed_company(
                    db_path, targets[company.case_id], company, records.staff_key
                )
            except AppError as exc:
                for error in exc.fields:
                    typer.echo(f"오류 [{company.case_id}]: {format_field_error(error)}")
                typer.echo(f"오류 [{company.case_id}]: {exc.message} {exc.next_action}")
                typer.echo(
                    f"'{company.case_id}'의 기록은 넣지 않았습니다(앞 회사 {seeded}곳은 저장됨). "
                    "파일을 고친 뒤 다시 실행하면 남은 회사만 넣습니다."
                )
                return EXIT_INPUT_ERROR if exc.status < 500 else EXIT_RUN_FAILED
            if status is None:
                skipped += 1
                typer.echo(f"{company.case_id}: 이미 영업 기록이 있어 건너뜀")
                continue
            seeded += 1
            if status in closed:
                closed[status] += 1
            label = STATUS_LABELS.get(status, "진행 중")
            typer.echo(f"{company.case_id}: 접촉 {len(company.contacts)}건 → {label}")
    except SQLAlchemyError as exc:
        typer.echo(f"오류: 가상 기록을 저장하지 못했습니다 ({type(exc).__name__}).")
        typer.echo("데이터베이스 파일과 init-db 적용 여부를 확인해 주세요.")
        return EXIT_RUN_FAILED
    typer.echo(
        f"가상 영업 기록 넣기 완료 ({db_path.name}): 넣은 회사 {seeded}곳"
        f"(성사 {closed['WON']}·거절 {closed['LOST']}), 건너뛴 회사 {skipped}곳. "
        "가상·거산 실제 사양 아님."
    )
    return EXIT_OK
