"""#677: 사람이 확정한 공정과 다른 AI 공정 제안을 물리치기([확정 값 유지])와 다시 붙이지 않기.

실제 임시 DB·실제 API로 본다. 외부 호출 없음. 가상 사례만 쓴다(거산 실제 사양 아님).
"""

from types import SimpleNamespace

from sqlalchemy import select

from geosan.evaluation.proposals import store_process_link_proposals
from geosan.opportunity.models import Opportunity, OppProcessLink
from geosan.records.models import Note, ReviewCheck
from geosan.storage.base import utcnow
from geosan.storage.session import session_scope
from tests.unit.u1 import test_sales_confirm as support

confirm_env = support.confirm_env
STAFF = {"X-Staff-Key": "park-lee"}
CODES = {"ANODIZING", "ZINC_PLATING", "CHROMATE", "ELECTROPOLISHING"}


def check(client, opp_id, item_id, **body):
    values = {"checked": False, "evalId": support.detail(client, opp_id)["evalId"], **body}
    return client.post(
        f"/api/v1/opportunities/{opp_id}/review-items/{item_id}/check", json=values, headers=STAFF
    )


def written(opp_id):
    with session_scope() as session:
        return (
            len(list(session.scalars(select(Note).where(Note.opp_id == opp_id)))),
            len(list(session.scalars(select(ReviewCheck).where(ReviewCheck.opp_id == opp_id)))),
        )


def propose(opp_id, *codes):
    """AI가 다시 조사에서 이 공정들을 제안했다고 치고 저장 함수를 그대로 부른다."""
    result = SimpleNamespace(
        process_link_proposals=[
            SimpleNamespace(process_code=code, basis="가상 근거", quote="가상 인용")
            for code in codes
        ]
    )
    with session_scope() as session:
        return store_process_link_proposals(
            session,
            session.get(Opportunity, opp_id),
            result,
            allowed_codes=CODES,
            requested_by="system",
        )


def test_keeping_confirmed_value_drops_only_that_proposal_and_leaves_a_record(confirm_env):
    """Given 확정 1 + AI 제안 2 / When 하나에 확정 값 유지 / Then 그 제안만 빠지고 기록이 남는다."""
    client, _, mixed = confirm_env
    before_eval = support.detail(client, mixed)["evalId"]
    rows = support.all_link_rows(mixed)
    response = check(client, mixed, "PL:ZINC_PLATING")
    assert response.status_code == 200, response.text
    assert response.json()["data"]["checked"] is False
    assert response.json()["meta"]["reevaluated"] is True
    links = support.links(mixed)
    assert set(links) == {"ANODIZING", "CHROMATE"}
    assert links["ANODIZING"][:2] == ("CASE_FILE", "CONFIRMED")
    assert links["CHROMATE"][:2] == ("AI", "PENDING")
    assert support.all_link_rows(mixed) == rows  # 지운 행은 없다
    assert support.detail(client, mixed)["evalId"] != before_eval
    assert written(mixed) == (1, 1)
    with session_scope() as session:
        note = session.scalar(select(Note).where(Note.opp_id == mixed))
        # 가상 묶음의 공정 이름에는 "— 가상"이 붙는다.
        assert note.text == "AI 공정 제안 물리침 · 확정 값 유지 · 아연도금(전기아연도금) — 가상"
        assert note.staff_key == "park-lee"
        row = session.scalar(select(ReviewCheck).where(ReviewCheck.opp_id == mixed))
        assert (row.item_id, row.checked, row.staff_key) == ("PL:ZINC_PLATING", False, "park-lee")


def test_company_without_confirmed_process_cannot_drop_a_proposal(confirm_env):
    """Given 확정한 공정이 없는 회사 / When AI 제안 해제 / Then 지금처럼 400, 바뀐 것 없음."""
    client, ai_only, _ = confirm_env
    response = check(client, ai_only, "PL:ZINC_PLATING")
    assert response.status_code == 400, response.text
    assert support.links(ai_only)["ZINC_PLATING"][:2] == ("AI", "PENDING")
    assert written(ai_only) == (0, 0)


def test_keeping_confirmed_value_rejects_a_step_label(confirm_env):
    client, _, mixed = confirm_env
    response = check(client, mixed, "PL:ZINC_PLATING", stepLabel="해당")
    assert response.status_code == 400, response.text
    assert support.links(mixed)["ZINC_PLATING"][:2] == ("AI", "PENDING")
    assert written(mixed) == (0, 0)


def test_already_dropped_proposal_is_not_found(confirm_env):
    client, _, mixed = confirm_env
    assert check(client, mixed, "PL:ZINC_PLATING").status_code == 200
    assert check(client, mixed, "PL:ZINC_PLATING").status_code == 404
    assert written(mixed) == (1, 1)


def test_research_never_brings_back_a_dropped_proposal_or_touches_confirmed(confirm_env):
    """Given 물리친 제안 / When 다시 조사가 같은·확정·새 공정을 제안 / Then 새 공정만 붙는다."""
    client, _, mixed = confirm_env
    assert check(client, mixed, "PL:ZINC_PLATING").status_code == 200
    confirmed = support.links(mixed)["ANODIZING"]
    assert propose(mixed, "ZINC_PLATING", "ANODIZING", "CHROMATE", "ELECTROPOLISHING") == 1
    links = support.links(mixed)
    assert set(links) == {"ANODIZING", "CHROMATE", "ELECTROPOLISHING"}
    assert links["ANODIZING"] == confirmed
    assert links["ELECTROPOLISHING"][:2] == ("AI", "PENDING")


def test_proposal_dropped_in_follow_up_question_is_not_brought_back(confirm_env):
    """Given 꼬리 질문에서 안 골라 빠진 AI 제안(#652) / When 다시 조사 / Then 다시 붙지 않는다."""
    _, ai_only, _ = confirm_env
    with session_scope() as session:
        row = session.scalar(
            select(OppProcessLink).where(
                OppProcessLink.opp_id == ai_only,
                OppProcessLink.process_code == "CHROMATE",
                OppProcessLink.superseded_at.is_(None),
            )
        )
        row.superseded_at = utcnow()
    assert propose(ai_only, "CHROMATE") == 0
    assert "CHROMATE" not in support.links(ai_only)
