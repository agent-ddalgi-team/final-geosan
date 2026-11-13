"""#608: 영업 분석표. 영업 기록만으로 공정별·회사별 표를 계산한다(AI·외부 호출 없음).

앞쪽은 받은 값만 쓰는 계산 함수 검사, 뒤쪽은 실제 임시 DB(SQLite)와 실제 API 검사다.
가상 사례만 쓴다(거산 실제 사양 아님). 기준 숫자(표본 10건·365일)는 예시 설정 값이다.
"""

from datetime import date, datetime, timedelta

import pytest
from fastapi.testclient import TestClient

from geosan.api.app import create_app
from geosan.config.app_settings import read_app_settings
from geosan.config.models import AppSetting
from geosan.dashboard.sales_analysis import (
    CompanyRecords,
    RecordLine,
    build_sales_analysis,
    load_company_records,
    summarize_company,
)
from geosan.evidence.transfer import KST
from geosan.opportunity.models import Customer, Opportunity, OppProcessLink
from geosan.records.models import Note, Outcome
from geosan.rules.codes import LostReasonCode
from geosan.storage.base import new_id
from geosan.storage.session import session_scope
from tests.unit.u7 import test_dashboard as support

dashboard_env = support.dashboard_env
record = support.record

NOW = datetime(2026, 11, 13, 9, 0, tzinfo=KST)
PROCESSES = [("ANODIZING", "아노다이징"), ("ZINC", "아연도금"), ("CHROMATE", "크로메이트")]
INDUSTRIES = ["방위산업", "자동차 부품"]
VIEWER = {"X-Staff-Key": "viewer"}
# 계산 함수에 넘기는 거절 이유 코드표 순서(계약 C0). 창구가 넘기는 값과 같다.
LOST_REASON_ORDER = [code.value for code in LostReasonCode]


def line(status="IN_PROGRESS", method=None, result=None, day=None, reason=None, at=NOW):
    return RecordLine(
        status=status,
        method=method,
        result=result,
        attempted_at=day,
        created_at=at,
        lost_reason_code=reason,
    )


def call(result="REACHED", day=date(2026, 11, 1), status="IN_PROGRESS", method="CALL"):
    return line(status=status, method=method, result=result, day=day)


def company(name, lines, processes=("ANODIZING",), industries=(), step=None):
    return CompanyRecords(
        opp_id=f"opp-{name}",
        name=name,
        process_codes=tuple(processes),
        industries=tuple(industries),
        sales_step=step,
        lines=tuple(lines),
    )


def analyse(companies, min_sample=10, window=365, now=NOW):
    return build_sales_analysis(
        companies,
        processes=PROCESSES,
        industries=INDUSTRIES,
        min_sample_for_ratio=min_sample,
        closed_window_days=window,
        now=now,
        tz=KST,
        lost_reason_order=LOST_REASON_ORDER,
    )


# ---------------------------------------------------------------------------
# 계산 함수
# ---------------------------------------------------------------------------


def test_no_contact_records_give_empty_tables():
    """Given 접촉 0건(단계만 바꾼 회사 포함) / When 계산 / Then 두 표가 비고 회사 수 0."""
    result = analyse([company("단계만", [line(status="ON_HOLD")])])
    assert result.by_process == [] and result.companies == []
    assert result.basis.company_count == 0 and result.basis.older_closed_excluded == 0
    assert analyse([]).companies == []


def test_company_row_counts_methods_days_and_outcome():
    """Given 전화 2·방문 1 뒤 성사 / When 계산 / Then 방법별 횟수·첫/마지막 접촉·걸린 날."""
    won_at = datetime(2026, 11, 10, 15, 0, tzinfo=KST)
    rows = analyse(
        [
            company(
                "가상정밀",
                [
                    call("ABSENT", date(2026, 10, 20)),
                    call("REACHED", date(2026, 10, 22)),
                    call("REACHED", date(2026, 11, 5), method="VISIT"),
                    line(status="WON", at=won_at),
                    line(status="WON", at=won_at + timedelta(days=2)),  # 성사 뒤 덧붙인 행
                ],
                step=None,
            )
        ]
    ).companies
    assert len(rows) == 1
    row = rows[0]
    count = row.contact_count
    assert (count.total, count.call, count.email, count.visit) == (3, 2, 0, 1)
    assert (row.first_contact_at, row.last_contact_at) == (date(2026, 10, 20), date(2026, 11, 5))
    assert row.days_since_first_contact == 24
    assert (row.outcome_status, row.outcome_at, row.days_to_outcome) == (
        "WON",
        date(2026, 11, 10),
        21,
    )
    assert row.lost_reason_code is None


