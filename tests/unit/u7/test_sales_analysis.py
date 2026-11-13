"""#608: 영업 분석표. 영업 기록만으로 공정별·회사별 표를 계산한다(AI·외부 호출 없음).

앞쪽은 받은 값만 쓰는 계산 함수 검사, 뒤쪽은 실제 임시 DB(SQLite)와 실제 API 검사다.
가상 사례만 쓴다(거산 실제 사양 아님). 기준 숫자(표본 10건·365일)는 예시 설정 값이다.
"""

from datetime import date, datetime, timedelta

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select

from geosan.api.app import create_app
from geosan.config.app_settings import read_app_settings
from geosan.config.models import AppSetting
from geosan.dashboard.sales_analysis import (
    CompanyRecords,
    RecordLine,
    build_sales_analysis,
    load_company_records,
    load_process_proposal_hit,
    proposal_hit,
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


STEP_ORDER = ["NOT_REACHED", "REACHED", "DEMAND_CONFIRMED", "MATERIAL_QUOTE", "VISIT_SAMPLE"]


def line(status="IN_PROGRESS", method=None, result=None, day=None, reason=None, at=NOW, after=None):
    return RecordLine(
        status=status,
        method=method,
        result=result,
        attempted_at=day,
        created_at=at,
        lost_reason_code=reason,
        step_after=after,
    )


def call(result="REACHED", day=date(2026, 11, 1), status="IN_PROGRESS", method="CALL", after=None):
    return line(status=status, method=method, result=result, day=day, after=after)


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
        step_order=STEP_ORDER,
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


def test_total_counts_each_company_once_and_rows_tell_the_overlap():
    """Given 공정 둘인 회사 1곳 + 하나인 회사 2곳 / When 계산 / Then 합계 3, 줄 합 4, 겹침 1."""
    result = analyse(
        [
            company("두공정", [call("ABSENT"), call()], processes=("ANODIZING", "CHROMATE")),
            company("아노", [call()]),
            company("확인전", [call(method="EMAIL")], processes=()),
        ]
    )
    assert result.total.contacted_count == 3 == result.basis.company_count
    assert [
        (row.process_code, row.stats.contacted_count, row.overlap_count)
        for row in result.by_process
    ] == [("ANODIZING", 2, 1), ("CHROMATE", 1, 1), (None, 1, 0)]
    # 접촉 횟수도 합계는 회사 기준 한 번이다. 줄에는 겹친 회사의 전화 2번이 두 줄 모두에 들어간다.
    assert (result.total.contact_reach.call.tried, result.total.contact_reach.email.tried) == (3, 1)
    assert sum(row.stats.contact_reach.call.tried for row in result.by_process) == 5
    assert result.total.in_progress_count == 3 and result.total.ratios is None


def test_total_is_zero_without_contacts():
    total = analyse([]).total
    assert (total.contacted_count, total.won_count, total.avg_contacts_to_won) == (0, 0, None)
    assert total.lost_reasons == [] and total.ratios is None


def test_industry_rows_tell_how_many_companies_are_in_another_industry_row():
    """Given 산업군 둘·하나·설정 밖 값이 낀 회사 / When 계산 / Then 설정 안 둘인 회사만 겹침."""
    result = analyse(
        [
            company("둘", [call()], industries=("자동차 부품", "방위산업")),
            company("하나", [call()], industries=("자동차 부품",)),
            company("설정밖", [call()], industries=("방위산업", "목록에 없는 산업")),
            company("없음", [call()]),
        ]
    )
    rows = result.by_process[0].by_industry
    assert [(row.industry, row.stats.contacted_count, row.overlap_count) for row in rows] == [
        ("방위산업", 2, 1),
        ("자동차 부품", 2, 1),
        ("산업 확인 전", 1, 0),
    ]


def steps_of(result):
    return {row.step: row for row in result.by_sales_step}


def test_step_rows_count_contacts_at_the_step_before_saving():
    """Given 부재 → 연결(수요 확인으로 건너뜀) → 방문 / When 계산 / Then 직전 단계에 센다."""
    result = analyse(
        [
            company(
                "가상정밀",
                [
                    call("ABSENT", after="NOT_REACHED"),
                    call("REACHED", after="DEMAND_CONFIRMED"),
                    call("REACHED", method="VISIT", after="DEMAND_CONFIRMED"),
                ],
            )
        ]
    )
    rows = steps_of(result)
    assert list(rows) == ["NOT_REACHED", "DEMAND_CONFIRMED"]  # 건너뛴 연결됨은 없다
    before = rows["NOT_REACHED"]
    assert (before.contacted_count, before.contact_count) == (1, 2)
    assert (before.contact_reach.call.reached, before.contact_reach.call.tried) == (1, 2)
    assert (before.reached_count, before.contacts_to_reach) == (
        0,
        0,
    )  # 연결 전은 이르는 단계가 아님
    demand = rows["DEMAND_CONFIRMED"]
    assert (demand.reached_count, demand.contacts_to_reach) == (1, 2)
    assert (demand.contact_count, demand.contact_reach.visit.tried) == (1, 1)
    assert demand.avg_contacts_to_reach is None and demand.reach_ratios is None  # 표본 1 < 10


def test_step_rows_follow_a_corrected_step_from_the_next_contact():
    """Given 자료·견적까지 갔다가 [단계 고치기]로 연결됨 / When 다음 접촉 / Then 연결됨에 센다."""
    result = analyse(
        [
            company(
                "고친곳",
                [
                    call(after="MATERIAL_QUOTE"),
                    line(after="REACHED"),  # 접촉 없이 단계만 고친 행
                    call(method="EMAIL", after="REACHED"),
                    call(after="MATERIAL_QUOTE"),  # 다시 이르러도 처음 이른 때만 센다
                ],
            )
        ]
    )
    rows = steps_of(result)
    assert rows["REACHED"].contact_reach.email.tried == 1
    assert rows["REACHED"].contact_reach.call.tried == 1
    assert (rows["REACHED"].reached_count, rows["REACHED"].contacts_to_reach) == (1, 1)
    quote = rows["MATERIAL_QUOTE"]
    assert (quote.reached_count, quote.contacts_to_reach, quote.contact_count) == (1, 1, 0)


def test_step_rows_give_average_and_ratios_once_the_sample_is_enough():
    """Given 기준 2곳, 수요 확인에 2번·5번 만에 이른 두 회사 / When 계산 / Then 평균 3.5, 비율."""
    result = analyse(
        [
            company("둘", [call("ABSENT", after="NOT_REACHED"), call(after="DEMAND_CONFIRMED")]),
            company(
                "다섯",
                [call("ABSENT", after="NOT_REACHED")] * 4 + [call(after="DEMAND_CONFIRMED")],
            ),
            company("하나", [call(after="REACHED")]),
        ],
        min_sample=2,
    )
    rows = steps_of(result)
    demand = rows["DEMAND_CONFIRMED"]
    assert (demand.reached_count, demand.contacts_to_reach) == (2, 7)
    assert demand.avg_contacts_to_reach == 3.5
    assert demand.reach_ratios is None  # 이 단계에 머무는 동안 접촉한 회사는 0곳
    before = rows["NOT_REACHED"]
    assert (before.contacted_count, before.contact_count) == (3, 8)
    assert before.reach_ratios.call == 0.38 and before.reach_ratios.email is None  # 3 ÷ 8
    assert rows["REACHED"].avg_contacts_to_reach is None  # 이른 회사 1곳 < 기준 2


def test_step_rows_leave_out_companies_outside_the_tables():
    """Given 기간 밖 성사 회사 / When 계산 / Then 두 표와 같이 단계별 접촉에서도 뺀다."""
    old = NOW - timedelta(days=400)
    result = analyse(
        [company("옛성사", [call(after="REACHED"), line(status="WON", at=old, after="REACHED")])]
    )
    assert result.basis.older_closed_excluded == 1 and result.by_sales_step == []


def test_unknown_step_value_is_an_error_not_a_silent_bucket():
    with pytest.raises(ValueError, match="세부 단계"):
        analyse([company("이상", [call(after="SOMETHING_NEW")])])


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


def confirm_second_process(opp_id, code="CHROMATE"):
    """사례 파일로 확정된 공정 연결을 하나 더 넣는다(가상)."""
    with session_scope() as session:
        session.add(
            OppProcessLink(
                link_id=new_id("link"),
                opp_id=opp_id,
                process_code=code,
                created_by="system",
                dataset_kind="VIRTUAL_REVIEWED",
                is_virtual=True,
            )
        )


def propose_process(opp_id, code):
    """AI 공정 제안 행을 DB에 직접 넣는다(가상, 실제 AI 호출 없음)."""
    with session_scope() as session:
        session.add(
            OppProcessLink(
                link_id=new_id("link"),
                opp_id=opp_id,
                process_code=code,
                current_reason="가상 AI 제안",
                source="AI",
                state="PENDING",
                created_by="system",
                dataset_kind="VIRTUAL_REVIEWED",
                is_virtual=True,
            )
        )


def confirm_by_answer(client, opp_id, *codes):
    record(client, opp_id, contact(answers=answers(*(("CONFIRM_PROCESS", code) for code in codes))))


def hit_of(client):
    return analysis(client)["data"]["aiProposalHit"]["process"]


def test_proposal_hit_ratio_follows_the_sample_minimum():
    """Given 확정 15곳 중 적중 12곳 / When 기준 10 / Then 0.8, 기준 20이면 건수만."""
    assert proposal_hit(15, 12, 10).ratio == 0.8
    assert proposal_hit(15, 12, 20).ratio is None
    empty = proposal_hit(0, 0, 0)
    assert (empty.confirmed_count, empty.hit_count, empty.ratio) == (0, 0, None)


def test_api_proposal_hit_is_zero_before_any_staff_confirmation(dashboard_env):
    """Given 사례 파일 확정과 AI 제안뿐 / When 조회 / Then 담당자가 확정한 회사 0곳."""
    client, (a, *_rest) = dashboard_env
    propose_process(a, "CHROMATE")
    assert hit_of(client) == {"confirmedCount": 0, "hitCount": 0, "ratio": None}


def test_api_proposal_hit_counts_companies_confirmed_within_ai_proposals(dashboard_env):
    """Given 제안 안에서 확정 1곳, 제안 밖 확정 1곳, 섞어 확정 1곳 / When 조회 / Then 3곳 중 1곳."""
    client, (a, b, c, d) = dashboard_env
    for opp_id in (a, b, c, d):
        propose_process(opp_id, "CHROMATE")
    confirm_by_answer(client, a, "CHROMATE")  # 제안 안
    confirm_by_answer(client, b, "ZINC_PLATING")  # 제안에 없던 공정
    confirm_by_answer(client, c, "CHROMATE", "ZINC_PLATING")  # 하나는 제안 밖 → 적중 아님
    assert hit_of(client) == {"confirmedCount": 3, "hitCount": 1, "ratio": None}
    # d는 AI 제안만 있고 확정 전이다. 사례 파일로 확정된 아노다이징은 어디서도 세지 않는다.
    with session_scope() as session:
        result = load_process_proposal_hit(
            session, dataset_kind="VIRTUAL_REVIEWED", min_sample_for_ratio=3
        )
        assert (result.confirmed_count, result.hit_count, result.ratio) == (3, 1, 0.33)
        # 실제 묶음으로 보면 가상 회사는 섞이지 않는다.
        real = load_process_proposal_hit(session, dataset_kind="BROCHURE", min_sample_for_ratio=3)
        assert (real.confirmed_count, real.hit_count) == (0, 0)


def test_api_proposal_hit_ignores_ai_rows_made_after_the_confirmation(dashboard_env):
    """Given 담당자가 먼저 확정한 뒤에 생긴 같은 공정의 AI 행 / When 조회 / Then 적중 아님."""
    client, (a, *_rest) = dashboard_env
    propose_process(a, "CHROMATE")  # 확정 전에 다른 공정 제안이 있어 분모에는 든다
    confirm_by_answer(client, a, "ZINC_PLATING")
    with session_scope() as session:
        staff_row = session.scalar(
            select(OppProcessLink).where(
                OppProcessLink.opp_id == a, OppProcessLink.source == "STAFF"
            )
        )
        session.add(
            OppProcessLink(
                link_id=new_id("link"),
                opp_id=a,
                process_code="ZINC_PLATING",
                source="AI",
                state="PENDING",
                created_by="system",
                created_at=staff_row.created_at + timedelta(minutes=1),
                superseded_at=staff_row.created_at + timedelta(minutes=2),
                dataset_kind="VIRTUAL_REVIEWED",
                is_virtual=True,
            )
        )
    assert hit_of(client) == {"confirmedCount": 1, "hitCount": 0, "ratio": None}


def test_api_proposal_hit_leaves_out_companies_without_any_ai_proposal(dashboard_env):
    """Given AI 제안 없이 확정한 회사 1곳 + 제안 안에서 확정한 회사 1곳 / When 조회 / Then 1/1.

    "제안이 틀렸다"와 "제안이 없었다"는 다르다(PM 결정 2026-11-13). 확정한 뒤에야 생긴 AI 행도
    제안이 없었던 것으로 본다.
    """
    client, (a, b, c, _d) = dashboard_env
    confirm_by_answer(client, a, "ZINC_PLATING")  # AI 제안 0건
    assert hit_of(client) == {"confirmedCount": 0, "hitCount": 0, "ratio": None}
    propose_process(b, "CHROMATE")
    confirm_by_answer(client, b, "CHROMATE")
    confirm_by_answer(client, c, "ZINC_PLATING")
    with session_scope() as session:
        staff_row = session.scalar(
            select(OppProcessLink).where(
                OppProcessLink.opp_id == c, OppProcessLink.source == "STAFF"
            )
        )
        session.add(
            OppProcessLink(
                link_id=new_id("link"),
                opp_id=c,
                process_code="CHROMATE",
                source="AI",
                state="PENDING",
                created_by="system",
                created_at=staff_row.created_at + timedelta(minutes=1),
                dataset_kind="VIRTUAL_REVIEWED",
                is_virtual=True,
            )
        )
    assert hit_of(client) == {"confirmedCount": 1, "hitCount": 1, "ratio": None}


def answers(*pairs):
    return [{"questionId": question, "answerId": answer} for question, answer in pairs]


def test_api_total_row_and_overlap_counts(dashboard_env):
    """Given 공정 둘 확정 1곳 + 공정 하나 2곳 / When 조회 / Then 합계 3곳, 줄 합 4, 겹침 1."""
    client, (a, b, c, _d) = dashboard_env
    confirm_second_process(a)
    record(client, a, contact("ABSENT"))
    record(client, a, contact())
    record(client, b, contact())
    record(client, b, {"status": "LOST", "lostReasonCode": "PRICE"})
    record(client, c, contact(method="EMAIL"))
    data = analysis(client)["data"]
    total = data["total"]
    assert (total["contactedCount"], total["inProgressCount"], total["lostCount"]) == (3, 2, 1)
    assert total["contactReach"]["CALL"] == {"reached": 2, "tried": 3}
    assert total["lostReasons"] == [{"code": "PRICE", "count": 1}] and total["ratios"] is None
    assert [
        (row["processCode"], row["contactedCount"], row["overlapCount"])
        for row in data["byProcess"]
    ] == [("ANODIZING", 3, 1), ("CHROMATE", 1, 1)]
    assert all(item["overlapCount"] == 0 for row in data["byProcess"] for item in row["byIndustry"])


def test_api_step_rows_follow_answers_corrections_and_cancelled_records(dashboard_env):
    """Given 답으로 단계가 가고, 고치고, 접촉 취소 / When 조회 / Then 상세와 같은 단계로 센다."""
    client, (a, *_rest) = dashboard_env
    record(client, a, contact("ABSENT", day="2026-10-15"))
    record(
        client,
        a,
        contact(day="2026-10-16", answers=answers(("WHO_TALKED", "RIGHT_PERSON"))),  # → 연결됨
    )
    record(
        client,
        a,
        contact(method="EMAIL", day="2026-10-17", answers=answers(("PLATING_NOW", "OUTSOURCED"))),
    )
    record(client, a, contact(method="VISIT", day="2026-10-18"))

    def rows():
        return {row["step"]: row for row in analysis(client)["data"]["bySalesStep"]}

    before = rows()
    assert list(before) == ["NOT_REACHED", "REACHED", "DEMAND_CONFIRMED"]
    assert before["NOT_REACHED"]["contactReach"]["CALL"] == {"reached": 1, "tried": 2}
    assert (before["REACHED"]["reachedCount"], before["REACHED"]["contactsToReach"]) == (1, 2)
    assert before["REACHED"]["contactReach"]["EMAIL"] == {"reached": 1, "tried": 1}
    assert before["DEMAND_CONFIRMED"]["contactsToReach"] == 3
    assert before["DEMAND_CONFIRMED"]["contactReach"]["VISIT"] == {"reached": 1, "tried": 1}

    # 수요 확인으로 보낸 메일 접촉을 취소하면 그 답도 빠져, 방문은 연결됨에서 한 접촉이 된다.
    with session_scope() as session:
        cancel_id = session.scalar(
            select(Outcome.outcome_id).where(Outcome.opp_id == a, Outcome.method == "EMAIL")
        )
    cancelled = client.post(
        f"/api/v1/opportunities/{a}/records/{cancel_id}/cancel",
        json={},
        headers={"X-Staff-Key": "park-lee"},
    )
    assert cancelled.status_code == 200, cancelled.text
    after = rows()
    assert list(after) == ["NOT_REACHED", "REACHED"]
    assert after["REACHED"]["contactReach"]["VISIT"] == {"reached": 1, "tried": 1}
    assert after["REACHED"]["contactReach"]["EMAIL"] == {"reached": 0, "tried": 0}

    # [단계 고치기]로 자료·견적으로 옮기면 그 뒤 접촉은 자료·견적에서 한 접촉이다.
    record(client, a, {"status": "IN_PROGRESS", "stepOverride": "MATERIAL_QUOTE"})
    record(client, a, contact(day="2026-10-20"))
    fixed = rows()
    assert fixed["MATERIAL_QUOTE"]["contactReach"]["CALL"] == {"reached": 1, "tried": 1}
    assert (
        fixed["MATERIAL_QUOTE"]["reachedCount"],
        fixed["MATERIAL_QUOTE"]["contactsToReach"],
    ) == (
        1,
        3,
    )
    detail = client.get(f"/api/v1/opportunities/{a}").json()["data"]
    assert detail["records"]["salesStep"]["code"] == "MATERIAL_QUOTE"


def test_api_is_empty_before_any_contact(dashboard_env):
    """Given 평가만 하고 접촉 기록 0건 / When 조회 / Then 빈 표와 설정 기준 숫자."""
    client, (a, *_rest) = dashboard_env
    record(client, a, {"status": "ON_HOLD"})  # 접촉 없이 단계만 바꾼 회사는 표에 없다
    body = analysis(client)
    assert body["data"]["byProcess"] == [] and body["data"]["companies"] == []
    assert body["data"]["bySalesStep"] == [] and body["data"]["total"]["contactedCount"] == 0
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
