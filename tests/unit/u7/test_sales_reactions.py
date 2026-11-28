"""#985: 영업 분석 "상대 반응 — 거산의 강점·약점". 접촉 기록의 상대 반응 답만 접촉 건수로 센다.

앞쪽은 받은 값만 쓰는 계산 함수 검사, 뒤쪽은 실제 임시 DB(SQLite)와 실제 API 검사다.
AI·외부 호출 없음. 가상 회사만 쓴다(거산 실제 사양 아님). 사람 이름·연락처는 넣지 않는다.
"""

from datetime import date, timedelta
from pathlib import Path

from fastapi.testclient import TestClient
from ruamel.yaml import YAML
from sqlalchemy import func, select

from geosan.api.app import create_app
from geosan.config.models import AppSetting
from geosan.dashboard.sales_reactions import (
    ReactionCompany,
    ReactionLine,
    build_sales_reactions,
)
from geosan.evidence.transfer import TransferLog
from geosan.opportunity.models import Customer, Opportunity
from geosan.records.models import Note, Outcome
from geosan.storage.base import new_id
from geosan.storage.session import session_scope
from tests.unit.u7 import test_sales_analysis as support

dashboard_env = support.dashboard_env
record = support.record
contact = support.contact
answers = support.answers
VIEWER = support.VIEWER
URL = "/api/v1/sales-analysis/reactions"
EXAMPLE_QUESTIONS = Path(__file__).resolve().parents[3] / "examples" / "sales-questions.yaml"

PROCESSES = [("ANODIZING", "아노다이징"), ("ZINC", "아연도금"), ("CHROMATE", "크로메이트")]
INDUSTRIES = ["방위산업", "자동차 부품"]
# 질문 파일의 보기 순서(예시 질문 파일과 같은 순서로 적은 가상 값).
ANSWER_ORDER = {
    "REACTION": ["POSITIVE", "NEUTRAL", "NEGATIVE"],
    "REACTION_GOOD": ["PROCESS_FIT", "QUALITY_CERT", "LEAD_TIME", "PRICE"],
    "REACTION_BAD": ["PRICE", "LEAD_TIME", "INCUMBENT_SUPPLIER", "CLAIM"],
}
DAY = date(2026, 11, 20)


def line(reaction=None, good=None, bad=None, day=DAY, method="CALL", extra=()):
    """접촉 한 행. 반응·좋게 본 부분·걸린 부분 답을 주면 그 답이 함께 저장된 것으로 본다."""
    pairs = [
        (question, answer)
        for question, answer in (
            ("REACTION", reaction),
            ("REACTION_GOOD", good),
            ("REACTION_BAD", bad),
        )
        if answer is not None
    ]
    return ReactionLine(day=day, method=method, answers=(*pairs, *extra))


def company(name, lines, processes=("ANODIZING",), industries=()):
    return ReactionCompany(
        opp_id=f"opp-{name}",
        name=name,
        process_codes=tuple(processes),
        industries=tuple(industries),
        lines=tuple(lines),
    )


def count(companies, period=None, answer_order=None, min_sample=10):
    return build_sales_reactions(
        companies,
        processes=PROCESSES,
        industries=INDUSTRIES,
        answer_order=ANSWER_ORDER if answer_order is None else answer_order,
        min_sample_for_ratio=min_sample,
        period=period,
    )


def numbers(group):
    return (group.answered_count, group.positive, group.neutral, group.negative)


def parts(items):
    return [(item.answer_id, item.count) for item in items]


# ---------------------------------------------------------------------------
# 계산 함수
# ---------------------------------------------------------------------------


def test_no_companies_give_zero_counts_and_empty_rows():
    """Given 회사 0곳 / When 계산 / Then 건수 0, 줄 없음, 표본 기준은 받은 값 그대로."""
    result = count([], min_sample=7)
    basis = result.basis
    assert (basis.min_sample_for_ratio, basis.contact_count, basis.answered_count) == (7, 0, 0)
    assert numbers(result.total) == (0, 0, 0, 0)
    assert (result.total.good, result.total.bad) == ([], [])
    assert (result.by_industry, result.by_process, result.contacts) == ([], [], [])