def test_contact_day_falls_back_to_the_saved_day_in_korea():
    """Given 접촉 날짜가 비어 있는 옛 행 / When 계산 / Then 저장한 날(한국 날짜)을 쓴다."""
    saved = datetime(2026, 11, 2, 23, 30, tzinfo=KST)
    row = summarize_company(
        company("옛기록", [line(method="EMAIL", result="ABSENT", at=saved)]), NOW.date(), tz=KST
    )
    assert row.first_contact_at == date(2026, 11, 2)
    assert row.outcome_at is None and row.days_to_outcome is None


def test_company_with_several_processes_is_counted_in_each():
    """Given 공정이 두 개인 회사 1곳 / When 계산 / Then 두 공정 줄에 각각 1곳, 회사 수는 1."""
    result = analyse([company("두공정", [call()], processes=("CHROMATE", "ANODIZING"))])
    assert [(row.process_code, row.stats.contacted_count) for row in result.by_process] == [
        ("ANODIZING", 1),
        ("CHROMATE", 1),
    ]
    assert result.basis.company_count == 1
    assert result.companies[0].process_codes == ["ANODIZING", "CHROMATE"]  # 역량 파일 순서


def test_process_rows_follow_catalog_order_and_unlinked_companies_go_last():
    result = analyse(
        [
            company("연결없음", [call()], processes=()),
            company("아연", [call()], processes=("ZINC",)),
            company("아노", [call()]),
        ]
    )
    assert [(row.process_code, row.process_name) for row in result.by_process] == [
        ("ANODIZING", "아노다이징"),
        ("ZINC", "아연도금"),
        (None, "공정 확인 전"),  # #652: 줄 이름이 "공정 미확정"에서 바뀜
    ]


def test_industry_rows_follow_settings_order_and_unknown_goes_last():
    """Given 산업군이 둘·하나·없음인 회사 / When 계산 / Then 설정 순서 + 맨 끝 '산업 확인 전'."""
    result = analyse(
        [
            company("둘", [call()], industries=("자동차 부품", "방위산업")),
            company("하나", [call()], industries=("자동차 부품",)),
            company("없음", [call()]),
            company("설정밖", [call()], industries=("목록에 없는 산업",)),
        ]
    )
    rows = result.by_process[0].by_industry
    assert [(row.industry, row.stats.contacted_count) for row in rows] == [
        ("방위산업", 1),
        ("자동차 부품", 2),
        ("산업 확인 전", 2),  # #652: 줄 이름이 "미확정"에서 바뀜
    ]


def test_stage_counts_add_up_to_the_contacted_count():
    """Given 접촉만·견적·보류·성사·거절 / When 계산 / Then 네 칸의 합 = 접촉한 곳 수."""
    stats = (
        analyse(
            [
                company("미접촉으로 남은 옛 기록", [call(status="NOT_EXECUTED")]),
                company("접촉", [call()]),
                company("견적", [call(), line(status="SAMPLE_OR_REGISTRATION_APPROVED")]),
                company("보류", [call(), line(status="ON_HOLD")]),
                company("성사", [call(), line(status="WON")]),
                company("거절", [call(), line(status="LOST", reason="PRICE")]),
            ]
        )
        .by_process[0]
        .stats
    )
    assert (
        stats.contacted_count,
        stats.in_progress_count,
        stats.on_hold_count,
        stats.won_count,
        stats.lost_count,
    ) == (6, 3, 1, 1, 1)


def test_average_contacts_to_won_uses_won_companies_only():
    """Given 성사 2곳(접촉 4번·5번)과 진행 중 1곳 / When 계산 / Then 평균 4.5번."""
    result = analyse(
        [
            company("성사1", [call()] * 4 + [line(status="WON")]),
            company("성사2", [call()] * 5 + [line(status="WON")]),
            company("진행", [call()] * 9),
        ]
    )
    assert result.by_process[0].stats.avg_contacts_to_won == 4.5


