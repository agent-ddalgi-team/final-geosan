"""#497: 가상 제안을 실제 임시 DB·API로 확정하고 기존 사람 값을 보존한다."""

from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from pytest_bdd import given, scenarios, then, when
from sqlalchemy import event, select
from sqlalchemy.orm import Session

from geosan.api.app import create_app
from geosan.api.routes import records
from geosan.capability.importer import import_capability
from geosan.config.app_settings import load_app_settings, sync_app_settings
from geosan.config.registry import load_runtime_config
from geosan.evaluation.inputs import current_item_inputs
from geosan.evaluation.models import ItemJudgmentInput
from geosan.evidence.models import Evidence
from geosan.opportunity.importer import import_case
from geosan.opportunity.models import OppProcessLink
from geosan.records.models import Note, ReviewCheck
from geosan.storage.session import session_scope
from geosan.workflows.flow_evaluate import run_evaluation
from geosan.workflows.models import FlowResult
from tests import factories
from tests.unit.u1.test_review_checks import detail
from tests.unit.u1.test_snapshot_ledger import _write

scenarios(str(Path(__file__).with_name("ai_proposal_review.feature")))
ITEM = "NEW_MATERIAL"


def card(client, opp_id):
    response = client.get("/api/v1/opportunities")
    assert response.status_code == 200
    return next(row for row in response.json()["data"] if row["oppId"] == opp_id)


def input_values(opp_id):
    with session_scope() as session:
        return {
            row.item_code: {
                column.name: getattr(row, column.name) for column in row.__table__.columns
            }
            for row in current_item_inputs(session, opp_id)
        }


def post(client, opp_id, item_id, **changes):
    values = {"checked": True, "evalId": detail(client, opp_id)["evalId"]}
    values.update(changes)
    return client.post(
        f"/api/v1/opportunities/{opp_id}/review-items/{item_id}/check",
        json=values,
        headers={"X-Staff-Key": "park-lee"},
    )


@pytest.fixture
def proposal_env(tmp_db, tmp_path):
    import_capability(_write(tmp_path, "cap.json", factories.capability_file()))
    original = import_case(_write(tmp_path, "original.json", factories.apjeong_case()))
    target = import_case(
        _write(
            tmp_path,
            "proposal.json",
            factories.apjeong_renamed_customer("proposal-target", "가상 제안 검토사"),
        )
    )
    with session_scope() as session:
        target_row = next(
            row for row in current_item_inputs(session, target.opp_id) if row.item_code == ITEM
        )
        target_row.proposed_by = "AI"
        target_row.state = "STRONG"
        rule = load_runtime_config(session).rule_config
        item = next(row for row in rule.new_profile_items if row.item_code == ITEM)
        target_row.match_rate_step = "정확히 일치"
        target_row.match_rate = item.match_rate_steps["정확히 일치"]
        target_row.fact_judged = "가상 회사의 소재와 공정이 맞는다"
    assert run_evaluation().ok
    with TestClient(create_app()) as client:
        yield client, target.opp_id, original.opp_id


@given("AI 점수 제안이 있는 가상 회사와 기존 A정밀이 있다", target_fixture="context")
def prepared(proposal_env):
    client, target, original = proposal_env
    return {
        "client": client,
        "target": target,
        "original": original,
        "before": input_values(target),
        "original_inputs": input_values(original),
        "original_scores": detail(client, original)["scores"],
        "previous_eval": detail(client, target)["evalId"],
    }


@when("담당자가 AI 점수 제안을 확정한다")
def confirm(context):
    context["result"] = post(context["client"], context["target"], "II:" + ITEM)


@then("제안은 담당자 값 새 버전이 되고 점수의 확인 전 표시가 해제된다")
def confirmed(context):
    result = context["result"]
    assert result.status_code == 200, result.text
    row = input_values(context["target"])[ITEM]
    assert row["proposed_by"] == "STAFF" and row["state"] == "CONFIRMED"
    assert row["version"] == context["before"][ITEM]["version"] + 1
    assert row["entered_by"] == "park-lee" and row["entered_at"]
    with session_scope() as session:
        previous = session.get(ItemJudgmentInput, context["before"][ITEM]["item_input_id"])
        assert previous.proposed_by == "AI" and previous.superseded_at is not None
    assert detail(context["client"], context["target"])["evalId"] != context["previous_eval"]
    assert card(context["client"], context["target"])["scoreState"] == "CONFIRMED"
    assert result.json()["meta"]["reevaluated"] is True


