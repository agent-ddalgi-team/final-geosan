"""#976 영업 홈 단계 카드 "+n 이번 주"와 관심 기업 줄의 접촉 요약·다음 일정(PM 결정 2026-11-28).

실제 SQLite·평가·API로 확인한다. 오늘은 2026-11-05(목)로 고정한다(NFR12).
이번 주는 11-02(월)부터다. 가상 사례만 쓴다. 외부 AI 호출 없음.
"""

from datetime import date

import pytest
from sqlalchemy import select

from geosan.dashboard.queries import week_start
from geosan.records.models import Outcome
from geosan.storage.session import session_scope
from tests.unit.u7.test_bookmark import give_opinion, set_bookmark
from tests.unit.u7.test_dashboard import record
from tests.unit.u7.test_dashboard_today import dashboard_data, today_env  # noqa: F401

ENTERED_KEYS = ("IN_CONTACT", "QUOTE_SAMPLE", "WON", "ON_HOLD")
ZERO = dict.fromkeys(ENTERED_KEYS, 0)


def contact(client, opp_id, day, status="IN_PROGRESS", method="CALL", **extra):
    """그 날짜의 접촉 한 건. 접촉 날짜가 그 기록의 날짜가 된다."""
    record(
        client,
        opp_id,
        {"status": status, "method": method, "result": "REACHED", "attemptedAt": day, **extra},
    )


def cancel(client, opp_id, day):
    with session_scope() as session:
        outcome_id = session.scalar(
            select(Outcome.outcome_id).where(
                Outcome.opp_id == opp_id, Outcome.attempted_at == date.fromisoformat(day)
            )
        )
    response = client.post(
        f"/api/v1/opportunities/{opp_id}/records/{outcome_id}/cancel",
        json={"reason": "가상 취소: 잘못 입력"},
        headers={"X-Staff-Key": "park-lee"},
    )
    assert response.status_code == 200, response.text


def card_of(client, opp_id):
    listed = client.get("/api/v1/opportunities").json()["data"]
    return next(card for card in listed if card["oppId"] == opp_id)


@pytest.mark.parametrize(
    ("today", "monday"),
    [
        (date(2026, 11, 5), date(2026, 11, 2)),  # 목요일
        (date(2026, 11, 2), date(2026, 11, 2)),  # 월요일은 그날이 시작
        (date(2026, 11, 8), date(2026, 11, 2)),  # 일요일은 그 주의 마지막 날
        (date(2026, 11, 9), date(2026, 11, 9)),
    ],
)
def test_week_starts_on_monday(today, monday):
    assert week_start(today) == monday


def test_only_companies_that_entered_the_band_this_week_are_counted(today_env):  # noqa: F811
    """Given 접촉 칸 두 곳(이번 주 첫 접촉 / 지난달부터 접촉 중) / When 대시보드
    / Then 이번 주에 들어온 한 곳만 세고, 칸 숫자는 두 곳 그대로다."""
    client, ids = today_env
    contact(client, ids["a"], "2026-11-03")
    contact(client, ids["b"], "2026-10-20")
    contact(client, ids["b"], "2026-11-04")  # 같은 단계가 이어진다: 들어온 날은 10-20 그대로
    data = dashboard_data(client)
    assert data["counts"]["IN_CONTACT"] == 2
    assert data["enteredThisWeek"] == {**ZERO, "IN_CONTACT": 1}
    # 미접촉 칸은 들어온 날을 정할 기록이 없어 주지 않는다.
    assert set(data["enteredThisWeek"]) == set(ENTERED_KEYS)


def test_moving_to_the_next_band_this_week_counts_in_the_new_band_only(today_env):  # noqa: F811
    """Given 지난달부터 접촉 중이던 회사가 이번 주에 견적·샘플로 넘어감 / When 대시보드
    / Then 견적·샘플 칸에 1, 접촉 칸에는 0이다."""
    client, ids = today_env
    contact(client, ids["a"], "2026-10-20")
    contact(client, ids["a"], "2026-11-04", status="SAMPLE_OR_REGISTRATION_APPROVED")
    data = dashboard_data(client)
    assert data["counts"]["QUOTE_SAMPLE"] == 1
    assert data["enteredThisWeek"] == {**ZERO, "QUOTE_SAMPLE": 1}


def test_monday_counts_and_last_sunday_does_not(today_env):  # noqa: F811
    """Given 이번 주 월요일 접촉 한 곳, 지난주 일요일 접촉 한 곳 / When 대시보드
    / Then 월요일 회사만 센다."""
    client, ids = today_env
    contact(client, ids["a"], "2026-11-02")
    contact(client, ids["b"], "2026-11-01")
    assert dashboard_data(client)["enteredThisWeek"]["IN_CONTACT"] == 1


def test_won_and_on_hold_bands_are_counted_too(today_env):  # noqa: F811
    """Given 이번 주에 성사 한 곳, 보류 한 곳 / When 대시보드 / Then 두 칸에 1씩이다."""
    client, ids = today_env
    contact(client, ids["a"], "2026-10-20")
    contact(client, ids["a"], "2026-11-04", status="WON")
    contact(client, ids["b"], "2026-11-03", status="ON_HOLD")
    data = dashboard_data(client)
    assert data["enteredThisWeek"] == {**ZERO, "WON": 1, "ON_HOLD": 1}


def test_a_cancelled_record_does_not_move_the_company(today_env):  # noqa: F811
    """Given 지난달부터 접촉 중인 회사의 이번 주 견적·샘플 기록을 [잘못 입력]으로 취소
    / When 대시보드 / Then 회사는 접촉 칸으로 돌아가고 어느 칸에도 이번 주로 세지 않는다."""
    client, ids = today_env
    contact(client, ids["a"], "2026-10-20")
    contact(client, ids["a"], "2026-11-04", status="SAMPLE_OR_REGISTRATION_APPROVED")
    cancel(client, ids["a"], "2026-11-04")
    data = dashboard_data(client)
    assert data["counts"]["IN_CONTACT"] == 1 and data["counts"]["QUOTE_SAMPLE"] == 0
    assert data["enteredThisWeek"] == ZERO


