"""#652: 꼬리 질문에서 공정·산업을 확인하면 그 회사 값이 확정된다.

실제 임시 DB·실제 API로 본다. 외부 호출 없음.

가상 사례만 쓴다(거산 실제 사양 아님). AI 제안은 DB에 직접 넣어 흉내 낸다(실제 AI 호출 없음).
"""

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select

from geosan.api.app import create_app
from geosan.api.routes import records
from geosan.capability.importer import import_capability
from geosan.opportunity.importer import import_case
from geosan.opportunity.models import Customer, Opportunity, OppProcessLink, Requirement
from geosan.records.models import Note, Outcome, OutcomeAnswer
from geosan.storage.base import new_id
from geosan.storage.session import session_scope
from geosan.workflows.flow_evaluate import run_evaluation
from geosan.workflows.models import FlowResult
from tests import factories
from tests.unit.u1 import test_sales_questions as questions
from tests.unit.u1 import test_sales_records as support
from tests.unit.u1.test_snapshot_ledger import _write

PROCESS = "CONFIRM_PROCESS"
INDUSTRY = "CONFIRM_INDUSTRY"
AI_INDUSTRIES = ["반도체", "기계·설비"]


def add_ai_links(session, opp_id, codes):
    opportunity = session.get(Opportunity, opp_id)
    for code in codes:
        session.add(
            OppProcessLink(
                link_id=new_id("link"),
                opp_id=opp_id,
                process_code=code,
                current_reason="가상 AI 제안",
                source="AI",
                state="PENDING",
                dataset_kind=opportunity.dataset_kind,
                is_virtual=opportunity.is_virtual,
                created_by="system",
            )
        )


def links(opp_id):
    """지금 살아 있는 공정 연결을 {공정 코드: (출처, 상태, 확정자)}로."""
    with session_scope() as session:
        return {
            row.process_code: (row.source, row.state, row.confirmed_by)
            for row in session.scalars(
                select(OppProcessLink).where(
                    OppProcessLink.opp_id == opp_id, OppProcessLink.superseded_at.is_(None)
                )
            )
        }


def all_link_rows(opp_id):
    with session_scope() as session:
        rows = session.scalars(select(OppProcessLink).where(OppProcessLink.opp_id == opp_id))
        return len(list(rows))


def industries(opp_id):
    with session_scope() as session:
        customer = session.get(Customer, session.get(Opportunity, opp_id).customer_id)
        return (
            list(customer.industries or []),
            customer.industries_source,
            customer.industries_confirmed_at is not None,
        )


def outcome_count(opp_id):
    with session_scope() as session:
        return len(list(session.scalars(select(Outcome).where(Outcome.opp_id == opp_id))))


def detail(client, opp_id):
    return client.get(f"/api/v1/opportunities/{opp_id}").json()["data"]


def analysis(client):
    return client.get("/api/v1/sales-analysis").json()["data"]


def picks(processes=(), industry=()):
    return [(PROCESS, code) for code in processes] + [(INDUSTRY, name) for name in industry]


@pytest.fixture
def confirm_env(tmp_db, tmp_path):
    """두 회사: ai_only = AI 제안뿐(공정 3·산업군 2), mixed = 사례 파일 확정 1 + AI 제안 2."""
    import_capability(_write(tmp_path, "cap.json", factories.capability_file()))
    ai_only = import_case(_write(tmp_path, "a.json", factories.apjeong_case())).opp_id
    case = factories.apjeong_renamed_customer("case-confirm-2", "B금속(가상)")
    mixed = import_case(_write(tmp_path, "b.json", case)).opp_id
    with session_scope() as session:
        # 사례 파일 연결을 AI 제안으로 바꿔 "담당자가 확정한 것이 없는 회사"를 만든다.
        for row in session.scalars(select(OppProcessLink).where(OppProcessLink.opp_id == ai_only)):
            row.source, row.state, row.confirmed_at = "AI", "PENDING", None
        for row in session.scalars(select(Requirement).where(Requirement.opp_id == ai_only)):
            row.link_id = None
        add_ai_links(session, ai_only, ["ZINC_PLATING", "CHROMATE"])
        add_ai_links(session, mixed, ["ZINC_PLATING", "CHROMATE"])
        customer = session.get(Customer, session.get(Opportunity, ai_only).customer_id)
        customer.industries, customer.industries_source = list(AI_INDUSTRIES), "AI"
    assert run_evaluation().ok
    with TestClient(create_app()) as client:
        yield client, ai_only, mixed


def test_sales_questions_fill_choices_from_process_list_and_settings(confirm_env):
    """Given 질문 파일의 choices 질문 / When 질문 묶음 조회 / Then 보기는 공정 목록·설정 산업군."""
    client, _, _ = confirm_env
    data = client.get("/api/v1/sales-questions").json()["data"]
    by_id = {row["questionId"]: row for row in data["questions"]}
    process = by_id[PROCESS]
    assert (process["choices"], process["step"]) == ("PROCESS", "REACHED")
    assert process["answers"][:2] == [
        {
            "answerId": "ZINC_PLATING",
            "label": "아연도금(전기아연도금)",
            "reaches": None,
            "closes": None,
            "lostReason": None,
        },
        {
            "answerId": "ANODIZING",
            "label": "아노다이징",
            "reaches": None,
            "closes": None,
            "lostReason": None,
        },
    ]
    assert len(process["answers"]) == 9
    settings = client.get("/api/v1/config/ui").json()["data"]["ingestOptions"]["industries"]
    assert [row["answerId"] for row in by_id[INDUSTRY]["answers"]] == settings
    assert by_id[INDUSTRY]["choices"] == "INDUSTRY"
    assert by_id["PLATING_NOW"]["choices"] is None