@then("기존 A정밀의 점수와 입력은 바뀌지 않는다")
def original_unchanged(context):
    assert input_values(context["original"]) == context["original_inputs"]
    assert detail(context["client"], context["original"])["scores"] == context["original_scores"]


@when("담당자가 AI 점수 제안을 일부 가능으로 고친다")
def correct(context):
    context["result"] = post(
        context["client"], context["target"], "II:" + ITEM, stepLabel="일부 가능"
    )


@then("설정에 있는 일부 가능 값으로 저장하고 다시 평가한다")
def corrected(context):
    result = context["result"]
    assert result.status_code == 200, result.text
    row = input_values(context["target"])[ITEM]
    with session_scope() as session:
        item = next(
            x
            for x in load_runtime_config(session).rule_config.new_profile_items
            if x.item_code == ITEM
        )
        assert row["match_rate"] == item.match_rate_steps["일부 가능"]
    assert row["match_rate_step"] == "일부 가능" and row["state"] == "CONFIRMED"
    assert row["proposed_by"] == "STAFF" and result.json()["meta"]["reevaluated"] is True


def test_detail_exposes_ai_proposal_and_configured_step_options(proposal_env):
    client, target, _ = proposal_env
    data = detail(client, target)
    proposal = next(row for row in data["reviewItems"] if row["itemId"] == "II:" + ITEM)
    assert proposal["kind"] == "ITEM_INPUT_PROPOSAL" and proposal["source"] == "AI"
    assert proposal["stepOptions"] == ["정확히 일치", "일부 가능"]
    assert "강한 추정" in proposal["text"]
    assert "정확히 일치" in proposal["text"] and "근거" in proposal["text"]
    assert proposal["checked"] is False
    assert all(
        row.get("stepOptions") is None
        for row in data["reviewItems"]
        if row["itemId"] != "II:" + ITEM
    )


def test_process_proposal_confirmation_creates_staff_link_and_activity(proposal_env):
    client, target, _ = proposal_env
    with session_scope() as session:
        link = session.scalar(
            select(OppProcessLink).where(
                OppProcessLink.opp_id == target,
                OppProcessLink.process_code == "ANODIZING",
                OppProcessLink.superseded_at.is_(None),
            )
        )
        assert link is not None
        link.source, link.state = "AI", "PENDING"
        link.evidence_ref = "가상 인용"
    assert run_evaluation(opp_ids=[target]).ok
    response = post(client, target, "PL:ANODIZING")
    assert response.status_code == 200, response.text
    with session_scope() as session:
        links = session.scalars(
            select(OppProcessLink).where(
                OppProcessLink.opp_id == target, OppProcessLink.process_code == "ANODIZING"
            )
        ).all()
        assert len(links) == 2
        active = next(row for row in links if row.superseded_at is None)
        assert (active.source, active.state, active.confirmed_by) == (
            "STAFF",
            "CONFIRMED",
            "park-lee",
        )
        assert active.confirmed_at and active.evidence_ref == "가상 인용"
        assert session.scalar(select(Note).where(Note.opp_id == target)) is not None
        assert session.scalar(select(ReviewCheck).where(ReviewCheck.opp_id == target)) is not None
    activities = client.get(f"/api/v1/opportunities/{target}/activity").json()["data"]
    assert sum("AI 공정 제안 확정" in row["summary"] for row in activities) == 1


@pytest.mark.parametrize("body", [{"stepLabel": "일부 가능"}, {"checked": False}])
def test_process_proposal_rejects_correction_and_uncheck(proposal_env, body):
    client, target, _ = proposal_env
    with session_scope() as session:
        row = session.scalar(
            select(OppProcessLink).where(
                OppProcessLink.opp_id == target,
                OppProcessLink.process_code == "ANODIZING",
                OppProcessLink.superseded_at.is_(None),
            )
        )
        row.source, row.state = "AI", "PENDING"
    assert post(client, target, "PL:ANODIZING", **body).status_code == 400
    with session_scope() as session:
        current = session.scalar(
            select(OppProcessLink).where(
                OppProcessLink.opp_id == target,
                OppProcessLink.process_code == "ANODIZING",
                OppProcessLink.superseded_at.is_(None),
            )
        )
        assert current.source == "AI" and current.state == "PENDING"
        assert session.scalar(select(ReviewCheck)) is None
        assert session.scalar(select(Note)) is None


