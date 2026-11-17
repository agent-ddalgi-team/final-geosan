"""#627: 대시보드 공정·산업군 막대(`breakdown`)를 실제 기록에서 집계한다.

실제 임시 DB와 API로 확인한다. 회사는 모두 소개서 묶음 형식의 시험용 가상 회사다
(거산 실제 사양 아님). 외부 AI 호출은 없다.
"""

from datetime import timedelta

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select

from geosan.api.app import create_app
from geosan.capability.importer import import_capability
from geosan.config.app_settings import read_app_settings
from geosan.config.models import AppSetting
from geosan.config.registry import set_active_dataset_kind
from geosan.dashboard.queries import BREAKDOWN_STATUSES, UNCONFIRMED_INDUSTRY, _ratio
from geosan.opportunity.importer import import_case
from geosan.opportunity.models import Customer, Opportunity
from geosan.records.models import Outcome
from geosan.storage.base import utcnow
from geosan.storage.session import session_scope
from geosan.workflows.flow_evaluate import run_evaluation
from tests import factories
from tests.unit.u1.test_snapshot_ledger import _write
from tests.unit.u7.test_bookmark import MINE, give_opinion, set_bookmark
from tests.unit.u7.test_dashboard import record

PROCESS_CODES = [row["code"] for row in factories.brochure_capability_file()["processes"]]


def add_company(tmp_path, name, *, processes=("ANODIZING",), industries=()):
    """소개서 묶음 형식의 가상 회사 한 곳을 넣고 기회 번호를 돌려준다.

    사례의 요구 조건이 아노다이징에 묶여 있어 아노다이징은 늘 넣고 다른 공정을 더한다.
    """
    case = factories.brochure_case(f"breakdown-{name}")
    link = case["processLinks"][0]
    case["processLinks"] = [{**link, "processCode": code} for code in processes]
    case["customer"]["industries"] = list(industries)
    return import_case(_write(tmp_path, f"{name}.json", case)).opp_id


def mark_industries_as_ai(opp_id):
    """AI가 제안하고 아직 사람이 확정하지 않은 산업군으로 바꾼다."""
    with session_scope() as session:
        customer_id = session.get(Opportunity, opp_id).customer_id
        session.get(Customer, customer_id).industries_source = "AI"


def age_outcomes(opp_id, days):
    """그 기회의 영업 기록 저장 시각을 `days`일 전으로 옮긴다(오래된 성사 재현)."""
    with session_scope() as session:
        for row in session.scalars(select(Outcome).where(Outcome.opp_id == opp_id)):
            row.created_at = utcnow() - timedelta(days=days)


def set_count_proposed(value):
    with session_scope() as session:
        session.get(AppSetting, "dashboard").value = {"countProposedIndustries": value}


def breakdown_of(client):
    response = client.get("/api/v1/dashboard", headers=MINE)
    assert response.status_code == 200, response.text
    return response.json()["data"]["breakdown"]


def process_counts(breakdown):
    return {row["processCode"]: row["count"] for row in breakdown["byProcess"]}


def industry_rows(breakdown):
    return {row["industry"]: row for row in breakdown["byIndustry"]}


@pytest.fixture
def brochure_env(tmp_db, tmp_path):
    """소개서 묶음으로 바꾸고 역량 파일만 넣은 상태. 회사는 검사마다 넣는다."""
    import_capability(_write(tmp_path, "brochure-cap.json", factories.brochure_capability_file()))
    with session_scope() as session:
        set_active_dataset_kind(session, "BROCHURE")
    return tmp_path


@pytest.fixture
def breakdown_env(brochure_env):
    """회사 9곳: 대상 4곳(관심·접촉·견적/샘플·최근 성사)과 대상이 아닌 5곳."""
    tmp_path = brochure_env
    ids = {
        # 대상
        "interested": add_company(tmp_path, "interested", industries=["방위산업"]),
        "contact": add_company(
            tmp_path,
            "contact",
            processes=("ANODIZING", "ZINC_PLATING"),
            industries=["방위산업", "반도체"],
        ),
        "sample": add_company(tmp_path, "sample", processes=("ANODIZING", "CHROMATE")),
        "won": add_company(tmp_path, "won"),
        # 대상 아님
        "won-old": add_company(tmp_path, "won-old", industries=["항공우주"]),
        "hold": add_company(tmp_path, "hold", industries=["항공우주"]),
        "lost": add_company(tmp_path, "lost", industries=["항공우주"]),
        "untouched": add_company(tmp_path, "untouched", industries=["항공우주"]),
        "excluded": add_company(tmp_path, "excluded", industries=["항공우주"]),
    }
    assert run_evaluation().ok
    mark_industries_as_ai(ids["contact"])
    with TestClient(create_app()) as client:
        assert set_bookmark(client, ids["interested"], True).status_code == 200
        record(client, ids["contact"], {"status": "IN_PROGRESS"})
        record(client, ids["sample"], {"status": "SAMPLE_OR_REGISTRATION_APPROVED"})
        record(client, ids["won"], {"status": "WON"})
        record(client, ids["won-old"], {"status": "WON"})
        age_outcomes(ids["won-old"], 366)
        record(client, ids["hold"], {"status": "ON_HOLD"})
        record(client, ids["lost"], {"status": "LOST", "lostReasonCode": "PRICE"})
        # 검토 대상 제외로 저장하면 관심이 꺼진다(#536). 그 뒤 단계를 적어도 대상이 아니다.
        assert set_bookmark(client, ids["excluded"], True).status_code == 200
        give_opinion(client, ids["excluded"], "NOT_TARGET")
        record(client, ids["excluded"], {"status": "IN_PROGRESS"})
        yield client, ids


