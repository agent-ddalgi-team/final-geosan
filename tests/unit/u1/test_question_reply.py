"""#248: 실제 임시 DB·API로 최신 답과 회사별 답 이력을 확인한다."""

import time
from concurrent.futures import ThreadPoolExecutor
from datetime import date
from unittest.mock import Mock

import pytest
from sqlalchemy import event, func, select

from geosan.capability.models import Process
from geosan.config.app_settings import load_app_settings
from geosan.config.errors import AppError
from geosan.config.models import AppSetting
from geosan.evaluation.models import EvaluationRun
from geosan.evidence import extraction, openai_search
from geosan.evidence.homepage import find_case_homepage
from geosan.evidence.public_items import approve_page
from geosan.evidence.reader import Page
from geosan.opportunity.importer import import_case
from geosan.questions.models import ConfirmationQuestion, QuestionOpportunityLink
from geosan.records.models import Bookmark, Note
from geosan.storage.base import new_id, utcnow
from geosan.storage.migrate import downgrade, upgrade_to_head
from geosan.storage.session import session_scope
from geosan.workflows.flow_evaluate import run_evaluation
from tests import factories
from tests.unit.u1.test_review_checks import detail, save_check
from tests.unit.u1.test_sales_records import records_env as sales_env
from tests.unit.u1.test_snapshot_ledger import _write
from tests.unit.u2.test_extraction import BODY, URL
from tests.unit.u2.test_extraction import reply as extraction_reply
from tests.unit.u2.test_search_limits import provider_reply

records_env = sales_env


@pytest.fixture
def reply_env(records_env, tmp_path):
    client, opp_id = records_env
    case = factories.apjeong_renamed_customer("reply-other", name="가상답회사2")
    case["customer"]["bizNumber"] = None
    other_id = import_case(_write(tmp_path, "reply-other.json", case)).opp_id
    assert run_evaluation().ok
    with session_scope() as session:
        process = session.scalar(select(Process))
        question = session.scalar(
            select(ConfirmationQuestion).where(
                ConfirmationQuestion.target_kind == "PROCESS",
                ConfirmationQuestion.target_id == process.process_id,
            )
        )
        if question is None:
            question = ConfirmationQuestion(
                question_id=new_id("q"),
                target_kind="PROCESS",
                target_id=process.process_id,
                question_text="가상 공정 확인 질문",
                dataset_kind="VIRTUAL_REVIEWED",
                is_virtual=True,
            )
            session.add(question)
            session.flush()
        for company in (opp_id, other_id):
            if (
                session.scalar(
                    select(QuestionOpportunityLink).where(
                        QuestionOpportunityLink.question_id == question.question_id,
                        QuestionOpportunityLink.opp_id == company,
                    )
                )
                is None
            ):
                session.add(
                    QuestionOpportunityLink(
                        question_link_id=new_id("ql"),
                        question_id=question.question_id,
                        opp_id=company,
                        effect_if_answered="가상 공정 확인",
                        linked_at=utcnow(),
                        dataset_kind="VIRTUAL_REVIEWED",
                        is_virtual=True,
                    )
                )
        question_id = question.question_id
    return client, opp_id, other_id, question_id


def reply(client, question_id, text="가상 인증 확인 답", staff="park-lee", **values):
    return client.post(
        f"/api/v1/questions/{question_id}/reply",
        json={"replyText": text, "repliedAt": "2026-11-04", **values},
        headers={"X-Staff-Key": staff} if staff is not None else {},
    )


@pytest.mark.parametrize("status", ["WAITING", "REQUESTED", "REPLIED"])
def test_allowed_states_save_answer_and_staff(reply_env, status):
    client, _, _, question_id = reply_env
    with session_scope() as session:
        session.get(ConfirmationQuestion, question_id).status = status
    response = reply(client, question_id)
    assert response.status_code == 200, response.text
    assert response.json()["data"] == {
        "questionId": question_id,
        "replyText": "가상 인증 확인 답",
        "repliedAt": "2026-11-04",
        "repliedBy": "park-lee",
    }
    with session_scope() as session:
        question = session.get(ConfirmationQuestion, question_id)
        assert question.status == "REPLIED" and question.replied_at == date(2026, 11, 4)


