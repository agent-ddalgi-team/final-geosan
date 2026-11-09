"""#499 가상 검색·판단 응답. 저장과 비용 계산은 실제 SQLite를 사용한다."""

import json
from datetime import date

from geosan.config.app_settings import read_app_settings, sync_app_settings
from geosan.opportunity import candidate_pick, candidate_web
from geosan.opportunity.source_models import SourceContract
from geosan.storage.session import session_scope
from tests.fakes.web_candidate_search import prepare, response


def setup_web_storage(path, monkeypatch):
    prepare(path)
    with session_scope() as session:
        settings = read_app_settings(session)
        settings.ingestion.ai_pick.enabled = True
        sync_app_settings(session, settings)
        session.add(
            SourceContract(
                source_id="kicox-factory-csv",
                source_name="가상 공개 자료",
                allowed_use="가상 검사",
                allowed_storage="가상 검사",
                confirmed_at=date(2026, 1, 1),
                is_virtual=True,
            )
        )
    monkeypatch.setenv("OPENAI_API_KEY", "synthetic")
    calls = {"search": [], "pick": []}

    def search(body, key):
        calls["search"].append(body)
        return response()

    def pick(body, key, deadline):
        calls["pick"].append(body)
        answer = [
            {
                "rowId": row["rowId"],
                "isManufacturer": True,
                "processCodes": ["ZN"],
                "industries": ["자동차 부품"],
                "reason": "공개 요약에 볼트 생산이 적힘",
                "fitLevel": "HIGH",
                "ownPlatingLineSuspected": False,
                "ownPlatingLineBasis": None,
            }
            for row in json.loads(body["input"])
        ]
        return {
            "status": "completed",
            "usage": {"input_tokens": 1000, "output_tokens": 200},
            "output": [
                {
                    "type": "message",
                    "role": "assistant",
                    "status": "completed",
                    "content": [
                        {"type": "output_text", "text": json.dumps(answer, ensure_ascii=False)}
                    ],
                }
            ],
        }

    monkeypatch.setattr(candidate_web, "_post_response", search)
    monkeypatch.setattr(candidate_pick, "_post", pick)
    return calls
