"""#719(PM 결정 2026-11-14): 화면 설정 응답이 조사용 AI가 켜져 있는지를 켜짐/꺼짐 한 값으로 준다.

실제 임시 DB·API로 본다. 외부 호출 없음. 키는 가짜 글자다(실제 키 아님).
"""

import pytest
from fastapi.testclient import TestClient

from geosan.api.app import create_app
from geosan.config.app_settings import (
    DEFAULT_APP_SETTINGS_PATH,
    load_app_settings,
    read_app_settings,
    sync_app_settings,
)
from geosan.config.errors import AppError
from geosan.config.models import AppSetting
from geosan.evidence.transfer import reserve_extraction
from geosan.storage.session import session_scope

FAKE_KEY = "virtual-test-key-719"


def _configure(monkeypatch, *, key=FAKE_KEY, **llm_changes):
    """AI를 부를 수 있는 설정을 만든 뒤 한 군데만 바꾼다."""
    if key is None:
        monkeypatch.delenv("OPENAI_API_KEY", raising=False)
    else:
        monkeypatch.setenv("OPENAI_API_KEY", key)
    values = {
        "mode": "EXTERNAL",
        "model": "virtual-model",
        "allowedModels": ["virtual-model"],
        "inputCostPerMillionTokens": 1.0,
        "outputCostPerMillionTokens": 2.0,
        "monthlyCallLimit": 100,
        "monthlyCostLimitUsd": 10.0,
        **llm_changes,
    }
    with session_scope() as session:
        if read_app_settings(session) is None:
            sync_app_settings(session, load_app_settings(DEFAULT_APP_SETTINGS_PATH))
        row = session.get(AppSetting, "llm")
        row.value = {**row.value, **values}


def _research(client):
    response = client.get("/api/v1/config/ui")
    assert response.status_code == 200, response.text
    assert FAKE_KEY not in response.text
    return response.json()["data"]["research"]


def _reserve_is_refused() -> bool:
    """근거 추출 호출 예약이 "AI 조사 설정이 아직 되어 있지 않습니다"로 거부되는가."""
    import os

    try:
        reserve_extraction("opp-719", bool(os.environ.get("OPENAI_API_KEY", "").strip()), None, "t")
    except AppError as error:
        assert error.kind == "LLM_NOT_CONFIGURED"
        return True
    return False


def test_research_ai_is_on_when_the_extraction_call_can_be_made(tmp_db, monkeypatch):
    """Given AI를 부를 수 있는 설정과 키 / Then aiEnabled true, 켜짐/꺼짐 한 값만 온다."""
    _configure(monkeypatch)
    with TestClient(create_app()) as client:
        assert _research(client) == {"aiEnabled": True}
    assert not _reserve_is_refused()


@pytest.mark.parametrize(
    "change",
    [
        {"key": None},
        {"key": "   "},
        {"mode": "NONE"},
        {"inputCostPerMillionTokens": 0},
        {"outputCostPerMillionTokens": 0},
    ],
)
def test_research_ai_is_off_exactly_when_the_extraction_call_is_refused(
    tmp_db, monkeypatch, change
):
    """Given 설정 한 군데가 빠짐 / Then aiEnabled false, 실제 호출 예약도 같은 이유로 거부된다."""
    _configure(monkeypatch, **change)
    with TestClient(create_app()) as client:
        assert _research(client) == {"aiEnabled": False}
    assert _reserve_is_refused()


def test_research_ai_does_not_look_at_limits(tmp_db, monkeypatch):
    """Given 월 호출 한도가 0 / Then 켜짐 값은 그대로 true다(한도는 이 값이 아니다)."""
    _configure(monkeypatch, monthlyCallLimit=0)
    with TestClient(create_app()) as client:
        assert _research(client) == {"aiEnabled": True}
