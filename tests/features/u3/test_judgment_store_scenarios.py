"""#373: 가상 AI 응답·실제 CSV와 SQLite. 실제 AI 호출·화면 검사는 아니다."""

import hashlib
import json
from datetime import date

import pytest
from pytest_bdd import given, scenarios, then, when
from sqlalchemy import select

from geosan.config.app_settings import load_app_settings, sync_app_settings
from geosan.config.errors import AppError, InputError
from geosan.evidence.transfer import TransferLog, finish_search, reserve_candidate_judgment
from geosan.opportunity.factory_csv import SOURCE_ID
from geosan.opportunity.factory_store import store_factory_csv
from geosan.opportunity.judgment_store import prepare_candidate_judgments, save_candidate_judgments
from geosan.opportunity.models import IngestBatch
from geosan.opportunity.source_models import CandidateJudgment, SourceContract, SourceFactoryRow
from geosan.storage.base import utcnow
from geosan.storage.session import session_scope

scenarios("u3/judgment_store.feature")
PROCESSES = {"ZINC_PLATING": "아연도금", "ANODIZING": "아노다이징"}


def prepare(row_ids):
    return prepare_candidate_judgments(
        "judgment-scenario",
        row_ids,
        process_catalog=PROCESSES,
        industry_catalog=["자동차 부품"],
        prompt="가상 검사: 전체 공정으로 판단한다.",
    )


def answer(row_ids):
    return json.dumps(
        [
            {
                "rowId": row_id,
                "isManufacturer": index == 0,
                "processCodes": list(PROCESSES) if index == 0 else [],
                "industries": ["자동차 부품"] if index == 0 else [],
                "reason": "가상 생산품에 따른 결과",
                "fitLevel": "MEDIUM",
                "ownPlatingLineSuspected": index == 0,
                "ownPlatingLineBasis": "가상 표면처리 생산품" if index == 0 else None,
            }
            for index, row_id in enumerate(row_ids)
        ]
    )


def change_product(row_id):
    with session_scope() as session:
        row = session.get(SourceFactoryRow, row_id)
        row.product = "변경된 생산품"
        row.product_hash = hashlib.sha256(row.product.encode()).hexdigest()


@given("승인된 공개 공장 두 행과 실행 중인 회차가 있다", target_fixture="public_rows")
def public_rows(tmp_db, tmp_path, app_settings_path):
    settings = load_app_settings(app_settings_path)
    settings.llm.mode = "EXTERNAL"
    with session_scope() as session:
        sync_app_settings(session, settings)
        session.add(
            SourceContract(
                source_id=SOURCE_ID,
                source_name="가상 공장 파일",
                allowed_use="검사",
                allowed_storage="검사",
                confirmed_at=date(2026, 1, 1),
                is_virtual=True,
            )
        )
        session.add(
            IngestBatch(
                batch_id="judgment-scenario",
                source_id=SOURCE_ID,
                requested_by="park-lee",
                started_at=utcnow(),
                status="RUNNING",
                criteria={"regions": ["충남"]},
                is_virtual=True,
            )
        )
    path = tmp_path / "factories.csv"
    path.write_text(
        "순번,회사명,단지명,생산품,공장주소\n"
        "1,가상볼트,,볼트,충남 아산시 가상길 1\n"
        "2,가상물류,,운송 서비스,충남 당진시 가상길 2\n",
        encoding="utf-8",
    )
    return store_factory_csv("judgment-scenario", path, date(2025, 12, 31)).row_ids


@when("전체 기준의 가상 판단을 저장하고 선택 공정을 바꿔 다시 비교한다", target_fixture="later")
def changed_selection(public_rows):
    save_candidate_judgments(prepare(public_rows), answer(public_rows), model="test-model")
    with session_scope() as session:
        session.get(IngestBatch, "judgment-scenario").criteria = {
            "regions": ["충남"],
            "processCodes": ["ANODIZING"],
        }
    return prepare(public_rows)


@then("추가 판단 대상은 없고 선정과 탈락 및 표면처리 표시가 보존된다")
def reused(later, public_rows):
    assert later.pending_row_ids == ()
    assert [row.model_dump(by_alias=True) for row in later.reused] == json.loads(
        answer(public_rows)
    )
    with session_scope() as session:
        assert session.scalars(select(TransferLog)).all() == []


@when("두 행의 판단을 저장하고 한 행의 생산품만 바꾼다", target_fixture="later")
def changed_one(public_rows):
    save_candidate_judgments(prepare(public_rows), answer(public_rows), model="test-model")
    change_product(public_rows[0])
    return prepare(public_rows)


@then("바뀐 행만 판단 대상이고 다른 행의 판단은 재사용한다")
def only_changed(later, public_rows):
    assert later.pending_row_ids == (public_rows[0],)
    assert [row.row_id for row in later.reused] == [public_rows[1]]


@when("회차 사용량을 확정한 뒤 한 행이 빠진 가상 판단을 저장하려 한다", target_fixture="failed")
def missing_response(public_rows):
    plan = prepare(public_rows)
    ticket = reserve_candidate_judgment("judgment-scenario", True)
    finish_search(ticket, 1000, 200, 0, None)
    with pytest.raises(AppError) as error:
        save_candidate_judgments(plan, answer(public_rows[:1]), model="test-model")
    return error.value, ticket


@then("판단 오류로 알리고 판단은 남지 않지만 확정 사용량은 남는다")
def missing_failed(failed):
    error, ticket = failed
    assert error.kind == "LLM_FAILED"
    with session_scope() as session:
        assert session.scalars(select(CandidateJudgment)).all() == []
        assert session.get(TransferLog, ticket.log_id).cost_usd is not None


@when("판단 대상을 정한 뒤 생산품이 바뀌고 예전 응답이 도착한다", target_fixture="error")
def changed_while_waiting(public_rows):
    plan = prepare(public_rows)
    change_product(public_rows[0])
    with pytest.raises(InputError) as error:
        save_candidate_judgments(plan, answer(public_rows), model="test-model")
    return error.value


@then("자료 변경 오류를 알리고 판단을 일부도 저장하지 않는다")
def outdated(error):
    assert "자료가 바뀌었습니다" in error.message
    with session_scope() as session:
        assert session.scalars(select(CandidateJudgment)).all() == []
