"""#685: 통화에서 확인한 신호(꼬리 질문 답)가 점수 두 항목으로 들어간다.

실제 임시 DB·실제 API로 본다. 외부 호출 없음. 가상 사례만 쓴다(거산 실제 사양 아님).
"""

from datetime import date, timedelta

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select

from geosan.api.call_signals import CallAnswer, wanted_signal
from geosan.api.routes import records as records_routes
from geosan.capability.importer import import_capability
from geosan.config.registry import DEFAULT_RULE_CONFIG_PATH
from geosan.config.rule_config import load_rule_config
from geosan.evaluation.inputs import current_item_inputs, supersede_inputs
from geosan.evaluation.ledger import latest_confirmed_evaluation
from geosan.evaluation.models import ItemJudgmentInput
from geosan.opportunity.importer import import_case
from geosan.opportunity.models import Customer, Opportunity, Signal
from geosan.records.models import Outcome
from geosan.storage.session import session_scope
from geosan.workflows.flow_evaluate import run_evaluation
from geosan.workflows.models import FlowResult
from tests import factories
from tests.unit.u1 import test_record_cancel as cancels
from tests.unit.u1 import test_sales_questions as questions
from tests.unit.u1 import test_sales_records as records
from tests.unit.u1.test_snapshot_ledger import _write

BASE_DATE = date(2026, 10, 20)
QUOTE = ("QUOTE_REQUEST", "QUOTE")
MATERIAL = ("QUOTE_REQUEST", "MATERIAL")
NOT_YET = ("QUOTE_REQUEST", "NOT_YET")
SWITCH_YES = ("SWITCH_INTENT", "YES")


def case_without_bid(case_id="case-call-free", name="C부품(가상)"):
    """A정밀 사본에서 공고 신호를 뺀 가상 회사: 구매·외주 의향이 사례 파일 "신호 없음"이다."""
    data = factories.apjeong_renamed_customer(case_id, name)
    data["signals"] = [row for row in data["signals"] if row["signalKind"] != "BID"]
    for item in data["itemInputs"]:
        if item["itemCode"] == "SIG_BID":
            item.update(
                matchRate=None,
                certainty=None,
                state="NO_SIGNAL",
                factJudged="홈페이지에 입찰·협력사 모집 글 없음(가상)",
                evidenceRefs=[],
                signalRefs=[],
            )
        if item["itemCode"] == "SIG_EXPAND":
            item["signalRefs"] = [0]
    return data


@pytest.fixture
def call_env(tmp_db, tmp_path):
    """두 회사: free = 공고가 없는 가상 회사, apjeong = 사례 파일 공고 점수가 있는 A정밀."""
    import_capability(_write(tmp_path, "cap.json", factories.capability_file()))
    free = import_case(_write(tmp_path, "free.json", case_without_bid())).opp_id
    apjeong = import_case(_write(tmp_path, "a.json", factories.apjeong_case())).opp_id
    assert run_evaluation().ok
    with TestClient(create_app_once()) as client:
        yield client, free, apjeong


def create_app_once():
    from geosan.api.app import create_app

    return create_app()


def detail(client, opp_id):
    return client.get(f"/api/v1/opportunities/{opp_id}").json()["data"]


def item(client, opp_id, code):
    return next(row for row in detail(client, opp_id)["scores"]["items"] if row["itemCode"] == code)


def call(client, opp_id, *answers, days_ago=0, **extra):
    """연결된 통화 한 건을 저장하고 응답(JSON 전체)을 돌려준다."""
    body = questions.contact(
        answers=answers, attemptedAt=(BASE_DATE - timedelta(days=days_ago)).isoformat(), **extra
    )
    response = records.post(client, opp_id, "outcomes", body)
    assert response.status_code == 200, response.text
    return response.json()


def call_signals(opp_id, live=True):
    with session_scope() as session:
        rows = session.scalars(
            select(Signal)
            .where(Signal.opp_id == opp_id, Signal.signal_kind.like("CALL_%"))
            .order_by(Signal.created_at, Signal.signal_id)
        )
        return [
            (row.signal_kind, row.relation, row.occurred_at, row.entered_by, row.evidence_id)
            for row in rows
            if not live or row.superseded_at is None
        ]