def test_each_contact_is_counted_once_by_its_reaction_answer():
    """Given 한 회사에 긍정적 2건·보통 1건·부정적 1건 / When 계산 / Then 접촉 건수대로 센다."""
    result = count(
        [
            company("K산업(가상)", [line("POSITIVE"), line("POSITIVE"), line("NEGATIVE")]),
            company("M정밀(가상)", [line("NEUTRAL")]),
        ]
    )
    assert numbers(result.total) == (4, 2, 1, 1)
    assert (result.basis.contact_count, result.basis.answered_count) == (4, 4)


def test_contacts_without_a_reaction_answer_count_as_contacts_only():
    """Given 부재 접촉(답 없음)·다른 질문만 답한 접촉·접촉 없이 단계만 적은 행 / When 계산
    / Then 접촉 건수에는 접촉 둘이 들고, 반응을 남긴 건수에는 들지 않는다."""
    result = count(
        [
            company(
                "K산업(가상)",
                [
                    line(),  # 부재 접촉: 답 없음
                    line(extra=(("INTEREST", "HIGH"),)),  # 다른 질문만 답함
                    line("POSITIVE", method=None),  # 접촉이 아닌 행은 답이 있어도 세지 않는다
                    line("NEUTRAL", method="EMAIL"),
                ],
            )
        ]
    )
    assert (result.basis.contact_count, result.basis.answered_count) == (3, 1)
    assert numbers(result.total) == (1, 0, 1, 0)
    assert [(row.method, row.reaction) for row in result.contacts] == [("EMAIL", "NEUTRAL")]


def test_good_part_counts_only_positive_contacts_and_bad_part_only_negative():
    """Given 반응과 맞지 않는 꼬리 답이 섞여 있음 / When 계산
    / Then 좋게 본 부분은 긍정적인 접촉에서만, 걸린 부분은 부정적인 접촉에서만 센다."""
    result = count(
        [
            company(
                "K산업(가상)",
                [
                    line("POSITIVE", good="QUALITY_CERT", day=date(2026, 11, 5)),
                    line("NEGATIVE", bad="CLAIM", day=date(2026, 11, 4)),
                    # 부정적인데 좋게 본 부분이 함께 온 접촉: 좋게 본 부분에 넣지 않는다.
                    line("NEGATIVE", good="PRICE", day=date(2026, 11, 3)),
                    # 긍정적인데 걸린 부분이 함께 온 접촉: 걸린 부분에 넣지 않는다.
                    line("POSITIVE", bad="PRICE", day=date(2026, 11, 2)),
                    # 보통은 어느 부분에도 넣지 않는다.
                    line("NEUTRAL", good="LEAD_TIME", bad="LEAD_TIME", day=date(2026, 11, 1)),
                ],
            )
        ]
    )
    assert numbers(result.total) == (5, 2, 1, 2)
    assert parts(result.total.good) == [("QUALITY_CERT", 1)]
    assert parts(result.total.bad) == [("CLAIM", 1)]
    assert [(row.reaction, row.good, row.bad) for row in result.contacts] == [
        ("POSITIVE", "QUALITY_CERT", None),
        ("NEGATIVE", None, "CLAIM"),
        ("NEGATIVE", None, None),
        ("POSITIVE", None, None),
        ("NEUTRAL", None, None),
    ]


def test_a_reaction_without_the_follow_up_answer_is_in_no_part():
    """Given 긍정적·부정적이라고만 답하고 부분은 안 고른 접촉 / When 계산
    / Then 반응에는 세고 좋게 본 부분·걸린 부분은 비어 있다."""
    result = count([company("S전자(가상)", [line("POSITIVE"), line("NEGATIVE")])])
    assert numbers(result.total) == (2, 1, 0, 1)
    assert (result.total.good, result.total.bad) == ([], [])


def test_company_with_two_processes_is_in_both_process_rows_and_once_in_total():
    """Given 공정이 둘인 회사의 부정적 접촉 1건 / When 계산
    / Then 공정 줄 둘에 모두 1건, 전체에는 1건, 접촉 줄은 하나(공정은 역량 파일 순서)."""
    result = count(
        [company("H금속(가상)", [line("NEGATIVE", bad="PRICE")], processes=("CHROMATE", "ZINC"))]
    )
    assert [(row.process_code, row.process_name, numbers(row)) for row in result.by_process] == [
        ("ZINC", "아연도금", (1, 0, 0, 1)),
        ("CHROMATE", "크로메이트", (1, 0, 0, 1)),
    ]
    assert all(parts(row.bad) == [("PRICE", 1)] for row in result.by_process)
    assert numbers(result.total) == (1, 0, 0, 1)
    assert len(result.contacts) == 1
    assert result.contacts[0].process_codes == ["ZINC", "CHROMATE"]


