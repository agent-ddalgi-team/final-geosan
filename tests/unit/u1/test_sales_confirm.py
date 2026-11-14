"""#652: 꼬리 질문에서 공정·산업을 확인하면 그 회사 값이 확정된다.

실제 임시 DB·실제 API로 본다. 외부 호출 없음.

가상 사례만 쓴다(거산 실제 사양 아님). AI 제안은 DB에 직접 넣어 흉내 낸다(실제 AI 호출 없음).
"""

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select

from geosan.api.app import create_app
from geosan.api.routes import records
from geosan.api.sales_confirm import confirm_processes
from geosan.capability.importer import import_capability
from geosan.evaluation.models import EvaluationRun
from geosan.opportunity.importer import import_case
from geosan.opportunity.models import Customer, Opportunity, OppProcessLink, Requirement
from geosan.records.models import Note, Outcome, OutcomeAnswer
from geosan.storage.base import new_id, utcnow
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


def superseded_codes(opp_id):
    """이력으로만 남은 공정 연결을 {(공정 코드, 출처)}로."""
    with session_scope() as session:
        rows = session.scalars(
            select(OppProcessLink).where(
                OppProcessLink.opp_id == opp_id, OppProcessLink.superseded_at.is_not(None)
            )
        )
        return {(row.process_code, row.source) for row in rows}


