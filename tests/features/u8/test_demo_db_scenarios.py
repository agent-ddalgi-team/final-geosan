"""#274: 발표 시연용 DB 시나리오. 실제 임시 DB와 실제 명령·API로 확인한다. 외부 호출 없음.

가상 사례·가상 기록만 쓴다(거산 실제 사양 아님). 서버는 띄우지 않고 시작 함수만 가짜로 바꾼다.
"""

from __future__ import annotations

import sqlite3
from datetime import date
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from pytest_bdd import given, parsers, scenarios, then, when
from typer.testing import CliRunner

from geosan.api.app import create_app
from geosan.commands import serve as serve_module
from geosan.commands.app import app
from geosan.config.app_settings import is_demo_database
from geosan.storage.engine import dispose_engines
from geosan.storage.session import session_scope
from tests.conftest import EXAMPLES_DIR

scenarios("u8/demo_db.feature")

RULE_CONFIG = EXAMPLES_DIR / "rule-config.yaml"
DEMO_SETTINGS = EXAMPLES_DIR / "app-settings-demo.yaml"
VIRTUAL_SETTINGS = EXAMPLES_DIR / "app-settings-virtual.yaml"
CASE_FILES = [EXAMPLES_DIR / "case-apjeong.json", *sorted((EXAMPLES_DIR / "demo").glob("*.json"))]
STAFF = {"X-Staff-Key": "park-lee"}


def run(*args: object) -> tuple[int, str]:
    result = CliRunner().invoke(app, [str(arg) for arg in args], catch_exceptions=False)
    return result.exit_code, result.output


def build_db(db_path: Path, monkeypatch, settings: Path, *, with_cases: bool = True) -> Path:
    """README "발표 시연용 DB"의 명령 순서 그대로 임시 DB를 만든다."""
    monkeypatch.setenv("GEOSAN_DB_PATH", str(db_path))
    monkeypatch.delenv("GEOSAN_PASSWORD", raising=False)
    dispose_engines()
    steps = [("init-db",), ("check-config", RULE_CONFIG, settings)]
    if with_cases:
        steps.append(("import-capability", EXAMPLES_DIR / "capability-geosan.json"))
        steps.extend(("import-case", path) for path in CASE_FILES)
        steps.append(("evaluate",))
    for step in steps:
        code, out = run(*step)
        assert code == 0, (step, out)
    return db_path


def outcome_count(db_path: Path) -> int:
    connection = sqlite3.connect(str(db_path))
    try:
        return connection.execute("SELECT count(*) FROM rec_outcome").fetchone()[0]
    finally:
        connection.close()


@pytest.fixture
def ctx(tmp_path, monkeypatch):
    started: list[tuple[int, str]] = []
    monkeypatch.setattr(
        serve_module, "_run_server", lambda port, host: started.append((port, host))
    )
    monkeypatch.setattr(serve_module, "port_in_use", lambda port, host: False)
    try:
        yield {"tmp": tmp_path, "monkeypatch": monkeypatch, "started": started}
    finally:
        dispose_engines()


@given("안내서 순서대로 만든 시연 DB에 가상 회사 36곳이 평가되어 있다")
def demo_db(ctx):
    # 파일 이름은 일부러 geosan-demo.db가 아니다. DB 안 시연 표시만으로 알아보는지 본다.
    ctx["db"] = build_db(ctx["tmp"] / "renamed.db", ctx["monkeypatch"], DEMO_SETTINGS)
    assert len(CASE_FILES) == 36  # (#826) 18곳 → 36곳


@given("시연 표시가 없는 설정으로 등록한 DB에 가상 회사 36곳이 평가되어 있다")
def plain_db(ctx):
    ctx["db"] = build_db(ctx["tmp"] / "geosan.db", ctx["monkeypatch"], VIRTUAL_SETTINGS)


@given("시연 표시 없이 파일 이름만 geosan-demo.db인 DB가 있다")
def named_demo_db(ctx):
    ctx["db"] = build_db(
        ctx["tmp"] / "geosan-demo.db", ctx["monkeypatch"], VIRTUAL_SETTINGS, with_cases=False
    )
    with session_scope(ctx["db"]) as session:
        assert not is_demo_database(session)


