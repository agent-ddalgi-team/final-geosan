"""#753: 배포용 DB 만들기 `geosan copy-without-records --to <파일>` (계약 C8, PM 결정 2026-11-15).

실제 임시 DB·실제 API로 시험 영업 기록(통화·메모·관심·거래 관계·질문 답)과 전송 기록을 남긴 뒤
명령을 돌린다. 원본은 그대로이고, 사본에서는 기록만 비며 회사·평가는 남는지 본다.
외부 호출 없음. 가상 사례만 쓴다(거산 실제 사양 아님).
"""

import hashlib
from decimal import Decimal

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import func, select
from sqlalchemy.exc import OperationalError
from typer.testing import CliRunner

from geosan.api.app import create_app
from geosan.commands import copy_without_records as command
from geosan.commands.app import app
from geosan.config.models import AppSetting
from geosan.evaluation.ledger import latest_confirmed_evaluation
from geosan.evidence.transfer import TransferLog
from geosan.opportunity.models import Customer, Opportunity, RelationHistory, Signal
from geosan.questions.models import ConfirmationQuestion
from geosan.records.models import Bookmark, Note, Outcome, OutcomeAnswer
from geosan.storage.base import new_id, utcnow
from geosan.storage.session import session_scope
from tests.unit.u1.test_call_signals import QUOTE, call, item
from tests.unit.u1.test_call_signals import call_env as call_env
from tests.unit.u1.test_customer_relation import save as save_relation
from tests.unit.u1.test_sales_records import post

runner = CliRunner()


def _digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def _counts(db_path):
    with session_scope(db_path) as session:
        count = lambda model: session.scalar(select(func.count()).select_from(model))  # noqa: E731
        return {
            "notes": count(Note),
            "outcomes": count(Outcome),
            "answers": count(OutcomeAnswer),
            "bookmarks": count(Bookmark),
            "relations": count(RelationHistory),
            "transfers": count(TransferLog),
            "customers": count(Customer),
            "opportunities": count(Opportunity),
            "questions": count(ConfirmationQuestion),
        }


@pytest.fixture
def recorded(call_env, tmp_db):
    """free 회사에 견적 요청 통화(통화 신호 → 구매·외주 의향 7점)·메모·관심, A정밀에 거래 관계 변경,
    질문 하나에 답, 전송 기록 한 줄을 남긴 DB."""
    client, free, apjeong = call_env
    call(client, free, QUOTE)
    assert item(client, free, "SIG_BID")["score"] == 7
    memo = post(client, free, "notes", {"text": "가상 메모: 다음 주 방문", "kind": "MEMO"})
    assert memo.status_code == 200, memo.text
    response = client.put(
        f"/api/v1/opportunities/{free}/bookmark",
        json={"active": True},
        headers={"X-Staff-Key": "park-lee"},
    )
    assert response.status_code == 200, response.text
    with session_scope() as session:
        eval_id = latest_confirmed_evaluation(session, apjeong).eval_id
        before_relation = session.get(
            Customer, session.get(Opportunity, apjeong).customer_id
        ).relation_status
        question = session.scalars(select(ConfirmationQuestion)).first()
        question_id = question.question_id
    changed = "EXISTING_CONFIRMED" if before_relation != "EXISTING_CONFIRMED" else "NEW_CONFIRMED"
    assert save_relation(client, apjeong, changed, eval_id).status_code == 200
    reply = client.post(
        f"/api/v1/questions/{question_id}/reply",
        json={"replyText": "가상 답", "repliedAt": "2026-11-15"},
        headers={"X-Staff-Key": "park-lee"},
    )
    assert reply.status_code == 200, reply.text
    with session_scope() as session:
        session.add(
            TransferLog(
                transfer_log_id=new_id("transfer"),
                opp_id=free,
                occurred_at=utcnow(),
                purpose="EXTERNAL_AI",
                kind="SALES_COACH",
                mode="SYNC",
                security_grade="INTERNAL",
                decision="ALLOWED",
                requested_by="park-lee",
                call_count=1,
                cost_usd=Decimal("0.01"),
                created_at=utcnow(),
                created_by="park-lee",
                is_virtual=True,
            )
        )
    return {
        "client": client,
        "free": free,
        "apjeong": apjeong,
        "relation": before_relation,
        "question": question_id,
        "db": tmp_db,
    }


def test_copy_clears_only_records_and_leaves_the_source_untouched(recorded, tmp_path):
    """Given 통화·메모·관심·거래 관계·질문 답·전송 기록이 있는 DB / When copy-without-records
    / Then 원본 파일은 한 글자도 안 바뀌고, 사본은 기록만 0건 · 회사·기회·질문은 같은 수."""
    source = recorded["db"]
    before = _counts(source)
    assert min(before[key] for key in ("notes", "outcomes", "bookmarks", "relations")) >= 1
    digest = _digest(source)
    target = tmp_path / "deploy.db"
    result = runner.invoke(app, ["copy-without-records", "--to", str(target)])
    assert result.exit_code == 0, result.output
    assert _digest(source) == digest
    after = _counts(target)
    for key in ("notes", "outcomes", "answers", "bookmarks", "relations", "transfers"):
        assert after[key] == 0, key
    for key in ("customers", "opportunities", "questions"):
        assert after[key] == before[key], key
    assert "접촉 결과: 1건" in result.output
    assert "질문 목록의 담당자 답: 1건" in result.output
    assert "담당자 계정: 0건" in result.output
    assert "다시 평가한 회사 2곳" in result.output


