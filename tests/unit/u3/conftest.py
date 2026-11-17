"""저장 연결 검사용 가상 회차. 실제 외부 요청은 만들지 않는다."""

import csv
from datetime import date

import pytest

from geosan.config.app_settings import load_app_settings, sync_app_settings
from geosan.opportunity.factory_csv import SOURCE_ID
from geosan.opportunity.models import IngestBatch
from geosan.opportunity.source_models import SourceContract
from geosan.storage.base import utcnow
from geosan.storage.session import session_scope


@pytest.fixture
def ingest_batch(tmp_db, app_settings_path):
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
                batch_id="batch-test",
                source_id=SOURCE_ID,
                requested_by="park-lee",
                started_at=utcnow(),
                status="RUNNING",
                criteria={"regions": ["충남"]},
                is_virtual=True,
                dataset_kind="VIRTUAL_REVIEWED",
                session_ref="test-session",
            )
        )
    return "batch-test"


@pytest.fixture
def factory_file(tmp_path):
    def write(rows, extra_headers=()):
        path = tmp_path / "factories.csv"
        with path.open("w", encoding="utf-8", newline="") as handle:
            writer = csv.writer(handle)
            writer.writerow(["순번", "회사명", "단지명", "생산품", "공장주소", *extra_headers])
            writer.writerows(rows)
        return path

    return write