@when("가상 영업 기록 넣기 명령을 실행한다")
def seed(ctx):
    ctx["code"], ctx["out"] = run("seed-demo-records")
    ctx["count_after_first"] = outcome_count(ctx["db"])


@when("가상 영업 기록 넣기 명령을 한 번 더 실행한다")
def seed_again(ctx):
    assert ctx["code"] == 0, ctx["out"]
    ctx["code"], ctx["out"] = run("seed-demo-records")


@when("배포 주소 0.0.0.0으로 서버를 시작한다")
def serve_deploy_host(ctx):
    ctx["code"], ctx["out"] = run("serve", "--host", "0.0.0.0", "--port", "18774")


@when("배포용 비밀번호가 설정된 환경에서 내 PC 주소로 서버를 시작한다")
def serve_with_password(ctx):
    ctx["monkeypatch"].setenv("GEOSAN_PASSWORD", "virtual-test-value")
    ctx["code"], ctx["out"] = run("serve", "--port", "18774")


@when("비밀번호 없이 내 PC 주소로 서버를 시작한다")
def serve_local(ctx):
    ctx["code"], ctx["out"] = run("serve", "--port", "18774")


@when("시연 표시가 없는 설정 파일을 등록한다")
def register_plain_settings(ctx):
    ctx["code"], ctx["out"] = run("check-config", RULE_CONFIG, EXAMPLES_DIR / "app-settings.yaml")


@then(
    "영업 분석표에 성사 9곳·거절 11곳·보류 4곳·진행 중 12곳이 보이고 "
    "거절 이유는 가격 5·납기 3·기존 거래처 유지 2·수요 없음 1건이다"
)
def won_and_lost(ctx):
    # (바뀜 2026-11-15 #765 — PM 결정: 시연 DB 6곳 → 18곳. 전에는 성사 3·거절 3이었다)
    assert ctx["code"] == 0, ctx["out"]
    # (바뀜 2026-11-17 #826 — PM 결정: 18곳 → 36곳. 곳 수가 늘어 기대값을 바꿈)
    assert "넣은 회사 36곳(성사 9·거절 11)" in ctx["out"]
    with TestClient(create_app()) as client:
        ctx["client_data"] = {
            "analysis": client.get("/api/v1/sales-analysis", headers=STAFF).json()["data"],
            "dashboard": client.get("/api/v1/dashboard", headers=STAFF).json()["data"],
            "ui": client.get("/api/v1/config/ui").json()["data"],
            "cards": client.get("/api/v1/opportunities", params={"pageSize": 50}).json()["data"],
        }
    companies = ctx["client_data"]["analysis"]["companies"]
    assert len(companies) == 36
    statuses = sorted(row["outcomeStatus"] for row in companies)
    assert statuses.count("WON") == 9 and statuses.count("LOST") == 11
    assert statuses.count("ON_HOLD") == 4
    # 진행 중은 분석표가 세는 대로(부재만 남긴 곳은 큰 단계가 미접촉으로 남지만 진행 중으로 센다).
    assert ctx["client_data"]["analysis"]["total"]["inProgressCount"] == 12
    reasons = sorted(row["lostReasonCode"] for row in companies if row["outcomeStatus"] == "LOST")
    assert reasons == [
        "INCUMBENT_SUPPLIER",
        "INCUMBENT_SUPPLIER",
        "LEAD_TIME",
        "LEAD_TIME",
        "LEAD_TIME",
        "NO_DEMAND",
        *["PRICE"] * 5,
    ]
    # 접촉은 1~150일 전으로 퍼져 있어 기간을 고르면 숫자가 달라진다(#760).
    first = min(row["firstContactAt"] for row in companies)
    last = max(row["lastContactAt"] for row in companies)
    assert (date.fromisoformat(last) - date.fromisoformat(first)).days >= 120
    # 성사한 곳은 접촉 2~3회, 접촉 날짜는 모두 최근 12개월 안(오늘 이전)이다.
    assert all(
        2 <= row["contactCount"]["total"] <= 3 for row in companies if row["outcomeStatus"] == "WON"
    )
    by_process = ctx["client_data"]["analysis"]["byProcess"]
    assert sum(row["wonCount"] for row in by_process) == 9
    assert sum(row["lostCount"] for row in by_process) == 11


