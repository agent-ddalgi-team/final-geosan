"""`geosan copy-without-records --to <파일>` 본문 (계약 C8, #753 — PM 결정 2026-11-15).

배포 서버에 넣을 DB를 만든다. 지금 DB를 `VACUUM INTO`로 새 파일에 복사하고(원본은 읽기만),
사본에서 담당자가 남긴 영업 기록과 외부 전송 기록·접속 기록만 지운다. 회사·조사 근거·공장 자료·
후보 판단·평가는 그대로 옮겨 조사·판단 비용을 다시 쓰지 않는다. 전송 기록을 지우는 까닭은 사본의
이번 달 AI 사용액이 0에서 시작하게 하려는 것이다(원본 DB에는 그대로 남는다).

통화에서 확인한 신호(#685)는 기록을 지운 뒤 화면 저장과 같은 함수로 다시 맞추고, 신호나 거래
관계가 바뀐 회사는 다시 평가한다. 지우기·되돌리기·다시 평가는 사본에서 한 트랜잭션이고, 중간에
실패하면 만든 사본을 지운다.
"""

from __future__ import annotations

import sqlite3
from dataclasses import dataclass
from pathlib import Path

import typer
from sqlalchemy import delete, func, select
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from geosan.api.call_signals import sync_call_signals
from geosan.api.deps import runtime_for
from geosan.api.models import AccessSession
from geosan.config.app_settings import is_demo_database
from geosan.config.errors import AppError
from geosan.evidence.models import Evidence
from geosan.evidence.transfer import TransferLog
from geosan.opportunity.models import Customer, Opportunity, RelationHistory
from geosan.opportunity.source_models import CandidateJudgment
from geosan.questions.models import ConfirmationQuestion
from geosan.records.models import (
    Bookmark,
    Note,
    Outcome,
    OutcomeAnswer,
    ReviewCheck,
    ReviewOpinion,
)
from geosan.storage.engine import database_path
from geosan.storage.session import session_scope
from geosan.workflows.flow_evaluate import evaluate_in_session

EXIT_OK = 0
EXIT_INPUT_ERROR = 1
EXIT_RUN_FAILED = 2

SYSTEM = "system"

# 지우는 순서: 다른 표가 가리키는 표(접촉 결과)보다 그 답을 먼저 지운다.
CLEARED = (
    ("영업 메모·남긴 피드백·다음 통화 준비", Note),
    ("꼬리 질문 답", OutcomeAnswer),
    ("접촉 결과", Outcome),
    ("관심 표시", Bookmark),
    ("검토 확인", ReviewCheck),
    ("담당자 의견", ReviewOpinion),
    ("거래 관계 입력 이력", RelationHistory),
    ("외부 전송 기록(AI 사용액)", TransferLog),
    ("접속 기록", AccessSession),
)


@dataclass(frozen=True)
class CopyResult:
    cleared: dict[str, int]
    cleared_replies: int
    reverted_relations: int
    reevaluated: int
    kept: dict[str, int]


def _count(session: Session, model) -> int:
    return session.scalar(select(func.count()).select_from(model)) or 0


def _revert_relations(session: Session) -> tuple[int, set[str]]:
    """거래 관계를 이력의 처음 값으로 되돌린다. 되돌린 회사 수와 그 회사의 기회 번호."""
    first: dict[str, RelationHistory] = {}
    for row in session.scalars(
        select(RelationHistory).order_by(RelationHistory.changed_at, RelationHistory.created_at)
    ):
        first.setdefault(row.customer_id, row)
    opp_ids: set[str] = set()
    for customer_id, row in first.items():
        customer = session.get(Customer, customer_id)
        if customer is None:
            continue
        customer.relation_status = row.from_status
        customer.relation_confirmed_at = None
        customer.relation_confirmed_by = None
        opp_ids.update(
            session.scalars(
                select(Opportunity.opp_id).where(Opportunity.customer_id == customer_id)
            )
        )
    return len(first), opp_ids


def _clear_question_replies(session: Session) -> int:
    """질문 목록에 담당자가 단 답만 비운다. 질문은 남기고 "답함"은 "기다림"으로 되돌린다."""
    rows = list(
        session.scalars(
            select(ConfirmationQuestion).where(
                (ConfirmationQuestion.status == "REPLIED")
                | ConfirmationQuestion.reply_text.is_not(None)
            )
        )
    )
    for question in rows:
        question.reply_text = None
        question.replied_at = None
        question.replied_by = None
        if question.status == "REPLIED":
            question.status = "WAITING"
    return len(rows)