def test_only_dashboard_targets_are_counted(breakdown_env):
    """Given 9곳 / When 조회 / Then 관심·진행 중·최근 12개월 성공 4곳만 대상이다."""
    client, _ = breakdown_env
    breakdown = breakdown_of(client)
    assert breakdown["basis"] == {"statuses": list(BREAKDOWN_STATUSES), "total": 4}
    assert breakdown["basis"]["statuses"] == [
        "INTERESTED",
        "IN_PROGRESS",
        "SAMPLE_OR_REGISTRATION_APPROVED",
        "WON_LAST_12M",
    ]
    # 대상이 아닌 5곳에만 적은 산업군(항공우주)은 0이다.
    assert industry_rows(breakdown)["항공우주"]["count"] == 0


def test_won_counts_only_within_365_days(breakdown_env):
    """Given 성사 2곳 / When 한 곳은 365일째, 한 곳은 366일째 / Then 365일 안만 센다."""
    client, ids = breakdown_env
    age_outcomes(ids["won"], 364)
    assert breakdown_of(client)["basis"]["total"] == 4
    age_outcomes(ids["won"], 366)
    assert breakdown_of(client)["basis"]["total"] == 3


def test_won_date_is_when_it_became_won_not_a_later_edit(breakdown_env):
    """Given 오래된 성사에 일정만 새로 적음 / When 조회 / Then 여전히 12개월 이전 성공이다."""
    client, ids = breakdown_env
    record(client, ids["won-old"], {"status": "WON", "nextScheduleNote": "가상 후속 메모"})
    assert breakdown_of(client)["basis"]["total"] == 4


def test_every_process_is_listed_in_capability_order_and_counted_each(breakdown_env):
    """Given 공정 2개인 회사 / When 조회 / Then 9종 전부(0 포함) 역량 파일 순서, 각각 센다."""
    client, _ = breakdown_env
    breakdown = breakdown_of(client)
    assert [row["processCode"] for row in breakdown["byProcess"]] == PROCESS_CODES
    assert len(breakdown["byProcess"]) == 9
    assert all(row["processName"] for row in breakdown["byProcess"])
    # 아노다이징은 대상 4곳 모두, 아연도금은 contact, 크로메이트는 sample. 두 공정인 회사는 양쪽에.
    assert process_counts(breakdown) == {
        **dict.fromkeys(PROCESS_CODES, 0),
        "ANODIZING": 4,
        "ZINC_PLATING": 1,
        "CHROMATE": 1,
    }
    ratios = {row["processCode"]: row["ratio"] for row in breakdown["byProcess"]}
    assert ratios["ANODIZING"] == 1 and ratios["ZINC_PLATING"] == 0.25
    assert ratios["PASSIVATION"] == 0
    assert sum(ratios.values()) > 1  # 여러 공정이면 각각 세므로 합이 1을 넘을 수 있다


def test_industries_follow_settings_order_then_unconfirmed(breakdown_env):
    """Given 산업군 있는 2곳·없는 2곳 / When 조회 / Then 설정 순서 + 맨 끝 미확정."""
    client, _ = breakdown_env
    breakdown = breakdown_of(client)
    with session_scope() as session:
        configured = read_app_settings(session).industries
    names = [row["industry"] for row in breakdown["byIndustry"]]
    assert names == [*configured, UNCONFIRMED_INDUSTRY] and names[-1] == "미확정"
    rows = industry_rows(breakdown)
    assert (rows["방위산업"]["count"], rows["방위산업"]["ratio"]) == (2, 0.5)
    assert (rows["반도체"]["count"], rows["반도체"]["ratio"]) == (1, 0.25)
    assert (rows["미확정"]["count"], rows["미확정"]["ratio"]) == (2, 0.5)