@then("전체는 표본이 기준 이상이라 성사율이 오고, 표본이 적은 공정 줄은 건수만 온다")
def counts_only(ctx):
    analysis = ctx["client_data"]["analysis"]
    minimum = analysis["basis"]["minSampleForRatio"]
    assert analysis["basis"]["companyCount"] == 36 >= minimum
    assert analysis["basis"]["olderClosedExcluded"] == 0
    assert analysis["total"]["ratios"]["won"] == 0.25  # 9 ÷ 36, 소수 2자리 (#826)
    for row in analysis["byProcess"]:
        assert (row["ratios"] is None) == (row["contactedCount"] < minimum), row["processName"]


@then(parsers.parse('대시보드 완료 칸은 성사·거절 20곳이고 화면 띠 문구는 "{label}"다'))
def dashboard_and_banner(ctx, label):
    # 완료 = 성사·거절로 끝난 곳(#765에서 성사 4 + 거절 5. 전에는 6곳 모두 끝난 회사라 6).
    # (#826) 성사 9 + 거절 11.
    assert ctx["client_data"]["dashboard"]["counts"]["DONE"] == 20
    brand = ctx["client_data"]["ui"]["brand"]
    assert brand["demoLabel"] == label
    # 시연 표시 자체는 화면 응답에 내보내지 않는다(약속 C7).
    assert "demo" not in brand


@then("목록의 회사는 모두 가상 표시가 켜져 있다")
def all_virtual(ctx):
    cards = ctx["client_data"]["cards"]
    assert len(cards) == 36 and all(card["isVirtual"] for card in cards)
    connection = sqlite3.connect(str(ctx["db"]))
    try:
        real = connection.execute("SELECT count(*) FROM opp_customer WHERE is_virtual = 0")
        assert real.fetchone()[0] == 0
    finally:
        connection.close()


@then("두 번째 실행은 36곳을 모두 건너뛰고 영업 기록 수가 그대로다")
def unchanged(ctx):
    assert ctx["code"] == 0, ctx["out"]
    assert "넣은 회사 0곳" in ctx["out"] and "건너뛴 회사 36곳" in ctx["out"]
    # 접촉 한 번이 기록 한 행이다: 처음 6곳 15행 + 더한 12곳 26행(#765).
    assert outcome_count(ctx["db"]) == ctx["count_after_first"] == 83


@then(parsers.parse('"{message}"로 거부되고 영업 기록은 0건이다'))
def seed_refused(ctx, message):
    assert ctx["code"] == 1, ctx["out"]
    assert message in ctx["out"]
    assert outcome_count(ctx["db"]) == 0


@then(parsers.parse('"{message}"를 내고 종료 코드 2로 시작하지 않는다'))
def serve_blocked(ctx, message):
    assert ctx["code"] == 2, ctx["out"]
    assert message in ctx["out"]
    assert ctx["started"] == []


@then("서버가 시작된다")
def serve_started(ctx):
    assert ctx["code"] == 0, ctx["out"]
    assert ctx["started"] == [(18774, "127.0.0.1")]


@then(parsers.parse('"{message}"로 거부되고 시연 표시가 남아 있다'))
def mark_kept(ctx, message):
    assert ctx["code"] == 1, ctx["out"]
    assert message in ctx["out"]
    with session_scope(ctx["db"]) as session:
        assert is_demo_database(session)


# ---------- #719: 시연용 설정은 새 DB나 이미 시연 표시가 있는 DB에만 ----------


@when("시연용 설정 파일을 등록한다")
def register_demo_settings(ctx):
    ctx["code"], ctx["out"] = run("check-config", RULE_CONFIG, DEMO_SETTINGS)


