"""#799 운영 관리 화면 + 대시보드 운영 알림(PM 결정 2026-11-16: 사용률 80%, 공장현황 180일,
운영 담당은 설정 목록에 choi-pm만).

실제 임시 DB·API로 본다. 외부 호출 없음. 지금은 2026-11-16 10:00(한국)으로 고정한다. 전송 기록은
가짜 행이다(실제 비용 아님).
"""

from datetime import date, datetime, timedelta
from decimal import Decimal

import pytest
from fastapi.testclient import TestClient

from geosan.api.app import create_app
from geosan.api.routes import dashboard as dashboard_route
from geosan.api.routes import operations as operations_route
from geosan.config.app_settings import (
    DEFAULT_APP_SETTINGS_PATH,
    load_app_settings,
    read_app_settings,
    sync_app_settings,
)
from geosan.config.models import AppSetting
from geosan.evidence.transfer import KST, TransferLog, month_usage
from geosan.opportunity.factory_csv import SOURCE_ID as FACTORY_CSV
from geosan.opportunity.source_models import SourceFactoryRow
from geosan.storage.base import new_id
from geosan.storage.session import session_scope

NOW = datetime(2026, 11, 16, 10, 0, tzinfo=KST)
OPS = {"X-Staff-Key": "choi-pm"}
SALES = {"X-Staff-Key": "park-lee"}


def _log(
    *, purpose, kind, cost, calls=1, when=NOW - timedelta(hours=2), decision="ALLOWED", reason=None
):
    return TransferLog(
        transfer_log_id=new_id("transfer"),
        occurred_at=when,
        opp_id="opp-virtual-799",
        purpose=purpose,
        kind=kind,
        mode="EXTERNAL" if calls else "NONE",
        model="virtual-model",
        security_grade="PUBLIC",
        decision=decision,
        reject_reason=reason,
        requested_by="system",
        call_count=calls,
        cost_usd=Decimal(str(cost)) if cost is not None else None,
        is_virtual=True,
    )


def _set_llm(**values):
    with session_scope() as session:
        row = session.get(AppSetting, "llm")
        row.value = {**row.value, **values}


@pytest.fixture
def ops_env(tmp_db, monkeypatch):
    """이번 달 사용 $5.50(조사 $4 · 웹 검색 $1 · 영업 코치 $0.5), 지난달 $9, 거부 12건,
    공장현황 2025-12-31."""
    with session_scope() as session:
        if read_app_settings(session) is None:
            sync_app_settings(session, load_app_settings(DEFAULT_APP_SETTINGS_PATH))
    _set_llm(monthlyCostLimitUsd=20.0, monthlyCallLimit=1000, costAlertRatio=0.8)
    with session_scope() as session:
        session.add_all(
            [
                _log(purpose="EXTERNAL_AI", kind="PUBLIC_TEXT", cost=4.0, calls=2),
                _log(
                    purpose="EXTERNAL_SEARCH",
                    kind="WEB_SEARCH",
                    cost=1.0,
                    when=NOW - timedelta(days=3),
                ),
                _log(purpose="EXTERNAL_AI", kind="SALES_COACH", cost=0.5),
                _log(
                    purpose="EXTERNAL_AI",
                    kind="PUBLIC_TEXT",
                    cost=9.0,
                    when=NOW - timedelta(days=20),
                ),
                _log(purpose="EXTERNAL_GEOCODE", kind="GEOCODE", cost=None, calls=3),
            ]
            + [
                _log(
                    purpose="EXTERNAL_AI",
                    kind="PUBLIC_TEXT",
                    cost=None,
                    calls=0,
                    decision="REJECTED",
                    reason=f"가상 거부 {n}",
                    when=NOW - timedelta(minutes=n),
                )
                for n in range(12)
            ]
        )
        session.add(
            SourceFactoryRow(
                row_id=new_id("row"),
                source_id=FACTORY_CSV,
                file_date=date(2025, 12, 31),
                company_name="가상정밀",
                product="볼트",
                address="충청남도 천안시 서북구 가상로 1",
                region="충남",
                product_hash="virtual",
                loaded_at=datetime(2026, 11, 6, 9, 0, tzinfo=KST),
                is_virtual=True,
            )
        )
    for module in (operations_route, dashboard_route):
        monkeypatch.setattr(module, "utcnow", lambda: NOW)
    with TestClient(create_app()) as client:
        yield client