def test_new_process_without_proposal_becomes_staff_link(confirm_env):
    """Given AI가 제안하지 않은 공정 / When 그 공정을 고름 / Then 담당자 출처 새 연결이 생긴다."""
    client, ai_only, _ = confirm_env
    body = questions.contact(answers=picks(["PASSIVATION", "ANODIZING"]))
    response = support.post(client, ai_only, "outcomes", body)
    assert response.status_code == 200, response.text
    assert response.json()["meta"]["reevaluated"] is True
    assert links(ai_only) == {
        "ANODIZING": ("STAFF", "CONFIRMED", "park-lee"),
        "PASSIVATION": ("STAFF", "CONFIRMED", "park-lee"),
    }
    # 산업 질문에는 답하지 않았으므로 AI 산업군은 그대로다.
    assert industries(ai_only) == (AI_INDUSTRIES, "AI", False)
    known = detail(client, ai_only)["records"]["salesStep"]["known"]
    assert [(row["questionId"], row["answerId"], row["answer"]) for row in known] == [
        (PROCESS, "PASSIVATION", "부동태"),
        (PROCESS, "ANODIZING", "아노다이징"),
    ]


def test_industry_only_answer_does_not_reevaluate(confirm_env):
    """Given AI 산업군 / When 산업만 고름 / Then 산업만 확정되고 다시 평가하지 않는다."""
    client, ai_only, _ = confirm_env
    before = detail(client, ai_only)["evalId"]
    body = questions.contact(answers=picks(industry=["기계·설비", "방위산업"]))
    response = support.post(client, ai_only, "outcomes", body)
    assert response.status_code == 200, response.text
    assert response.json()["meta"].get("reevaluated") is None
    # 고른 순서가 아니라 설정 순서로 저장한다.
    assert industries(ai_only) == (["방위산업", "기계·설비"], "STAFF", True)
    assert detail(client, ai_only)["evalId"] == before
    assert len(links(ai_only)) == 3
    with session_scope() as session:
        note = session.scalar(select(Note).where(Note.opp_id == ai_only))
        assert note.text == "꼬리 질문으로 산업 확정 · 방위산업, 기계·설비"


@pytest.mark.parametrize(
    "answers,index,message",
    [
        (picks(["ZINC_PLATING", "ZINC_PLATING"]), 1, "같은 보기를 두 번 골랐습니다."),
        (
            picks(industry=["반도체", "방위산업", "항공우주", "기타"]),
            3,
            "산업군은 3개까지 고를 수 있습니다.",
        ),
        (
            picks(industry=["없는 산업"]),
            0,
            "질문 목록에 없는 질문이나 보기입니다. 화면을 새로 고쳐 주세요.",
        ),
    ],
)
def test_wrong_choice_answers_are_rejected_and_nothing_changes(
    confirm_env, answers, index, message
):
    client, ai_only, _ = confirm_env
    before = (links(ai_only), industries(ai_only))
    response = support.post(client, ai_only, "outcomes", questions.contact(answers=answers))
    assert response.status_code == 400, response.text
    fields = response.json()["error"]["fields"]
    assert fields == [{"path": f"answers[{index}]", "message": message}]
    assert (links(ai_only), industries(ai_only)) == before
    assert outcome_count(ai_only) == 0


def test_choice_answers_are_rejected_on_declined_contact(confirm_env):
    """Given 접촉 결과 거절 / When 공정을 고름 / Then 모든 단계 질문만 받는 기존 규칙대로 거부."""
    client, ai_only, _ = confirm_env
    body = questions.contact(result="DECLINED", answers=picks(["ZINC_PLATING"]))
    response = support.post(client, ai_only, "outcomes", body)
    assert response.status_code == 400
    assert len(links(ai_only)) == 3


def test_answering_again_with_same_values_changes_nothing(confirm_env):
    """Given 이미 확정한 공정·산업 / When 같은 값으로 다시 답함 / Then 연결·이력이 늘지 않는다."""
    client, ai_only, _ = confirm_env
    body = questions.contact(answers=picks(["ZINC_PLATING"], ["반도체"]))
    questions.save(client, ai_only, body)
    rows, evaluation = all_link_rows(ai_only), detail(client, ai_only)["evalId"]
    response = support.post(client, ai_only, "outcomes", body)
    assert response.status_code == 200, response.text
    assert response.json()["meta"].get("reevaluated") is None
    assert all_link_rows(ai_only) == rows
    assert detail(client, ai_only)["evalId"] == evaluation
    with session_scope() as session:
        assert len(list(session.scalars(select(Note).where(Note.opp_id == ai_only)))) == 1
        answers = session.scalars(select(OutcomeAnswer).where(OutcomeAnswer.opp_id == ai_only))
        assert len(list(answers)) == 4


def failing_evaluation(monkeypatch):
    monkeypatch.setattr(records, "evaluate_in_session", lambda *_: FlowResult(ok=False))