@then(parsers.parse('"{message}"로 거부되고 시연 표시가 붙지 않는다'))
def mark_not_added(ctx, message):
    assert ctx["code"] == 1, ctx["out"]
    assert message in ctx["out"]
    with session_scope(ctx["db"]) as session:
        assert not is_demo_database(session)


@then("원래 설정은 그대로 다시 등록된다")
def plain_settings_still_register(ctx):
    code, out = run("check-config", RULE_CONFIG, VIRTUAL_SETTINGS)
    assert code == 0, out
    with session_scope(ctx["db"]) as session:
        assert not is_demo_database(session)


@then("등록되고 시연 표시가 남아 있다")
def demo_settings_registered_again(ctx):
    assert ctx["code"] == 0, ctx["out"]
    with session_scope(ctx["db"]) as session:
        assert is_demo_database(session)


# ---------- #811: 시연 DB에서만 가상 회사에 가상 위치 ----------


def _coordinates(db_path: Path) -> list[tuple[float | None, float | None, str | None]]:
    connection = sqlite3.connect(str(db_path))
    try:
        return connection.execute(
            "SELECT lat, lng, geocode_source FROM opp_customer WHERE is_virtual = 1"
        ).fetchall()
    finally:
        connection.close()


@then(parsers.parse('가상 회사 36곳에 가상 위치가 저장되고 출력에 "{text}"이 보인다'))
def demo_locations_saved(ctx, text):
    assert ctx["code"] == 0, ctx["out"]
    assert text in ctx["out"]
    rows = _coordinates(ctx["db"])
    assert len(rows) == 36
    assert all(
        source == "DEMO" and lat is not None and lng is not None for lat, lng, source in rows
    )


# (바뀜 2026-11-23 #899 — PM 결정 "연결 전은 미접촉") 부재 전화만 있는 진행 중 3곳은 미접촉이 되어 관심 점으로 보인다.
@then('대시보드 지도에 성사 9곳·진행 중 9곳·관심 3곳이 점으로 보이고 이름마다 "가상"이 들어 있다')
def demo_map_points(ctx):
    with TestClient(create_app()) as client:
        response = client.get("/api/v1/dashboard/map", headers=STAFF)
        ctx["cards"] = client.get("/api/v1/opportunities", params={"pageSize": 50}).json()["data"]
    assert response.status_code == 200, response.text
    ctx["map"] = response.json()["data"]
    groups = [point["group"] for point in ctx["map"]["points"]]
    assert sorted(groups) == ["INTERESTED"] * 3 + ["IN_PROGRESS"] * 9 + ["WON_THIS_YEAR"] * 9
    assert ctx["map"]["missingCoordinates"] == 0
    assert all("가상" in point["customerName"] for point in ctx["map"]["points"])
    assert all(isinstance(point["distanceKm"], float) for point in ctx["map"]["points"])


@then("진행 중·관심 12곳마다 같이 들를 곳 묶음이 있고 거리는 숫자다")
def demo_visit_groups(ctx):
    # 같이 들를 곳은 진행 중·관심 회사를 기준으로 묶는다(map_points VISIT_ANCHOR_GROUPS).
    in_progress = {
        p["oppId"] for p in ctx["map"]["points"] if p["group"] in ("IN_PROGRESS", "INTERESTED")
    }
    groups = ctx["map"]["visitGroups"]
    assert {group["oppId"] for group in groups} == in_progress
    for group in groups:
        assert group["nearby"], group
        assert all(isinstance(row["distanceKm"], float) for row in group["nearby"])


@then("목록 카드 36곳 모두 거산에서 거리가 있다")
def demo_card_distances(ctx):
    assert len(ctx["cards"]) == 36
    assert all(isinstance(card["distanceKm"], float) for card in ctx["cards"])


@then("가상 회사에 좌표가 하나도 없다")
def no_demo_locations(ctx):
    assert ctx["code"] == 1, ctx["out"]
    rows = _coordinates(ctx["db"])
    assert len(rows) == 36
    assert all(row == (None, None, None) for row in rows)
