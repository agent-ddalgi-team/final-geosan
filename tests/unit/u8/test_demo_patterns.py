"""#826 발표용 시연 DB(36곳)에서 새 화면이 실제처럼 채워지는지 본다.

가상 사례만 쓴다(거산 실제 사양 아님). 시연 DB는 임시 경로에 만들고 실제 DB는 쓰지 않는다.
"""

from __future__ import annotations

from fastapi.testclient import TestClient

from geosan.api.app import create_app
from tests.unit.u8.test_demo_db import demo_db, run  # noqa: F401  (fixture 재사용)

STAFF = {"X-Staff-Key": "park-lee"}


def _seeded(client_db):
    code, out = run("seed-demo-records")
    assert code == 0, out
    with TestClient(create_app()) as client:
        patterns = client.get("/api/v1/sales-analysis/patterns", headers=STAFF)
        dashboard = client.get("/api/v1/dashboard", headers=STAFF)
    assert patterns.status_code == 200, patterns.text
    assert dashboard.status_code == 200, dashboard.text
    return patterns.json()["data"], dashboard.json()["data"]


def test_demo_db_shows_a_standout_cell_over_the_sample_rule(demo_db):  # noqa: F811
    """Given 시연 DB에 가상 기록 / When 영업 분석 패턴
    / Then 표본 기준을 넘은 '눈에 띔' 칸이 있다.

    예: 관심 정도 '높음'이라고 답한 회사의 성사율이 전체보다 크게 높다(예외 3곳을 섞음).
    """
    patterns, _ = _seeded(demo_db)
    standouts = patterns["standouts"]
    assert standouts, patterns.get("basis")
    interest_high = [
        s for s in standouts if s.get("questionId") == "INTEREST" and s.get("answerId") == "HIGH"
    ]
    assert interest_high and interest_high[0]["won"] + interest_high[0]["failed"] >= 10
    assert interest_high[0]["diff"] > 0


def test_demo_db_shows_stalled_companies_on_the_dashboard(demo_db):  # noqa: F811
    """Given 시연 DB에 가상 기록 / When 대시보드
    / Then 일정 없이 오래 멈춘 회사가 1곳 이상(#800)."""
    _, dashboard = _seeded(demo_db)
    stalled = [
        row for rows in dashboard["progressCompanies"].values() for row in rows if row["stalled"]
    ]
    assert len(stalled) >= 1
    assert all("가상" in row["customerName"] for row in stalled)


def test_demo_db_today_lines_show_virtual_mark_once(demo_db):  # noqa: F811
    """Given 시연 DB / When 대시보드 오늘 확인할 것
    / Then 회사 이름 + 일정 글에 '(가상)'이 한 번만(#826).

    전에는 "G정공(가상) (가상) 소개서…"처럼 두 번 보였다.
    """
    _, dashboard = _seeded(demo_db)
    lines = [
        f"{item['customerName']} {item.get('note') or ''}"
        for row in dashboard["todayChecks"]
        for item in row["items"]
    ]
    assert lines
    assert all(line.count("(가상)") <= 1 for line in lines), lines