def test_average_is_rounded_half_up_and_missing_without_a_win():
    two = [company("a", [call(), line(status="WON")])]
    two.append(company("b", [call(), call(), call(), call(), line(status="WON")]))
    two.append(company("c", [call(), call(), line(status="WON")]))
    two.append(company("d", [call(), call(), line(status="WON")]))
    assert analyse(two).by_process[0].stats.avg_contacts_to_won == 2.3  # 9 ÷ 4 = 2.25
    none = analyse([company("진행", [call()])]).by_process[0].stats
    assert none.avg_contacts_to_won is None  # 성사 0곳: 0으로 나누지 않는다


def test_contact_reach_counts_tried_and_reached_per_method():
    """Given 전화 3번 중 1번 연결, 메일 1번 부재, 방문 1번 연결 / When 계산 / Then 방법별."""
    reach = (
        analyse(
            [
                company("가", [call("ABSENT"), call("DECLINED"), call("REACHED")]),
                company("나", [call("ABSENT", method="EMAIL"), call(method="VISIT")]),
            ]
        )
        .by_process[0]
        .stats.contact_reach
    )
    assert (reach.call.reached, reach.call.tried) == (1, 3)
    assert (reach.email.reached, reach.email.tried) == (0, 1)
    assert (reach.visit.reached, reach.visit.tried) == (1, 1)


def test_lost_reasons_are_sorted_by_count_then_code_order():
    def lost(name, reason):
        return company(name, [call(), line(status="LOST", reason=reason)])

    result = analyse(
        [
            lost("1", "INCUMBENT_SUPPLIER"),
            lost("2", "LEAD_TIME"),
            lost("3", "INCUMBENT_SUPPLIER"),
            lost("4", "PRICE"),
            lost("옛 거절(코드 없음)", None),
            company("거절했다가 다시 진행", [call(), line(status="LOST", reason="PRICE"), call()]),
        ]
    )
    stats = result.by_process[0].stats
    assert [(item.code, item.count) for item in stats.lost_reasons] == [
        ("INCUMBENT_SUPPLIER", 2),
        ("PRICE", 1),
        ("LEAD_TIME", 1),
    ]
    assert stats.lost_count == 5 and stats.in_progress_count == 1


def test_ratios_are_hidden_below_the_sample_minimum():
    """Given 표본 3곳 / When 기준 10 / Then 비율 없음. 기준 3이면 비율이 나온다."""
    companies = [
        company("성사", [call(), line(status="WON")]),
        company("진행1", [call("ABSENT"), call("ABSENT", method="EMAIL")]),
        company("진행2", [call("ABSENT")]),
    ]
    assert analyse(companies, min_sample=10).by_process[0].stats.ratios is None
    ratios = analyse(companies, min_sample=3).by_process[0].stats.ratios
    assert ratios.won == 0.33
    assert (ratios.reach.call, ratios.reach.email, ratios.reach.visit) == (0.33, 0.0, None)


def test_closed_results_outside_the_window_are_left_out_and_counted():
    """Given 400일 전 거절·10일 전 성사 / When 기간 365일 / Then 옛 거절만 빠지고 건수로 남는다."""
    old = NOW - timedelta(days=400)
    recent = NOW - timedelta(days=10)
    companies = [
        company("옛거절", [call(), line(status="LOST", reason="PRICE", at=old)]),
        company("최근성사", [call(), line(status="WON", at=recent)]),
        company("오래 진행 중", [line(method="CALL", result="ABSENT", at=old)]),
    ]
    result = analyse(companies)
    assert {row.name for row in result.companies} == {"최근성사", "오래 진행 중"}
    assert result.basis.older_closed_excluded == 1 and result.basis.company_count == 2
    assert result.by_process[0].stats.lost_count == 0
    assert analyse(companies, window=500).basis.older_closed_excluded == 0


def test_companies_are_sorted_by_last_contact_then_name():
    result = analyse(
        [
            company("나", [call(day=date(2026, 11, 3))]),
            company("다", [call(day=date(2026, 11, 9))]),
            company("가", [call(day=date(2026, 11, 3))]),
        ]
    )
    assert [row.name for row in result.companies] == ["다", "가", "나"]


