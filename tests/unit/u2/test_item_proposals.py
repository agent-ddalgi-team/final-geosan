"""AI 점수 입력·공정 연결 제안(#286): 사람 값 우선, 확인 전 표시, 잘못된 제안 거부."""

import pytest
from sqlalchemy import select

from geosan.api.routes.opportunities import _score_state
from geosan.evaluation.inputs import current_item_inputs, has_ai_pending_inputs, supersede_inputs
from geosan.evaluation.ledger import latest_confirmed_evaluation
from geosan.evaluation.models import ItemJudgmentInput
from geosan.opportunity.models import Customer, OppProcessLink
from geosan.storage.session import session_scope
from geosan.workflows import flow_extract
from geosan.workflows.flow_evaluate import run_evaluation
from tests.unit.u2 import test_extraction as support

search_env = support.search_env
extract_env = support.extract_env
URL = support.URL
PROCESS = "ELECTROPOLISHING"


def proposals(**changes):
    data = support.answer()
    data["itemInputProposals"] = [
        {
            "itemCode": "NEW_PRODUCT",
            "matchRateStep": "해당",
            "certaintyProposed": "STRONG",
            "factJudged": "정밀 볼트를 생산해 표면처리가 필요한 부품을 만든다",
            "quote": "정밀 볼트를 생산합니다.",
        },
        {
            "itemCode": "NEW_RECORD",
            "matchRateStep": "동일 산업",
            "certaintyProposed": "WEAK",
            "factJudged": "자동차용 부품 가공 경험이 있다",
            "quote": "자동차용 부품을 가공합니다.",
        },
    ]
    data["processLinkProposals"] = [
        {"processCode": PROCESS, "basis": "정밀 부품 가공", "quote": "정밀 볼트를 생산합니다."}
    ]
    data.update(changes)
    return data


def use(transport, data):
    transport.side_effect = lambda *_: support.reply(data)


def as_ingested(case):
    """사례 파일 입력을 모두 대체해 후보 찾기로 들어온 회사(입력 없음) 모양으로 만든다."""
    with session_scope() as session:
        supersede_inputs(session, case.opp_id)
        customer = session.get(Customer, case.customer_id)
        customer.ingest_batch_id = "batch-test"
        customer.discovery_source = "FACTORY_FILE"
        customer.pick_reason = "볼트를 생산해 아연도금 확인이 필요함"


def inputs(opp_id):
    with session_scope() as session:
        return {row.item_code: row for row in current_item_inputs(session, opp_id)}


def test_case_file_values_are_never_overwritten_by_proposals(extract_env):
    """사례 파일 18곳 보호: 사람이 적은 입력이 있으면 AI 제안을 저장하지 않는다."""
    case, transport = extract_env
    use(transport, proposals())
    before = {
        code: (row.state, row.match_rate, row.version) for code, row in inputs(case.opp_id).items()
    }
    result = flow_extract.run_extract(case.opp_id, URL)
    assert result.ok, result.error
    assert "점수 제안 0건" in result.summary
    after = inputs(case.opp_id)
    assert {code: (row.state, row.match_rate, row.version) for code, row in after.items()} == before
    assert all(row.proposed_by == "FILE" for row in after.values())
    with session_scope() as session:
        assert has_ai_pending_inputs(session, case.opp_id) is False
        run = latest_confirmed_evaluation(session, case.opp_id)
        # AI 제안이 없으니 "AI 제안 · 확인 전" 흐림이 새로 붙지 않는다(기존 상태 규칙 그대로).
        assert run.classification_code != "NOT_EVALUATED"
        assert _score_state(run, ai_pending=False) == _score_state(run)


