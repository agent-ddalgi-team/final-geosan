"""#744: 찾기 뒤 적합도 순 자동 조사 대기 줄(하루 금액은 관심 자동 조사와 함께 씀).

실제 파일·판단 저장·등록·평가·전송 기록은 실제 부품이다. 외부 AI 응답과 회사 한 곳 조사는
가짜로 바꾼다(실제 홈페이지 접속·AI 호출 없음). 회사 이름은 모두 가상이다(거산 실제 사양 아님).
"""

from datetime import timedelta
from decimal import Decimal
from pathlib import Path
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select

from geosan.api import auto_research
from geosan.api.app import create_app
from geosan.api.ingest_views import research_state
from geosan.capability.importer import import_capability
from geosan.config.app_settings import load_app_settings, read_app_settings, sync_app_settings
from geosan.config.errors import AppError
from geosan.evaluation.ledger import latest_confirmed_evaluation
from geosan.evidence.research_context import current_research, research_context
from geosan.evidence.transfer import TransferLog
from geosan.opportunity import candidate_pick
from geosan.opportunity.models import Customer, Opportunity
from geosan.opportunity.source_models import SourceContract, SourceFactoryRow
from geosan.records.models import Outcome, ReviewOpinion
from geosan.storage.base import new_id, utcnow
from geosan.storage.session import session_scope
from geosan.workflows import flow_ingest as flow
from geosan.workflows import research_queue
from geosan.workflows.research import ResearchResult
from tests.fakes.ingest_responses import FakeCandidateResponses, fake_supply_tier
from tests.unit.u3.test_flow_ingest import new_batch, saved

# 회사 이름 → (적합도, 표면처리를 직접 하는 회사 표시)
FITS = {
    "가상 일번사": ("MEDIUM", False),
    "가상 이번사": ("HIGH", False),
    "가상 삼번사": ("LOW", False),
    "가상 사번사": ("HIGH", True),
    "가상 오번사": ("MEDIUM", False),
}


@pytest.fixture
def queue_env(tmp_db, tmp_path, factory_file, monkeypatch):
    """적합도가 다른 가상 회사 다섯 곳이 든 공장 파일과 실제(가상 아님) 자료 묶음 설정."""
    import_capability(Path("examples/capability-geosan-brochure.json"))
    with session_scope() as session:
        session.add(
            SourceContract(
                source_id="kicox-factory-csv",
                source_name="가상 파일",
                allowed_use="검사",
                allowed_storage="검사",
                confirmed_at=utcnow().date(),
                is_virtual=True,
            )
        )
    rows = [
        [index, name, "가상단지", "가상 볼트", f"충청남도 당진시 가상길 {index}"]
        for index, name in enumerate(FITS, start=1)
    ]
    path = factory_file(rows).rename(tmp_path / "factories_20251231.csv")
    settings = load_app_settings(Path("examples/app-settings.yaml"))
    settings.ingestion.factory_csv_path = str(path)
    settings.ingestion.ai_pick.enabled = True
    settings.ingestion.ai_pick.exclude_keywords = []
    settings.llm.mode = "EXTERNAL"
    with session_scope() as session:
        sync_app_settings(session, settings)
    monkeypatch.setenv("OPENAI_API_KEY", "synthetic")
    monkeypatch.setattr(candidate_pick, "_post", FakeCandidateResponses())
    fake_supply_tier(monkeypatch)
    original = flow.pick_candidates

    def pick(batch_id, row_ids, **kwargs):
        judgments = original(batch_id, row_ids, **kwargs)
        with session_scope() as session:
            names = dict(
                session.execute(
                    select(SourceFactoryRow.row_id, SourceFactoryRow.company_name)
                ).all()
            )
        changed = []
        for judgment in judgments:
            fit, own = FITS[names[judgment.row_id]]
            changed.append(
                judgment.model_copy(
                    update={
                        "fit_level": fit,
                        "own_plating_line_suspected": own,
                        "own_plating_line_basis": "가상 근거" if own else None,
                    }
                )
            )
        return changed

    monkeypatch.setattr(flow, "pick_candidates", pick)
    calls = []

    def research(opp_id):
        context = current_research.get()
        requester = context.transfer_requester if context else None
        calls.append((name_of(opp_id), requester))
        cost = env.cost
        if cost is not None:
            with session_scope() as session:
                session.add(_call_row(opp_id, requester, cost))
        if env.errors:
            return ResearchResult(error=env.errors.pop(0))
        return ResearchResult()

    env = SimpleNamespace(calls=calls, cost=None, errors=[])
    monkeypatch.setattr(flow, "research_one", research)
    monkeypatch.setattr(auto_research, "research_one", research)
    auto_research.reset_queue_day()
    research_queue._started.clear()
    yield env
    auto_research.reset_queue_day()
    research_queue._started.clear()