def test_unknown_stage_value_is_an_error_not_a_silent_bucket():
    with pytest.raises(ValueError, match="모르는 영업 단계"):
        analyse([company("이상", [call(status="SOMETHING_ELSE")])])


# ---------------------------------------------------------------------------
# 실제 임시 DB + 실제 API
# ---------------------------------------------------------------------------


def analysis(client, headers=VIEWER):
    response = client.get("/api/v1/sales-analysis", headers=headers)
    assert response.status_code == 200, response.text
    return response.json()


def contact(result="REACHED", method="CALL", status="IN_PROGRESS", day="2026-10-20", **extra):
    return {"status": status, "method": method, "result": result, "attemptedAt": day, **extra}


def test_api_is_empty_before_any_contact(dashboard_env):
    """Given 평가만 하고 접촉 기록 0건 / When 조회 / Then 빈 표와 설정 기준 숫자."""
    client, (a, *_rest) = dashboard_env
    record(client, a, {"status": "ON_HOLD"})  # 접촉 없이 단계만 바꾼 회사는 표에 없다
    body = analysis(client)
    assert body["data"]["byProcess"] == [] and body["data"]["companies"] == []
    assert body["data"]["basis"] == {
        "minSampleForRatio": 10,
        "closedWindowDays": 365,
        "companyCount": 0,
        "olderClosedExcluded": 0,
    }
    assert body["meta"]["hasVirtualData"] is False


def test_api_tables_match_saved_records_and_viewer_can_read(dashboard_env):
    """Given 3곳의 접촉·성사·거절 기록 / When 보기 전용이 조회 / Then 기록 수와 맞는 표."""
    client, (a, b, c, _d) = dashboard_env
    record(client, a, contact("ABSENT", day="2026-10-15"))
    record(client, a, contact("REACHED", day="2026-10-17"))
    record(client, a, contact("REACHED", method="VISIT", day="2026-10-20"))
    record(client, a, {"status": "WON"})
    record(client, b, contact("ABSENT", method="EMAIL", day="2026-10-16"))
    record(client, b, {"status": "LOST", "lostReasonCode": "INCUMBENT_SUPPLIER"})
    record(client, c, contact("REACHED", day="2026-10-18"))
    with session_scope() as session:
        customer_id = session.get(Opportunity, a).customer_id
        customer = session.get(Customer, customer_id)
        # #652: 확정된 산업군만 센다. 사례 파일에 사람이 적은 값으로 넣는다.
        customer.industries, customer.industries_source = ["자동차 부품"], "CASE_FILE"
    body = analysis(client)
    data = body["data"]
    assert body["meta"]["hasVirtualData"] is True  # 가상 묶음이면 화면 띠에 가상 표시
    assert body["meta"]["datasetKind"] == "VIRTUAL_REVIEWED"
    assert [row["processCode"] for row in data["byProcess"]] == ["ANODIZING"]
    row = data["byProcess"][0]
    assert "가상" not in row["processName"]
    assert {
        key: row[key]
        for key in ("contactedCount", "inProgressCount", "onHoldCount", "wonCount", "lostCount")
    } == {
        "contactedCount": 3,
        "inProgressCount": 1,
        "onHoldCount": 0,
        "wonCount": 1,
        "lostCount": 1,
    }
    assert row["avgContactsToWon"] == 3.0
    assert row["contactReach"] == {
        "CALL": {"reached": 2, "tried": 3},
        "EMAIL": {"reached": 0, "tried": 1},
        "VISIT": {"reached": 1, "tried": 1},
    }
    assert row["lostReasons"] == [{"code": "INCUMBENT_SUPPLIER", "count": 1}]
    assert row["ratios"] is None  # 표본 3곳 < 기준 10
    assert [(item["industry"], item["contactedCount"]) for item in row["byIndustry"]] == [
        ("자동차 부품", 1),
        ("산업 확인 전", 2),
    ]
    companies = {item["oppId"]: item for item in data["companies"]}
    assert set(companies) == {a, b, c}
    won = companies[a]
    assert won["contactCount"] == {"total": 3, "call": 2, "email": 0, "visit": 1}
    assert (won["firstContactAt"], won["lastContactAt"]) == ("2026-10-15", "2026-10-20")
    assert won["outcomeStatus"] == "WON" and won["salesStep"] is None
    assert won["outcomeAt"] is not None and won["daysToOutcome"] >= 0
    assert companies[b]["lostReasonCode"] == "INCUMBENT_SUPPLIER"
    assert companies[c]["salesStep"] == "NOT_REACHED" and companies[c]["outcomeAt"] is None
    # 상세의 접촉 수·카드의 세부 단계와 같은 값이다.
    detail = client.get(f"/api/v1/opportunities/{a}").json()["data"]
    assert detail["records"]["contactCount"] == won["contactCount"]
    # 담당자를 고르지 않은 계정·기록 담당자도 같은 표를 본다(읽기 전용).
    for headers in ({}, {"X-Staff-Key": "park-lee"}):
        other = analysis(client, headers=headers)["data"]
        assert (other["byProcess"], other["companies"]) == (data["byProcess"], data["companies"])


