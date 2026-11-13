"""#549 2단계: 누르기 전 예상 금액·이번 달 사용액·잠금, 접수·명령 거부, 회차 금액 기록.

실제 임시 DB와 가상 AI 답만 쓴다(외부 호출 없음). 단가·한도는 설정에서 읽으므로 검사마다
설정 사본을 바꿔 계산이 설정을 따르는지 본다. 가상 공장 2곳(충남 아산 볼트·당진 운송).
"""

from datetime import timedelta
from decimal import Decimal

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select

from geosan.api.app import create_app
from geosan.api.ingest_views import latest_ingest
from geosan.config.registry import load_runtime_config
from geosan.evidence.transfer import TransferLog
from geosan.opportunity.candidate_web import load_search_context
from geosan.opportunity.ingest_preview import ingest_budget
from geosan.opportunity.models import IngestBatch
from geosan.opportunity.source_models import WebSearchRun
from geosan.storage.base import utcnow
from geosan.storage.session import session_scope
from tests.unit.u3.test_candidate_pick import pick_context as pick_context
from tests.unit.u3.test_candidate_pick import setting
from tests.unit.u3.test_ingest_api import FakeFinder
from tests.unit.u3.test_ingest_preview import judged as judged
from tests.unit.u3.test_ingest_tables import _insert_filled
from tests.unit.u3.test_judgment_store import public_rows as public_rows

PREVIEW = "/api/v1/ingest/preview"
INGEST = "/api/v1/ingest"
CONDITIONS = {"processCodes": "ZINC_PLATING", "regions": "충남"}
BODY = {"processCodes": ["ZINC_PLATING"], "regions": ["충남"]}
STAFF = {"X-Staff-Key": "park-lee"}
PRICES = {
    "judgeUsdPerRow": 0.002,
    "researchUsdPerCompany": 0.04,
    "researchCallsPerCompany": 2,
    "webSearchUsdPerBatch": 0.04,
}


def configure(*, auto_research=True, cost_limit=20.0, call_limit=1000, rows_per_call=None):
    """예상 금액에 쓰는 설정만 검사용 값으로 맞춘다. 단가는 약속의 초기값과 같다."""
    setting("ingestion", costEstimate=PRICES, maxCandidates=50)
    if rows_per_call is not None:
        with session_scope() as session:
            pick = load_runtime_config(session).app_settings.ingestion.ai_pick
            changed = pick.model_dump(by_alias=True) | {"rowsPerCall": rows_per_call}
        setting("ingestion", aiPick=changed)
    setting("homepageDiscovery", autoResearch=auto_research)
    setting("llm", monthlyCostLimitUsd=cost_limit, monthlyCallLimit=call_limit)


def finish_fixture_batch():
    """검사 준비용 회차를 끝낸 상태로 둔다(실행 중 회차가 있으면 접수가 409가 된다)."""
    with session_scope() as session:
        batch = session.get(IngestBatch, "batch-test")
        batch.status = "DONE"
        batch.finished_at = utcnow()


def budget(*, rejudge=False, industries=()):
    with session_scope() as session:
        settings = load_runtime_config(session).app_settings
        return ingest_budget(
            session,
            process_codes=["ZINC_PLATING"],
            regions=["충남"],
            industries=list(industries),
            max_candidates=settings.ingestion.max_candidates,
            settings=settings,
            rejudge=rejudge,
        )


def add_log(*, cost, opp_id=None, batch_id="batch-test", at=None, calls=1):
    with session_scope() as session:
        session.add(
            TransferLog(
                transfer_log_id=f"transfer-{utcnow().timestamp()}-{cost}-{opp_id}",
                occurred_at=at or utcnow(),
                opp_id=opp_id,
                batch_id=batch_id,
                purpose="EXTERNAL_AI",
                kind="PUBLIC_TEXT",
                mode="EXTERNAL",
                security_grade="PUBLIC",
                decision="ALLOWED",
                call_count=calls,
                cost_usd=None if cost is None else Decimal(str(cost)),
            )
        )