def _call_row(opp_id, requester, cost):
    return TransferLog(
        transfer_log_id=new_id("transfer"),
        occurred_at=utcnow(),
        opp_id=opp_id,
        purpose="EXTERNAL_AI",
        kind="PUBLIC_TEXT",
        mode="EXTERNAL",
        security_grade="PUBLIC",
        decision="ALLOWED",
        requested_by=requester,
        call_count=1,
        cost_usd=Decimal(str(cost)),
    )


def name_of(opp_id):
    with session_scope() as session:
        return session.scalar(
            select(Customer.name)
            .join(Opportunity, Opportunity.customer_id == Customer.customer_id)
            .where(Opportunity.opp_id == opp_id)
        )


def opp_of(name):
    with session_scope() as session:
        return session.scalar(
            select(Opportunity.opp_id)
            .join(Customer, Opportunity.customer_id == Customer.customer_id)
            .where(Customer.name == name)
        )


def set_settings(**changes):
    with session_scope() as session:
        settings = read_app_settings(session)
        for key, value in changes.items():
            section, name = key.split("__")
            setattr(getattr(settings, section), name, value)
        sync_app_settings(session, settings)


def register(auto=True):
    """[영업 후보로 더하기] 한 번. auto=False면 자동 조사 스위치를 끈 채 등록만 한다."""
    set_settings(homepage_discovery__auto_research=auto)
    batch_id = new_batch(dataset="BROCHURE")
    flow.run_ingest(batch_id)
    set_settings(homepage_discovery__auto_research=True)
    return batch_id


def medium_in_list_order():
    with session_scope() as session:
        rows = session.execute(
            select(Opportunity, Customer)
            .join(Customer, Opportunity.customer_id == Customer.customer_id)
            .where(Customer.fit_level == "MEDIUM")
        ).all()
        rows.sort(key=lambda pair: research_queue.queue_order(pair[1], pair[0]))
        return [customer.name for _, customer in rows]


def auto_rows(name):
    with session_scope() as session:
        return session.execute(
            select(TransferLog.requested_by, TransferLog.decision, TransferLog.reject_reason)
            .where(TransferLog.opp_id == opp_of(name))
            .order_by(TransferLog.occurred_at)
        ).all()


def state_of(name):
    with session_scope() as session:
        customer = session.scalar(select(Customer).where(Customer.name == name))
        return research_state(customer, None, scored=False)


# ---------- 찾기 직후 ----------


def test_new_companies_are_researched_high_then_medium_without_low_or_own_plating(queue_env):
    """Given 적합도 상·중·하와 표면처리 직접 하는 회사 / When [영업 후보로 더하기]
    Then 상 → 중(같으면 목록 순서)으로만 조사하고, 하·표면처리 회사는 조사하지 않는다."""
    batch_id = register()
    assert [name for name, _ in queue_env.calls] == ["가상 이번사", *medium_in_list_order()]
    assert {requester for _, requester in queue_env.calls} == {"auto-ingest"}
    assert saved(batch_id).status == "DONE" and saved(batch_id).research_done_count == 3
    assert auto_rows("가상 삼번사") == [] and auto_rows("가상 사번사") == []
    assert state_of("가상 삼번사") == "NOT_TRIED"
    # 시작 표시 1행이 남는다(C4 auto-ingest).
    assert auto_rows("가상 이번사") == [("auto-ingest", "ALLOWED", None)]


def test_daily_amount_stops_the_queue_and_the_rest_wait_as_not_researched(queue_env):
    """Given 하루 금액 $0.05, 한 곳 $0.03 / When 찾기 / Then 두 곳만 조사, 남은 곳은 "조사 전"."""
    set_settings(research__auto_on_bookmark_daily_cost_usd=0.05)
    queue_env.cost = 0.03
    batch_id = register()
    first, second = medium_in_list_order()
    assert [name for name, _ in queue_env.calls] == ["가상 이번사", first]
    assert saved(batch_id).status == "DONE" and saved(batch_id).research_done_count == 2
    # 한도에 닿아 멈춘 회사에는 아무 행도 남기지 않는다(거부 행 없음 → 조사 전 그대로).
    assert auto_rows(second) == []
    assert state_of(second) == "NOT_TRIED"


