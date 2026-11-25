"""#800 대시보드 영업 진행 띠에서 단계별 회사 펴기 + "멈춘 회사"(PM 결정 2026-11-16).

실제 SQLite·평가·API로 확인한다. 오늘은 2026-11-05로 고정한다(NFR12). 가상 사례만 쓴다.
"""

from datetime import date

import pytest
from sqlalchemy import select

from geosan.config.app_settings import DashboardSettings
from geosan.dashboard.queries import ProgressCompany, stalled_company
from geosan.records.models import Outcome
from geosan.storage.session import session_scope
from tests.unit.u7.test_dashboard import record
from tests.unit.u7.test_dashboard_today import dashboard_data, today_env  # noqa: F401

PROGRESS_KEYS = ("NOT_CONTACTED", "IN_CONTACT", "QUOTE_SAMPLE", "WON", "ON_HOLD")


def contact(client, opp_id, day, **extra):
    record(
        client,
        opp_id,
        {
            "status": "IN_PROGRESS",
            "method": "CALL",
            "result": "REACHED",
            "attemptedAt": day,
            **extra,
        },
    )


def test_each_band_lists_the_same_companies_as_its_count(today_env):  # noqa: F811
    """Given 관심 기업이 접촉·견적·샘플·성사 칸에 나뉨 / When 대시보드
    / Then 칸마다 회사 목록 길이가 칸 숫자와 같고, 칸에 든 회사만 실린다."""
    client, ids = today_env
    contact(client, ids["a"], "2026-11-03", nextScheduleAt="2026-11-18", nextScheduleNote="방문")
    record(client, ids["b"], {"status": "SAMPLE_OR_REGISTRATION_APPROVED"})
    record(client, ids["c"], {"status": "WON"})
    data = dashboard_data(client)
    companies = data["progressCompanies"]
    assert set(companies) == set(PROGRESS_KEYS)
    for key in PROGRESS_KEYS:
        assert len(companies[key]) == data["counts"][key], key
    a = companies["IN_CONTACT"][0]
    assert a == {
        "oppId": ids["a"],
        "customerName": "A정밀",
        "lastContactAt": "2026-11-03",
        "nextScheduleAt": "2026-11-18",
        "nextScheduleNote": "방문",
        "stalled": False,
        "lastContactMethod": "CALL",
        "lastContactStaffKey": "park-lee",
        "lastContactStaffName": "영업 담당",
    }
    assert [row["oppId"] for row in companies["QUOTE_SAMPLE"]] == [ids["b"]]
    assert [row["oppId"] for row in companies["WON"]] == [ids["c"]]


def test_contacted_long_ago_without_a_schedule_is_stalled_and_first(today_env):  # noqa: F811
    """Given 접촉 칸 두 곳 — 20일 전 접촉·일정 없음 / 어제 접촉·일정 없음 / When 대시보드
    / Then 20일 전 회사만 멈춘 회사이고 칸 목록 맨 위에 선다."""
    client, ids = today_env
    contact(client, ids["a"], "2026-11-04")
    contact(client, ids["b"], "2026-10-16")
    rows = dashboard_data(client)["progressCompanies"]["IN_CONTACT"]
    assert [(row["oppId"], row["stalled"]) for row in rows] == [
        (ids["b"], True),
        (ids["a"], False),
    ]


def test_a_cancelled_contact_does_not_count_as_last_contact(today_env):  # noqa: F811
    """Given 20일 전 접촉 뒤 어제 접촉을 [잘못 입력]으로 취소 / When 대시보드
    / Then 마지막 접촉은 20일 전 날짜이고 멈춘 회사다."""
    client, ids = today_env
    contact(client, ids["a"], "2026-10-16")
    contact(client, ids["a"], "2026-11-04")
    with session_scope() as session:
        latest = session.scalar(
            select(Outcome.outcome_id).where(
                Outcome.opp_id == ids["a"], Outcome.attempted_at == date(2026, 11, 4)
            )
        )
    response = client.post(
        f"/api/v1/opportunities/{ids['a']}/records/{latest}/cancel",
        json={"reason": "가상 취소: 날짜 잘못"},
        headers={"X-Staff-Key": "park-lee"},
    )
    assert response.status_code == 200, response.text
    row = dashboard_data(client)["progressCompanies"]["IN_CONTACT"][0]
    assert row["lastContactAt"] == "2026-10-16" and row["stalled"] is True