def test_api_counts_a_company_under_each_of_its_processes(dashboard_env):
    """Given 공정 연결이 둘인 회사 / When 조회 / Then 공정 줄 둘에 각각 1곳, 회사 줄은 하나."""
    client, (a, *_rest) = dashboard_env
    record(client, a, contact())
    with session_scope() as session:
        session.add(
            OppProcessLink(
                link_id=new_id("link"),
                opp_id=a,
                process_code="CHROMATE",
                created_by="system",
                dataset_kind="VIRTUAL_REVIEWED",
                is_virtual=True,
            )
        )
    data = analysis(client)["data"]
    assert sorted(row["processCode"] for row in data["byProcess"]) == ["ANODIZING", "CHROMATE"]
    assert all(row["contactedCount"] == 1 for row in data["byProcess"])
    assert len(data["companies"]) == 1
    assert sorted(data["companies"][0]["processCodes"]) == ["ANODIZING", "CHROMATE"]


def test_api_counts_only_confirmed_processes_and_industries(dashboard_env):
    """Given AI 제안 공정 연결·AI 산업군이 붙은 회사 / When 조회 / Then 확정된 값만 센다(#652).

    세 묶음 순서 조정(#610)이 쓰는 기본 읽기는 전처럼 AI 제안까지 싣는다.
    """
    client, (a, *_rest) = dashboard_env
    record(client, a, contact())
    with session_scope() as session:
        session.add(
            OppProcessLink(
                link_id=new_id("link"),
                opp_id=a,
                process_code="CHROMATE",
                source="AI",
                state="PENDING",
                created_by="system",
                dataset_kind="VIRTUAL_REVIEWED",
                is_virtual=True,
            )
        )
        customer = session.get(Customer, session.get(Opportunity, a).customer_id)
        customer.industries, customer.industries_source = ["반도체"], "AI"
    data = analysis(client)["data"]
    assert [row["processCode"] for row in data["byProcess"]] == ["ANODIZING"]
    assert [item["industry"] for item in data["byProcess"][0]["byIndustry"]] == ["산업 확인 전"]
    assert (data["companies"][0]["processCodes"], data["companies"][0]["industries"]) == (
        ["ANODIZING"],
        [],
    )
    with session_scope() as session:
        loaded = load_company_records(
            session, dataset_kind="VIRTUAL_REVIEWED", sales_step_of=lambda *_: None
        )
    assert loaded[0].process_codes == ("ANODIZING", "CHROMATE")
    assert loaded[0].industries == ("반도체",)