def operations(client, headers=OPS):
    return client.get("/api/v1/operations", headers=headers)


def alerts(client, headers):
    rows = client.get("/api/v1/dashboard", headers=headers).json()["data"]["todayChecks"]
    return {row["kind"]: row for row in rows if row["kind"].startswith(("AI_", "DATA_"))}


def test_only_operations_staff_can_read(ops_env):
    """Given 운영 담당 choi-pm / When 다른 담당자·보기 전용·키 없음이 열면
    / Then 403, 운영 담당만 200."""
    assert operations(ops_env).status_code == 200
    for headers in (SALES, {"X-Staff-Key": "viewer"}, {}):
        response = operations(ops_env, headers)
        assert response.status_code == 403, headers
        assert "운영 담당만" in response.json()["error"]["message"]


def test_usage_is_this_month_by_group_with_the_same_cost_as_geosan_cost(ops_env):
    """Given 이번 달 조사 $4·웹 검색 $1·코치 $0.5와 지난달 $9 / When 운영 관리
    / Then 이번 달 $5.50(한도 계산 비용과 같음), 쓰임새별·날짜별로 나뉜다."""
    usage = operations(ops_env).json()["data"]["usage"]
    with session_scope() as session:
        settings = read_app_settings(session)
        calls, cost = month_usage(session, settings.llm, now=NOW)
    assert usage["month"] == "2026-11"
    assert usage["costUsd"] == pytest.approx(float(cost)) == pytest.approx(5.5)
    assert usage["calls"] == calls == 4
    assert usage["costLimitUsd"] == 20.0 and usage["alertRatio"] == 0.8
    assert {row["group"]: (row["calls"], row["costUsd"]) for row in usage["groups"]} == {
        "RESEARCH": (2, 4.0),
        "WEB_SEARCH": (1, 1.0),
        "SALES": (1, 0.5),
    }
    assert [row["day"] for row in usage["daily"]] == ["2026-11-13", "2026-11-16"]
    assert set(usage["autoResearchToday"]) == {"usedUsd", "limitUsd"}


def test_sources_show_dates_and_factory_file_refresh_due(ops_env):
    """Given 공장현황 파일 기준일 2025-12-31, 갱신 주기 180일 / When 운영 관리
    / Then 다음 갱신 권장 2026-06-29이 지나 '지남'. 다른 자료는 갱신 권장일이 없다."""
    sources = {row["source"]: row for row in operations(ops_env).json()["data"]["sources"]}
    assert list(sources) == [
        "FACTORY_FILE",
        "FACTORY_REGISTRY",
        "FACTORY_PROFILE",
        "WATER_LIST",
        "AI_JUDGMENT",
    ]
    factory = sources["FACTORY_FILE"]
    assert factory["asOf"] == "2025-12-31" and factory["rows"] == 1
    assert factory["refreshDueAt"] == "2026-06-29" and factory["refreshOverdue"] is True
    assert sources["WATER_LIST"]["refreshDueAt"] is None and sources["WATER_LIST"]["rows"] == 0


def test_blocked_shows_latest_ten_reasons_only(ops_env):
    """Given 거부 12건 / When 운영 관리 / Then 최근 10건, 이유·용도·종류·시각만."""
    blocked = operations(ops_env).json()["data"]["blocked"]
    assert len(blocked) == 10
    assert blocked[0]["reason"] == "가상 거부 0"
    assert set(blocked[0]) == {"occurredAt", "purpose", "kind", "reason"}