def test_next_day_first_list_read_continues_the_queue_once(queue_env):
    """Given 어제 하루 금액에 닿아 한 곳이 남음 / When 다음 날 첫 목록 읽기
    Then 응답 뒤 남은 회사를 조사하고, 같은 날 두 번째 목록 읽기는 줄을 다시 돌리지 않는다."""
    set_settings(research__auto_on_bookmark_daily_cost_usd=0.05)
    queue_env.cost = 0.03
    register()
    left = medium_in_list_order()[1]
    with TestClient(create_app()) as client:
        # 같은 날: 금액이 남지 않아 조사하지 않는다.
        assert client.get("/api/v1/opportunities").status_code == 200
        assert len(queue_env.calls) == 2
        # 날짜를 바꿔 끼운다: 오늘 쓴 기록을 모두 어제로 옮긴다.
        with session_scope() as session:
            for row in session.scalars(select(TransferLog)):
                row.occurred_at = row.occurred_at - timedelta(days=1)
        auto_research.reset_queue_day()
        assert client.get("/api/v1/opportunities").status_code == 200
        assert [name for name, _ in queue_env.calls][-1] == left and len(queue_env.calls) == 3
        runs = []
        original = auto_research.run_waiting_queue
        auto_research.run_waiting_queue = lambda *a, **k: runs.append(1) or original(*a, **k)
        try:
            assert client.get("/api/v1/opportunities").status_code == 200
        finally:
            auto_research.run_waiting_queue = original
        assert runs == [] and len(queue_env.calls) == 3


def test_already_researched_or_started_companies_are_not_researched_again(queue_env):
    """Given 이미 조사한 회사와 관심 자동 조사가 시작한 회사 / Then 줄은 다른 회사만 조사한다."""
    register(auto=False)
    assert queue_env.calls == []
    first, second = medium_in_list_order()
    with session_scope() as session:
        customer = session.scalar(select(Customer).where(Customer.name == "가상 이번사"))
        customer.researched_at = utcnow()
        opportunity = session.get(Opportunity, opp_of(first))
        session.add(
            research_queue.start_marker(opportunity, requester=research_queue.BOOKMARK_REQUESTER)
        )
    run = auto_research.run_waiting_queue()
    assert [name for name, _ in queue_env.calls] == [second] and run.stopped == "EMPTY"
    # 한 번 조사한 회사는 다음 줄에서 다시 하지 않는다.
    assert auto_research.run_waiting_queue().researched == []


def test_switch_off_or_zero_amount_does_not_run_the_queue(queue_env):
    """Given 자동 조사 스위치 꺼짐, 또는 하루 금액 0 / Then 줄이 돌지 않고 흔적도 없다."""
    set_settings(homepage_discovery__auto_research=False)
    flow.run_ingest(new_batch(dataset="BROCHURE"))
    assert queue_env.calls == []
    assert research_queue.run_queue(lambda opp_id: None).stopped == "OFF"
    set_settings(
        homepage_discovery__auto_research=True, research__auto_on_bookmark_daily_cost_usd=0
    )
    assert auto_research.run_waiting_queue().stopped == "OFF"
    with TestClient(create_app()) as client:
        assert client.get("/api/v1/opportunities").status_code == 200
    assert queue_env.calls == []
    with session_scope() as session:
        assert (
            session.scalar(
                select(TransferLog).where(
                    TransferLog.requested_by.in_(research_queue.AUTO_REQUESTERS)
                )
            )
            is None
        )


def test_finished_companies_are_not_put_in_the_queue(queue_env):
    """Given 성사로 끝난 회사와 제외 의견 회사 / Then 줄은 그 회사를 조사하지 않는다."""
    register(auto=False)
    first, second = medium_in_list_order()
    with session_scope() as session:
        won = opp_of("가상 이번사")
        session.add(Outcome(outcome_id=new_id("outcome"), opp_id=won, status="WON", version=1))
        excluded = opp_of(first)
        session.add(
            ReviewOpinion(
                opinion_id=new_id("opinion"),
                opp_id=excluded,
                eval_id=latest_confirmed_evaluation(session, excluded).eval_id,
                opinion="NOT_TARGET",
                staff_name="가상 담당",
                recorded_at=utcnow(),
            )
        )
    auto_research.run_waiting_queue()
    assert [name for name, _ in queue_env.calls] == [second]