def test_shared_latest_answer_history_and_checks_scenario(reply_env):
    # Given: 같은 질문이 두 회사에 연결되어 있고 첫 회사의 체크만 켜져 있다.
    client, opp_id, other_id, question_id = reply_env
    before = detail(client, opp_id)
    item_id = f"Q:{question_id}"
    assert save_check(client, opp_id, item_id, before["evalId"], True).status_code == 200
    with session_scope() as session:
        evaluations = session.scalar(select(func.count()).select_from(EvaluationRun))
    # When: 답을 두 번 저장하고 상세를 다시 읽는다.
    assert reply(client, question_id, "가상 이전 답").status_code == 200
    assert reply(client, question_id, "가상 최신 답", staff="choi-pm").status_code == 200
    # Then: 두 회사에는 최신 답, 활동에는 이전 답까지 남고 체크·점수·평가는 그대로다.
    for company in (opp_id, other_id):
        current = detail(client, company)
        item = next(row for row in current["reviewItems"] if row["itemId"] == item_id)
        assert (item["replyText"], item["repliedAt"], item["repliedBy"]) == (
            "가상 최신 답",
            "2026-11-04",
            "choi-pm",
        )
        assert item["checked"] is (company == opp_id)
        question = next(
            row for row in current["reasons"]["questions"] if row["questionId"] == question_id
        )
        assert question["replyText"] == item["replyText"] and question["repliedBy"] == "choi-pm"
        assert current["records"]["contactCount"]["total"] == 0
        history = client.get(f"/api/v1/opportunities/{company}/activity").json()["data"]
        answers = [row for row in history if row["kind"] == "REPLY"]
        assert len(answers) == 2
        assert all(row["summary"].startswith("답 기록 · ") for row in answers)
        assert any("가상 이전 답" in row["summary"] for row in answers)
        assert any("가상 최신 답" in row["summary"] for row in answers)
        assert {row["summary"] for row in answers} == {
            "답 기록 · 가상 이전 답",
            "답 기록 · 가상 최신 답",
        }
    after = detail(client, opp_id)
    assert after["evalId"] == before["evalId"] and after["scores"] == before["scores"]
    assert run_evaluation().ok
    assert (
        next(row for row in detail(client, opp_id)["reviewItems"] if row["itemId"] == item_id)[
            "replyText"
        ]
        == "가상 최신 답"
    )
    with session_scope() as session:
        assert session.scalar(select(func.count()).select_from(EvaluationRun)) == evaluations + 2
        notes = list(session.scalars(select(Note).where(Note.kind == "REPLY")))
        assert len(notes) == 4 and all(
            row.text.startswith(f"Q:{question_id} 답: ") for row in notes
        )


@pytest.mark.parametrize("staff", [None, "viewer", "unknown-staff"])
def test_missing_or_viewer_staff_cannot_save(reply_env, staff):
    client, _, _, question_id = reply_env
    assert reply(client, question_id, staff=staff).status_code == 403
    with session_scope() as session:
        assert session.get(ConfirmationQuestion, question_id).status == "WAITING"
        assert session.scalar(select(func.count()).select_from(Note)) == 0


@pytest.mark.parametrize(
    "values",
    [
        {"replyText": "x" * 501},
        {"replyText": ""},
        {"replyText": None},
        {"repliedAt": "not-a-date"},
        {"repliedAt": None},
        {"repliedBy": "forged"},
    ],
)
def test_invalid_input_cannot_leave_answer_or_history(reply_env, values):
    client, _, _, question_id = reply_env
    assert reply(client, question_id, **values).status_code == 400
    with session_scope() as session:
        assert session.get(ConfirmationQuestion, question_id).status == "WAITING"
        assert session.scalar(select(func.count()).select_from(Note)) == 0


def test_reply_limits_and_internal_contact_text(reply_env, caplog):
    client, _, _, question_id = reply_env
    text = "가상답 " + "x" * 496
    assert len(text) == 500 and reply(client, question_id, text).status_code == 200
    internal = "가상 담당자 연락 test@example.invalid, 010-0000-0000"
    caplog.clear()
    assert reply(client, question_id, internal).status_code == 200
    assert internal not in caplog.text and "test@example.invalid" not in caplog.text


def test_reply_does_not_enable_reply_kind_in_note_input(reply_env):
    client, opp_id, _, question_id = reply_env
    response = client.post(
        f"/api/v1/opportunities/{opp_id}/notes",
        json={"kind": "REPLY", "text": "가상 임의 답"},
        headers={"X-Staff-Key": "park-lee"},
    )
    assert response.status_code == 400
    assert reply(client, question_id).status_code == 200


def test_reply_versions_follow_existing_notes(reply_env):
    client, opp_id, _, question_id = reply_env
    assert (
        client.post(
            f"/api/v1/opportunities/{opp_id}/notes",
            json={"text": "가상 기존 메모"},
            headers={"X-Staff-Key": "park-lee"},
        ).status_code
        == 200
    )
    assert reply(client, question_id).status_code == 200
    with session_scope() as session:
        notes = list(
            session.scalars(select(Note).where(Note.opp_id == opp_id).order_by(Note.version))
        )
        assert [(row.kind, row.version) for row in notes] == [("MEMO", 1), ("REPLY", 2)]


def test_missing_question_returns_404(records_env):
    client, _ = records_env
    assert reply(client, "missing-question").status_code == 404