def test_judged_region_estimates_only_research_and_reads_month_from_logs(judged):
    """Given 판단이 끝난 지역(더할 곳 1) / When 예상을 센다
    / Then 판단 몫 0, 조사 1곳분만. 이번 달 사용액은 판단 때 남은 전송 기록 2건의 합이다."""
    configure()
    result = budget()
    estimate = result.estimate
    assert (estimate.judge_rows, estimate.judge_calls, estimate.judge_usd) == (0, 0, 0.0)
    assert (estimate.research_count, estimate.research_calls) == (1, 2)
    assert (estimate.research_usd, estimate.web_search_usd, estimate.total_usd) == (0.04, 0.0, 0.04)
    month = result.month
    assert (month.used_usd, month.used_calls) == (0.008, 2)
    assert (month.limit_usd, month.limit_calls) == (20.0, 1000)
    assert result.blocked is None


def test_unjudged_region_adds_judgment_cost_and_rounds_calls_up(pick_context):
    """Given 판단 전 공장 2곳 / When 예상을 센다
    / Then 판단 2행 몫을 더하고, 더할 곳은 최대 건수(50)로 잡는다. 호출 수는 묶음 크기로 올림."""
    configure()  # 묶음 1행(준비 값)
    estimate = budget().estimate
    assert (estimate.judge_rows, estimate.judge_calls, estimate.judge_usd) == (2, 2, 0.004)
    assert (estimate.research_count, estimate.research_calls, estimate.research_usd) == (
        50,
        100,
        2.0,
    )
    assert estimate.total_usd == 2.004
    configure(rows_per_call=20)
    assert budget().estimate.judge_calls == 1


def test_auto_research_off_means_no_research_cost(pick_context):
    """Given 자동 조사를 끈 설정 / When 예상을 센다 / Then 조사 몫은 0이고 판단 몫만 남는다."""
    configure(auto_research=False)
    estimate = budget().estimate
    assert (estimate.research_count, estimate.research_calls, estimate.research_usd) == (0, 0, 0.0)
    assert estimate.total_usd == estimate.judge_usd == 0.004


def test_prices_come_from_settings(pick_context):
    """Given 단가를 바꾼 설정 / When 예상을 센다 / Then 바뀐 단가로 계산한다(코드에 숫자 없음)."""
    configure(auto_research=False)
    setting("ingestion", costEstimate=PRICES | {"judgeUsdPerRow": 0.5})
    assert budget().estimate.judge_usd == 1.0


def test_web_search_cost_only_when_enabled_and_no_stored_result(judged):
    """Given 웹 후보 검색을 켠 설정 / When 같은 조건의 저장 결과가 없다 → 있다
    / Then 없을 때만 웹 검색 1회분을 더한다. 꺼져 있으면 0."""
    configure(auto_research=False)
    assert budget().estimate.web_search_usd == 0.0
    setting("candidateWebSearch", enabled=True, blockedDomains=["example.com"])
    assert budget().estimate.web_search_usd == 0.04
    criteria = {"processCodes": ["ZINC_PLATING"], "regions": ["충남"], "industries": []}
    with session_scope() as session:
        draft = IngestBatch(
            batch_id="preview",
            status="RUNNING",
            criteria=criteria,
            max_candidates=50,
            dataset_kind="VIRTUAL_REVIEWED",
            is_virtual=True,
        )
        context = load_search_context("preview", session=session, batch=draft)
        now = utcnow()
        session.add(
            WebSearchRun(
                run_id="websearch-stored",
                criteria=criteria,
                criteria_hash=context.criteria_hash,
                searched_at=now - timedelta(hours=1),
                expires_at=now + timedelta(days=1),
                result_count=0,
                dropped_count=0,
                requested_by="park-lee",
                dataset_kind="VIRTUAL_REVIEWED",
                is_virtual=True,
            )
        )
    stored = budget().estimate
    assert (stored.web_search_usd, stored.total_usd) == (0.0, 0.0)
    # 조건이 다르면 저장 결과를 못 쓰므로 다시 1회분이 든다.
    assert budget(industries=["반도체"]).estimate.web_search_usd == 0.04


def test_month_counts_unconfirmed_call_with_configured_estimate(judged):
    """Given 사용량을 못 받은 호출 1건 / When 이번 달 사용액을 센다
    / Then 설정의 추정 비용(llm.unconfirmedCallCostUsd)으로 쳐서 더한다(전송 보호와 같은 계산)."""
    configure()
    setting("llm", unconfirmedCallCostUsd=0.25)
    add_log(cost=None)
    month = budget().month
    assert (month.used_usd, month.used_calls) == (0.258, 3)