def test_company_with_two_industries_is_in_both_industry_rows_and_once_in_total():
    """Given 산업이 둘인 회사의 긍정적 접촉 1건 / When 계산 / Then 산업 줄 둘에 모두, 전체 한 번."""
    result = count(
        [
            company(
                "H금속(가상)",
                [line("POSITIVE", good="PROCESS_FIT")],
                industries=("자동차 부품", "방위산업"),
            )
        ]
    )
    assert [(row.industry, numbers(row)) for row in result.by_industry] == [
        ("방위산업", (1, 1, 0, 0)),
        ("자동차 부품", (1, 1, 0, 0)),
    ]
    assert numbers(result.total) == (1, 1, 0, 0)
    assert result.contacts[0].industries == ["방위산업", "자동차 부품"]  # 설정 순서


def test_rows_follow_settings_order_and_unknown_rows_go_last():
    """Given 공정·산업이 없는 회사와 있는 회사 / When 계산
    / Then 산업은 설정 순서 뒤 "미확정", 공정은 역량 파일 순서 뒤 null "공정 미확정"이 맨 끝."""
    result = count(
        [
            company("T기계(가상)", [line("NEGATIVE", bad="PRICE")], processes=()),
            company("K산업(가상)", [line("NEUTRAL")], ("CHROMATE",), ("자동차 부품",)),
            company("M정밀(가상)", [line("POSITIVE")], ("ANODIZING",), ("방위산업",)),
        ]
    )
    assert [(row.industry, row.answered_count) for row in result.by_industry] == [
        ("방위산업", 1),
        ("자동차 부품", 1),
        ("미확정", 1),
    ]
    assert [(row.process_code, row.process_name) for row in result.by_process] == [
        ("ANODIZING", "아노다이징"),
        ("CHROMATE", "크로메이트"),
        (None, "공정 미확정"),
    ]
    assert parts(result.by_process[-1].bad) == [("PRICE", 1)]
    unknown = next(row for row in result.contacts if row.name == "T기계(가상)")
    assert (unknown.industries, unknown.process_codes) == ([], [])


def test_industry_and_process_outside_the_lists_fall_into_the_unknown_rows():
    """Given 설정에 없는 산업 이름·역량 파일에 없는 공정 코드만 가진 회사 / When 계산
    / Then 분석표처럼 맨 끝 줄에 세고, 접촉 줄에는 목록에 있는 값만 싣는다."""
    result = count(
        [
            company("R테크(가상)", [line("NEUTRAL")], ("없는공정",), ("목록에 없는 산업",)),
            company("K산업(가상)", [line("NEUTRAL")], ("ZINC", "없는공정"), ("방위산업", "밖")),
        ]
    )
    assert [(row.industry, row.answered_count) for row in result.by_industry] == [
        ("방위산업", 1),
        ("미확정", 1),
    ]
    assert [(row.process_code, row.answered_count) for row in result.by_process] == [
        ("ZINC", 1),
        (None, 1),
    ]
    by_name = {row.name: row for row in result.contacts}
    assert (by_name["R테크(가상)"].industries, by_name["R테크(가상)"].process_codes) == ([], [])
    assert (by_name["K산업(가상)"].industries, by_name["K산업(가상)"].process_codes) == (
        ["방위산업"],
        ["ZINC"],
    )


def test_rows_without_any_reaction_answer_are_left_out():
    """Given 접촉은 있지만 반응 답이 없는 회사의 공정·산업 / When 계산 / Then 그 줄은 없다."""
    result = count(
        [
            company("K산업(가상)", [line()], ("ZINC",), ("자동차 부품",)),  # 부재만
            company("M정밀(가상)", [line("POSITIVE")], ("ANODIZING",), ("방위산업",)),
        ]
    )
    assert [row.process_code for row in result.by_process] == ["ANODIZING"]
    assert [row.industry for row in result.by_industry] == ["방위산업"]
    assert (result.basis.contact_count, result.basis.answered_count) == (2, 1)


