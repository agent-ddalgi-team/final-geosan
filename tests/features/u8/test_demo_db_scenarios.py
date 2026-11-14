"""#274: 발표 시연용 DB 시나리오. 실제 임시 DB와 실제 명령·API로 확인한다. 외부 호출 없음.

가상 사례·가상 기록만 쓴다(거산 실제 사양 아님). 서버는 띄우지 않고 시작 함수만 가짜로 바꾼다.
"""

from __future__ import annotations

import sqlite3
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


@given("안내서 순서대로 만든 시연 DB에 가상 회사 6곳이 평가되어 있다")
def demo_db(ctx):
    # 파일 이름은 일부러 geosan-demo.db가 아니다. DB 안 시연 표시만으로 알아보는지 본다.
    ctx["db"] = build_db(ctx["tmp"] / "renamed.db", ctx["monkeypatch"], DEMO_SETTINGS)
    assert len(CASE_FILES) == 6


@given("시연 표시가 없는 설정으로 등록한 DB에 가상 회사 6곳이 평가되어 있다")
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
    "영업 분석표에 성사 3곳과 거절 3곳이 보이고 거절 이유는 가격·납기·기존 거래처 유지 각 1건이다"
)
def won_and_lost(ctx):
    assert ctx["code"] == 0, ctx["out"]
    assert "넣은 회사 6곳(성사 3·거절 3)" in ctx["out"]
    with TestClient(create_app()) as client:
        ctx["client_data"] = {
            "analysis": client.get("/api/v1/sales-analysis", headers=STAFF).json()["data"],
            "dashboard": client.get("/api/v1/dashboard", headers=STAFF).json()["data"],
            "ui": client.get("/api/v1/config/ui").json()["data"],
            "cards": client.get("/api/v1/opportunities").json()["data"],
        }
    companies = ctx["client_data"]["analysis"]["companies"]
    assert len(companies) == 6
    assert sorted(row["outcomeStatus"] for row in companies) == ["LOST"] * 3 + ["WON"] * 3
    reasons = sorted(row["lostReasonCode"] for row in companies if row["outcomeStatus"] == "LOST")
    assert reasons == ["INCUMBENT_SUPPLIER", "LEAD_TIME", "PRICE"]
    # 성사한 곳은 접촉 2~3회, 접촉 날짜는 모두 최근 12개월 안(오늘 이전)이다.
    assert all(
        2 <= row["contactCount"]["total"] <= 3 for row in companies if row["outcomeStatus"] == "WON"
    )
    by_process = ctx["client_data"]["analysis"]["byProcess"]
    assert sum(row["wonCount"] for row in by_process) == 3
    assert sum(row["lostCount"] for row in by_process) == 3


@then("표본이 기준보다 적어 비율 없이 건수만 온다")
def counts_only(ctx):
    analysis = ctx["client_data"]["analysis"]
    assert analysis["basis"]["companyCount"] == 6 < analysis["basis"]["minSampleForRatio"]
    assert analysis["basis"]["olderClosedExcluded"] == 0
    assert all(row["ratios"] is None for row in analysis["byProcess"])
    assert all(
        item["ratios"] is None for row in analysis["byProcess"] for item in row["byIndustry"]
    )


@then(parsers.parse('대시보드 완료 칸은 6곳이고 화면 띠 문구는 "{label}"다'))
def dashboard_and_banner(ctx, label):
    assert ctx["client_data"]["dashboard"]["counts"]["DONE"] == 6
    brand = ctx["client_data"]["ui"]["brand"]
    assert brand["demoLabel"] == label
    # 시연 표시 자체는 화면 응답에 내보내지 않는다(약속 C7).
    assert "demo" not in brand


@then("목록의 회사는 모두 가상 표시가 켜져 있다")
def all_virtual(ctx):
    cards = ctx["client_data"]["cards"]
    assert len(cards) == 6 and all(card["isVirtual"] for card in cards)
    connection = sqlite3.connect(str(ctx["db"]))
    try:
        real = connection.execute("SELECT count(*) FROM opp_customer WHERE is_virtual = 0")
        assert real.fetchone()[0] == 0
    finally:
        connection.close()


@then("두 번째 실행은 6곳을 모두 건너뛰고 영업 기록 수가 그대로다")
def unchanged(ctx):
    assert ctx["code"] == 0, ctx["out"]
    assert "넣은 회사 0곳" in ctx["out"] and "건너뛴 회사 6곳" in ctx["out"]
    assert outcome_count(ctx["db"]) == ctx["count_after_first"] == 15


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