def test_over_cost_locks_and_reports_rows_that_still_fit(pick_context):
    """Given 남은 금액 $0.003 / When 판단 전 2곳($0.004) / Then OVER_COST, 1곳까지 판단 가능."""
    configure(auto_research=False, cost_limit=0.003)
    blocked = budget().blocked
    assert (blocked.kind, blocked.judgeable_rows) == ("OVER_COST", 1)


def test_judgeable_rows_never_goes_below_zero(pick_context):
    """Given 조사 몫($2.00)만으로 한도($1)를 넘음 / When 센다 / Then 판단 가능 수는 0(음수 아님)."""
    configure(cost_limit=1.0)
    blocked = budget().blocked
    assert (blocked.kind, blocked.judgeable_rows) == ("OVER_COST", 0)


def test_over_calls_locks_when_only_call_limit_is_exceeded(pick_context):
    """Given 남은 호출 1회 / When 판단 2회가 필요 / Then OVER_CALLS, 남은 1회로 1곳(묶음 1행)."""
    configure(auto_research=False, call_limit=1)
    blocked = budget().blocked
    assert (blocked.kind, blocked.judgeable_rows) == ("OVER_CALLS", 1)


def test_rejudge_counts_every_row_in_region(judged):
    """Given 판단이 끝난 지역 / When 다시 판단(명령 --rejudge)으로 센다
    / Then 저장된 판단을 안 쓰므로 고른 지역의 공장 2곳 전체가 판단 몫이다."""
    configure(auto_research=False)
    assert budget().estimate.judge_rows == 0
    assert budget(rejudge=True).estimate.judge_rows == 2


def test_api_adds_estimate_month_and_lock(pick_context):
    """Given 판단 전 2곳·한도 $1 / When 창구를 부른다
    / Then estimate 8칸·month 4칸·blocked가 camelCase로 온다."""
    configure(cost_limit=1.0)
    with TestClient(create_app()) as client:
        data = client.get(PREVIEW, params=CONDITIONS).json()["data"]
    assert data["unjudgedCount"] == 2
    assert data["estimate"] == {
        "judgeRows": 2,
        "judgeCalls": 2,
        "judgeUsd": 0.004,
        "researchCount": 50,
        "researchCalls": 100,
        "researchUsd": 2.0,
        "webSearchUsd": 0.0,
        "totalUsd": 2.004,
    }
    assert data["month"] == {"usedUsd": 0.0, "limitUsd": 1.0, "usedCalls": 0, "limitCalls": 1000}
    assert data["blocked"] == {"kind": "OVER_COST", "judgeableRows": 0}


def test_api_without_conditions_returns_month_only(judged):
    """Given 전송 기록 2건 / When 조건 없이 부른다([다시 조사]·[붙여넣고 조사]용)
    / Then month만 채우고 나머지는 null이다. 외부 호출·저장은 없다."""
    configure()
    with TestClient(create_app()) as client:
        response = client.get(PREVIEW)
    assert response.status_code == 200
    data = response.json()["data"]
    assert data.pop("month") == {
        "usedUsd": 0.008,
        "limitUsd": 20.0,
        "usedCalls": 2,
        "limitCalls": 1000,
    }
    assert set(data) == {
        "matchedCount",
        "fitCounts",
        "registeredCount",
        "addableCount",
        "addableHighCount",
        "unjudgedCount",
        "addCount",
        "estimate",
        "blocked",
    }
    assert all(value is None for value in data.values())
    with session_scope() as session:
        assert len(session.scalars(select(TransferLog)).all()) == 2


def test_post_over_budget_is_rejected_and_creates_no_batch(pick_context):
    """Given 예상이 한도를 넘는 조건 / When 화면 잠금을 거치지 않고 접수를 요청한다
    / Then 422 INGEST_OVER_BUDGET, 회차는 만들어지지 않고 찾기도 불리지 않는다."""
    configure(cost_limit=1.0)
    finish_fixture_batch()
    finder = FakeFinder()
    with TestClient(create_app(ingest_runner=finder)) as client:
        response = client.post(INGEST, json=BODY, headers=STAFF)
    assert response.status_code == 422
    error = response.json()["error"]
    assert error["kind"] == "INGEST_OVER_BUDGET"
    assert error["message"] == "이번 달 남은 AI 금액을 넘습니다"
    assert error["nextAction"] == "시·군을 골라 나눠 진행해 주세요"
    assert finder.calls == []
    with session_scope() as session:
        assert [row.batch_id for row in session.scalars(select(IngestBatch))] == ["batch-test"]


