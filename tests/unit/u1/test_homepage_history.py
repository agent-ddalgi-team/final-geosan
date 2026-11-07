"""#304 PM 결정: 주소 변경 기록과 주소를 함께 저장하고 조사 실패 뒤에도 보존한다."""

from unittest.mock import Mock

import pytest
from sqlalchemy import event, select
from sqlalchemy.orm import Session

from geosan.config.errors import AppError
from geosan.opportunity.models import Customer
from geosan.records.models import Note
from geosan.storage.session import session_scope
from geosan.workflows import flow_extract
from tests.unit.u1 import test_homepage_api as support

search_env = support.search_env
extract_env = support.extract_env
homepage_env = support.homepage_env
CHANGED = "https://example.org/corrected-company"


def notes(env):
    with session_scope() as session:
        return session.scalars(
            select(Note).where(Note.opp_id == env[1].opp_id).order_by(Note.version)
        ).all()


def test_address_history_keeps_previous_note_and_uses_next_version(homepage_env):
    """Given 기존 메모 / When 주소 변경 / Then 이전·새 주소를 다음 기록으로 남긴다."""
    client, case, transport = homepage_env
    path = f"/api/v1/opportunities/{case.opp_id}/notes"
    response = client.post(
        path, json={"text": "기존 가상 메모"}, headers={"X-Staff-Key": "park-lee"}
    )
    assert response.status_code == 200
    previous = notes(homepage_env)[0]
    response = support.post(homepage_env, {"url": CHANGED})
    assert response.status_code == 200, response.text
    old, changed = notes(homepage_env)
    assert (old.note_id, old.text, old.version) == (
        previous.note_id,
        previous.text,
        previous.version,
    )
    assert (changed.kind, changed.version, changed.staff_key, changed.created_by) == (
        "RESEARCH",
        2,
        "park-lee",
        "park-lee",
    )
    assert changed.text == f"홈페이지 주소 변경 · 이전 {support.URL} · 새 {CHANGED}"
    assert changed.created_at.tzinfo is not None
    with session_scope() as session:
        customer = session.get(Customer, case.customer_id)
        assert changed.dataset_kind == customer.dataset_kind
        assert changed.is_virtual == customer.is_virtual
    activity = client.get(f"/api/v1/opportunities/{case.opp_id}/activity").json()["data"]
    assert any(row["kind"] == "NOTE" and changed.text in row["summary"] for row in activity)
    assert changed.text not in str(transport.call_args_list)
    response = client.post(
        path, json={"text": "다음 가상 메모"}, headers={"X-Staff-Key": "park-lee"}
    )
    assert response.status_code == 200 and response.json()["data"]["version"] == 3


@pytest.mark.parametrize("fault", ["reader", "ai_response", "evaluation"])
def test_address_history_survives_research_failure(homepage_env, monkeypatch, fault):
    """Given 기존 조사 / When 주소 변경 뒤 실패 / Then 변경 이력과 기존 조사를 보존한다."""
    assert support.post(homepage_env, {}).status_code == 200
    saved = support.saved_research(homepage_env)
    if fault == "reader":
        monkeypatch.setattr(
            flow_extract,
            "fetch",
            Mock(side_effect=AppError("읽기 실패", "다시 조사해 주세요.", 422, "UNREACHABLE")),
        )
    elif fault == "ai_response":
        answer = support.support.answer()
        answer["evidence"][0]["quote"] = "본문에 없는 문장입니다."
        homepage_env[2].side_effect = lambda *_: support.support.reply(answer)
    else:
        monkeypatch.setattr(
            flow_extract, "evaluate_in_session", Mock(side_effect=RuntimeError("test failure"))
        )
    response = support.post(homepage_env, {"url": CHANGED})
    assert response.status_code == {"reader": 422, "ai_response": 503, "evaluation": 500}[fault]
    assert support.saved_research(homepage_env) == saved
    (row,) = notes(homepage_env)
    assert row.text == f"홈페이지 주소 변경 · 이전 {support.URL} · 새 {CHANGED}"
    assert row.kind == "RESEARCH" and row.version == 1


def test_retry_same_address_does_not_duplicate_history(homepage_env, monkeypatch):
    """Given 주소 변경 뒤 실패 / When 같은 주소 재시도 / Then 변경 기록은 한 줄이다."""
    monkeypatch.setattr(
        flow_extract,
        "fetch",
        Mock(side_effect=AppError("읽기 실패", "다시 조사해 주세요.", 422, "UNREACHABLE")),
    )
    for body in ({"url": CHANGED}, {}, {"url": CHANGED}, {"confirmOnly": True}):
        response = support.post(homepage_env, body)
        assert response.status_code == (200 if body.get("confirmOnly") else 422)
    (row,) = notes(homepage_env)
    assert row.version == 1 and support.URL in row.text and CHANGED in row.text


def test_same_address_and_confirmation_create_no_history(homepage_env):
    assert support.post(homepage_env, {"confirmOnly": True}).status_code == 200
    assert support.post(homepage_env, {"url": support.URL}).status_code == 200
    assert notes(homepage_env) == []


@pytest.mark.parametrize("staff", [None, "viewer"])
def test_rejected_staff_creates_no_address_history(homepage_env, staff):
    assert support.post(homepage_env, {"url": CHANGED}, staff=staff).status_code == 403
    assert notes(homepage_env) == [] and homepage_env[2].call_count == 0


def test_private_case_creates_no_address_history(homepage_env):
    with session_scope() as session:
        session.get(Customer, homepage_env[1].customer_id).security_grade = "INTERNAL_ONLY"
    assert support.post(homepage_env, {"url": CHANGED}).status_code == 422
    assert notes(homepage_env) == [] and homepage_env[2].call_count == 0


def test_history_save_failure_rolls_back_address_before_external_call(homepage_env):
    """Given 기록 저장 실패 / When 주소 변경 / Then 주소도 되돌리고 조사를 시작하지 않는다."""

    def fail_note(session, _context, _instances):
        if any(isinstance(row, Note) for row in session.new):
            raise RuntimeError("test history save failure")

    event.listen(Session, "before_flush", fail_note)
    try:
        response = support.post(homepage_env, {"url": CHANGED})
    finally:
        event.remove(Session, "before_flush", fail_note)
    assert response.status_code == 500 and homepage_env[2].call_count == 0
    assert notes(homepage_env) == []
    with session_scope() as session:
        customer = session.get(Customer, homepage_env[1].customer_id)
        assert (customer.homepage_url, customer.homepage_status, customer.homepage_source) == (
            support.URL,
            "AI_FOUND",
            "AI",
        )