def test_parts_are_sorted_by_count_then_question_file_order():
    """Given 걸린 부분 답이 클레임 2·가격 1·납기 1, 좋게 본 부분이 납기 1·공정 1 / When 계산
    / Then 많은 순, 건수가 같으면 질문 파일 보기 순서(가격 → 납기, 공정·기술 → 납기)."""
    result = count(
        [
            company(
                "K산업(가상)",
                [
                    line("NEGATIVE", bad="LEAD_TIME"),
                    line("NEGATIVE", bad="CLAIM"),
                    line("NEGATIVE", bad="PRICE"),
                    line("NEGATIVE", bad="CLAIM"),
                    line("POSITIVE", good="LEAD_TIME"),
                    line("POSITIVE", good="PROCESS_FIT"),
                ],
            )
        ]
    )
    assert parts(result.total.bad) == [("CLAIM", 2), ("PRICE", 1), ("LEAD_TIME", 1)]
    assert parts(result.total.good) == [("PROCESS_FIT", 1), ("LEAD_TIME", 1)]


def test_contact_lines_are_sorted_by_recent_day_then_name_then_later_saved():
    """Given 날짜가 섞인 접촉들 / When 계산
    / Then 최근 날짜 순, 같은 날이면 회사 이름순, 같은 회사면 나중에 저장한 접촉 먼저."""
    result = count(
        [
            company(
                "M정밀(가상)",
                [
                    line("NEUTRAL", day=date(2026, 11, 10)),
                    line("POSITIVE", day=date(2026, 11, 24), method="VISIT"),
                ],
            ),
            company(
                "K산업(가상)",
                [
                    line("NEGATIVE", day=date(2026, 11, 10), method="CALL"),
                    line("POSITIVE", day=date(2026, 11, 10), method="EMAIL"),
                ],
            ),
        ]
    )
    assert [(row.name, row.day, row.method, row.reaction) for row in result.contacts] == [
        ("M정밀(가상)", date(2026, 11, 24), "VISIT", "POSITIVE"),
        ("K산업(가상)", date(2026, 11, 10), "EMAIL", "POSITIVE"),
        ("K산업(가상)", date(2026, 11, 10), "CALL", "NEGATIVE"),
        ("M정밀(가상)", date(2026, 11, 10), "CALL", "NEUTRAL"),
    ]


def test_period_counts_only_contacts_inside_both_ends_included():
    """Given 10월 말·11월 첫날·11월 끝날·12월 첫날 접촉 / When 11월로 계산
    / Then 양끝 날짜를 포함해 11월 접촉만 접촉 건수·반응 건수에 든다."""
    lines = [
        line("POSITIVE", day=date(2026, 10, 31)),
        line("NEGATIVE", bad="PRICE", day=date(2026, 11, 1)),
        line(day=date(2026, 11, 15)),  # 기간 안 부재 접촉
        line("NEUTRAL", day=date(2026, 11, 30)),
        line("POSITIVE", day=date(2026, 12, 1)),
    ]
    result = count([company("K산업(가상)", lines)], period=(date(2026, 11, 1), date(2026, 11, 30)))
    assert (result.basis.contact_count, result.basis.answered_count) == (3, 2)
    assert numbers(result.total) == (2, 0, 1, 1)
    assert [row.day for row in result.contacts] == [date(2026, 11, 30), date(2026, 11, 1)]
    # 한쪽 끝이 비면 그쪽은 막지 않는다.
    assert count([company("K산업(가상)", lines)], period=(None, date(2026, 11, 1))).basis == (
        count([company("K산업(가상)", lines[:2])]).basis
    )
    assert numbers(count([company("K산업(가상)", lines)]).total) == (4, 2, 1, 1)


def test_question_file_without_the_reaction_question_gives_zero_not_an_error():
    """Given 질문 파일에 상대 반응 질문이 없음(지난 답은 남아 있음) / When 계산
    / Then 오류 없이 반응 건수는 모두 0이고, 접촉 건수는 그대로 센다."""
    result = count(
        [company("K산업(가상)", [line("NEGATIVE", bad="CLAIM"), line("POSITIVE")])],
        answer_order={},
    )
    assert (result.basis.contact_count, result.basis.answered_count) == (2, 0)
    assert numbers(result.total) == (0, 0, 0, 0)
    assert (result.by_industry, result.by_process, result.contacts) == ([], [], [])