def test_api_never_returns_memo_text_staff_or_contacts(dashboard_env):
    """Given 한 줄 메모·거절 사유 글·영업 메모(연락처 포함) / When 조회 / Then 응답에 없다."""
    client, (a, *_rest) = dashboard_env
    record(client, a, contact(memo="분석표에 나가면 안 되는 한 줄 메모"))
    record(
        client,
        a,
        {"status": "LOST", "lostReasonCode": "OTHER", "reason": "분석표에 나가면 안 되는 사유 글"},
    )
    with session_scope() as session:
        session.add(
            Note(
                note_id=new_id("note"),
                opp_id=a,
                staff_key="park-lee",
                kind="MEMO",
                text="가상 담당자 010-0000-0000 hong@example.invalid",
                version=1,
                created_by="park-lee",
                dataset_kind="VIRTUAL_REVIEWED",
                is_virtual=True,
            )
        )
    text = client.get("/api/v1/sales-analysis").text
    for secret in ("한 줄 메모", "사유 글", "010-0000-0000", "example.invalid", "park-lee"):
        assert secret not in text
    row = analysis(client)["data"]["companies"][0]
    assert row["lostReasonCode"] == "OTHER"
    assert set(row) == {
        "oppId",
        "name",
        "processCodes",
        "industries",
        "contactCount",
        "outcomeStatus",
        "salesStep",
        "lostReasonCode",
        "firstContactAt",
        "lastContactAt",
        "daysSinceFirstContact",
        "outcomeAt",
        "daysToOutcome",
    }


def test_api_reads_thresholds_from_settings(dashboard_env):
    """Given 표본 기준을 2로 낮춘 설정 / When 조회 / Then 비율이 나오고 기준 숫자가 그대로 온다."""
    client, (a, b, *_rest) = dashboard_env
    record(client, a, contact())
    record(client, a, {"status": "WON"})
    record(client, b, contact("ABSENT"))
    assert analysis(client)["data"]["byProcess"][0]["ratios"] is None
    with session_scope() as session:
        session.get(AppSetting, "salesAnalysis").value = {
            "minSampleForRatio": 2,
            "closedWindowDays": 365,
        }
    data = analysis(client)["data"]
    assert data["basis"]["minSampleForRatio"] == 2
    assert data["byProcess"][0]["ratios"] == {
        "won": 0.5,
        "reach": {"CALL": 0.5, "EMAIL": None, "VISIT": None},
    }


def test_api_leaves_out_old_closed_results(dashboard_env):
    """Given 400일 전에 거절로 바뀐 회사 / When 조회 / Then 표에서 빠지고 건수만 남는다."""
    client, (a, b, *_rest) = dashboard_env
    record(client, a, contact())
    record(client, a, {"status": "LOST", "lostReasonCode": "PRICE"})
    record(client, b, contact())
    with session_scope() as session:
        for row in session.query(Outcome).filter(Outcome.opp_id == a):
            row.created_at = row.created_at - timedelta(days=400)
    data = analysis(client)["data"]
    assert [row["oppId"] for row in data["companies"]] == [b]
    assert data["basis"]["olderClosedExcluded"] == 1
    assert data["byProcess"][0]["lostCount"] == 0


def test_real_companies_are_not_mixed_into_the_virtual_bundle(dashboard_env):
    """Given 가상 묶음이 활성 / When 실제 회사 표시인 기록이 있어도 / Then 표에 섞이지 않는다."""
    client, (a, b, *_rest) = dashboard_env
    record(client, a, contact())
    record(client, b, contact())
    with session_scope() as session:
        opportunity = session.get(Opportunity, b)
        opportunity.is_virtual = False
        session.get(Customer, opportunity.customer_id).is_virtual = False
    assert [row["oppId"] for row in analysis(client)["data"]["companies"]] == [a]


def test_old_settings_copy_without_the_new_section_reads_example_values(dashboard_env):
    """Given #608 전 DB 사본(salesAnalysis 없음) / When 조회 / Then 예시 파일 값으로 읽는다."""
    client, _ = dashboard_env
    with session_scope() as session:
        session.delete(session.get(AppSetting, "salesAnalysis"))
    with session_scope() as session:
        settings = read_app_settings(session).sales_analysis
        assert (settings.min_sample_for_ratio, settings.closed_window_days) == (10, 365)
    assert analysis(client)["data"]["basis"]["minSampleForRatio"] == 10


def test_api_needs_the_access_session_when_protection_is_on(dashboard_env, monkeypatch):
    """Given 접속 보호가 켜짐 / When 접속 확인 없이 조회 / Then 401."""
    client, _ = dashboard_env
    monkeypatch.setenv("GEOSAN_PASSWORD", "virtual-test-password")
    with session_scope() as session:
        session.get(AppSetting, "accessProtection").value = {"enabled": True}
    with TestClient(create_app()) as fresh:
        assert fresh.get("/api/v1/sales-analysis").status_code == 401