def input_rows(opp_id, code):
    """그 항목의 입력 행 전부를 (버전, 출처, 상태, 살아 있나)로."""
    with session_scope() as session:
        rows = session.scalars(
            select(ItemJudgmentInput)
            .where(ItemJudgmentInput.opp_id == opp_id, ItemJudgmentInput.item_code == code)
            .order_by(ItemJudgmentInput.version)
        )
        return [
            (row.version, row.proposed_by, row.state, row.superseded_at is None) for row in rows
        ]


def run_of(opp_id):
    """최신 확정 평가 기록의 분류·직접 행동 신호 조건·유효 기한."""
    with session_scope() as session:
        run = latest_confirmed_evaluation(session, opp_id)
        return {
            "eval_id": run.eval_id,
            "classification_code": run.classification_code,
            "timing_requirements": dict(run.timing_requirements),
            "valid_until": run.valid_until,
        }


def as_not_evaluated(opp_id):
    """사례 파일 입력을 모두 대체해 후보 찾기로 들어온 회사(점수 입력 없음) 모양으로 만든다."""
    with session_scope() as session:
        supersede_inputs(session, opp_id)
        customer = session.get(Customer, session.get(Opportunity, opp_id).customer_id)
        customer.ingest_batch_id = "batch-test"
        customer.discovery_source = "FACTORY_FILE"
    assert run_evaluation(opp_ids=[opp_id]).ok


# ---------------------------------------------------------------------------
# 대응표 읽기·검사
# ---------------------------------------------------------------------------


def test_example_rule_config_carries_the_call_signal_table():
    """Given 예시 규칙 설정 / When 읽음 / Then 두 항목의 대응표와 넓힌 이름이 있고 배점은 그대로."""
    config = load_rule_config(DEFAULT_RULE_CONFIG_PATH)
    assert config.version == "v0.17-e"
    table = {
        rule.item_code: (
            rule.signal_kind,
            [(a.question_id, a.answer_id, str(a.relation)) for a in rule.answers],
        )
        for rule in config.call_signals
    }
    assert table == {
        "SIG_BID": (
            "CALL_INTENT",
            [
                ("QUOTE_REQUEST", "QUOTE", "DIRECT"),
                ("SWITCH_INTENT", "YES", "DIRECT"),
                ("QUOTE_REQUEST", "MATERIAL", "INDIRECT"),
            ],
        ),
        "SIG_HIRE": (
            "CALL_INTEREST",
            [
                ("VISIT_OR_SAMPLE", "VISIT", "DIRECT"),
                ("VISIT_OR_SAMPLE", "SAMPLE", "DIRECT"),
                ("INTEREST", "HIGH", "DIRECT"),
                ("INTEREST", "MEDIUM", "INDIRECT"),
            ],
        ),
    }
    items = {row.item_code: (row.label, row.weight, row.decay) for row in config.new_profile_items}
    assert items["SIG_BID"] == ("구매·외주 의향", 7, "BID_EXCEPTION")
    assert items["SIG_HIRE"] == ("관심", 5, "HIRE")


def _config_copy(tmp_path, old, new):
    source = DEFAULT_RULE_CONFIG_PATH.read_text(encoding="utf-8")
    assert source.count(old) == 1, old
    path = tmp_path / "rule-config-call.yaml"
    path.write_text(source.replace(old, new), encoding="utf-8")
    return path


@pytest.mark.parametrize(
    "old,new,expected",
    [
        (
            "  - itemCode: SIG_HIRE\n    signalKind",
            "  - itemCode: NEW_PRODUCT\n    signalKind",
            "시점",
        ),
        ("signalKind: CALL_INTEREST", "signalKind: CALL_INTENT", "두 번"),
        (
            "{ questionId: INTEREST, answerId: MEDIUM, relation: INDIRECT }",
            "{ questionId: INTEREST, answerId: HIGH, relation: INDIRECT }",
            "같은 답",
        ),
        ("signalKind: CALL_INTEREST", "signalKind: HIRING", "callSignals[1].signalKind"),
    ],
)
def test_rule_config_rejects_a_broken_call_signal_table(tmp_path, old, new, expected):
    """Given 대응표가 어긋난 규칙 설정 / When 검사 / Then 줄·항목·이유로 거부한다."""
    from geosan.config.rule_config import check_rule_config_file
    from geosan.config.validators import format_field_error

    result = check_rule_config_file(_config_copy(tmp_path, old, new))
    assert result.config is None
    text = "\n".join(format_field_error(error) for error in result.errors)
    assert expected in text and all(error.line for error in result.errors)