def test_last_contact_shows_the_latest_method_and_who_recorded_it(today_env):  # noqa: F811
    """#921 Given A정밀에 영업 담당이 전화(11/01), 검수 담당이 방문(11/03)을 적음 / 접촉 없는 회사
    / When 대시보드 / Then A정밀 줄은 마지막 접촉 "방문 · 검수 담당",
    접촉 없는 회사는 셋 다 비어 있다."""
    client, ids = today_env
    contact(client, ids["a"], "2026-11-01")
    record(
        client,
        ids["a"],
        {
            "status": "IN_PROGRESS",
            "method": "VISIT",
            "result": "REACHED",
            "attemptedAt": "2026-11-03",
        },
        staff="kim-gwajang",
    )
    record(client, ids["b"], {"status": "SAMPLE_OR_REGISTRATION_APPROVED"})
    companies = dashboard_data(client)["progressCompanies"]
    a = companies["IN_CONTACT"][0]
    assert (a["lastContactAt"], a["lastContactMethod"]) == ("2026-11-03", "VISIT")
    assert (a["lastContactStaffKey"], a["lastContactStaffName"]) == (
        "kim-gwajang",
        "검수 담당(품질·기술)",
    )
    b = companies["QUOTE_SAMPLE"][0]
    assert (b["lastContactMethod"], b["lastContactStaffKey"], b["lastContactStaffName"]) == (
        None,
        None,
        None,
    )


def test_progress_rows_never_carry_memo_text(today_env):  # noqa: F811
    """Given 접촉 한 줄 메모가 있는 회사 / When 대시보드 / Then 회사 목록에 메모 글이 없다."""
    client, ids = today_env
    contact(client, ids["a"], "2026-11-03", memo="목록에 실리면 안 되는 가상 메모")
    data = dashboard_data(client)
    assert "목록에 실리면 안 되는 가상 메모" not in str(data["progressCompanies"])


@pytest.mark.parametrize(
    ("band", "last", "schedule", "expected"),
    [
        ("IN_CONTACT", date(2026, 10, 22), None, True),  # 14일째: 멈춤
        ("IN_CONTACT", date(2026, 10, 23), None, False),  # 13일째
        ("QUOTE_SAMPLE", date(2026, 10, 1), None, True),
        ("IN_CONTACT", date(2026, 10, 1), date(2026, 11, 20), False),  # 일정 있음
        ("IN_CONTACT", None, None, False),  # 접촉 없음
        ("WON", date(2026, 10, 1), None, False),  # 끝난 칸
        ("ON_HOLD", date(2026, 10, 1), None, False),
        ("NOT_CONTACTED", date(2026, 10, 1), None, False),
    ],
)
def test_stalled_rule(band, last, schedule, expected):
    """멈춘 회사 = 접촉·견적 칸 + 다음 일정 없음 + 마지막 접촉 뒤 설정 일수(14) 이상."""
    days = DashboardSettings().stalled_after_days
    assert days == 14
    assert stalled_company(band, last, schedule, date(2026, 11, 5), days) is expected
    assert ProgressCompany.__dataclass_fields__.keys() >= {"stalled", "last_contact_at"}


def test_stalled_days_is_a_setting_and_refuses_bad_values():
    """Given 설정 값 / When 읽기 / Then 1~365 정수만 받는다(규칙 숫자는 설정에서)."""
    assert DashboardSettings.model_validate({"stalledAfterDays": 7}).stalled_after_days == 7
    with pytest.raises(ValueError):
        DashboardSettings.model_validate({"stalledAfterDays": 0})