def test_answers_no_longer_in_the_question_file_are_not_counted():
    """Given 질문 파일에서 사라진 보기로 남은 지난 답 / When 계산
    / Then 없는 반응 보기는 반응으로 세지 않고, 없는 부분 보기는 어느 부분에도 넣지 않는다."""
    result = count(
        [
            company(
                "K산업(가상)",
                [
                    line("VERY_GOOD"),  # 반응 질문에 없는 보기
                    line("NEGATIVE", bad="OLD_CHOICE"),  # 걸린 부분 질문에 없는 보기
                    line("POSITIVE", good="QUALITY_CERT"),
                ],
            )
        ],
        # 좋게 본 부분 질문이 파일에서 빠진 경우
        answer_order={key: ANSWER_ORDER[key] for key in ("REACTION", "REACTION_BAD")},
    )
    assert (result.basis.contact_count, result.basis.answered_count) == (3, 2)
    assert numbers(result.total) == (2, 1, 0, 1)
    assert (result.total.good, result.total.bad) == ([], [])
    assert {(row.reaction, row.good, row.bad) for row in result.contacts} == {
        ("NEGATIVE", None, None),
        ("POSITIVE", None, None),
    }


# ---------------------------------------------------------------------------
# 실제 임시 DB + 실제 API
# ---------------------------------------------------------------------------

NEGATIVE_CLAIM = answers(("REACTION", "NEGATIVE"), ("REACTION_BAD", "CLAIM"))
POSITIVE_QUALITY = answers(("REACTION", "POSITIVE"), ("REACTION_GOOD", "QUALITY_CERT"))
NEUTRAL = answers(("REACTION", "NEUTRAL"))


def reactions(client, query="", headers=VIEWER):
    response = client.get(f"{URL}{query}", headers=headers)
    assert response.status_code == 200, response.text
    return response.json()


def group_numbers(group):
    return (group["answeredCount"], group["positive"], group["neutral"], group["negative"])


def set_industries(opp_id, industries, source="STAFF"):
    """회사의 산업군을 DB에 직접 넣는다(가상). 담당자·사례 파일로 확정된 값만 분석이 센다."""
    with session_scope() as session:
        customer = session.get(Customer, session.get(Opportunity, opp_id).customer_id)
        customer.industries, customer.industries_source = list(industries), source


def test_api_is_all_zero_before_any_contact(dashboard_env):
    """Given 평가만 하고 접촉 기록 0건 / When 보기 전용이 조회 / Then 건수 0·빈 줄·가상 표시 꺼짐"""
    client, _opp_ids = dashboard_env
    body = reactions(client)
    data = body["data"]
    assert set(data) == {"asOf", "basis", "total", "byIndustry", "byProcess", "contacts"}
    assert data["basis"] == {"minSampleForRatio": 10, "contactCount": 0, "answeredCount": 0}
    assert data["total"] == {
        "answeredCount": 0,
        "positive": 0,
        "neutral": 0,
        "negative": 0,
        "good": [],
        "bad": [],
    }
    assert (data["byIndustry"], data["byProcess"], data["contacts"]) == ([], [], [])
    assert data["asOf"]
    assert body["meta"]["hasVirtualData"] is False
    assert body["meta"]["datasetKind"] == "VIRTUAL_REVIEWED"