def test_copy_resets_call_signal_relation_and_reply(recorded, tmp_path, monkeypatch):
    """Given 견적 요청 통화로 생긴 통화 신호(7점), 담당자가 바꾼 거래 관계, 질문 답
    / When 사본을 만든다 / Then 사본에서 통화 신호는 사라지고 구매·외주 의향은 통화 전 점수로,
    거래 관계는 처음 값·확인자 없음, 질문은 남고 답만 비어 "기다림"."""
    target = tmp_path / "deploy.db"
    assert runner.invoke(app, ["copy-without-records", "--to", str(target)]).exit_code == 0
    with session_scope(target) as session:
        live = session.scalars(
            select(Signal).where(
                Signal.opp_id == recorded["free"],
                Signal.signal_kind.like("CALL_%"),
                Signal.superseded_at.is_(None),
            )
        ).all()
        assert live == []
        customer = session.get(Customer, session.get(Opportunity, recorded["apjeong"]).customer_id)
        assert customer.relation_status == recorded["relation"]
        assert (customer.relation_confirmed_at, customer.relation_confirmed_by) == (None, None)
        question = session.get(ConfirmationQuestion, recorded["question"])
        assert (question.reply_text, question.replied_by, question.status) == (
            None,
            None,
            "WAITING",
        )
    # 사본으로 서버를 띄운 것처럼 화면 창구를 부르면 기록 없음·통화 전 점수·이번 달 사용액 0.
    monkeypatch.setenv("GEOSAN_DB_PATH", str(target))
    with TestClient(create_app()) as client:
        records = client.get(f"/api/v1/opportunities/{recorded['free']}").json()["data"]["records"]
        assert records["contactCount"]["total"] == 0
        assert records["bookmark"] is None
        assert item(client, recorded["free"], "SIG_BID")["score"] != 7
        month = client.get("/api/v1/ingest/preview").json()["data"]["month"]
        assert (month["usedUsd"], month["usedCalls"]) == (0.0, 0)


@pytest.mark.parametrize("case", ["exists", "same", "no_folder"])
def test_bad_target_is_refused_without_making_anything(recorded, tmp_path, case):
    """Given 기록이 있는 DB / When 이미 있는 파일·원본과 같은 파일·없는 폴더를 고른다
    / Then 종료 1, 원본·그 파일은 그대로."""
    source = recorded["db"]
    digest = _digest(source)
    if case == "exists":
        target = tmp_path / "already.db"
        target.write_bytes(b"keep")
    elif case == "same":
        target = source
    else:
        target = tmp_path / "missing" / "deploy.db"
    result = runner.invoke(app, ["copy-without-records", "--to", str(target)])
    assert result.exit_code == 1, result.output
    assert _digest(source) == digest
    if case == "exists":
        assert target.read_bytes() == b"keep"
    if case == "no_folder":
        assert not target.parent.exists()


def test_demo_database_is_refused(tmp_db, tmp_path):
    """Given 시연 표시(brand.demo)가 있는 DB / When 배포용 사본을 만든다
    / Then 종료 1, 파일 없음."""
    with session_scope() as session:
        brand = session.get(AppSetting, "brand")
        brand.value = {**brand.value, "demo": True}
    target = tmp_path / "deploy.db"
    result = runner.invoke(app, ["copy-without-records", "--to", str(target)])
    assert result.exit_code == 1
    assert "시연용 DB" in result.output
    assert not target.exists()


def test_failure_in_the_middle_removes_the_half_made_copy(recorded, tmp_path, monkeypatch):
    """Given 기록이 있는 DB / When 사본에서 지우는 중에 저장 오류
    / Then 종료 2, 만든 사본은 지우고 원본 그대로."""
    source = recorded["db"]
    digest = _digest(source)

    def broken(session):
        raise OperationalError("DELETE", {}, Exception("가상 저장 오류"))

    monkeypatch.setattr(command, "clear_records", broken)
    target = tmp_path / "deploy.db"
    result = runner.invoke(app, ["copy-without-records", "--to", str(target)])
    assert result.exit_code == 2
    assert "만든 사본은 지웠습니다" in result.output
    assert not target.exists()
    assert _digest(source) == digest


def test_copy_of_a_database_without_records_is_the_same_data(tmp_db, tmp_path):
    """Given 기록이 하나도 없는 DB / When 사본을 만든다 / Then 지운 것 0건, 다시 평가 0곳."""
    target = tmp_path / "deploy.db"
    result = runner.invoke(app, ["copy-without-records", "--to", str(target)])
    assert result.exit_code == 0, result.output
    assert "다시 평가한 회사 0곳" in result.output
    assert _counts(target) == _counts(tmp_db)
