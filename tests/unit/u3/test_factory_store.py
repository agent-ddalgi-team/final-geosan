"""#366: 공개 CSV → 실제 SQLite 저장. 외부 AI와 회사 등록은 실행하지 않는다."""

from datetime import date

import pytest
from sqlalchemy import event, select
from sqlalchemy.exc import SQLAlchemyError

from geosan.config.errors import AppError, InputError, NotFoundError, RunFailedError
from geosan.evidence.transfer import TransferLog, finish_search, reserve_candidate_judgment
from geosan.opportunity.factory_csv import SOURCE_ID
from geosan.opportunity.factory_store import store_factory_csv
from geosan.opportunity.models import Customer, IngestBatch, Opportunity
from geosan.opportunity.source_models import CandidateJudgment, SourceContract, SourceFactoryRow
from geosan.storage.base import utcnow
from geosan.storage.session import session_scope

OLD = date(2025, 12, 31)
NEW = date(2026, 6, 30)
A = [1, "가상공장가", "가상단지", "볼트", "충청남도 당진시 가상길 1"]
B = [2, "가상공장나", "가상단지", "너트", "충청남도 당진시 가상길 2"]


def rows():
    with session_scope() as session:
        return session.scalars(
            select(SourceFactoryRow).order_by(SourceFactoryRow.company_name)
        ).all()


def save(batch, factory_file, values, day=OLD):
    return store_factory_csv(batch, factory_file(values), day)


def test_public_fields_persist_without_extra_contact_columns_or_company_creation(
    ingest_batch, factory_file
):
    path = factory_file(
        [
            A + ["가상대표", "010-0000-0000", "000-000-0000"],
            [3, "타지역가상공장", "", "볼트", "경기도 가상길 3", "", "", ""],
        ],
        ["대표자명", "전화번호", "팩스번호"],
    )
    result = store_factory_csv(ingest_batch, path, OLD)
    (row,) = rows()
    assert result.row_ids == (row.row_id,)
    assert (result.csv.raw_count, result.csv.filtered_count) == (2, 1)
    assert (row.company_name, row.product, row.region, row.file_date) == (A[1], A[3], "충남", OLD)
    assert row.source_id == SOURCE_ID and row.product_hash == result.csv.rows[0].product_hash
    assert row.created_by == "park-lee" and row.is_virtual
    assert row.loaded_at is not None and row.missing_since is None
    assert "가상대표" not in repr(vars(row)) and "010-0000-0000" not in repr(vars(row))
    with session_scope() as session:
        assert session.scalars(select(Customer)).all() == []
        assert session.scalars(select(Opportunity)).all() == []
        assert session.get(IngestBatch, ingest_batch).status == "RUNNING"


def test_reordered_file_and_normalized_name_keep_ids(ingest_batch, factory_file):
    first = save(ingest_batch, factory_file, [A, B])
    second = save(ingest_batch, factory_file, [[9, "(주)가상 공장나", *B[2:]], [8, *A[1:]]])
    assert second.row_ids == tuple(reversed(first.row_ids))
    assert len(rows()) == 2


def test_product_change_keeps_id_and_changes_hash(ingest_batch, factory_file):
    first = save(ingest_batch, factory_file, [A])
    old_hash = rows()[0].product_hash
    with session_scope() as session:
        session.add(
            CandidateJudgment(
                judgment_id="old-judgment",
                row_id=first.row_ids[0],
                criteria_version="b" * 64,
                product_hash=old_hash,
                is_manufacturer=False,
                process_codes=[],
                industries=[],
                reason="가상 탈락 판단",
                fit_level="LOW",
                judged_at=utcnow(),
                model="test-model",
            )
        )
    changed = A.copy()
    changed[3] = "정밀 너트"
    second = save(ingest_batch, factory_file, [changed], NEW)
    assert second.row_ids == first.row_ids
    assert rows()[0].product_hash != old_hash and rows()[0].product == "정밀 너트"
    with session_scope() as session:
        previous = session.get(CandidateJudgment, "old-judgment")
        assert previous.product_hash == old_hash and not previous.is_manufacturer


def test_new_complete_file_marks_missing_and_reappearance_clears_it(ingest_batch, factory_file):
    first = save(ingest_batch, factory_file, [A, B])
    save(ingest_batch, factory_file, [A], NEW)
    assert rows()[1].missing_since == NEW
    save(ingest_batch, factory_file, [A], date(2026, 7, 31))
    assert rows()[1].missing_since == NEW
    restored = save(ingest_batch, factory_file, [A, B], date(2026, 8, 31))
    assert restored.row_ids == first.row_ids
    assert all(row.missing_since is None for row in rows())