def test_second_company_history_failure_rolls_back_latest_and_all_notes(reply_env):
    client, _, _, question_id = reply_env
    assert reply(client, question_id, "가상 보존할 답").status_code == 200
    calls = []

    def fail_second(_mapper, _connection, target):
        if target.kind == "REPLY":
            calls.append(target.note_id)
            if len(calls) == 2:
                raise RuntimeError("가상 저장 실패")

    event.listen(Note, "before_insert", fail_second)
    try:
        response = reply(client, question_id, "가상 저장되면 안 되는 답")
    finally:
        event.remove(Note, "before_insert", fail_second)
    assert response.status_code == 500 and len(calls) == 2
    with session_scope() as session:
        assert session.get(ConfirmationQuestion, question_id).reply_text == "가상 보존할 답"
        notes = list(session.scalars(select(Note)))
        assert len(notes) == 2 and all("가상 보존할 답" in row.text for row in notes)


def test_upgrade_preserves_legacy_question_and_note(reply_env, tmp_db):
    client, opp_id, _, question_id = reply_env
    assert (
        client.post(
            f"/api/v1/opportunities/{opp_id}/notes",
            json={"text": "가상 이전 메모"},
            headers={"X-Staff-Key": "park-lee"},
        ).status_code
        == 200
    )
    assert downgrade(tmp_db, "tg_001") == ["tg_001"]
    assert upgrade_to_head(tmp_db) == ["rec_011"]
    assert upgrade_to_head(tmp_db) == ["rec_011"]
    with session_scope() as session:
        question = session.get(ConfirmationQuestion, question_id)
        assert (
            question.reply_text is None
            and question.replied_at is None
            and question.replied_by is None
        )
        assert session.scalar(select(Note)).text == "가상 이전 메모"


def test_private_answer_is_not_a_public_source_or_external_payload(reply_env, monkeypatch):
    client, opp_id, _, question_id = reply_env
    secret = "가상 내부 답 test@example.invalid 010-0000-0000"
    assert reply(client, question_id, secret).status_code == 200
    settings_file = load_app_settings("examples/app-settings.yaml")
    with session_scope() as session:
        settings = session.get(AppSetting, "llm")
        settings.value = {
            **settings_file.llm.model_dump(by_alias=True, mode="json"),
            "mode": "EXTERNAL",
        }
        settings = session.get(AppSetting, "homepageDiscovery")
        settings.value = {
            **settings_file.homepage_discovery.model_dump(by_alias=True, mode="json"),
            "enabled": True,
        }
        note_id = session.scalar(select(Note)).note_id
    monkeypatch.setenv("OPENAI_API_KEY", "test-only-placeholder")
    search = Mock(return_value=provider_reply())
    extract = Mock(return_value=extraction_reply())
    monkeypatch.setattr(openai_search, "_post_response", search)
    monkeypatch.setattr(extraction, "_post", extract)
    find_case_homepage(opp_id)
    with approve_page(opp_id, Page(URL, BODY)) as approved_ids:
        extraction.extract_evidence(approved_ids, opp_id, deadline=time.monotonic() + 60)
    assert secret not in str(search.call_args) and secret not in str(extract.call_args)
    assert "replyText" not in str(search.call_args) and "replyText" not in str(extract.call_args)
    with pytest.raises(AppError):
        extraction.extract_evidence([note_id], opp_id, deadline=time.monotonic() + 60)
    extract.assert_called_once()
    cards = client.get("/api/v1/opportunities").json()
    assert secret not in str(cards)


def test_access_cookie_is_required_when_protection_enabled(reply_env):
    client, _, _, question_id = reply_env
    with session_scope() as session:
        session.get(AppSetting, "accessProtection").value = {"enabled": True}
    assert reply(client, question_id).status_code == 401
    with session_scope() as session:
        assert session.get(ConfirmationQuestion, question_id).reply_text is None
        assert session.scalar(select(func.count()).select_from(Note)) == 0


def test_concurrent_replies_keep_both_histories_and_versions(reply_env):
    client, opp_id, other_id, question_id = reply_env
    with ThreadPoolExecutor(max_workers=2) as pool:
        responses = list(
            pool.map(
                lambda text: reply(client, question_id, text), ["가상 동시 답1", "가상 동시 답2"]
            )
        )
    assert all(response.status_code == 200 for response in responses)
    with session_scope() as session:
        question = session.get(ConfirmationQuestion, question_id)
        for company in (opp_id, other_id):
            notes = list(
                session.scalars(select(Note).where(Note.opp_id == company).order_by(Note.version))
            )
            assert [row.version for row in notes] == [1, 2]
            assert notes[-1].text == f"Q:{question_id} 답: {question.reply_text}"


def test_program_made_reply_note_does_not_turn_bookmark_on(reply_env):
    """Given 관심이 꺼진 두 회사 / When 질문 답으로 프로그램이 답 이력을 남김 / Then 관심 그대로.

    자동 관심은 담당자가 직접 저장한 메모·단계·의견에만 건다(PM 결정 2026-11-07, #380).
    """
    client, opp_id, other_id, question_id = reply_env
    assert reply(client, question_id).status_code == 200
    with session_scope() as session:
        assert (
            session.scalar(select(func.count()).select_from(Note).where(Note.kind == "REPLY")) >= 1
        )
        assert (
            session.scalar(select(Bookmark).where(Bookmark.opp_id.in_([opp_id, other_id]))) is None
        )
