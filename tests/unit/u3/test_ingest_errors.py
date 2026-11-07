"""#373: 실제 저장 실패의 원인 분류는 남기고 SQL 값과 원문은 숨긴다."""

import logging
from datetime import date

import pytest
from sqlalchemy import event, select

from geosan.api.app import JsonFormatter
from geosan.config.errors import RunFailedError
from geosan.opportunity.factory_store import store_factory_csv
from geosan.opportunity.source_models import SourceFactoryRow
from geosan.storage.session import session_scope


def test_factory_failure_has_safe_cause_and_matching_ref(ingest_batch, factory_file, caplog):
    def break_constraint(mapper, connection, row):
        row.company_name = None
        row.product = "PRIVATE_BODY_MARKER"

    event.listen(SourceFactoryRow, "before_insert", break_constraint)
    caplog.set_level(logging.ERROR, logger="geosan")
    try:
        with pytest.raises(RunFailedError) as error:
            store_factory_csv(
                ingest_batch,
                factory_file([[1, "가상공장", "", "볼트", "충남 아산시 가상길 1"]]),
                date(2025, 12, 31),
            )
    finally:
        event.remove(SourceFactoryRow, "before_insert", break_constraint)
    assert error.value.message == "공개 공장 행을 저장하지 못했습니다."
    assert "integrity_error" in caplog.text
    assert "sqlite_constraint_notnull" in caplog.text
    record = next(row for row in caplog.records if getattr(row, "ref", None) == error.value.ref)
    rendered = JsonFormatter().format(record)
    assert error.value.ref in rendered and "sqlite_constraint_notnull" in rendered
    assert "PRIVATE_BODY_MARKER" not in caplog.text + rendered + str(error.value.to_error_body())
    assert "INSERT INTO" not in rendered and record.exc_info is None
    with session_scope() as session:
        assert session.scalars(select(SourceFactoryRow)).all() == []