def test_other_region_and_source_are_not_marked_missing(ingest_batch, factory_file):
    save(ingest_batch, factory_file, [A])
    with session_scope() as session:
        for row_id, source, region in [
            ("other-region", SOURCE_ID, "대전"),
            ("other-source", "api", "충남"),
        ]:
            session.add(
                SourceFactoryRow(
                    row_id=row_id,
                    source_id=source,
                    company_name="가상공장",
                    address="가상주소",
                    region=region,
                    product="볼트",
                    product_hash="a" * 64,
                    file_date=OLD,
                    loaded_at=utcnow(),
                )
            )
    save(ingest_batch, factory_file, [], NEW)
    by_id = {row.row_id: row for row in rows()}
    assert by_id["other-region"].missing_since is None
    assert by_id["other-source"].missing_since is None
    assert sum(row.missing_since == NEW for row in rows()) == 1


def test_same_file_missing_row_is_not_treated_as_new_file_deletion(ingest_batch, factory_file):
    save(ingest_batch, factory_file, [A, B])
    save(ingest_batch, factory_file, [A])
    assert all(row.missing_since is None for row in rows())


@pytest.mark.parametrize("new_rows", [[A], []])
def test_older_file_cannot_overwrite_or_revive_missing_rows(ingest_batch, factory_file, new_rows):
    save(ingest_batch, factory_file, [A])
    save(ingest_batch, factory_file, new_rows, NEW)
    before = [(row.row_id, row.file_date, row.missing_since) for row in rows()]
    with pytest.raises(InputError):
        save(ingest_batch, factory_file, [A, B], OLD)
    assert [(row.row_id, row.file_date, row.missing_since) for row in rows()] == before


def test_identical_duplicates_collapse_but_different_public_facts_survive(
    ingest_batch, factory_file
):
    different = A.copy()
    different[3] = "너트"
    result = save(ingest_batch, factory_file, [A, A, different])
    assert len(result.row_ids) == 2 and result.csv.raw_count == 3
    by_product = {row.product: row.row_id for row in rows()}
    save(ingest_batch, factory_file, [different, A])
    assert {row.product: row.row_id for row in rows()} == by_product


def test_ambiguous_changed_duplicates_do_not_arbitrarily_overwrite(ingest_batch, factory_file):
    variants = [A, [2, A[1], A[2], "너트", A[4]]]
    first = save(ingest_batch, factory_file, variants)
    variants[0] = [1, A[1], A[2], "나사", A[4]]
    variants[1] = [2, A[1], A[2], "핀", A[4]]
    second = save(ingest_batch, factory_file, variants, NEW)
    assert not set(first.row_ids) & set(second.row_ids)
    assert len(rows()) == 4
    assert all(row.missing_since == NEW for row in rows() if row.row_id in first.row_ids)
    assert save(ingest_batch, factory_file, variants, NEW).row_ids == second.row_ids


def test_one_remaining_changed_duplicate_keeps_unambiguous_id(ingest_batch, factory_file):
    variant = [2, A[1], A[2], "너트", A[4]]
    first = save(ingest_batch, factory_file, [A, variant])
    variant[3] = "핀"
    assert save(ingest_batch, factory_file, [variant, A], NEW).row_ids == tuple(
        reversed(first.row_ids)
    )


def test_skipped_input_rows_are_reported_without_false_missing_mark(ingest_batch, factory_file):
    save(ingest_batch, factory_file, [A, B])
    result = save(ingest_batch, factory_file, [A, [2, "", *B[2:]]], NEW)
    assert [(row.row_no, row.reason) for row in result.csv.skipped_rows] == [
        (3, "회사명 또는 공장주소가 비어 있음")
    ]
    assert rows()[1].missing_since is None


@pytest.mark.parametrize("confirmed", [False, None])
def test_unapproved_source_is_rejected_before_reading_file(
    ingest_batch, tmp_path, monkeypatch, confirmed
):
    with session_scope() as session:
        contract = session.get(SourceContract, SOURCE_ID)
        if confirmed is None:
            session.delete(contract)
        else:
            contract.confirmed_at = None

    def unexpected_read(*args, **kwargs):
        pytest.fail("승인 전에 원본을 읽음")

    monkeypatch.setattr("geosan.opportunity.factory_store.read_factory_csv", unexpected_read)
    with pytest.raises(InputError):
        store_factory_csv(ingest_batch, tmp_path / "missing.csv", OLD)
    assert rows() == []