@pytest.mark.parametrize("step", ["없는 단계", "동일 산업", "", " 일부 가능 ", 1, True])
def test_invalid_step_is_rejected_without_writes(proposal_env, step):
    client, target, _ = proposal_env
    before = input_values(target)
    response = post(client, target, "II:" + ITEM, stepLabel=step)
    assert response.status_code == 400, response.text
    assert input_values(target) == before
    with session_scope() as session:
        assert session.scalar(select(ReviewCheck)) is None
        assert session.scalar(select(Note)) is None


def test_uncheck_of_proposal_is_rejected(proposal_env):
    client, target, _ = proposal_env
    before = input_values(target)
    assert post(client, target, "II:" + ITEM, checked=False).status_code == 400
    assert input_values(target) == before


def test_regular_review_item_rejects_step_but_keeps_existing_check_behavior(proposal_env):
    client, target, _ = proposal_env
    ordinary = next(
        x for x in detail(client, target)["reviewItems"] if not x["itemId"].startswith("II:")
    )
    assert post(client, target, ordinary["itemId"], stepLabel="일부 가능").status_code == 400
    result = post(client, target, ordinary["itemId"])
    assert result.status_code == 200
    assert result.json()["meta"].get("reevaluated") is None


def test_missing_data_confirmation_keeps_null_score_input(proposal_env):
    client, target, _ = proposal_env
    with session_scope() as session:
        row = next(x for x in current_item_inputs(session, target) if x.item_code == ITEM)
        row.state = "UNAVAILABLE"
        row.match_rate = row.match_rate_step = None
    assert run_evaluation(opp_ids=[target]).ok
    response = post(client, target, "II:" + ITEM)
    assert response.status_code == 200, response.text
    row = input_values(target)[ITEM]
    assert row["proposed_by"] == "STAFF" and row["state"] == "UNAVAILABLE"
    assert row["match_rate"] is None and row["match_rate_step"] is None


def test_human_values_are_not_offered_or_overwritten_as_ai(proposal_env):
    client, _, original = proposal_env
    before = input_values(original)
    assert all(
        not row["itemId"].startswith(("II:", "PL:"))
        for row in detail(client, original)["reviewItems"]
    )
    assert post(client, original, "II:" + ITEM).status_code == 404
    assert input_values(original) == before


def test_confirmed_proposal_cannot_be_confirmed_twice(proposal_env):
    client, target, _ = proposal_env
    assert post(client, target, "II:" + ITEM).status_code == 200
    before = input_values(target)
    assert post(client, target, "II:" + ITEM).status_code == 404
    assert input_values(target) == before
    with session_scope() as session:
        assert len(session.scalars(select(ReviewCheck)).all()) == 1
        assert len(session.scalars(select(Note)).all()) == 1


def test_failed_reevaluation_rolls_back_proposal_and_records(proposal_env, monkeypatch):
    client, target, _ = proposal_env
    before = input_values(target)
    before_detail = detail(client, target)
    monkeypatch.setattr(records, "evaluate_in_session", lambda *_: FlowResult(ok=False))
    response = post(client, target, "II:" + ITEM)
    assert response.status_code == 500 and "취소" in response.json()["error"]["message"]
    assert input_values(target) == before
    assert detail(client, target)["evalId"] == before_detail["evalId"]
    with session_scope() as session:
        assert session.scalar(select(ReviewCheck)) is None
        assert session.scalar(select(Note)) is None


def test_concurrent_confirmation_stores_one_new_version(proposal_env):
    client, target, _ = proposal_env
    viewed = detail(client, target)["evalId"]
    before = input_values(target)[ITEM]
    with ThreadPoolExecutor(max_workers=2) as executor:
        responses = list(
            executor.map(lambda _: post(client, target, "II:" + ITEM, evalId=viewed), range(2))
        )
    assert sorted(response.status_code for response in responses) == [200, 404]
    assert input_values(target)[ITEM]["version"] == before["version"] + 1
    with session_scope() as session:
        assert len(session.scalars(select(ReviewCheck)).all()) == 1