@pytest.mark.parametrize(
    "old,new,expected",
    [
        ("answerId: QUOTE, relation", "answerId: NO_SUCH, relation", "없는 보기 'NO_SUCH'"),
        ("questionId: SWITCH_INTENT", "questionId: NO_QUESTION", "없는 질문 'NO_QUESTION'"),
        ("questionId: SWITCH_INTENT", "questionId: CONFIRM_PROCESS", "choices"),
    ],
)
def test_check_config_compares_the_table_with_the_question_file(
    tmp_path, monkeypatch, old, new, expected
):
    """Given 꼬리 질문 파일에 없는 질문·보기 / When check-config / Then 줄 번호와 함께 실패한다."""
    from geosan.commands.check_config import run_check_config

    monkeypatch.setenv("GEOSAN_DB_PATH", str(tmp_path / "none.db"))
    lines: list[str] = []
    monkeypatch.setattr("typer.echo", lambda text="": lines.append(str(text)))
    assert run_check_config(_config_copy(tmp_path, old, new), None) == 1
    output = "\n".join(lines)
    assert expected in output and "번째 줄" in output
    lines.clear()
    assert run_check_config(DEFAULT_RULE_CONFIG_PATH, None) == 0, "\n".join(lines)


def test_case_file_cannot_carry_a_call_signal(tmp_path):
    """Given 통화 신호를 적은 사례 파일 / When 검사 / Then 거부한다(통화 신호는 접촉 기록에서만)."""
    from geosan.config.file_checks import check_case_file

    data = factories.apjeong_case()
    data["signals"].append(
        {
            "signalKind": "CALL_INTENT",
            "occurredAt": "2026-10-19",
            "certainty": "CONFIRMED",
            "relation": "DIRECT",
        }
    )
    report = check_case_file(_write(tmp_path, "call.json", data))
    assert any("통화 신호(CALL_INTENT)는 사례 파일에" in e.message for e in report.errors)


# ---------------------------------------------------------------------------
# 가장 센 것 하나 · 가장 최근 답
# ---------------------------------------------------------------------------


def test_strongest_answer_wins_and_ties_take_the_latest_call():
    """Given 한 항목에 맞는 답 여럿 / When 고름 / Then 직접 > 간접, 같으면 더 최근 접촉."""
    rule = load_rule_config(DEFAULT_RULE_CONFIG_PATH).call_signals[0]
    old, new = date(2026, 10, 1), date(2026, 10, 15)
    both = {"QUOTE_REQUEST": CallAnswer("MATERIAL", new), "SWITCH_INTENT": CallAnswer("YES", old)}
    chosen = wanted_signal(rule, both)
    assert (chosen.relation, chosen.day, chosen.answer_id) == ("DIRECT", old, "YES")
    direct = {"QUOTE_REQUEST": CallAnswer("QUOTE", old), "SWITCH_INTENT": CallAnswer("YES", new)}
    assert wanted_signal(rule, direct).day == new
    unknown = {
        "QUOTE_REQUEST": CallAnswer("NOT_YET", new),
        "SWITCH_INTENT": CallAnswer("UNKNOWN", new),
    }
    assert wanted_signal(rule, unknown) is None
    assert wanted_signal(rule, {}) is None


def test_material_request_gives_half_and_a_later_quote_replaces_it(call_env):
    """Given 자료 요청(절반) / When 나중 통화에서 견적 요청 / Then 4점에서 7점, 신호는 하나."""
    client, free, _ = call_env
    call(client, free, MATERIAL, days_ago=3)
    assert item(client, free, "SIG_BID")["score"] == 4
    assert item(client, free, "SIG_BID")["factJudged"] == "통화에서 확인(10/17) · 자료 요청"
    meta = call(client, free, QUOTE)["meta"]
    assert meta["reevaluated"] is True
    assert item(client, free, "SIG_BID")["score"] == 7
    assert call_signals(free) == [("CALL_INTENT", "DIRECT", BASE_DATE, "CALL", None)]
    assert len(call_signals(free, live=False)) == 2