def test_coming_back_to_a_band_this_week_counts_again(today_env):  # noqa: F811
    """Given 접촉 → 보류(지난달) → 이번 주에 다시 접촉 / When 대시보드
    / Then 접촉 칸에 이번 주로 센다(다른 칸에 갔다가 돌아온 회사)."""
    client, ids = today_env
    contact(client, ids["a"], "2026-10-10")
    contact(client, ids["a"], "2026-10-20", status="ON_HOLD")
    contact(client, ids["a"], "2026-11-03")
    assert dashboard_data(client)["enteredThisWeek"] == {**ZERO, "IN_CONTACT": 1}


def test_turning_interest_on_this_week_is_not_entering_the_band(today_env):  # noqa: F811
    """Given 지난달부터 접촉 중인 회사를 제외했다가(관심 꺼짐) 이번 주에 다시 관심으로 켬
    / When 대시보드
    / Then 꺼진 동안에는 대상이 아니고, 다시 켜도 이번 주에 들어온 회사로 세지 않는다."""
    client, ids = today_env
    contact(client, ids["a"], "2026-10-20")
    give_opinion(client, ids["a"], "NOT_TARGET")
    off = dashboard_data(client)
    assert off["counts"]["IN_CONTACT"] == 0 and off["enteredThisWeek"] == ZERO
    give_opinion(client, ids["a"], "WORTH_REVIEW")
    assert set_bookmark(client, ids["a"], True).status_code == 200
    data = dashboard_data(client)
    assert data["counts"]["IN_CONTACT"] == 1
    assert data["enteredThisWeek"] == ZERO


def test_no_records_gives_zero_for_every_band(today_env):  # noqa: F811
    client, _ = today_env
    assert dashboard_data(client)["enteredThisWeek"] == ZERO


def test_list_row_carries_contact_summary_and_next_schedule(today_env):  # noqa: F811
    """Given 메일 1번·전화 1번 접촉하고 다음 일정을 잡은 회사 / When 목록
    / Then 그 줄에 방법별 접촉 수·마지막 접촉 날짜·다음 일정이 실리고 상세의 값과 같다."""
    client, ids = today_env
    contact(client, ids["a"], "2026-10-28", method="EMAIL")
    contact(
        client,
        ids["a"],
        "2026-11-03",
        nextScheduleAt="2026-11-10",
        nextScheduleNote="전화",
    )
    card = card_of(client, ids["a"])
    assert card["contactCount"] == 2
    assert card["contactByMethod"] == {"call": 1, "email": 1, "visit": 0}
    assert card["lastContactAt"] == "2026-11-03"
    assert card["records"]["outcome"] == {
        "status": "IN_PROGRESS",
        "nextScheduleAt": "2026-11-10",
        "nextScheduleNote": "전화",
    }
    detail = client.get(f"/api/v1/opportunities/{ids['a']}").json()["data"]["records"]
    assert {key: detail["contactCount"][key] for key in ("call", "email", "visit")} == card[
        "contactByMethod"
    ]
    assert detail["contactCount"]["total"] == card["contactCount"]
    assert detail["lastContactAt"] == card["lastContactAt"]
    assert detail["outcome"]["nextScheduleAt"] == card["records"]["outcome"]["nextScheduleAt"]
    assert detail["outcome"]["nextScheduleNote"] == card["records"]["outcome"]["nextScheduleNote"]


def test_list_row_without_records_has_empty_summary(today_env):  # noqa: F811
    """Given 영업 기록이 없는 회사 / When 목록
    / Then 접촉 수는 0, 마지막 접촉·영업 기록은 비어 있다."""
    client, ids = today_env
    card = card_of(client, ids["a"])
    assert card["contactByMethod"] == {"call": 0, "email": 0, "visit": 0}
    assert card["lastContactAt"] is None
    assert card["records"]["outcome"] is None


def test_list_row_drops_cancelled_contacts_and_has_no_schedule_note_without_a_date(
    today_env,  # noqa: F811
):
    """Given 접촉 두 번 가운데 나중 것을 취소 / When 목록
    / Then 취소한 접촉은 세지 않고 마지막 접촉은 앞의 날짜다.
    일정이 없으면 일정 칸은 둘 다 비어 있다."""
    client, ids = today_env
    contact(client, ids["a"], "2026-10-28", method="VISIT")
    contact(client, ids["a"], "2026-11-03", nextScheduleAt="2026-11-10", nextScheduleNote="전화")
    cancel(client, ids["a"], "2026-11-03")
    card = card_of(client, ids["a"])
    assert card["contactByMethod"] == {"call": 0, "email": 0, "visit": 1}
    assert card["lastContactAt"] == "2026-10-28"
    assert card["records"]["outcome"]["nextScheduleAt"] is None
    assert card["records"]["outcome"]["nextScheduleNote"] is None


def test_list_row_never_carries_memo_text(today_env):  # noqa: F811
    """Given 영업 메모가 있는 접촉 / When 목록 / Then 그 줄에 메모 글은 실리지 않는다."""
    client, ids = today_env
    memo = "가상 메모: 담당 과장과 통화"
    contact(client, ids["a"], "2026-11-03", memo=memo, nextScheduleAt="2026-11-10")
    card = card_of(client, ids["a"])
    assert memo not in str(card)
    assert set(card["records"]["outcome"]) == {"status", "nextScheduleAt", "nextScheduleNote"}
