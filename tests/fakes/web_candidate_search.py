"""#493: 외부 응답만 대체한다. 회차·공정·설정·전송 기록은 실제 SQLite다."""

import json

from sqlalchemy import select

from geosan.capability.models import Process
from geosan.config.app_settings import load_app_settings, sync_app_settings
from geosan.config.models import AppSetting
from geosan.evidence.transfer import TransferLog
from geosan.opportunity.models import IngestBatch
from geosan.rules.codes import DatasetKind
from geosan.storage.base import utcnow
from geosan.storage.session import session_scope

BATCH = "web-search-test"


def prepare(path):
    settings = load_app_settings(path)
    settings.active_dataset_kind = DatasetKind.VIRTUAL_REVIEWED
    settings.llm.mode = "EXTERNAL"
    settings.candidate_web_search.enabled = True
    with session_scope() as session:
        sync_app_settings(session, settings)
        session.add(
            Process(
                process_id="web-process",
                code="ZN",
                name="전기아연도금",
                review_status="REVIEWED",
                dataset_kind="VIRTUAL_REVIEWED",
                is_virtual=True,
                assumption_note="PRIVATE_INTERNAL_MARKER",
            )
        )
        session.add(
            IngestBatch(
                batch_id=BATCH,
                source_id="kicox-factory-csv",
                requested_by="park-lee",
                started_at=utcnow(),
                status="RUNNING",
                is_virtual=True,
                dataset_kind="VIRTUAL_REVIEWED",
                max_candidates=10,
                criteria={"processCodes": ["ZN"], "regions": ["충남"], "industries": []},
            )
        )


def settings(key="candidateWebSearch", **values):
    with session_scope() as session:
        row = session.get(AppSetting, key)
        row.value = row.value | values


def logs():
    with session_scope() as session:
        return session.scalars(select(TransferLog).order_by(TransferLog.created_at)).all()


def candidate(**changes):
    return {
        "companyName": "가상볼트",
        "address": "충남 아산시",
        "sourceUrl": "https://bolt.example/products",
        "homepageUrl": "https://bolt.example/",
        "snippet": "볼트와 너트 생산",
        **changes,
    }


def response(candidates=None, sources=None):
    candidates = [candidate()] if candidates is None else candidates
    sources = (
        [item.get("sourceUrl") for item in candidates if item.get("sourceUrl")]
        if sources is None
        else sources
    )
    return {
        "status": "completed",
        "usage": {"input_tokens": 1000, "output_tokens": 200},
        "output": [
            {
                "type": "web_search_call",
                "status": "completed",
                "action": {
                    "type": "search",
                    "sources": [{"type": "url", "url": url} for url in sources],
                },
            },
            {
                "type": "message",
                "status": "completed",
                "role": "assistant",
                "content": [
                    {
                        "type": "output_text",
                        "text": json.dumps(candidates, ensure_ascii=False),
                        "annotations": [],
                    }
                ],
            },
        ],
    }
