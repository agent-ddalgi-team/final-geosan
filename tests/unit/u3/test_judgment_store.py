"""#373: 가상 AI 응답과 실제 SQLite로 판단 저장·재사용·경합을 검사한다."""

import hashlib
import json
from concurrent.futures import ThreadPoolExecutor
from datetime import date
from threading import Barrier

import pytest
from sqlalchemy import event, select
from sqlalchemy.exc import SQLAlchemyError

from geosan.config.errors import AppError, InputError, NotFoundError, RunFailedError
from geosan.evidence.transfer import TransferLog, finish_search, reserve_candidate_judgment
from geosan.opportunity.candidate_judgments import select_candidates
from geosan.opportunity.factory_csv import SOURCE_ID
from geosan.opportunity.factory_store import store_factory_csv
from geosan.opportunity.judgment_store import prepare_candidate_judgments, save_candidate_judgments
from geosan.opportunity.models import Customer, IngestBatch, Opportunity
from geosan.opportunity.source_models import CandidateJudgment, SourceContract, SourceFactoryRow
from geosan.storage.session import session_scope

PROCESSES = {"ZINC_PLATING": "아연도금", "ANODIZING": "아노다이징"}
INDUSTRIES = ["자동차 부품", "반도체"]
PROMPT = "가상 검사 지시문: 전체 공정을 판단한다."
MODEL = "test-model"


@pytest.fixture
def public_rows(ingest_batch, factory_file):
    return store_factory_csv(
        ingest_batch,
        factory_file(
            [
                [1, "가상볼트", "가상단지", "볼트", "충남 아산시 가상길 1"],
                [2, "가상물류", "", "운송 서비스", "충남 당진시 가상길 2"],
            ]
        ),
        date(2025, 12, 31),
    ).row_ids


def prepare(batch, ids, **changes):
    return prepare_candidate_judgments(
        batch,
        ids,
        **(
            {
                "process_catalog": PROCESSES,
                "industry_catalog": INDUSTRIES,
                "prompt": PROMPT,
            }
            | changes
        ),
    )


def response(ids, **changes):
    values = [
        {
            "rowId": row_id,
            "isManufacturer": index == 0,
            "processCodes": ["ZINC_PLATING", "ANODIZING"] if index == 0 else [],
            "industries": ["자동차 부품"] if index == 0 else [],
            "reason": "가상 생산품에 따른 판단",
            "fitLevel": "HIGH" if index == 0 else "LOW",
            "ownPlatingLineSuspected": index == 0,
            "ownPlatingLineBasis": "가상 생산품의 표면처리" if index == 0 else None,
        }
        | changes
        for index, row_id in enumerate(ids)
    ]
    return json.dumps(values, ensure_ascii=False)


def stored():
    with session_scope() as session:
        return session.scalars(
            select(CandidateJudgment).order_by(CandidateJudgment.created_at)
        ).all()


def test_initial_save_and_reuse_preserve_negative_and_surface_judgments(ingest_batch, public_rows):
    plan = prepare(ingest_batch, public_rows)
    assert plan.pending_row_ids == public_rows and plan.reused == ()
    ids = save_candidate_judgments(plan, response(public_rows), model=MODEL)
    assert tuple(row.judgment_id for row in stored()) == ids
    assert all(row.model == MODEL and row.created_by == "park-lee" for row in stored())
    assert all(row.is_virtual and row.dataset_kind == "VIRTUAL_REVIEWED" for row in stored())
    assert all(row.session_ref == "test-session" and row.judged_at.tzinfo for row in stored())
    again = prepare(ingest_batch, public_rows)
    assert again.pending_row_ids == ()
    assert [row.model_dump(by_alias=True) for row in again.reused] == json.loads(
        response(public_rows)
    )
    with session_scope() as session:
        assert session.scalars(select(Customer)).all() == []
        assert session.scalars(select(Opportunity)).all() == []
        assert session.scalars(select(TransferLog)).all() == []
        assert session.get(IngestBatch, ingest_batch).status == "RUNNING"