def evaluation_count(opp_id):
    with session_scope() as session:
        rows = session.scalars(select(EvaluationRun).where(EvaluationRun.opp_id == opp_id))
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
            "default": False,
        },
        {
            "answerId": "ANODIZING",
            "label": "아노다이징",
            "reaches": None,
            "closes": None,
            "lostReason": None,
            "default": False,
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


def test_confirmed_links_alone_count_as_an_answer_and_drop_the_proposals(confirm_env):
    """Given 사례 파일 확정 1 + AI 제안 2 / When 확정된 공정만 답함 / Then 제안이 빠지고 닫힌다."""
    client, _, mixed = confirm_env
    questions.save(client, mixed, questions.contact(answers=[("WHO_TALKED", "RIGHT_PERSON")]))
    assert PROCESS in detail(client, mixed)["records"]["salesStep"]["openQuestions"]
    body = questions.contact(answers=picks(["ANODIZING"]))
    response = support.post(client, mixed, "outcomes", body)
    assert response.status_code == 200, response.text
    assert response.json()["meta"]["reevaluated"] is True
    assert links(mixed) == {"ANODIZING": ("CASE_FILE", "CONFIRMED", None)}
    step = detail(client, mixed)["records"]["salesStep"]
    assert PROCESS not in step["openQuestions"]
    known = [row["answerId"] for row in step["known"] if row["questionId"] == PROCESS]
    assert known == ["ANODIZING"]


def test_choice_questions_stay_open_after_the_reached_step_until_answered(confirm_env):
    """Given "연결됨"을 지나 "수요 확인" / When 공정·산업 답이 없음 / Then 계속 묻는다."""
    client, ai_only, _ = confirm_env
    questions.save(client, ai_only, questions.contact(answers=[("WHO_TALKED", "RIGHT_PERSON")]))
    questions.save(client, ai_only, questions.contact(answers=[("PLATING_NOW", "OUTSOURCED")]))
    step = detail(client, ai_only)["records"]["salesStep"]
    assert step["code"] == "DEMAND_CONFIRMED"
    assert {PROCESS, INDUSTRY} <= set(step["openQuestions"])
    # 보통 질문은 지난 단계 것을 다시 묻지 않는다.
    assert "INTEREST" not in step["openQuestions"]
    questions.save(client, ai_only, questions.contact(answers=picks(["ZINC_PLATING"])))
    step = detail(client, ai_only)["records"]["salesStep"]
    assert PROCESS not in step["openQuestions"] and INDUSTRY in step["openQuestions"]


def test_cancelling_the_contact_reopens_the_question_but_keeps_the_confirmation(confirm_env):
    """Given 공정을 확정한 접촉 / When 그 접촉을 취소 / Then 답은 빠지고 확정은 그대로.

    지금 동작을 그대로 적어 둔 검사다(#253 취소는 재평가·되돌리기를 하지 않는다).
    """
    client, ai_only, _ = confirm_env
    questions.save(client, ai_only, questions.contact(answers=picks(["ZINC_PLATING"], ["반도체"])))
    with session_scope() as session:
        outcome_id = session.scalar(select(Outcome.outcome_id).where(Outcome.opp_id == ai_only))
    response = client.post(
        f"/api/v1/opportunities/{ai_only}/records/{outcome_id}/cancel",
        json={},
        headers={"X-Staff-Key": "park-lee"},
    )
    assert response.status_code == 200, response.text
    assert links(ai_only) == {"ZINC_PLATING": ("STAFF", "CONFIRMED", "park-lee")}
    assert industries(ai_only) == (["반도체"], "STAFF", True)
    assert detail(client, ai_only)["records"]["salesStep"]["known"] == []


def failing_evaluation(monkeypatch):
    monkeypatch.setattr(records, "evaluate_in_session", lambda *_: FlowResult(ok=False))


# ---------- #719(PM 결정 2026-11-14): 확인된 값을 바꾼 저장은 "변경"으로 남긴다 ----------


def _notes(opp_id):
    with session_scope() as session:
        rows = session.scalars(select(Note).where(Note.opp_id == opp_id).order_by(Note.version))
        return [row.text for row in rows]


def _answer(client, opp_id, **chosen):
    response = support.post(client, opp_id, "outcomes", questions.contact(answers=picks(**chosen)))
    assert response.status_code == 200, response.text


def test_changing_a_confirmed_industry_is_recorded_as_a_change(confirm_env):
    """Given 담당자가 확정한 산업 / When 다른 산업을 골라 저장 / Then "산업 변경 · 옛 → 새"."""
    client, ai_only, _ = confirm_env
    _answer(client, ai_only, industry=["방위산업", "기계·설비"])
    _answer(client, ai_only, industry=["기계·설비"])
    assert _notes(ai_only) == [
        "꼬리 질문으로 산업 확정 · 방위산업, 기계·설비",
        "산업 변경 · 방위산업, 기계·설비 → 기계·설비",
    ]
    assert industries(ai_only) == (["기계·설비"], "STAFF", True)


def test_changing_a_case_file_industry_is_recorded_as_a_change(confirm_env):
    """Given 사례 파일에서 온 산업(확인된 값) / When 다른 산업을 고름 / Then 변경으로 남는다."""
    client, _, mixed = confirm_env
    with session_scope() as session:
        customer = session.get(Customer, session.get(Opportunity, mixed).customer_id)
        customer.industries, customer.industries_source = ["방위산업"], "CASE_FILE"
    _answer(client, mixed, industry=["반도체"])
    assert _notes(mixed)[-1] == "산업 변경 · 방위산업 → 반도체"
    assert industries(mixed) == (["반도체"], "STAFF", True)


def test_first_confirmation_of_ai_industries_keeps_the_old_sentence(confirm_env):
    """Given AI가 제안한 산업뿐 / When 처음 확정 / Then 지금 문장 그대로(변경이 아니다)."""
    client, ai_only, _ = confirm_env
    _answer(client, ai_only, industry=["방위산업"])
    assert _notes(ai_only) == ["꼬리 질문으로 산업 확정 · 방위산업"]


def test_adding_a_process_to_a_company_with_a_confirmed_one_is_recorded_as_a_change(
    confirm_env,
):
    """Given 확정 공정 1개 + AI 제안 2개 / When 확정 공정도 함께 고름 / Then 둘 다 남는다.

    (바뀜 2026-11-14 #720) 예전에는 안 고른 확정 공정도 남았다. 이제 남기려면 함께 골라야 한다.
    """
    client, _, mixed = confirm_env
    _answer(client, mixed, processes=["ZINC_PLATING", "ANODIZING"])
    assert links(mixed)["ANODIZING"][:2] == ("CASE_FILE", "CONFIRMED")
    assert links(mixed)["ZINC_PLATING"][:2] == ("STAFF", "CONFIRMED")
    assert _notes(mixed) == [
        "공정 변경 · 아노다이징 → 아연도금(전기아연도금), 아노다이징 · AI 제안 1개 뺌"
    ]


# ---------- #720(PM 결정 2026-11-14): 통화에서 공정을 바꿀 수 있다 ----------


def test_leaving_out_a_confirmed_process_replaces_it_and_keeps_the_row_as_history(confirm_env):
    """Given 사례 파일 확정 공정 A + AI 제안 2개 / When B만 고름 / Then B만 남고 A는 이력으로."""
    client, _, mixed = confirm_env
    rows, evaluations = all_link_rows(mixed), evaluation_count(mixed)
    response = support.post(
        client, mixed, "outcomes", questions.contact(answers=picks(["ZINC_PLATING"]))
    )
    assert response.status_code == 200, response.text
    assert response.json()["meta"]["reevaluated"] is True
    assert links(mixed) == {"ZINC_PLATING": ("STAFF", "CONFIRMED", "park-lee")}
    assert ("ANODIZING", "CASE_FILE") in superseded_codes(mixed)
    assert all_link_rows(mixed) == rows + 1
    assert evaluation_count(mixed) == evaluations + 1
    assert _notes(mixed) == ["공정 변경 · 아노다이징 → 아연도금(전기아연도금) · AI 제안 1개 뺌"]
    data = detail(client, mixed)
    assert [row["processCode"] for row in data["processLinks"]] == ["ZINC_PLATING"]
    known = [row["answerId"] for row in data["records"]["salesStep"]["known"]]
    assert known == ["ZINC_PLATING"]


def test_a_staff_confirmed_process_can_be_replaced_too(confirm_env):
    """Given 담당자가 확정한 공정 A / When 다음 통화에서 B만 고름 / Then B만 남는다."""
    client, ai_only, _ = confirm_env
    _answer(client, ai_only, processes=["ZINC_PLATING"])
    _answer(client, ai_only, processes=["CHROMATE"])
    assert links(ai_only) == {"CHROMATE": ("STAFF", "CONFIRMED", "park-lee")}
    assert ("ZINC_PLATING", "STAFF") in superseded_codes(ai_only)
    assert _notes(ai_only)[-1] == "공정 변경 · 아연도금(전기아연도금) → 크로메이트"
    # 되돌리면 옛 행을 되살리지 않고 새 확정 행을 만든다(이력은 그대로 쌓인다).
    _answer(client, ai_only, processes=["ZINC_PLATING"])
    assert links(ai_only) == {"ZINC_PLATING": ("STAFF", "CONFIRMED", "park-lee")}
    assert _notes(ai_only)[-1] == "공정 변경 · 크로메이트 → 아연도금(전기아연도금)"


def test_an_empty_process_list_changes_nothing(confirm_env):
    """Given 확정 공정이 있는 회사 / When 공정을 안 고름 / Then 확정 공정은 그대로다(0개 안 됨)."""
    client, _, mixed = confirm_env
    with session_scope() as session:
        result = confirm_processes(
            session, session.get(Opportunity, mixed), [], {}, staff="park-lee", now=utcnow()
        )
    assert (result.summary, result.links_changed) == (None, False)
    assert links(mixed)["ANODIZING"][:2] == ("CASE_FILE", "CONFIRMED")
    _answer(client, mixed, industry=["반도체"])
    assert links(mixed)["ANODIZING"][:2] == ("CASE_FILE", "CONFIRMED")


def test_failed_reevaluation_cancels_the_process_change(confirm_env, monkeypatch):
    """Given 다시 평가가 실패 / When 확정 공정을 바꿈 / Then 접촉 기록까지 취소, 공정은 그대로."""
    client, _, mixed = confirm_env
    before = links(mixed)
    failing_evaluation(monkeypatch)
    response = support.post(
        client, mixed, "outcomes", questions.contact(answers=picks(["ZINC_PLATING"]))
    )
    assert response.status_code == 500
    assert links(mixed) == before and outcome_count(mixed) == 0


def test_importing_the_case_file_again_brings_its_processes_back(confirm_env, tmp_path):
    """한계(약속에 적음): 사례 파일을 다시 넣으면 통화에서 바꾼 공정이 사례 파일 값으로 돌아간다."""
    client, _, mixed = confirm_env
    _answer(client, mixed, processes=["ZINC_PLATING"])
    case = factories.apjeong_renamed_customer("case-confirm-2", "B금속(가상)")
    assert import_case(_write(tmp_path, "b-again.json", case)).opp_id == mixed
    assert set(links(mixed)) == {"ANODIZING"}
    assert links(mixed)["ANODIZING"][:2] == ("CASE_FILE", "CONFIRMED")


def test_dropping_only_ai_proposals_keeps_the_old_sentence(confirm_env):
    """Given 확정 공정 1개 + AI 제안 2개 / When 확정된 공정만 다시 고름 / Then 변경이 아니다."""
    client, _, mixed = confirm_env
    _answer(client, mixed, processes=["ANODIZING"])
    assert _notes(mixed) == ["꼬리 질문으로 공정 확정 · 아노다이징 · AI 제안 2개 뺌"]


def test_first_confirmation_of_ai_processes_keeps_the_old_sentence(confirm_env):
    """Given AI 제안뿐인 회사 / When 처음 확정 / Then 지금 문장 그대로."""
    client, ai_only, _ = confirm_env
    _answer(client, ai_only, processes=["ZINC_PLATING"])
    assert len(_notes(ai_only)) == 1
    assert _notes(ai_only)[0].startswith("꼬리 질문으로 공정 확정 · 아연도금(전기아연도금)")