def test_accepted_batch_keeps_estimate_and_old_batch_stays_null(judged):
    """Given 한도 안의 조건 / When 접수한다 / Then 새 회차에 예상 금액($0.04)을 남긴다.
    이 칸이 생기기 전의 옛 회차는 비어 있다."""
    configure()
    finish_fixture_batch()
    finder = FakeFinder()
    with TestClient(create_app(ingest_runner=finder)) as client:
        response = client.post(INGEST, json=BODY, headers=STAFF)
    assert response.status_code == 200, response.text
    with session_scope() as session:
        new = session.get(IngestBatch, response.json()["data"]["batchId"])
        assert new.estimated_usd == 0.04
        assert session.get(IngestBatch, "batch-test").estimated_usd is None


def test_latest_ingest_reports_estimate_and_actual_cost(judged):
    """Given 회차의 판단 기록 2건($0.008) + 그 회차로 들어온 회사의 자동 조사 기록
    / When 마지막 회차 요약을 읽는다
    / Then 실제 금액 = 회차 기록 + 회차 동안의 조사 기록(빈 기록은 추정 비용).
    회차가 끝난 뒤의 [다시 조사]와 다른 회사의 기록은 넣지 않는다."""
    configure()
    setting("llm", unconfirmedCallCostUsd=0.1)
    with session_scope() as session:
        # 준비용 회차의 조건을 실제 접수 때와 같은 세 칸으로 맞춘다.
        session.get(IngestBatch, "batch-test").criteria = {
            "processCodes": ["ZINC_PLATING"],
            "regions": ["충남"],
            "industries": [],
        }
        con = session.connection().connection.driver_connection
        for customer, opp, batch in (
            ("cust-new", "opp-new", "batch-test"),
            ("c-old", "o-old", None),
        ):
            _insert_filled(
                con, "opp_customer", customer_id=customer, name=customer, ingest_batch_id=batch
            )
            _insert_filled(con, "opp_opportunity", opp_id=opp, customer_id=customer)
    add_log(cost=0.03, opp_id="opp-new", batch_id=None)
    add_log(cost=None, opp_id="opp-new", batch_id=None)
    add_log(cost=0.5, opp_id="o-old", batch_id=None)
    with session_scope() as session:
        old = latest_ingest(session, "VIRTUAL_REVIEWED")
        assert old.estimated_usd is None
        assert old.actual_usd == 0.138
    finish_fixture_batch()
    add_log(cost=0.07, opp_id="opp-new", batch_id=None, at=utcnow() + timedelta(minutes=5))
    with session_scope() as session:
        session.get(IngestBatch, "batch-test").estimated_usd = 0.2
    with session_scope() as session:
        done = latest_ingest(session, "VIRTUAL_REVIEWED")
        assert (done.estimated_usd, done.actual_usd) == (0.2, 0.138)
        dumped = done.model_dump(by_alias=True)
        assert (dumped["estimatedUsd"], dumped["actualUsd"]) == (0.2, 0.138)


@pytest.mark.parametrize("missing", ["costEstimate"])
def test_old_settings_copy_without_new_key_still_reads(judged, missing):
    """Given #549 전에 만든 DB의 설정 사본(costEstimate 없음) / When 예상을 센다
    / Then 서버가 멈추지 않고 예시 파일 값으로 읽는다(#591과 같은 방식)."""
    from geosan.config.models import AppSetting

    with session_scope() as session:
        row = session.get(AppSetting, "ingestion")
        row.value = {key: value for key, value in row.value.items() if key != missing}
    setting("homepageDiscovery", autoResearch=True)
    with session_scope() as session:
        prices = load_runtime_config(session).app_settings.ingestion.cost_estimate
        # 예시 파일의 웹 검색 단가는 검색 3번 기준 0.11이다(PM 결정 2026-11-13 #706).
        assert prices.model_dump(by_alias=True) == PRICES | {"webSearchUsdPerBatch": 0.11}
    assert budget().estimate.research_usd == 0.04
