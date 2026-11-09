"""#489: 명령과 실제 SQLite로 소스 확인·중복 거부·담당자 검사를 확인한다."""

from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, date, datetime
from pathlib import Path
from threading import Barrier

import pytest
from pytest_bdd import given, parsers, scenarios, then, when
from sqlalchemy import event, select
from sqlalchemy.orm import Session
from typer.testing import CliRunner

from geosan.commands.app import app
from geosan.config.models import AppSetting
from geosan.opportunity.source_models import SourceContract
from geosan.storage.session import session_scope
from tests.unit.u3 import test_flow_ingest as support
from tests.unit.u3.test_ingest_command import invoke as ingest

scenarios(str(Path(__file__).with_name("source_confirm.feature")))
ingest_env = support.ingest_env

TERMS = "https://example.org/public-source/terms"


def confirm(source="kicox-factory-csv", *, by="choi-pm", on="2026-11-01", terms=TERMS):
    args = ["source-confirm", source, "--by", by]
    if on is not None:
        args.extend(["--on", on])
    if terms is not None:
        args.extend(["--terms", terms])
    return CliRunner().invoke(app, args)


def saved(source="kicox-factory-csv"):
    with session_scope() as session:
        row = session.get(SourceContract, source)
        return (
            {column.name: getattr(row, column.name) for column in SourceContract.__table__.columns}
            if row is not None
            else None
        )


def assert_no_records():
    with session_scope() as session:
        assert list(session.scalars(select(SourceContract))) == []


@given("소스 확인 기록이 없는 임시 DB와 담당자 설정이 있다")
def empty_source_database(tmp_db):
    assert_no_records()


@when(parsers.parse('담당자가 "{source}"의 이용·저장 확인 명령을 실행한다'), target_fixture="run")
def run_confirmation(source):
    return source, confirm(source)


@then("해당 소스의 확인자와 날짜가 실제 DB에 저장된다")
def source_is_saved(run):
    source, result = run
    assert result.exit_code == 0, result.output
    row = saved(source)
    assert row["confirmed_by"] == row["created_by"] == "choi-pm"
    assert row["confirmed_at"] == date(2026, 11, 1)
    assert row["terms_ref"] == TERMS
    assert row["source_name"] == (
        "산단공 전국등록공장현황 파일" if source.endswith("csv") else "산단공 공장등록생산정보 조회"
    )
    assert row["allowed_use"] and row["allowed_storage"]
    assert row["is_virtual"] is False and row["dataset_kind"] is None
    assert "확인" in result.output and "저장" in result.output


@pytest.mark.parametrize("staff", ["viewer", "not-registered"])
def test_unregistered_or_view_only_staff_cannot_confirm(tmp_db, staff):
    result = confirm(by=staff)
    assert result.exit_code == 1
    assert "설정에 등록된 기록 담당자 키" in result.output
    assert_no_records()


def test_unknown_source_is_rejected_without_writing(tmp_db):
    result = confirm("unknown-source")
    assert result.exit_code == 1 and "소스" in result.output
    assert_no_records()


def test_existing_confirmation_is_never_overwritten(tmp_db):
    assert confirm().exit_code == 0
    before = saved()
    result = confirm(by="park-lee", on="2026-11-02", terms="https://example.org/changed")
    assert result.exit_code == 1 and "이미" in result.output
    assert saved() == before


@pytest.fixture
def seoul_clock(monkeypatch):
    from geosan.commands import source_confirm

    monkeypatch.setattr(source_confirm, "utcnow", lambda: datetime(2026, 11, 8, 16, tzinfo=UTC))


def test_default_confirmation_day_is_today_in_seoul(tmp_db, seoul_clock):
    result = confirm(on=None)
    assert result.exit_code == 0, result.output
    assert saved()["confirmed_at"] == date(2026, 11, 9)
    assert "2026-11-09" in result.output


@pytest.mark.parametrize("day", ["2026-11-10", "2026-02-30", "20261101", "2026-1-1", ""])
def test_invalid_or_future_confirmation_date_writes_nothing(tmp_db, seoul_clock, day):
    result = confirm(on=day)
    assert result.exit_code == 1 and "확인일" in result.output
    assert_no_records()


@pytest.mark.parametrize(
    "terms", ["", "not-a-url", "file:///terms", "https://user:secret@example.org"]
)
def test_invalid_terms_address_is_not_saved_or_echoed(tmp_db, terms, caplog):
    result = confirm(terms=terms)
    assert result.exit_code == 1 and "약관 주소" in result.output
    assert "secret" not in result.output + caplog.text
    assert_no_records()