def test_ingested_company_gets_pending_scores_from_proposals(extract_env):
    """Given 입력 없는 수집 회사(평가 전) / When AI 제안 2항목 / Then 8행 AI 입력·점수·PENDING."""
    case, transport = extract_env
    as_ingested(case)
    assert run_evaluation(opp_ids=[case.opp_id]).ok
    with session_scope() as session:
        assert (
            latest_confirmed_evaluation(session, case.opp_id).classification_code == "NOT_EVALUATED"
        )
    use(transport, proposals())
    result = flow_extract.run_extract(case.opp_id, URL)
    assert result.ok, result.error
    assert "점수 제안 2건·공정 제안 1건" in result.summary
    rows = inputs(case.opp_id)
    assert len(rows) == 8 and all(row.proposed_by == "AI" for row in rows.values())
    assert (
        rows["NEW_PRODUCT"].state,
        rows["NEW_PRODUCT"].match_rate_step,
        rows["NEW_PRODUCT"].match_rate,
    ) == ("STRONG", "해당", 1.0)
    assert rows["NEW_RECORD"].state == "WEAK" and rows["NEW_RECORD"].match_rate == pytest.approx(
        0.67
    )
    assert rows["NEW_RECORD"].evidence_ids == [] or all(
        e.startswith("ev") for e in rows["NEW_RECORD"].evidence_ids
    )
    assert {rows[code].state for code in rows if code not in ("NEW_PRODUCT", "NEW_RECORD")} == {
        "UNAVAILABLE"
    }
    with session_scope() as session:
        run = latest_confirmed_evaluation(session, case.opp_id)
        assert run.score_s is not None and run.classification_code != "NOT_EVALUATED"
        assert has_ai_pending_inputs(session, case.opp_id) is True
        assert _score_state(run, ai_pending=True) == "PENDING"
        link = session.scalar(
            select(OppProcessLink).where(
                OppProcessLink.opp_id == case.opp_id,
                OppProcessLink.process_code == PROCESS,
                OppProcessLink.superseded_at.is_(None),
            )
        )
        assert link is not None and (link.source, link.state) == ("AI", "PENDING")
    # 다시 조사하면 이전 AI 행을 대체하고 새 버전으로 쌓인다.
    result = flow_extract.run_extract(case.opp_id, URL)
    assert result.ok, result.error
    again = inputs(case.opp_id)
    assert len(again) == 8
    # 제안이 있는 항목만 새 버전으로 대체되고, 제안 없는 항목(UNAVAILABLE)은 그대로 남는다.
    for code, row in again.items():
        expected = rows[code].version + (1 if code in ("NEW_PRODUCT", "NEW_RECORD") else 0)
        assert row.version == expected, code
    with session_scope() as session:
        total = len(
            session.scalars(
                select(ItemJudgmentInput).where(ItemJudgmentInput.opp_id == case.opp_id)
            ).all()
        )
    # 사례 파일 8행(대체됨) + 첫 조사 AI 8행 + 두 번째 조사에서 제안 항목 2행만 새로.
    assert total == 18


def test_proposal_without_any_item_keeps_company_before_scoring(extract_env):
    """제안이 비어 있으면 입력 행을 만들지 않아 회사는 '평가 전' 그대로다."""
    case, transport = extract_env
    as_ingested(case)
    use(transport, support.answer())
    result = flow_extract.run_extract(case.opp_id, URL)
    assert result.ok, result.error
    assert inputs(case.opp_id) == {}
    with session_scope() as session:
        assert (
            latest_confirmed_evaluation(session, case.opp_id).classification_code == "NOT_EVALUATED"
        )


@pytest.mark.parametrize(
    "bad",
    [
        {"matchRateStep": "엉뚱한 단계"},
        {"quote": "본문에 없는 문장입니다."},
        {"itemCode": "NEW_MATERIAL", "matchRateStep": "해당"},
    ],
)
def test_invalid_proposals_are_rejected_and_nothing_is_stored(extract_env, bad):
    case, transport = extract_env
    as_ingested(case)
    data = proposals()
    data["itemInputProposals"][0].update(bad)
    use(transport, data)
    result = flow_extract.run_extract(case.opp_id, URL)
    assert not result.ok and result.error.kind == "LLM_FAILED"
    assert inputs(case.opp_id) == {}


def test_unknown_process_code_is_rejected(extract_env):
    case, transport = extract_env
    as_ingested(case)
    data = proposals()
    data["processLinkProposals"][0]["processCode"] = "NOT_A_PROCESS"
    use(transport, data)
    result = flow_extract.run_extract(case.opp_id, URL)
    assert not result.ok and result.error.kind == "LLM_FAILED"


def test_prompt_lists_items_steps_and_process_codes(extract_env):
    case, transport = extract_env
    assert flow_extract.run_extract(case.opp_id, URL).ok
    instructions = transport.call_args.args[0]["instructions"]
    for text in (
        "NEW_PRODUCT",
        "해당",
        "NEW_RECORD",
        "동일 산업",
        "허용 코드",
        PROCESS,
        "CONFIRMED는 쓰지",
    ):
        assert text in instructions