def test_changing_selected_conditions_reuses_the_same_judgments(ingest_batch, public_rows):
    first = prepare(ingest_batch, public_rows)
    save_candidate_judgments(first, response(public_rows), model=MODEL)
    with session_scope() as session:
        session.get(IngestBatch, ingest_batch).criteria = {
            "regions": ["충남"],
            "processCodes": ["ANODIZING"],
            "industries": ["자동차 부품"],
        }
    second = prepare(ingest_batch, public_rows)
    assert second.criteria_version == first.criteria_version and second.pending_row_ids == ()
    assert [
        row.row_id for row in select_candidates(second.reused, process_codes=["ANODIZING"])
    ] == [public_rows[0]]
    assert len(second.reused) == 2


def test_order_only_change_and_partial_cache_keep_requested_order(ingest_batch, public_rows):
    plan = prepare(ingest_batch, [public_rows[1]])
    save_candidate_judgments(
        plan, response([public_rows[1]], isManufacturer=False, processCodes=[]), model=MODEL
    )
    later = prepare(
        ingest_batch,
        list(reversed(public_rows)),
        process_catalog=dict(reversed(list(PROCESSES.items()))),
        industry_catalog=list(reversed(INDUSTRIES)),
    )
    assert later.criteria_version == plan.criteria_version
    assert later.pending_row_ids == (public_rows[0],)
    assert [row.row_id for row in later.reused] == [public_rows[1]]


@pytest.mark.parametrize(
    "changes",
    [
        {"prompt": PROMPT + " 변경"},
        {"process_catalog": PROCESSES | {"ZINC_PLATING": "전기아연도금"}},
        {"industry_catalog": INDUSTRIES + ["새 산업"]},
    ],
)
def test_changed_full_criteria_require_new_judgment(ingest_batch, public_rows, changes):
    first = prepare(ingest_batch, public_rows)
    save_candidate_judgments(first, response(public_rows), model=MODEL)
    later = prepare(ingest_batch, public_rows, **changes)
    assert later.criteria_version != first.criteria_version
    assert later.pending_row_ids == public_rows and later.reused == ()


def test_only_changed_product_is_pending_and_old_judgment_is_preserved(ingest_batch, public_rows):
    first = prepare(ingest_batch, public_rows)
    save_candidate_judgments(first, response(public_rows), model=MODEL)
    old_hash = stored()[0].product_hash
    with session_scope() as session:
        row = session.get(SourceFactoryRow, public_rows[0])
        row.product = "너트"
        row.product_hash = hashlib.sha256(row.product.encode()).hexdigest()
    later = prepare(ingest_batch, public_rows)
    assert later.pending_row_ids == (public_rows[0],)
    save_candidate_judgments(later, response(later.pending_row_ids), model=MODEL)
    assert len(stored()) == 3 and stored()[0].product_hash == old_hash
    assert stored()[-1].product_hash != old_hash
    assert prepare(ingest_batch, public_rows).pending_row_ids == ()


def test_forced_judgment_appends_history_and_latest_result_wins(ingest_batch, public_rows):
    save_candidate_judgments(prepare(ingest_batch, public_rows), response(public_rows), model=MODEL)
    with session_scope() as session:
        session.get(IngestBatch, ingest_batch).rejudge = True
    forced = prepare(ingest_batch, public_rows)
    assert forced.pending_row_ids == public_rows and forced.reused == ()
    save_candidate_judgments(forced, response(public_rows, reason="새 판단"), model=MODEL)
    with session_scope() as session:
        session.get(IngestBatch, ingest_batch).rejudge = False
    assert len(stored()) == 4
    assert all(row.reason == "새 판단" for row in prepare(ingest_batch, public_rows).reused)