def test_api_counts_saved_reaction_answers_and_viewer_can_read(dashboard_env):
    """Given 세 회사에 부재·부정적(클레임)·긍정적(품질·인증)·보통 접촉을 저장
    / When 보기 전용이 조회
    / Then 저장한 답대로 전체·산업별·공정별 건수와 접촉 줄이 온다. 부재는 접촉 건수에만 든다."""
    client, (a, b, c, _d) = dashboard_env
    set_industries(a, ["자동차 부품"])
    set_industries(b, ["방위산업", "자동차 부품"], source="CASE_FILE")
    record(client, a, contact("ABSENT", day="2026-10-15"))
    record(client, a, contact(day="2026-10-16", answers=NEGATIVE_CLAIM))
    record(client, b, contact(method="VISIT", day="2026-10-20", answers=POSITIVE_QUALITY))
    record(client, c, contact(method="EMAIL", day="2026-10-18", answers=NEUTRAL))
    body = reactions(client)
    data = body["data"]
    assert data["basis"] == {"minSampleForRatio": 10, "contactCount": 4, "answeredCount": 3}
    assert data["total"] == {
        "answeredCount": 3,
        "positive": 1,
        "neutral": 1,
        "negative": 1,
        "good": [{"answerId": "QUALITY_CERT", "count": 1}],
        "bad": [{"answerId": "CLAIM", "count": 1}],
    }
    # 산업은 설정 순서(방위산업 → 자동차 부품), 산업이 없는 회사(c)는 맨 끝 "미확정".
    assert [(row["industry"], group_numbers(row)) for row in data["byIndustry"]] == [
        ("방위산업", (1, 1, 0, 0)),
        ("자동차 부품", (2, 1, 0, 1)),
        ("미확정", (1, 0, 1, 0)),
    ]
    assert data["byIndustry"][1]["bad"] == [{"answerId": "CLAIM", "count": 1}]
    assert [(row["processCode"], group_numbers(row)) for row in data["byProcess"]] == [
        ("ANODIZING", (3, 1, 1, 1))
    ]
    assert set(data["byProcess"][0]) == {
        "processCode",
        "processName",
        "answeredCount",
        "positive",
        "neutral",
        "negative",
        "good",
        "bad",
    }
    names = {row["oppId"]: row["name"] for row in support.analysis(client)["data"]["companies"]}
    assert data["contacts"] == [
        {
            "oppId": b,
            "name": names[b],
            "day": "2026-10-20",
            "method": "VISIT",
            "reaction": "POSITIVE",
            "good": "QUALITY_CERT",
            "bad": None,
            "industries": ["방위산업", "자동차 부품"],
            "processCodes": ["ANODIZING"],
        },
        {
            "oppId": c,
            "name": names[c],
            "day": "2026-10-18",
            "method": "EMAIL",
            "reaction": "NEUTRAL",
            "good": None,
            "bad": None,
            "industries": [],
            "processCodes": ["ANODIZING"],
        },
        {
            "oppId": a,
            "name": names[a],
            "day": "2026-10-16",
            "method": "CALL",
            "reaction": "NEGATIVE",
            "good": None,
            "bad": "CLAIM",
            "industries": ["자동차 부품"],
            "processCodes": ["ANODIZING"],
        },
    ]
    assert body["meta"]["hasVirtualData"] is True
    assert body["meta"]["datasetKind"] == "VIRTUAL_REVIEWED"
    # 담당자 키가 있어도 같은 값이다(읽기 전용).
    assert reactions(client, headers={"X-Staff-Key": "park-lee"})["data"]["total"] == data["total"]


def test_api_counts_a_two_process_company_in_both_process_rows(dashboard_env):
    """Given 공정 둘이 확정된 회사의 부정적 접촉 1건 / When 조회
    / Then 공정 줄 둘에 모두 1건이고 전체에는 1건, 접촉 줄은 하나."""
    client, (a, *_rest) = dashboard_env
    support.confirm_second_process(a)
    record(client, a, contact(answers=NEGATIVE_CLAIM))
    data = reactions(client)["data"]
    assert [(row["processCode"], group_numbers(row)) for row in data["byProcess"]] == [
        ("ANODIZING", (1, 0, 0, 1)),
        ("CHROMATE", (1, 0, 0, 1)),
    ]
    assert group_numbers(data["total"]) == (1, 0, 0, 1)
    assert [row["processCodes"] for row in data["contacts"]] == [["ANODIZING", "CHROMATE"]]


def test_api_counts_only_confirmed_processes_and_industries(dashboard_env):
    """Given AI 제안 공정·AI 산업군만 붙은 회사 / When 조회
    / Then 분석표처럼 확정 값만 센다: 산업은 "미확정" 줄, 공정은 확정된 것만."""
    client, (a, *_rest) = dashboard_env
    support.propose_process(a, "CHROMATE")
    set_industries(a, ["반도체"], source="AI")
    record(client, a, contact(answers=NEUTRAL))
    data = reactions(client)["data"]
    assert [row["industry"] for row in data["byIndustry"]] == ["미확정"]
    assert [row["processCode"] for row in data["byProcess"]] == ["ANODIZING"]
    assert (data["contacts"][0]["industries"], data["contacts"][0]["processCodes"]) == (
        [],
        ["ANODIZING"],
    )