def _resync_call_signals(session: Session, opp_ids: set[str]) -> set[str]:
    """기록을 지운 회사의 통화 신호를 화면 저장과 같은 함수로 다시 맞춘다(#685)."""
    from geosan.api.routes.records import sales_questions

    rule_config = runtime_for(session).rule_config
    changed: set[str] = set()
    for opp_id in sorted(opp_ids):
        opportunity = session.get(Opportunity, opp_id)
        if opportunity is None:
            continue
        if sync_call_signals(
            session,
            opportunity,
            rule_config,
            staff=SYSTEM,
            load_questions=lambda: sales_questions(session),
        ):
            changed.add(opp_id)
    return changed


def clear_records(session: Session) -> CopyResult:
    """사본 DB 안에서 영업 기록만 지우고 신호·평가를 맞춘다. 호출자가 트랜잭션을 쥔다."""
    touched = set(session.scalars(select(Outcome.opp_id).distinct()))
    reverted, relation_opps = _revert_relations(session)
    replies = _clear_question_replies(session)
    cleared: dict[str, int] = {}
    for label, model in CLEARED:
        cleared[label] = _count(session, model)
        session.execute(delete(model))
    session.flush()
    changed = _resync_call_signals(session, touched)
    reevaluate = sorted(changed | relation_opps)
    if reevaluate:
        result = evaluate_in_session(session, reevaluate, SYSTEM)
        if not result.ok:
            message = result.error.message if result.error else "다시 평가하지 못했습니다."
            raise AppError(message, "원본 DB를 확인한 뒤 다시 실행해 주세요.", status=500)
    kept = {
        "회사": _count(session, Customer),
        "조사 근거": _count(session, Evidence),
        "후보 판단": _count(session, CandidateJudgment),
    }
    return CopyResult(cleared, replies, reverted, len(reevaluate), kept)


def _input_error(message: str, hint: str) -> int:
    typer.echo(f"오류: {message}")
    typer.echo(hint)
    return EXIT_INPUT_ERROR


def run_copy_without_records(to: Path) -> int:
    source = database_path()
    if not source.exists():
        return _input_error(
            f"데이터베이스 파일이 없습니다 ({source}).", "GEOSAN_DB_PATH를 확인해 주세요."
        )
    target = Path(to)
    if target.exists():
        return _input_error(
            f"{target}이(가) 이미 있습니다.", "덮어쓰지 않습니다. 새 파일 이름을 골라 주세요."
        )
    if target.resolve() == source.resolve():
        return _input_error("원본과 같은 파일입니다.", "다른 파일 이름을 골라 주세요.")
    if not target.parent.is_dir():
        return _input_error(
            f"{target.parent} 폴더가 없습니다.", "있는 폴더 안의 새 파일 이름을 골라 주세요."
        )
    try:
        with session_scope(source) as session:
            if is_demo_database(session):
                return _input_error(
                    "시연용 DB는 배포용으로 복사하지 않습니다.",
                    "GEOSAN_DB_PATH가 실제 DB를 가리키는지 확인해 주세요.",
                )
    except SQLAlchemyError as exc:
        typer.echo(f"오류: 원본 DB를 읽지 못했습니다 ({type(exc).__name__}).")
        return EXIT_RUN_FAILED

    try:
        connection = sqlite3.connect(f"file:{source}?mode=ro", uri=True, timeout=5)
        try:
            connection.execute("VACUUM INTO ?", (str(target),))
        finally:
            connection.close()
        with session_scope(target) as session:
            result = clear_records(session)
    except (sqlite3.Error, SQLAlchemyError, AppError) as exc:
        target.unlink(missing_ok=True)
        detail = exc.message if isinstance(exc, AppError) else type(exc).__name__
        typer.echo(f"오류: 배포용 사본을 만들지 못했습니다 ({detail}). 만든 사본은 지웠습니다.")
        typer.echo("원본 DB는 바뀌지 않았습니다.")
        return EXIT_RUN_FAILED

    typer.echo(f"배포용 사본을 만들었습니다: {target}")
    typer.echo(f"원본 파일 {source}: 바꾸지 않음")
    typer.echo("지운 것:")
    for label, count in result.cleared.items():
        typer.echo(f"  {label}: {count}건")
    typer.echo(f"  질문 목록의 담당자 답: {result.cleared_replies}건(질문은 남김)")
    typer.echo(
        f"거래 관계를 처음 값으로 되돌린 회사 {result.reverted_relations}곳, "
        f"다시 평가한 회사 {result.reevaluated}곳"
    )
    kept = " · ".join(f"{label} {count}" for label, count in result.kept.items())
    typer.echo(f"남긴 것: {kept}")
    typer.echo(
        "다음: 이 사본을 배포 서버 저장 공간(/data/geosan.db)에 올리고, "
        "README 첫 배포 순서대로 보호 켠 설정을 check-config로 등록해 주세요."
    )
    return EXIT_OK