@pytest.mark.parametrize("staff", [None, "viewer", "unknown"])
def test_only_registered_recording_staff_can_confirm(proposal_env, staff):
    client, target, _ = proposal_env
    before = input_values(target)
    response = client.post(
        f"/api/v1/opportunities/{target}/review-items/II:{ITEM}/check",
        json={"checked": True, "evalId": detail(client, target)["evalId"]},
        headers={"X-Staff-Key": staff} if staff is not None else {},
    )
    assert response.status_code == 403
    assert input_values(target) == before


def test_evaluation_from_another_company_is_rejected(proposal_env):
    client, target, original = proposal_env
    assert (
        post(client, target, "II:" + ITEM, evalId=detail(client, original)["evalId"]).status_code
        == 400
    )


def test_hidden_evidence_quote_is_not_copied_to_proposal_text(proposal_env):
    client, target, _ = proposal_env
    with session_scope() as session:
        row = next(x for x in current_item_inputs(session, target) if x.item_code == ITEM)
        assert row.evidence_ids
        quote = None
        for key in row.evidence_ids:
            evidence = session.get(Evidence, key)
            evidence.security_grade = "FORBIDDEN"
            quote = evidence.quote
    item = next(x for x in detail(client, target)["reviewItems"] if x["itemId"] == "II:" + ITEM)
    assert quote not in item["text"] and "인용 없음" in item["text"]


def test_storage_failure_cancels_proposal_evaluation_and_activity(proposal_env, caplog):
    client, target, _ = proposal_env
    before = input_values(target)
    before_eval = detail(client, target)["evalId"]
    failures = []

    def fail(session, *_):
        if any(isinstance(row, ReviewCheck) for row in session.new):
            failures.append(True)
            raise RuntimeError("PRIVATE_STORAGE_ERROR")

    event.listen(Session, "before_flush", fail)
    try:
        response = post(client, target, "II:" + ITEM)
    finally:
        event.remove(Session, "before_flush", fail)
    assert response.status_code == 500 and failures == [True]
    assert "PRIVATE_STORAGE_ERROR" not in response.text + caplog.text
    assert input_values(target) == before
    assert detail(client, target)["evalId"] == before_eval
    with session_scope() as session:
        assert session.scalar(select(ReviewCheck)) is None
        assert session.scalar(select(Note)) is None


def test_eighteen_case_files_have_no_ai_proposal_rows(bare_db):
    settings_path = Path("examples/app-settings.yaml")
    with session_scope() as session:
        sync_app_settings(session, load_app_settings(settings_path), source_path=settings_path)
    import_capability(Path("examples/capability-geosan-brochure.json"))
    files = sorted(Path("examples/cases").glob("*.json"))
    assert len(files) == 18
    cases = [import_case(path) for path in files]
    assert run_evaluation().ok
    with TestClient(create_app()) as client:
        for case in cases:
            data = detail(client, case.opp_id)
            assert all(
                not item["itemId"].startswith(("II:", "PL:")) for item in data["reviewItems"]
            )
            assert all(row["proposed_by"] == "FILE" for row in input_values(case.opp_id).values())


def test_score_proposal_cannot_be_dropped_even_with_a_confirmed_process(proposal_env):
    """Given 확정 공정이 있는 회사의 AI 점수 제안 / When 해제 / Then 400, 바뀐 것 없음 (#719).

    [확정 값 유지](#677)는 공정 제안(PL 줄)에만 있다. 점수 제안(II 줄)은 확정·고치기만 된다.
    """
    client, target, _ = proposal_env
    with session_scope() as session:
        states = {
            row.state
            for row in session.scalars(
                select(OppProcessLink).where(
                    OppProcessLink.opp_id == target, OppProcessLink.superseded_at.is_(None)
                )
            )
        }
    assert "CONFIRMED" in states
    before = input_values(target)
    response = post(client, target, "II:" + ITEM, checked=False)
    assert response.status_code == 400, response.text
    assert response.json()["error"]["message"] == "AI 제안은 확정 또는 고치기만 할 수 있습니다."
    assert input_values(target) == before
    with session_scope() as session:
        assert session.scalars(select(Note).where(Note.opp_id == target)).all() == []
        assert session.scalars(select(ReviewCheck).where(ReviewCheck.opp_id == target)).all() == []