def test_api_period_counts_only_contacts_inside(dashboard_env):
    """Given 9월·10월·11월 접촉 / When 10월로 조회
    / Then 10월 접촉만 세고, 기간을 비우면 모두 센다."""
    client, (a, b, *_rest) = dashboard_env
    record(client, a, contact(day="2026-09-10", answers=POSITIVE_QUALITY))
    record(client, a, contact(day="2026-10-16", answers=NEGATIVE_CLAIM))
    record(client, a, contact("ABSENT", day="2026-10-17"))
    record(client, b, contact(day="2026-11-02", answers=NEUTRAL))
    october = reactions(client, "?from=2026-10-01&to=2026-10-31")["data"]
    assert october["basis"] == {"minSampleForRatio": 10, "contactCount": 2, "answeredCount": 1}
    assert group_numbers(october["total"]) == (1, 0, 0, 1)
    assert [(row["oppId"], row["day"]) for row in october["contacts"]] == [(a, "2026-10-16")]
    until = reactions(client, "?to=2026-10-16")["data"]
    assert [row["day"] for row in until["contacts"]] == ["2026-10-16", "2026-09-10"]
    since = reactions(client, "?from=2026-10-17")["data"]
    assert (since["basis"]["contactCount"], [row["oppId"] for row in since["contacts"]]) == (2, [b])
    everything = reactions(client)["data"]
    assert everything["basis"] == {"minSampleForRatio": 10, "contactCount": 4, "answeredCount": 3}


def test_api_rejects_bad_period_values_like_the_analysis_table(dashboard_env):
    """Given 날짜 모양이 아니거나 시작일이 끝일보다 뒤 / When 조회 / Then 400과 칸 이름."""
    client, _opp_ids = dashboard_env
    shape = client.get(f"{URL}?from=2026-13-01", headers=VIEWER)
    assert shape.status_code == 400, shape.text
    assert [field["path"] for field in shape.json()["error"]["fields"]] == ["from"]
    order = client.get(f"{URL}?from=2026-11-30&to=2026-11-01", headers=VIEWER)
    assert order.status_code == 400, order.text
    assert [field["path"] for field in order.json()["error"]["fields"]] == ["from", "to"]


def test_api_leaves_out_a_cancelled_contact_and_its_answers(dashboard_env):
    """Given 부정적(클레임) 접촉과 보통 접촉 / When 부정적 접촉을 잘못 입력으로 취소
    / Then 그 접촉과 답이 반응·접촉 건수에서 빠진다."""
    client, (a, *_rest) = dashboard_env
    record(client, a, contact(method="EMAIL", day="2026-10-16", answers=NEGATIVE_CLAIM))
    record(client, a, contact(day="2026-10-17", answers=NEUTRAL))
    before = reactions(client)["data"]
    assert group_numbers(before["total"]) == (2, 0, 1, 1)
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
    after = reactions(client)["data"]
    assert after["basis"] == {"minSampleForRatio": 10, "contactCount": 1, "answeredCount": 1}
    assert group_numbers(after["total"]) == (1, 0, 1, 0)
    assert after["total"]["bad"] == []
    assert [row["reaction"] for row in after["contacts"]] == ["NEUTRAL"]