def test_latest_answer_to_the_same_question_decides(call_env):
    """Given 견적 요청 뒤 / When 같은 질문에 "아직 없음" / Then 가장 최근 답이라 신호가 없어진다."""
    client, free, _ = call_env
    before = item(client, free, "SIG_BID")
    call(client, free, QUOTE, days_ago=5)
    assert item(client, free, "SIG_BID")["score"] == 7
    meta = call(client, free, NOT_YET)["meta"]
    assert meta["reevaluated"] is True
    assert call_signals(free) == []
    after = item(client, free, "SIG_BID")
    assert (after["state"], after["score"], after["factJudged"]) == (
        before["state"],
        before["score"],
        before["factJudged"],
    )
    # 덮기 전 사례 파일 행이 새 버전으로 되살아났다(지운 행 없음).
    assert input_rows(free, "SIG_BID") == [
        (1, "FILE", "NO_SIGNAL", False),
        (2, "CALL", "CONFIRMED", False),
        (3, "FILE", "NO_SIGNAL", True),
    ]


def test_two_items_are_filled_independently(call_env):
    """Given 외주처 바꿀 생각 있음 + 관심 보통 / When 저장 / Then 의향 7점, 관심 3점(절반)."""
    client, free, _ = call_env
    before = detail(client, free)["scores"]
    call(client, free, SWITCH_YES, ("INTEREST", "MEDIUM"))
    after = detail(client, free)["scores"]
    assert item(client, free, "SIG_BID")["score"] == 7
    hire = item(client, free, "SIG_HIRE")
    assert (hire["score"], hire["state"], hire["matchRate"]) == (3, "CONFIRMED", 0.5)
    assert hire["factJudged"] == "통화에서 확인(10/20) · 보통"
    assert after["E"] == before["E"] + 10
    assert sorted(row[0] for row in call_signals(free)) == ["CALL_INTENT", "CALL_INTEREST"]


# ---------------------------------------------------------------------------
# 사례 파일 공고 우선 · 같은 입력이면 다시 쓰지 않음 · 실패하면 전부 취소
# ---------------------------------------------------------------------------


def test_case_file_bid_score_is_not_overwritten_by_a_call(call_env):
    """Given 사례 파일 공고 7점(A정밀) / When 견적 요청 저장 / Then 공고 값 그대로다."""
    client, _, apjeong = call_env
    before = detail(client, apjeong)
    response = call(client, apjeong, QUOTE)
    assert "reevaluated" not in response["meta"] or response["meta"]["reevaluated"] is not True
    after = detail(client, apjeong)
    assert after["evalId"] == before["evalId"]
    assert item(client, apjeong, "SIG_BID") == next(
        row for row in before["scores"]["items"] if row["itemCode"] == "SIG_BID"
    )
    assert input_rows(apjeong, "SIG_BID") == [(1, "FILE", "CONFIRMED", True)]
    # 신호 행은 저장해 두지만 항목에는 연결하지 않는다(BID와 통화 신호를 같이 연결하지 않음).
    assert call_signals(apjeong) == [("CALL_INTENT", "DIRECT", BASE_DATE, "CALL", None)]
    with session_scope() as session:
        row = next(r for r in current_item_inputs(session, apjeong) if r.item_code == "SIG_BID")
        kinds = {session.get(Signal, key).signal_kind for key in row.signal_ids}
    assert kinds == {"BID"}


def test_apjeong_missing_hire_item_is_filled_by_interest(call_env):
    """Given A정밀의 미확보 항목(관심) / When 관심 높음 / Then 5점이 붙고 공고 7점은 그대로."""
    client, _, apjeong = call_env
    meta = call(client, apjeong, ("INTEREST", "HIGH"))["meta"]
    assert meta["reevaluated"] is True
    assert item(client, apjeong, "SIG_HIRE")["score"] == 5
    assert item(client, apjeong, "SIG_BID")["score"] == 7
    scores = detail(client, apjeong)["scores"]
    assert (scores["E"], scores["P"], scores["R"]) == (82, 100, 82)