def test_includes_proposed_marks_only_bars_with_ai_values(breakdown_env):
    """Given AI 제안 회사 1곳 / When 조회 / Then 그 회사가 든 막대에만 AI 제안 포함 표시."""
    client, _ = breakdown_env
    rows = industry_rows(breakdown_of(client))
    assert rows["방위산업"]["includesProposed"] is True  # 사람이 적은 1곳 + AI 제안 1곳
    assert rows["반도체"]["includesProposed"] is True
    assert rows["항공우주"]["includesProposed"] is False
    assert rows["미확정"]["includesProposed"] is False


def test_turning_off_proposed_counts_only_confirmed(breakdown_env):
    """Given AI 제안 회사 1곳 / When 설정을 끔 / Then 그 회사는 미확정으로 가고 표시도 없다."""
    client, _ = breakdown_env
    set_count_proposed(False)
    breakdown = breakdown_of(client)
    rows = industry_rows(breakdown)
    assert breakdown["basis"]["total"] == 4
    assert rows["방위산업"]["count"] == 1 and rows["반도체"]["count"] == 0
    assert rows["미확정"]["count"] == 3
    assert not any(row["includesProposed"] for row in breakdown["byIndustry"])
    set_count_proposed(True)
    assert industry_rows(breakdown_of(client))["방위산업"]["count"] == 2


def test_no_targets_returns_zero_without_dividing(brochure_env):
    """Given 관심 기업 없음 / When 조회 / Then 대상 0곳, 9종·산업군 모두 0, 오류 없음."""
    add_company(brochure_env, "untouched")
    assert run_evaluation().ok
    with TestClient(create_app()) as client:
        breakdown = breakdown_of(client)
    assert breakdown["basis"]["total"] == 0
    assert len(breakdown["byProcess"]) == 9
    assert {row["count"] for row in breakdown["byProcess"]} == {0}
    assert {row["ratio"] for row in breakdown["byProcess"]} == {0}
    assert {(row["count"], row["ratio"]) for row in breakdown["byIndustry"]} == {(0, 0)}
    assert breakdown["byIndustry"][-1]["industry"] == "미확정"


@pytest.mark.parametrize(
    "count,total,expected",
    [
        (0, 0, 0.0),
        (3, 0, 0.0),
        (1, 8, 0.13),
        (3, 8, 0.38),
        (1, 3, 0.33),
        (2, 3, 0.67),
        (5, 4, 1.25),
    ],
)
def test_ratio_is_two_decimals_rounding_half_up(count, total, expected):
    """Given 건수·대상 수 / When 비율 / Then 소수 2자리(0.5 올림), 대상 0이면 0."""
    assert _ratio(count, total) == expected


def test_virtual_dataset_has_no_breakdown(tmp_db, tmp_path):
    """Given 가상 묶음의 관심 기업 / When 조회 / Then 가상 사례는 세지 않으므로 막대 없음(null)."""
    import_capability(_write(tmp_path, "cap.json", factories.capability_file()))
    opp_id = import_case(_write(tmp_path, "a.json", factories.apjeong_case())).opp_id
    assert run_evaluation().ok
    with TestClient(create_app()) as client:
        assert set_bookmark(client, opp_id, True).status_code == 200
        response = client.get("/api/v1/dashboard", headers=MINE)
    assert response.json()["data"]["counts"]["BOOKMARKED"] == 1
    assert response.json()["data"]["breakdown"] is None
    assert response.json()["meta"]["hasVirtualData"] is True


def test_old_settings_copy_without_dashboard_key_still_works(breakdown_env):
    """Given 대시보드 설정 칸이 없는 옛 DB 사본 / When 조회 / Then 서버가 켜지고 AI 제안을 센다."""
    client, _ = breakdown_env
    with session_scope() as session:
        session.delete(session.get(AppSetting, "dashboard"))
    with session_scope() as session:
        assert session.get(AppSetting, "dashboard") is None
        assert read_app_settings(session).dashboard.count_proposed_industries is True
    rows = industry_rows(breakdown_of(client))
    assert rows["방위산업"]["count"] == 2 and rows["방위산업"]["includesProposed"] is True


def test_breakdown_carries_no_contacts_or_memos(breakdown_env):
    """Given 메모가 있는 대상 회사 / When 조회 / Then 막대에는 공정·산업군 이름과 숫자뿐이다."""
    client, ids = breakdown_env
    secret = "막대에 나오면 안 되는 가상 메모"
    response = client.post(
        f"/api/v1/opportunities/{ids['contact']}/notes", json={"text": secret}, headers=MINE
    )
    assert response.status_code == 200, response.text
    breakdown = breakdown_of(client)
    assert secret not in str(breakdown)
    assert {key for row in breakdown["byProcess"] for key in row} == {
        "processCode",
        "processName",
        "count",
        "ratio",
    }
    assert {key for row in breakdown["byIndustry"] for key in row} == {
        "industry",
        "count",
        "ratio",
        "includesProposed",
    }
