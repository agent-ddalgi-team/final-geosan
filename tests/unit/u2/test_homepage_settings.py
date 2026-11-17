"""홈페이지 검색 설정(C7)의 허용 범위와 기존 DB 사본 호환을 확인한다."""

import pytest
from pydantic import ValidationError

from geosan.config.app_settings import HomepageDiscoverySettings, LlmSettings, read_app_settings
from geosan.config.models import AppSetting
from geosan.storage.session import session_scope


@pytest.mark.parametrize(
    ("field", "value"),
    [
        ("minConfidence", -0.01),
        ("minConfidence", 1.01),
        ("minConfidence", float("nan")),
        ("minConfidence", True),
        ("dailyCallLimit", -1),
        ("dailyCallLimit", 0.5),
        ("dailyCallLimit", False),
        ("autoResearch", "false"),
    ],
)
def test_invalid_setting_reports_field(field, value):
    with pytest.raises(ValidationError) as exc:
        HomepageDiscoverySettings.model_validate(
            {"enabled": True, "termsConfirmed": False, field: value}
        )
    assert exc.value.errors()[0]["loc"] == (field,)


@pytest.mark.parametrize("threshold", [0, 1])
def test_threshold_boundaries_and_zero_limit(threshold):
    settings = HomepageDiscoverySettings.model_validate(
        {"enabled": True, "termsConfirmed": False, "minConfidence": threshold, "dailyCallLimit": 0}
    )
    assert settings.min_confidence == threshold
    assert settings.daily_call_limit == 0


def test_old_database_copy_keeps_automatic_research_off(tmp_db):
    with session_scope(tmp_db) as session:
        session.get(AppSetting, "homepageDiscovery").value = {
            "enabled": True,
            "termsConfirmed": True,
        }
    with session_scope(tmp_db) as session:
        settings = read_app_settings(session).homepage_discovery
        assert settings.enabled and settings.terms_confirmed
        assert settings.auto_research is False
        assert settings.min_confidence == 0.7
        assert settings.daily_call_limit == 200


@pytest.mark.parametrize(
    "values",
    [
        {"monthlyCostLimitUsd": float("nan")},
        {"inputCostPerMillionTokens": -1},
        {"costAlertRatio": 1.01},
        {"model": "typo", "allowedModels": ["gpt-6.1-sol"]},
    ],
)
def test_invalid_openai_prices_and_model_are_rejected(values):
    with pytest.raises(ValidationError):
        LlmSettings.model_validate(
            {
                "mode": "NONE",
                "model": None,
                "monthlyCallLimit": 0,
                "costPerThousandTokens": 0,
                "unconfirmedCallCostUsd": 0.10,
                **values,
            }
        )