def test_unknown_or_duplicate_row_ids_never_become_empty_success(ingest_batch, public_rows):
    with pytest.raises(NotFoundError):
        prepare(ingest_batch, [*public_rows, "unknown"])
    with pytest.raises(InputError):
        prepare(ingest_batch, [public_rows[0], public_rows[0]])
    for invalid in [None, "row", [None], [""]]:
        with pytest.raises(InputError):
            prepare(ingest_batch, invalid)
    assert stored() == []


@pytest.mark.parametrize(
    "field,value",
    [
        ("source_id", "private"),
        ("region", "대전"),
        ("missing_since", date(2026, 1, 1)),
    ],
)
def test_out_of_scope_or_missing_source_rows_are_rejected(ingest_batch, public_rows, field, value):
    with session_scope() as session:
        setattr(session.get(SourceFactoryRow, public_rows[0]), field, value)
    with pytest.raises(InputError):
        prepare(ingest_batch, public_rows)


def test_unapproved_api_row_is_blocked_until_its_own_source_is_confirmed(ingest_batch, public_rows):
    with session_scope() as session:
        session.get(SourceFactoryRow, public_rows[0]).source_id = "kicox-production-api"
    with pytest.raises(InputError):
        prepare(ingest_batch, public_rows)
    with session_scope() as session:
        session.add(
            SourceContract(
                source_id="kicox-production-api",
                source_name="가상 조회",
                allowed_use="검사",
                allowed_storage="검사",
                confirmed_at=date(2026, 1, 1),
            )
        )
    assert prepare(ingest_batch, public_rows).pending_row_ids == public_rows


def test_mismatched_product_hash_is_reported_not_silently_reused(ingest_batch, public_rows):
    with session_scope() as session:
        session.get(SourceFactoryRow, public_rows[0]).product = "해시와 다른 생산품"
    with pytest.raises(RunFailedError):
        prepare(ingest_batch, public_rows)


@pytest.mark.parametrize(
    "change", ["product", "missing", "approval", "status", "regions", "rejudge", "source"]
)
def test_changed_context_during_judgment_rejects_all_saves(ingest_batch, public_rows, change):
    plan = prepare(ingest_batch, public_rows)
    with session_scope() as session:
        row = session.get(SourceFactoryRow, public_rows[0])
        batch = session.get(IngestBatch, ingest_batch)
        if change == "product":
            row.product = "너트"
            row.product_hash = hashlib.sha256(row.product.encode()).hexdigest()
        elif change == "missing":
            row.missing_since = date(2026, 1, 1)
        elif change == "approval":
            session.get(SourceContract, SOURCE_ID).confirmed_at = None
        elif change == "status":
            batch.status = "FAILED"
        elif change == "regions":
            batch.criteria = {"regions": ["대전"]}
        elif change == "rejudge":
            batch.rejudge = True
        else:
            row.source_id = "kicox-production-api"
            session.add(
                SourceContract(
                    source_id=row.source_id,
                    source_name="가상 조회",
                    allowed_use="검사",
                    allowed_storage="검사",
                    confirmed_at=date(2026, 1, 1),
                )
            )
    with pytest.raises(AppError):
        save_candidate_judgments(plan, response(public_rows), model=MODEL)
    assert stored() == []


@pytest.mark.parametrize(
    "kind", ["missing", "duplicate", "extra", "contacts", "bad_json", "unknown_process"]
)
def test_invalid_response_is_rejected_before_any_save(ingest_batch, public_rows, kind, caplog):
    plan = prepare(ingest_batch, public_rows)
    values = json.loads(response(public_rows))
    if kind == "missing":
        values.pop()
    elif kind == "duplicate":
        values.append(values[0])
    elif kind == "extra":
        values.append(values[0] | {"rowId": "unexpected"})
    elif kind == "contacts":
        values[1]["reason"] = "test@example.invalid PRIVATE_MARKER"
    elif kind == "unknown_process":
        values[1]["processCodes"] = ["UNKNOWN"]
    text = "PRIVATE_MARKER" if kind == "bad_json" else json.dumps(values)
    with pytest.raises(AppError) as error:
        save_candidate_judgments(plan, text, model=MODEL)
    assert error.value.kind == "LLM_FAILED" and stored() == []
    assert "PRIVATE_MARKER" not in str(error.value) + caplog.text