def test_same_answers_write_nothing_again(call_env):
    """Given 견적 요청이 반영된 회사 / When 관계없는 접촉을 더 저장 / Then 신호·입력·평가 그대로."""
    client, free, _ = call_env
    call(client, free, QUOTE)
    snapshot = (
        call_signals(free, live=False),
        input_rows(free, "SIG_BID"),
        input_rows(free, "SIG_HIRE"),
        detail(client, free)["evalId"],
    )
    response = call(client, free, ("WHO_TALKED", "RIGHT_PERSON"))
    assert response["meta"].get("reevaluated") is not True
    response = records.post(client, free, "outcomes", questions.contact(result="ABSENT"))
    assert response.status_code == 200 and response.json()["meta"].get("reevaluated") is not True
    assert snapshot == (
        call_signals(free, live=False),
        input_rows(free, "SIG_BID"),
        input_rows(free, "SIG_HIRE"),
        detail(client, free)["evalId"],
    )


def test_failed_reevaluation_cancels_the_contact_and_the_signal(call_env, monkeypatch):
    """Given 다시 평가가 실패하는 상태 / When 견적 요청 저장 / Then 접촉·신호·입력 모두 그대로."""
    client, free, _ = call_env
    before = (input_rows(free, "SIG_BID"), detail(client, free)["evalId"])
    monkeypatch.setattr(records_routes, "evaluate_in_session", lambda *_: FlowResult(ok=False))
    body = questions.contact(answers=[QUOTE])
    response = records.post(client, free, "outcomes", body)
    assert response.status_code == 500
    assert "통화에서 확인한 신호를 다시 평가하지 못해" in response.text
    assert call_signals(free, live=False) == []
    assert (input_rows(free, "SIG_BID"), detail(client, free)["evalId"]) == before
    with session_scope() as session:
        assert not list(session.scalars(select(Outcome).where(Outcome.opp_id == free)))


def test_failed_reevaluation_keeps_the_record_uncancelled(call_env, monkeypatch):
    """Given 견적 요청이 반영된 회사 / When 취소 뒤 다시 평가 실패 / Then 취소 표시도 저장 안 됨."""
    client, free, _ = call_env
    call(client, free, QUOTE)
    record_id = cancels.record_id_of(client, free, "CONTACT_ATTEMPT")
    monkeypatch.setattr(records_routes, "evaluate_in_session", lambda *_: FlowResult(ok=False))
    response = cancels.cancel(client, free, record_id)
    assert response.status_code == 500
    with session_scope() as session:
        assert session.get(Outcome, record_id).cancelled_at is None
    assert item(client, free, "SIG_BID")["score"] == 7


def test_cancelling_a_note_does_not_touch_signals(call_env):
    """Given 견적 요청이 반영된 회사 / When 메모를 취소 / Then 다시 평가하지 않는다."""
    client, free, _ = call_env
    call(client, free, QUOTE)
    assert records.post(client, free, "notes", {"text": "가상 메모"}).status_code == 200
    eval_id = detail(client, free)["evalId"]
    response = cancels.cancel(client, free, cancels.record_id_of(client, free, "NOTE"))
    assert response.status_code == 200 and response.json()["meta"].get("reevaluated") is not True
    assert detail(client, free)["evalId"] == eval_id


def test_reimport_keeps_the_call_signal_and_its_score(call_env, tmp_path):
    """Given 견적 요청이 반영된 회사 / When 사례 파일 재투입 / Then 통화 신호와 7점이 남는다."""
    client, free, _ = call_env
    call(client, free, QUOTE)
    import_case(_write(tmp_path, "again.json", case_without_bid()))
    assert run_evaluation(opp_ids=[free]).ok
    assert call_signals(free) == [("CALL_INTENT", "DIRECT", BASE_DATE, "CALL", None)]
    assert item(client, free, "SIG_BID")["score"] == 7
    assert input_rows(free, "SIG_BID")[-2:] == [
        (3, "FILE", "NO_SIGNAL", False),
        (4, "CALL", "CONFIRMED", True),
    ]