@pytest.mark.parametrize(
    ("source", "url"),
    [
        ("kicox-factory-csv", "https://www.data.go.kr/data/15105482/fileData.do"),
        ("kicox-production-api", "https://www.data.go.kr/data/15087611/openapi.do"),
    ],
)
def test_pm_confirmed_terms_default_is_used_when_omitted(tmp_db, source, url):
    result = confirm(source, terms=None)
    assert result.exit_code == 0, result.output
    row = saved(source)
    assert row["terms_ref"] == url
    assert "이용허락범위 제한 없음" in row["allowed_use"]
    assert "대표자 이름·팩스·전화·개인 연락처는 읽는 즉시 버림" in row["allowed_storage"]


def test_database_staff_copy_is_used_instead_of_bundled_defaults(tmp_db):
    with session_scope() as session:
        row = session.get(AppSetting, "staff")
        row.value = [{"key": "source-admin", "displayName": "소스 담당"}]
    assert confirm().exit_code == 1
    result = confirm(by="source-admin")
    assert result.exit_code == 0, result.output
    assert saved()["confirmed_by"] == "source-admin"


def test_bare_database_uses_existing_settings_fallback(bare_db):
    result = confirm()
    assert result.exit_code == 0, result.output
    assert saved()["confirmed_by"] == "choi-pm"


def test_missing_database_requires_init_without_creating_a_file(tmp_path, monkeypatch):
    path = tmp_path / "not-created.db"
    monkeypatch.setenv("GEOSAN_DB_PATH", str(path))
    result = confirm()
    assert result.exit_code == 1 and "init-db" in result.output
    assert not path.exists()


def test_existing_unconfirmed_row_is_also_not_replaced(tmp_db):
    with session_scope() as session:
        session.add(
            SourceContract(
                source_id="kicox-factory-csv",
                source_name="기존 기록",
                allowed_use="기존 용도",
                allowed_storage="기존 범위",
            )
        )
    before = saved()
    result = confirm()
    assert result.exit_code == 1 and "이미" in result.output
    assert saved() == before and saved()["confirmed_at"] is None


def test_concurrent_confirmations_insert_once_without_overwriting(tmp_db):
    from geosan.commands.source_confirm import run_source_confirm

    barrier = Barrier(2)

    def run(staff):
        barrier.wait(timeout=10)
        messages = []
        code = run_source_confirm(
            "kicox-factory-csv", staff_key=staff, terms=TERMS, on="2026-11-01", echo=messages.append
        )
        return code, staff

    with ThreadPoolExecutor(max_workers=2) as executor:
        results = list(executor.map(run, ["choi-pm", "park-lee"]))
    assert sorted(code for code, _ in results) == [0, 1]
    assert saved()["confirmed_by"] == next(staff for code, staff in results if code == 0)


def test_failed_commit_rolls_back_and_hides_external_error(tmp_db, caplog):
    writes = []

    def fail_after_insert(session, context):
        if any(isinstance(row, SourceContract) for row in session.new):
            writes.append(True)
            raise RuntimeError("PRIVATE_STORAGE_ERROR")

    event.listen(Session, "after_flush", fail_after_insert)
    try:
        result = confirm()
    finally:
        event.remove(Session, "after_flush", fail_after_insert)
    assert result.exit_code == 2 and "저장하지 못했습니다" in result.output
    assert "PRIVATE_STORAGE_ERROR" not in result.output + caplog.text
    assert writes == [True]
    assert_no_records()


def test_confirmation_unblocks_real_ingest_command(ingest_env):
    """파일·등록·평가는 실제 부품, 외부 AI 응답만 기존 가짜 응답으로 대체한다."""
    with session_scope() as session:
        session.delete(session.get(SourceContract, "kicox-factory-csv"))
    before = ingest()
    assert before.exit_code == 2 and "이용·저장 확인" in before.output
    assert ingest_env.picker.calls == 0
    assert confirm().exit_code == 0
    after = ingest()
    assert after.exit_code == 0, after.output
    assert "DONE" in after.output and "등록 1곳" in after.output
    assert ingest_env.picker.calls == 1


def test_registry_confirmation_unblocks_existing_source_guard(ingest_batch):
    from geosan.evidence.public_source import reserve_factory_registry

    assert confirm("kicox-production-api").exit_code == 0
    log_id = reserve_factory_registry(batch_id=ingest_batch)
    assert log_id


def test_help_lists_approved_arguments():
    result = CliRunner().invoke(app, ["source-confirm", "--help"])
    assert result.exit_code == 0
    assert all(text in result.output for text in ["--by", "--terms", "--on", "확인일", "덮어쓰지"])