def test_double_save_and_late_competing_plan_are_rejected(ingest_batch, public_rows):
    first = prepare(ingest_batch, public_rows)
    competing = prepare(ingest_batch, public_rows)
    saved = save_candidate_judgments(first, response(public_rows), model=MODEL)
    for plan in [first, competing]:
        with pytest.raises(AppError) as error:
            save_candidate_judgments(plan, response(public_rows, reason="늦은 판단"), model=MODEL)
        assert error.value.status == 409
    assert tuple(row.judgment_id for row in stored()) == saved


def test_concurrent_saves_keep_one_complete_result(ingest_batch, public_rows):
    plans = [prepare(ingest_batch, public_rows) for _ in range(2)]
    barrier = Barrier(2)

    def save(plan):
        barrier.wait(timeout=10)
        try:
            return save_candidate_judgments(plan, response(public_rows), model=MODEL)
        except AppError as error:
            return error

    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(save, plans))
    assert sum(isinstance(value, AppError) for value in results) == 1
    assert next(value for value in results if isinstance(value, AppError)).status == 409
    assert len(stored()) == 2


def test_sql_save_failure_rolls_back_judgments_but_preserves_cost(
    ingest_batch, public_rows, caplog
):
    plan = prepare(ingest_batch, public_rows)
    ticket = reserve_candidate_judgment(ingest_batch, True)
    finish_search(ticket, 1000, 200, 0, None)
    written = []

    def fail_after_sql(mapper, connection, row):
        written.append(row.judgment_id)
        raise SQLAlchemyError("PRIVATE_MARKER")

    event.listen(CandidateJudgment, "after_insert", fail_after_sql)
    try:
        with pytest.raises(RunFailedError) as error:
            save_candidate_judgments(plan, response(public_rows), model=MODEL)
    finally:
        event.remove(CandidateJudgment, "after_insert", fail_after_sql)
    assert written and stored() == []
    assert "ingest.judgment.failed.sqlalchemy_error" in caplog.text
    assert "PRIVATE_MARKER" not in str(error.value) + caplog.text
    with session_scope() as session:
        assert session.get(TransferLog, ticket.log_id).input_tokens == 1000
        assert session.get(TransferLog, ticket.log_id).cost_usd is not None


def test_corrupt_saved_judgment_is_reported_instead_of_empty_or_new_ai_work(
    ingest_batch, public_rows
):
    save_candidate_judgments(prepare(ingest_batch, public_rows), response(public_rows), model=MODEL)
    with session_scope() as session:
        session.scalars(select(CandidateJudgment)).first().reason = None
    with pytest.raises(RunFailedError):
        prepare(ingest_batch, public_rows)
    assert len(stored()) == 2


def test_empty_input_needs_no_judgment_and_cannot_be_saved(ingest_batch):
    plan = prepare(ingest_batch, [])
    assert plan.pending_row_ids == plan.reused == plan.rows == ()
    with pytest.raises(InputError):
        save_candidate_judgments(plan, "[]", model=MODEL)


def test_invalid_or_missing_batch_does_not_return_reuse_plan(tmp_db):
    for value in [None, "", "  ", 1]:
        with pytest.raises(InputError):
            prepare(value, [])
    with pytest.raises(NotFoundError):
        prepare("missing", [])


@pytest.mark.parametrize("model", [None, "", " ", "test@example.invalid", "a" * 81])
def test_invalid_model_name_cannot_be_saved(ingest_batch, public_rows, model):
    with pytest.raises(InputError):
        save_candidate_judgments(
            prepare(ingest_batch, public_rows), response(public_rows), model=model
        )
    assert stored() == []