@pytest.mark.parametrize(
    "field,value",
    [
        ("status", "DONE"),
        ("source_id", "api"),
        ("criteria", {}),
        ("criteria", {"regions": ["경기"]}),
        ("criteria", {"regions": ["충남", "충남"]}),
        ("criteria", {"regions": [None]}),
        ("criteria", {"regions": "충남"}),
    ],
)
def test_invalid_batch_context_does_not_store(ingest_batch, factory_file, field, value):
    with session_scope() as session:
        setattr(session.get(IngestBatch, ingest_batch), field, value)
    with pytest.raises(AppError):
        save(ingest_batch, factory_file, [A])
    assert rows() == []


def test_invalid_arguments_or_missing_batch_are_rejected(tmp_db, tmp_path):
    for batch, path, day in [
        (None, tmp_path, OLD),
        ("batch", None, OLD),
        ("batch", tmp_path, "2025-12-31"),
    ]:
        with pytest.raises(InputError):
            store_factory_csv(batch, path, day)
    with pytest.raises(NotFoundError):
        store_factory_csv("missing", tmp_path, OLD)


@pytest.mark.parametrize("column", [1, 2, 3, 4])
def test_contacts_in_public_fields_skip_row_without_echo(
    ingest_batch, factory_file, column, caplog
):
    private = "test@example.invalid"
    changed = B.copy()
    changed[column] += " " + private
    result = save(ingest_batch, factory_file, [A, changed])
    assert [row.company_name for row in rows()] == [A[1]]
    assert [(row.row_no, row.reason) for row in result.csv.skipped_rows] == [
        (3, "공개 본문에 연락처 형식이 있어 확인 필요")
    ]
    assert private not in repr(result) + repr([vars(row) for row in rows()]) + caplog.text


def test_bad_csv_does_not_mutate_existing_rows(ingest_batch, factory_file):
    first = save(ingest_batch, factory_file, [A])
    path = factory_file([B])
    with path.open("a", encoding="utf-8") as handle:
        handle.write('"unclosed')
    with pytest.raises(InputError):
        store_factory_csv(ingest_batch, path, NEW)
    assert [row.row_id for row in rows()] == list(first.row_ids)


def test_save_failure_rolls_back_all_rows_but_keeps_settled_cost(
    ingest_batch, factory_file, caplog
):
    ticket = reserve_candidate_judgment(ingest_batch, True)
    finish_search(ticket, 1000, 200, 0, None)
    calls = []

    def fail_second(mapper, connection, target):
        calls.append(target.row_id)
        if len(calls) == 2:
            raise SQLAlchemyError("PRIVATE_MARKER")

    event.listen(SourceFactoryRow, "before_insert", fail_second)
    try:
        with pytest.raises(RunFailedError) as error:
            save(ingest_batch, factory_file, [A, B])
    finally:
        event.remove(SourceFactoryRow, "before_insert", fail_second)
    assert len(calls) == 2 and rows() == []
    assert "PRIVATE_MARKER" not in str(error.value) + caplog.text
    with session_scope() as session:
        ledger = session.get(TransferLog, ticket.log_id)
        assert ledger.batch_id == ingest_batch and ledger.input_tokens == 1000
        assert ledger.cost_usd is not None


def test_preexisting_duplicate_facts_are_reported_instead_of_merged(ingest_batch, factory_file):
    save(ingest_batch, factory_file, [A])
    with session_scope() as session:
        original = session.scalars(select(SourceFactoryRow)).one()
        session.add(
            SourceFactoryRow(
                row_id="duplicate",
                source_id=SOURCE_ID,
                file_date=OLD,
                company_name=original.company_name,
                address=original.address,
                product=original.product,
                complex_name=original.complex_name,
                region=original.region,
                product_hash=original.product_hash,
                loaded_at=utcnow(),
            )
        )
    with pytest.raises(InputError):
        save(ingest_batch, factory_file, [A], NEW)
    assert all(row.file_date == OLD for row in rows())


def test_error_after_sql_update_rolls_back_product_and_missing_marker(ingest_batch, factory_file):
    first = save(ingest_batch, factory_file, [A, B])
    updated = []

    def fail_after_update(mapper, connection, target):
        updated.append(target.row_id)
        raise SQLAlchemyError("가상 갱신 오류")

    event.listen(SourceFactoryRow, "after_update", fail_after_update)
    changed = A.copy()
    changed[3] = "핀"
    try:
        with pytest.raises(RunFailedError):
            save(ingest_batch, factory_file, [changed], NEW)
    finally:
        event.remove(SourceFactoryRow, "after_update", fail_after_update)
    assert updated
    assert [row.row_id for row in rows()] == list(first.row_ids)
    assert [row.product for row in rows()] == ["볼트", "너트"]
    assert all(row.file_date == OLD and row.missing_since is None for row in rows())