def test_dashboard_alerts_follow_usage_ratio_and_refresh_due(ops_env):
    """Given 한도 $6(사용 $5.50 = 92%) / When 대시보드 / Then 운영 담당에게 사용률·자료 갱신 알림,
    영업 담당에게는 없음. 알림 줄은 맨 앞이고 회사 목록이 없다."""
    _set_llm(monthlyCostLimitUsd=6.0)
    mine = alerts(ops_env, OPS)
    assert set(mine) == {"AI_USAGE_ALERT", "DATA_REFRESH_DUE"}
    assert mine["AI_USAGE_ALERT"]["alert"] == {
        "usedUsd": 5.5,
        "limitUsd": 6.0,
        "percent": 92,
        "asOf": None,
        "dueAt": None,
    }
    assert mine["AI_USAGE_ALERT"]["count"] == 1 and mine["AI_USAGE_ALERT"]["items"] == []
    assert mine["DATA_REFRESH_DUE"]["alert"]["dueAt"] == "2026-06-29"
    rows = ops_env.get("/api/v1/dashboard", headers=OPS).json()["data"]["todayChecks"]
    assert rows[0]["kind"] == "AI_USAGE_ALERT"
    assert alerts(ops_env, SALES) == {}


def test_below_ratio_no_usage_alert(ops_env):
    """Given 한도 $20(사용 28%) / When 대시보드 / Then 사용률 알림 없음(자료 갱신 알림만)."""
    assert set(alerts(ops_env, OPS)) == {"DATA_REFRESH_DUE"}


def test_limit_reached_is_shown_to_every_recording_staff(ops_env):
    """Given 한도 $5(사용 $5.50) / When 대시보드 / Then 영업 담당·운영 담당 모두 한도 도달 줄,
    사용률 알림은 겹쳐 보이지 않는다. 보기 전용은 없다. 메뉴 숫자(곳 수)에는 안 들어간다."""
    _set_llm(monthlyCostLimitUsd=5.0)
    assert set(alerts(ops_env, SALES)) == {"AI_LIMIT_REACHED"}
    assert set(alerts(ops_env, OPS)) == {"AI_LIMIT_REACHED", "DATA_REFRESH_DUE"}
    assert alerts(ops_env, {"X-Staff-Key": "viewer"}) == {}
    badges = ops_env.get(
        "/api/v1/menu-badges", headers=SALES, params={"listSince": NOW.isoformat()}
    ).json()["data"]
    assert badges["dashboard"] == 0


def test_config_ui_tells_who_sees_the_menu(ops_env):
    """Given 설정 운영 담당 choi-pm / When 화면 설정 / Then operationsStaffKeys = [choi-pm]."""
    assert ops_env.get("/api/v1/config/ui").json()["data"]["operationsStaffKeys"] == ["choi-pm"]


def test_operations_key_not_in_staff_is_ignored_not_rejected(ops_env):
    """Given 담당자 목록을 바꿔 운영 담당 키(choi-pm)가 목록에서 빠짐
    / When 설정 읽기·화면 설정·운영 관리
    / Then 설정 전체는 그대로 읽히고, 그 키는 운영 담당이 아니다(메뉴 없음·403).

    처음엔 설정을 거부했으나 담당자 목록만 바꿔도 앱 전체가 막혀(#799 검사) 무시하는 쪽으로 바꿨다.
    """
    with session_scope() as session:
        row = session.get(AppSetting, "staff")
        row.value = [entry for entry in row.value if entry["key"] != "choi-pm"]
    with session_scope() as session:
        settings = read_app_settings(session)
    assert settings.operations.staff_keys == ["choi-pm"]
    assert settings.operations_staff_keys() == []
    assert ops_env.get("/api/v1/config/ui").json()["data"]["operationsStaffKeys"] == []
    assert operations(ops_env, SALES).status_code == 403


def test_example_settings_hold_the_pm_numbers():
    """PM 확인값: 사용률 80%(llm.costAlertRatio), 공장현황 180일, 운영 담당 choi-pm."""
    settings = load_app_settings(DEFAULT_APP_SETTINGS_PATH)
    assert settings.llm.cost_alert_ratio == 0.8
    assert settings.operations.factory_csv_refresh_days == 180
    assert settings.operations.staff_keys == ["choi-pm"]
