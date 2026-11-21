"""#802 월별 추세: 최근 12개월의 접촉·성사·거절 회사 수. 순수 계산과 창구 응답. 모두 가상 자료다."""

from datetime import UTC, date, datetime

from geosan.dashboard.sales_analysis import CompanyRecords, RecordLine, monthly_trend
from geosan.evidence.transfer import KST
from tests.unit.u7 import test_sales_analysis as support

dashboard_env = support.dashboard_env
NOW = datetime(2026, 11, 22, 1, 0, tzinfo=UTC)


def line(status, day, method="CALL"):
    return RecordLine(
        status=status,
        method=method,
        result="REACHED" if method else None,
        attempted_at=day if method else None,
        created_at=datetime(day.year, day.month, day.day, 3, 0, tzinfo=UTC),
        lost_reason_code="PRICE" if status == "LOST" else None,
    )


def company(opp_id, *lines):
    return CompanyRecords(opp_id, opp_id, (), (), None, tuple(lines))


def test_twelve_months_oldest_first_and_company_counted_once_per_month():
    rows = monthly_trend(
        [
            company(
                "a",
                line("IN_PROGRESS", date(2026, 10, 3)),
                line("IN_PROGRESS", date(2026, 10, 20)),
                line("LOST", date(2026, 11, 5), method=None),
            ),
            company(
                "b",
                line("IN_PROGRESS", date(2026, 11, 2)),
                line("WON", date(2026, 11, 15), method=None),
            ),
            # 12개월보다 오래된 접촉은 세지 않는다.
            company("c", line("IN_PROGRESS", date(2025, 11, 30))),
        ],
        now=NOW,
        tz=KST,
    )
    assert [row.month for row in rows][:2] == ["2025-12", "2026-01"]
    assert len(rows) == 12 and rows[-1].month == "2026-11"
    by_month = {row.month: (row.contacted, row.won, row.lost) for row in rows}
    assert by_month["2026-10"] == (1, 0, 0)
    assert by_month["2026-11"] == (1, 1, 1)
    assert sum(row.contacted for row in rows) == 2


def test_company_reopened_after_lost_is_not_counted_as_lost():
    """거절 뒤 다시 진행 중이면 마지막 상태가 진행 중이라 거절로 세지 않는다."""
    rows = monthly_trend(
        [
            company(
                "a",
                line("LOST", date(2026, 9, 1), method=None),
                line("IN_PROGRESS", date(2026, 10, 1)),
            )
        ],
        now=NOW,
        tz=KST,
    )
    assert sum(row.lost for row in rows) == 0


def test_api_returns_monthly_rows(dashboard_env):
    client, (a, b, *_) = dashboard_env
    today = datetime.now(UTC).astimezone(KST).date()
    support.record(client, a, support.contact("REACHED", day=today.isoformat()))
    support.record(client, a, {"status": "LOST", "lostReasonCode": "PRICE"})
    data = client.get("/api/v1/sales-analysis", headers=support.VIEWER).json()["data"]
    assert len(data["monthly"]) == 12
    last = data["monthly"][-1]
    assert last["month"] == f"{today:%Y-%m}" and last["contacted"] == 1 and last["lost"] == 1