def test_api_never_returns_memo_text_staff_or_contacts_and_saves_nothing(dashboard_env):
    """Given 한 줄 메모·영업 메모(연락처 포함)가 있는 회사 / When 조회
    / Then 응답에 메모 글·연락처·담당자 키가 없고, 저장·외부 전송 기록이 생기지 않는다."""
    client, (a, *_rest) = dashboard_env
    record(
        client,
        a,
        contact(memo="반응 표에 나가면 안 되는 한 줄 메모", answers=NEGATIVE_CLAIM),
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

    def saved_rows():
        with session_scope() as session:
            return tuple(
                session.scalar(select(func.count()).select_from(model))
                for model in (Outcome, Note, TransferLog)
            )

    before = saved_rows()
    response = client.get(URL, headers={"X-Staff-Key": "park-lee"})
    assert response.status_code == 200, response.text
    for secret in ("한 줄 메모", "010-0000-0000", "example.invalid", "park-lee", "클레임"):
        assert secret not in response.text
    row = response.json()["data"]["contacts"][0]
    assert set(row) == {
        "oppId",
        "name",
        "day",
        "method",
        "reaction",
        "good",
        "bad",
        "industries",
        "processCodes",
    }
    assert saved_rows() == before
    assert before[2] == 0  # 외부 전송 기록 없음


def test_api_gives_zero_when_the_question_file_has_no_reaction_question(dashboard_env, tmp_path):
    """Given 반응 답을 저장한 뒤 질문 파일에서 상대 반응 질문을 뺀 설정 / When 조회
    / Then 오류 없이 반응 건수가 모두 0이다(접촉 건수는 그대로)."""
    client, (a, *_rest) = dashboard_env
    record(client, a, contact(answers=NEGATIVE_CLAIM))
    assert reactions(client)["data"]["basis"]["answeredCount"] == 1
    yaml = YAML()
    document = yaml.load(EXAMPLE_QUESTIONS.read_text(encoding="utf-8"))
    document["questions"] = [
        question for question in document["questions"] if not question["id"].startswith("REACTION")
    ]
    without_reaction = tmp_path / "sales-questions-without-reaction.yaml"
    with without_reaction.open("w", encoding="utf-8") as handle:
        yaml.dump(document, handle)
    with session_scope() as session:
        session.get(AppSetting, "records").value = {"salesQuestionsFile": str(without_reaction)}
    data = reactions(client)["data"]
    assert data["basis"] == {"minSampleForRatio": 10, "contactCount": 1, "answeredCount": 0}
    assert group_numbers(data["total"]) == (0, 0, 0, 0)
    assert (data["byIndustry"], data["byProcess"], data["contacts"]) == ([], [], [])


def test_api_reads_the_sample_minimum_from_settings(dashboard_env):
    """Given 표본 기준을 2로 바꾼 설정 / When 조회 / Then 기준 숫자가 설정 값 그대로 온다."""
    client, _opp_ids = dashboard_env
    with session_scope() as session:
        session.get(AppSetting, "salesAnalysis").value = {
            "minSampleForRatio": 2,
            "closedWindowDays": 365,
        }
    assert reactions(client)["data"]["basis"]["minSampleForRatio"] == 2


def test_api_leaves_out_companies_the_analysis_table_leaves_out(dashboard_env):
    """Given 400일 전에 거절로 바뀐 회사와 실제 회사 표시인 회사 / When 가상 묶음으로 조회
    / Then 영업 분석표와 같은 회사만 센다(오래된 결과·다른 묶음 회사의 반응은 빠진다)."""
    client, (a, b, c, _d) = dashboard_env
    record(client, a, contact(answers=NEGATIVE_CLAIM))
    record(client, a, {"status": "LOST", "lostReasonCode": "PRICE"})
    record(client, b, contact(answers=POSITIVE_QUALITY))
    record(client, c, contact(answers=NEUTRAL))
    with session_scope() as session:
        for row in session.query(Outcome).filter(Outcome.opp_id == a):
            row.created_at = row.created_at - timedelta(days=400)
        opportunity = session.get(Opportunity, b)
        opportunity.is_virtual = False
        session.get(Customer, opportunity.customer_id).is_virtual = False
    data = reactions(client)["data"]
    assert [row["oppId"] for row in support.analysis(client)["data"]["companies"]] == [c]
    assert [row["oppId"] for row in data["contacts"]] == [c]
    assert data["basis"] == {"minSampleForRatio": 10, "contactCount": 1, "answeredCount": 1}
    assert group_numbers(data["total"]) == (1, 0, 1, 0)


def test_api_needs_the_access_session_when_protection_is_on(dashboard_env, monkeypatch):
    """Given 접속 보호가 켜짐 / When 접속 확인 없이 조회 / Then 401."""
    client, _ = dashboard_env
    monkeypatch.setenv("GEOSAN_PASSWORD", "virtual-test-password")
    with session_scope() as session:
        session.get(AppSetting, "accessProtection").value = {"enabled": True}
    with TestClient(create_app()) as fresh:
        assert fresh.get(URL).status_code == 401
