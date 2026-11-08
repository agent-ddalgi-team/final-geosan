"""#428 서버 시작부터 실제 후보 찾기 실행까지 연결을 확인한다.

외부 AI 통신만 대체한다. 서버가 연결한 실제 실행 함수·원본 저장·판단·등록·평가·API를 쓴다.
"""

from datetime import date
from pathlib import Path

import pytest
import uvicorn
from fastapi.testclient import TestClient
from sqlalchemy import select

from geosan.capability.importer import import_capability
from geosan.commands import serve
from geosan.config.app_settings import load_app_settings, read_app_settings, sync_app_settings
from geosan.opportunity import candidate_pick
from geosan.opportunity.models import IngestBatch
from geosan.opportunity.source_models import SourceContract
from geosan.storage.session import session_scope
from tests import factories
from tests.unit.u1.test_snapshot_ledger import _write
from tests.unit.u3.conftest import factory_file as factory_file


@pytest.mark.parametrize("failed", [False, True])
def test_server_runs_real_ingest_and_reports_terminal_state(
    tmp_db, tmp_path, factory_file, monkeypatch, failed
):
    # 이 부품을 대체하면 선행 작업 누락을 숨기므로 실제 #427 부품을 가져온다.
    from tests.fakes.ingest_responses import FakeCandidateResponses

    import_capability(_write(tmp_path, "capability.json", factories.capability_file()))
    original = factory_file([[1, "가상 볼트사", "", "가상 볼트", "충남 당진시 가상길 1"]])
    path = original.with_name("factories_20251231.csv")
    path.write_bytes(original.read_bytes())
    with session_scope() as session:
        settings = read_app_settings(session)
        settings.ingestion.factory_csv_path = str(path)
        settings.ingestion.ai_pick.enabled = True
        settings.llm = load_app_settings(Path("examples/app-settings.yaml")).llm
        settings.llm.mode = "EXTERNAL"
        sync_app_settings(session, settings)
        session.add(
            SourceContract(
                source_id="kicox-factory-csv",
                source_name="가상 파일",
                allowed_use="검사",
                allowed_storage="검사",
                confirmed_at=date(2026, 1, 1),
                is_virtual=True,
            )
        )
    response_stub = FakeCandidateResponses()
    observed = []

    def response(payload, key, deadline):
        with session_scope() as session:
            observed.append(session.scalar(select(IngestBatch)).status)
        if failed:
            raise RuntimeError("외부 원문은 실패 안내에 복사하지 않음")
        return response_stub(payload, key, deadline)

    monkeypatch.setenv("OPENAI_API_KEY", "synthetic")
    monkeypatch.setattr(candidate_pick, "_post", response)
    apps = []
    monkeypatch.setattr(uvicorn, "run", lambda app, **kwargs: apps.append(app))
    serve._run_server(18769)
    assert len(apps) == 1
    with TestClient(apps[0]) as client:
        body = {"processCodes": ["ZINC_PLATING"], "regions": ["충남"]}
        assert client.post("/api/v1/ingest", json=body).status_code == 403
        accepted = client.post("/api/v1/ingest", json=body, headers={"X-Staff-Key": "park-lee"})
        assert accepted.status_code == 200, accepted.text
        listing = client.get("/api/v1/opportunities").json()
        progress = listing["meta"]["latestIngest"]
        assert observed == ["RUNNING"]
        assert progress["batchId"] == accepted.json()["data"]["batchId"]
        assert progress["status"] == ("FAILED" if failed else "DONE")
        if failed:
            assert progress["failureReason"]
            assert "외부 원문" not in progress["failureReason"]
            assert listing["data"] == []
        else:
            assert progress["newCount"] == 1 and len(listing["data"]) == 1
            card = listing["data"][0]
            assert card["evalId"] and card["classificationCode"] == "NOT_EVALUATED"
            detail = client.get(f"/api/v1/opportunities/{card['oppId']}")
            assert detail.status_code == 200 and detail.json()["data"]["evalId"] == card["evalId"]