def test_queue_and_bookmark_share_one_daily_amount(queue_env):
    """Given 관심 자동 조사가 오늘 금액을 다 씀 / Then 줄은 멈춘다. 줄이 쓴 금액도 함께 센다."""
    register(auto=False)
    with session_scope() as session:
        session.add(_call_row(opp_of("가상 삼번사"), research_queue.BOOKMARK_REQUESTER, 1.0))
    assert auto_research.run_waiting_queue().stopped == "LIMIT" and queue_env.calls == []
    with session_scope() as session:
        session.add(_call_row(opp_of("가상 삼번사"), research_queue.QUEUE_REQUESTER, 0.5))
        llm = read_app_settings(session).llm
        assert auto_research.spent_today(session, llm) == Decimal("1.5")


def test_limit_or_setting_stop_pauses_and_the_company_is_tried_again(queue_env):
    """Given 월 한도로 조사가 멈춤 / Then 그 회사에 멈춤 1행을 남기고, 다음 줄에서 다시 조사한다."""
    register(auto=False)
    queue_env.errors = [AppError("이번 달 비용 한도 초과", "다음 달", kind="LLM_LIMIT")]
    run = auto_research.run_waiting_queue()
    assert run.stopped == "STOP" and [name for name, _ in queue_env.calls] == ["가상 이번사"]
    assert auto_rows("가상 이번사")[-1] == (
        "auto-ingest",
        "REJECTED",
        research_queue.PAUSED_REASON,
    )
    auto_research.run_waiting_queue()
    assert [name for name, _ in queue_env.calls][:2] == ["가상 이번사", "가상 이번사"]


def test_failed_company_is_recorded_and_the_queue_moves_on(queue_env):
    """Given 한 곳이 실패 / Then 그 회사에 실패 1행을 남기고 다음 회사로 간다(다시 하지 않음)."""
    register(auto=False)
    queue_env.errors = [AppError("가상 오류", "확인", kind="LLM_FAILED")]
    run = auto_research.run_waiting_queue()
    assert len(run.researched) == 3 and run.stopped == "EMPTY"
    assert auto_rows("가상 이번사")[-1][1:] == (
        "REJECTED",
        f"{research_queue.FAILURE_REASON} (LLM_FAILED)",
    )
    assert auto_research.run_waiting_queue().researched == []


def test_running_queue_shows_running_for_a_company_without_homepage(queue_env):
    """Given 대기 줄이 홈페이지 없는 회사를 방금 시작 / Then 카드 상태는 "조사 중"이다."""
    register(auto=False)
    with session_scope() as session:
        session.add(
            research_queue.start_marker(
                session.get(Opportunity, opp_of("가상 이번사")),
                requester=research_queue.QUEUE_REQUESTER,
            )
        )
    research_queue.mark_running("다른 회사")
    try:
        assert state_of("가상 이번사") == "RUNNING"
    finally:
        research_queue.unmark_running("다른 회사")
    assert state_of("가상 오번사") == "NOT_TRIED"


def test_inner_research_context_keeps_the_queue_requester():
    """대기 줄이 감싼 조사 안에서 요청자를 주지 않으면 바깥 요청자(auto-ingest)를 잇는다."""
    with research_context(research_queue.QUEUE_REQUESTER):
        with research_context() as inner:
            assert inner.transfer_requester == "auto-ingest"
        with research_context("auto-bookmark") as other:
            assert other.transfer_requester == "auto-bookmark"
    with research_context() as alone:
        assert alone.transfer_requester is None


def test_batch_done_with_unresearched_companies_is_not_running():
    """(바뀜 #744) 회차가 끝났고 "조사 n/m"이 덜 찼어도 도는 조사가 없으면 "조사 중"이 아니다."""
    customer = SimpleNamespace(
        researched_at=None, ingest_batch_id="batch-1", homepage_status=None, homepage_url=None
    )
    progress = SimpleNamespace(
        batch_id="batch-1", status="DONE", new_count=10, research_done_count=3
    )
    assert research_state(customer, progress, scored=False) == "NOT_TRIED"


def test_example_settings_keep_the_unofficial_page_switch_off():
    """#744: 공개 페이지 찾기는 보류. 예시 설정 세 벌 모두 꺼진 채다."""
    for name in ("app-settings.yaml", "app-settings-virtual.yaml", "app-settings-demo.yaml"):
        assert load_app_settings(Path("examples") / name).research.allow_unofficial_page is False
