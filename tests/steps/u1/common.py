"""공통 단계: 임시 DB·파일 투입·평가·목록/상세 조회·A정밀 판정 확인 (여러 feature가 함께 쓴다).

실제 호출 경로: 명령은 Typer 앱(`geosan` CLI)을 같은 프로세스에서 돌리고, 확인은 저장소 모델
(PM 세션)과 웹 API(TestClient)로 한다. 구현이 아직 없는 단계는 `_support.lazy_attr`가 명시적으로
실패시킨다.
"""

from __future__ import annotations

from datetime import date
from pathlib import Path
from typing import Any

import pytest
from parse import with_pattern
from pytest_bdd import given, parsers, then, when
from sqlalchemy import select

from tests import factories
from tests.steps.u1._support import (
    APJEONG_CASE_ID,
    DATA_DIR,
    EXAMPLES_DIR,
    ScenarioContext,
    api_client,
    init_db,
    lazy_attr,
    model,
    require_ok,
    run_cli,
    session_scope,
    write_json,
)


@with_pattern(r"[A-Z][A-Z_]*")
def parse_code(text: str) -> str:
    """영문 코드(C0 열거값)만 받는 parse 타입. '{x:Code}'로 쓴다."""
    return text


EXTRA_TYPES = {"Code": parse_code}


def P(pattern: str):
    """코드 타입(Code)을 아는 parse 파서. 단계 문장은 이 별칭으로 짧게 적는다."""
    return parsers.parse(pattern, extra_types=EXTRA_TYPES)


# ---------------------------------------------------------------------------
# 픽스처
# ---------------------------------------------------------------------------


@pytest.fixture
def ctx() -> ScenarioContext:
    return ScenarioContext()


# ---------------------------------------------------------------------------
# 저장소 조회 도우미 (각 feature의 단계가 함께 쓴다)
# ---------------------------------------------------------------------------


def opp_id_for(case_id: str) -> str:
    opportunity = model("opportunity", "Opportunity")
    with session_scope() as session:
        rows = session.scalars(select(opportunity).where(opportunity.case_id == case_id)).all()
    if len(rows) != 1:
        pytest.fail(f"caseId {case_id}인 기회가 {len(rows)}건입니다 (1건이어야 함)")
    return rows[0].opp_id


def confirmed_evals(opp_id: str) -> list[Any]:
    """기회의 CONFIRMED 평가(최신 먼저)."""
    run = model("evaluation", "EvaluationRun")
    with session_scope() as session:
        rows = session.scalars(
            select(run)
            .where(run.opp_id == opp_id, run.run_status == "CONFIRMED")
            .order_by(run.created_at.desc(), run.eval_id.desc())
        ).all()
        session.expunge_all()
    return rows


def latest_eval(case_id: str = APJEONG_CASE_ID) -> Any:
    rows = confirmed_evals(opp_id_for(case_id))
    if not rows:
        pytest.fail(f"{case_id}의 확정 평가가 없습니다 (evaluate가 저장하지 않음)")
    return rows[0]


def all_evals(case_id: str = APJEONG_CASE_ID) -> list[Any]:
    run = model("evaluation", "EvaluationRun")
    opp_id = opp_id_for(case_id)
    with session_scope() as session:
        rows = session.scalars(
            select(run)
            .where(run.opp_id == opp_id)
            .order_by(run.created_at.asc(), run.eval_id.asc())
        ).all()
        session.expunge_all()
    return rows


def requirement_checks(eval_id: str) -> dict[str, Any]:
    """요구 이름 → RequirementCheck 행."""
    check = model("evaluation", "RequirementCheck")
    requirement = model("opportunity", "Requirement")
    with session_scope() as session:
        rows = session.execute(
            select(check, requirement.name)
            .join(requirement, requirement.req_id == check.req_id)
            .where(check.eval_id == eval_id)
        ).all()
        session.expunge_all()
    return {name: row for row, name in rows}


def waiting_questions(opp_id: str) -> list[Any]:
    question = model("questions", "ConfirmationQuestion")
    link = model("questions", "QuestionOpportunityLink")
    with session_scope() as session:
        rows = session.scalars(
            select(question)
            .join(link, link.question_id == question.question_id)
            .where(link.opp_id == opp_id, question.status == "WAITING")
        ).all()
        session.expunge_all()
    return rows


def import_case_file(path: Path, ctx: ScenarioContext) -> None:
    ctx.last_cli = require_ok(run_cli("import-case", str(path)), "import-case")


def evaluate(ctx: ScenarioContext) -> None:
    result = require_ok(run_cli("evaluate"), "evaluate")
    ctx.last_cli = result


# ---------------------------------------------------------------------------
# 배경·투입
# ---------------------------------------------------------------------------


@given("임시 데이터베이스가 준비되어 있다")
def _db_ready(tmp_db: Path) -> None:
    init_db(tmp_db)
    assert tmp_db.exists(), "init-db가 DB 파일을 만들지 않았습니다"


@given("가상 검수 역량 파일을 투입했다")
@when("가상 검수 역량 파일을 투입하면")
def _import_capability(ctx: ScenarioContext) -> None:
    ctx.last_cli = run_cli("import-capability", str(EXAMPLES_DIR / "capability-geosan.json"))
    require_ok(ctx.last_cli, "import-capability")


@given("소개서 묶음 역량 파일을 투입했다")
@when("소개서 묶음 역량 파일을 투입하면")
def _import_brochure_capability(ctx: ScenarioContext) -> None:
    ctx.last_cli = run_cli("import-capability", str(DATA_DIR / "capability-brochure.json"))
    require_ok(ctx.last_cli, "import-capability(BROCHURE)")


@given("A정밀 사례 파일을 투입했다")
def _import_apjeong(ctx: ScenarioContext) -> None:
    import_case_file(EXAMPLES_DIR / "case-apjeong.json", ctx)


@given("활성 거산 값 묶음을 BROCHURE로 두었다")
def _activate_brochure() -> None:
    setter = lazy_attr("geosan.config.registry", "set_active_dataset_kind", "Step 11 (PM 세션)")
    with session_scope() as session:
        setter(session, "BROCHURE", updated_by="test")


@given("평가를 실행했다")
@when("평가를 실행하면")
def _evaluate(ctx: ScenarioContext) -> None:
    evaluate(ctx)


@when("평가를 두 번 실행하면")
def _evaluate_twice(ctx: ScenarioContext) -> None:
    evaluate(ctx)
    first = latest_eval()
    evaluate(ctx)
    second = latest_eval()
    ctx.extra["pair"] = (first, second)


# ---------------------------------------------------------------------------
# A정밀 평가 결과 확인
# ---------------------------------------------------------------------------


@then(P("A정밀의 최신 확정 평가는 E {e:d}, P {p:d}, S {s:g}, R {r:d}, C {c:g}이다"))
def _scores(e: int, p: int, s: float, r: int, c: float) -> None:
    run = latest_eval()
    assert (run.score_e, run.score_p, run.score_r) == (e, p, r), (
        f"E/P/R = {run.score_e}/{run.score_p}/{run.score_r}"
    )
    assert run.score_s == pytest.approx(s, abs=1e-9), f"S = {run.score_s}"
    assert run.completion_c == pytest.approx(c, abs=1e-9), f"C = {run.completion_c}"


@then(P("A정밀의 최신 확정 평가는 E {e:d}, P {p:d}로 계산되어 있다"))
def _scores_ep(e: int, p: int) -> None:
    run = latest_eval()
    assert (run.score_e, run.score_p) == (e, p), f"E/P = {run.score_e}/{run.score_p}"


@then(P("A정밀의 필터 상태는 {filter_state:Code}, 핵심 근거는 {core:Code}, 분류는 {code:Code}이다"))
def _filter_core_class(filter_state: str, core: str, code: str) -> None:
    run = latest_eval()
    assert run.filter_state == filter_state
    assert run.core_evidence_met == core
    assert run.classification_code == code


@then(P("A정밀의 필터 상태는 {filter_state:Code}이고 분류는 {code:Code}이다"))
def _filter_class(filter_state: str, code: str) -> None:
    run = latest_eval()
    assert (run.filter_state, run.classification_code) == (filter_state, code)


@then(P("A정밀의 필터 상태는 {filter_state:Code}이다"))
def _filter_only(filter_state: str) -> None:
    assert latest_eval().filter_state == filter_state


@then(P('A정밀의 "{name}" 판정은 {result:Code}이고 판정 표시는 {display:Code}이다'))
def _req_check(name: str, result: str, display: str) -> None:
    row = requirement_checks(latest_eval().eval_id).get(name)
    assert row is not None, f"요구 '{name}'의 판정 행이 없습니다"
    assert (row.result, row.display_result) == (result, display)


@then(P('A정밀의 "{name}" 판정 표시는 {display:Code}이다'))
def _req_display(name: str, display: str) -> None:
    row = requirement_checks(latest_eval().eval_id).get(name)
    assert row is not None, f"요구 '{name}'의 판정 행이 없습니다"
    assert row.display_result == display


@then(P('A정밀의 "{name}" 판정은 {result:Code}이다'))
def _req_result(name: str, result: str) -> None:
    row = requirement_checks(latest_eval().eval_id).get(name)
    assert row is not None, f"요구 '{name}'의 판정 행이 없습니다"
    assert row.result == result


@then(P('A정밀의 필터 상태는 {filter_state:Code}이고 "{name}" 판정 표시는 {display:Code}이다'))
def _filter_and_display(filter_state: str, name: str, display: str) -> None:
    run = latest_eval()
    assert run.filter_state == filter_state
    row = requirement_checks(run.eval_id).get(name)
    assert row is not None, f"요구 '{name}'의 판정 행이 없습니다"
    assert row.display_result == display


@then("A정밀의 막는 조건은 승인을 막지 않는다")
def _blocker_not_blocking() -> None:
    assert latest_eval().blocks_approval is False


@then("A정밀의 막는 조건은 승인을 막는다")
def _blocker_blocking() -> None:
    assert latest_eval().blocks_approval is True


@then(P('A정밀의 막는 조건에 "{text}"이 있고 승인을 막는다'))
def _blocker_text(text: str) -> None:
    run = latest_eval()
    assert text in run.blocker_text, run.blocker_text
    assert run.blocks_approval is True


@then("A정밀의 이전 평가는 그대로 남아 있다")
def _previous_eval_kept() -> None:
    rows = all_evals()
    assert len(rows) >= 2, "평가가 두 건 이상 있어야 합니다"
    assert any(row.run_status == "SUPERSEDED" for row in rows[:-1])


@then(P("A정밀의 확정 평가 {count:d}건은 그대로 남아 있다"))
def _confirmed_count_kept(count: int) -> None:
    assert len(confirmed_evals(opp_id_for(APJEONG_CASE_ID))) == count


# ---------------------------------------------------------------------------
# 웹 API 조회
# ---------------------------------------------------------------------------


@when("추천 목록을 조회하면")
def _fetch_list(ctx: ScenarioContext) -> None:
    response = api_client().get("/api/v1/opportunities")
    assert response.status_code == 200, response.text
    ctx.list_response = response.json()


def cards(ctx: ScenarioContext) -> list[dict[str, Any]]:
    if ctx.list_response is None:
        response = api_client().get("/api/v1/opportunities")
        assert response.status_code == 200, response.text
        ctx.list_response = response.json()
    return ctx.list_response["data"]


@then(P('카드는 {count:d}건이고 순위 {rank:d}, 분류 {code:Code}, 점수 표시 "{display}"이다'))
def _card_rank(ctx: ScenarioContext, count: int, rank: int, code: str, display: str) -> None:
    items = cards(ctx)
    assert len(items) == count, items
    card = items[0]
    assert (card["rank"], card["classificationCode"], card["scoreDisplay"]) == (rank, code, display)


@then(P('카드는 {count:d}건이고 분류 {code:Code}, 점수 표시 "{display}"이다'))
def _card_class(ctx: ScenarioContext, count: int, code: str, display: str) -> None:
    items = cards(ctx)
    assert len(items) == count, items
    assert (items[0]["classificationCode"], items[0]["scoreDisplay"]) == (code, display)


@then(P('그 카드의 막는 조건은 "{prefix}"으로 시작하고 승인을 막지 않는다'))
def _card_blocker_open(ctx: ScenarioContext, prefix: str) -> None:
    blocker = cards(ctx)[0]["blocker"]
    assert blocker["text"].startswith(prefix), blocker
    assert blocker["blocksApproval"] is False


@then("그 카드의 막는 조건은 승인을 막는다")
def _card_blocker_blocks(ctx: ScenarioContext) -> None:
    assert cards(ctx)[0]["blocker"]["blocksApproval"] is True


@then(P("목록 meta에 가상 데이터 표시가 있고 묶음은 {kind:Code}이다"))
def _list_meta_virtual(ctx: ScenarioContext, kind: str) -> None:
    cards(ctx)
    meta = ctx.list_response["meta"]
    assert meta["hasVirtualData"] is True
    assert meta["datasetKind"] == kind


@when("A정밀 근거 상세를 조회하면")
def _fetch_detail(ctx: ScenarioContext) -> None:
    opp_id = opp_id_for(APJEONG_CASE_ID)
    response = api_client().get(f"/api/v1/opportunities/{opp_id}")
    assert response.status_code == 200, response.text
    ctx.detail_response = response.json()


def detail(ctx: ScenarioContext) -> dict[str, Any]:
    assert ctx.detail_response is not None, "먼저 상세를 조회해야 합니다"
    return ctx.detail_response["data"]


@then(
    P(
        '요구 표에서 "{n1}"은 {d1:Code}, "{n2}"은 {d2:Code}, "{n3}"은 {d3:Code}이다',
    )
)
def _detail_requirements(
    ctx: ScenarioContext, n1: str, d1: str, n2: str, d2: str, n3: str, d3: str
) -> None:
    table = {row["name"]: row["result"] for row in detail(ctx)["requirements"]}
    assert table == {n1: d1, n2: d2, n3: d3}, table


@then(P("상세의 확인 질문은 {count:d}개이고 {keyword}에 관한 것이다"))
def _detail_questions(ctx: ScenarioContext, count: int, keyword: str) -> None:
    questions = detail(ctx)["reasons"]["questions"]
    assert len(questions) == count, questions
    assert keyword in questions[0]["text"], questions[0]


@then(P("상세의 점수 세부는 E {e:d}, P {p:d}, S {s:g}, R {r:d}이다"))
def _detail_scores(ctx: ScenarioContext, e: int, p: int, s: float, r: int) -> None:
    scores = detail(ctx)["scores"]
    assert (scores["E"], scores["P"], scores["R"]) == (e, p, r), scores
    assert scores["S"] == pytest.approx(s, abs=1e-9)


@then("상세의 승인 가능 여부는 가능이다")
def _detail_eligible(ctx: ScenarioContext) -> None:
    assert detail(ctx)["approvalEligibility"]["eligible"] is True


@then(P("상세의 고객 관계는 {relation:Code}이고 대응 목적은 {purpose:Code}이다"))
def _detail_relation(ctx: ScenarioContext, relation: str, purpose: str) -> None:
    header = detail(ctx)["header"]
    assert (header["relationStatus"], header["purpose"]) == (relation, purpose), header


@then(P('상세의 관계 메모에 "{text}"이 있다'))
def _detail_relation_note(ctx: ScenarioContext, text: str) -> None:
    note = detail(ctx)["header"].get("relationNote") or ""
    assert text in note, note


@then(P("A정밀의 평가 프로필은 {profile:Code}이고 상세는 재접촉이 아니다"))
def _profile_new(ctx: ScenarioContext, profile: str) -> None:
    assert latest_eval().profile == profile
    assert detail(ctx)["header"]["isRecontact"] is False


# ---------------------------------------------------------------------------
# 의견 저장 (S10과 뼈대 끝단이 함께 쓴다)
# ---------------------------------------------------------------------------

OPINION_PATTERN = (
    r"^담당자 (?P<staff>[a-z-]+)[가이] "
    r"(?:expectedVersion (?P<expected>\d+)로 )?"
    r"(?:기억한 평가 ID로 )?"
    r"A정밀에 의견 (?P<opinion>[A-Z_]+)[을를]"
    r'(?: 사유 "(?P<reason>[^"]*)"[으]?로| 사유 없이| 메모 "(?P<memo>[^"]*)"[으]?로)?'
    r" 저장(?:하면|했다)$"
)


def save_opinion(
    ctx: ScenarioContext,
    staff: str | None,
    opinion: str,
    *,
    reason: str | None = None,
    memo: str | None = None,
    expected: int | None = None,
    eval_id: str | None = None,
) -> None:
    opp_id = opp_id_for(APJEONG_CASE_ID)
    body: dict[str, Any] = {
        "opinion": opinion,
        "evalId": eval_id or latest_eval().eval_id,
    }
    if reason:
        body["reason"] = reason
    if memo:
        body["memo"] = memo
    if expected is not None:
        body["expectedVersion"] = expected
    headers = {"X-Staff-Key": staff} if staff else {}
    ctx.opinion_response = api_client().post(
        f"/api/v1/opportunities/{opp_id}/opinions", json=body, headers=headers
    )


@given(parsers.re(OPINION_PATTERN))
@when(parsers.re(OPINION_PATTERN))
def _save_opinion_step(
    ctx: ScenarioContext,
    staff: str,
    opinion: str,
    expected: str | None,
    reason: str | None,
    memo: str | None,
) -> None:
    uses_remembered = ctx.remembered_eval_id is not None and expected is None
    save_opinion(
        ctx,
        staff,
        opinion,
        reason=reason,
        memo=memo,
        expected=int(expected) if expected else None,
        eval_id=ctx.remembered_eval_id if uses_remembered else None,
    )


@then(P("의견 응답은 {status:d}이고 version {version:d}, updatedBy {staff}이다"))
def _opinion_saved(ctx: ScenarioContext, status: int, version: int, staff: str) -> None:
    response = ctx.opinion_response
    assert response.status_code == status, response.text
    data = response.json()["data"]
    assert (data["version"], data["updatedBy"]) == (version, staff), data


@then(P("의견 응답은 {status:d}이다"))
def _opinion_status(ctx: ScenarioContext, status: int) -> None:
    assert ctx.opinion_response.status_code == status, ctx.opinion_response.text


@then(P("추천 목록 카드의 현재 의견은 {opinion:Code}이다"))
def _card_opinion(ctx: ScenarioContext, opinion: str) -> None:
    ctx.list_response = None
    card = cards(ctx)[0]
    assert card["records"]["opinion"]["opinion"] == opinion, card["records"]


# ---------------------------------------------------------------------------
# 사례 파일 변형 투입 (여러 feature가 쓴다)
# ---------------------------------------------------------------------------


@given(P("관계 상태를 {relation:Code}로 바꾼 A정밀 사례 파일을 투입했다"))
def _import_relation_variant(ctx: ScenarioContext, tmp_path: Path, relation: str) -> None:
    path = write_json(tmp_path, "case-relation.json", factories.apjeong_with_relation(relation))
    import_case_file(path, ctx)


@then(
    P(
        "A정밀의 평가 묶음에 프로필 {profile:Code}, 기준일 {base}, 규칙 버전 {version}와 해시, "
        "묶음 {kind:Code}가 남는다"
    )
)
def _batch_recorded(profile: str, base: str, version: str, kind: str) -> None:
    batch_model = model("evaluation", "EvaluationBatch")
    run = latest_eval()
    with session_scope() as session:
        batch = session.get(batch_model, run.batch_id)
        assert batch is not None, "평가 묶음이 없습니다"
        assert batch.profile == profile
        assert batch.base_date == date.fromisoformat(str(base)[:10])
        assert batch.rule_version == version
        assert batch.rule_hash and len(batch.rule_hash) == 64
        assert batch.dataset_kind == kind
        assert batch.status == "CONFIRMED"


# ---------------------------------------------------------------------------
# verify-case (W4, BR11.2) — Step 19 나머지(PM 세션) 연결 뒤 추가
# ---------------------------------------------------------------------------


@when("A정밀 사례 파일로 verify-case를 실행하면")
def _verify_apjeong(ctx: ScenarioContext) -> None:
    ctx.last_cli = run_cli("verify-case", str(EXAMPLES_DIR / "case-apjeong.json"))


@then(P('명령 출력에 "{text}"가 있고 종료 코드는 {code:d}이다'))
def _output_and_exit_code(ctx: ScenarioContext, text: str, code: int) -> None:
    assert ctx.last_cli is not None, "먼저 명령을 실행해야 합니다"
    assert text in ctx.last_cli.output, ctx.last_cli.output
    assert ctx.last_cli.exit_code == code, (
        f"종료 코드 {ctx.last_cli.exit_code} (기대 {code}):\n{ctx.last_cli.output}"
    )


@then("두 평가의 점수·분류·순위가 완전히 같다")
def _two_runs_identical(ctx: ScenarioContext) -> None:
    """같은 입력을 두 번 평가하면 점수·분류·순위가 같다(AC5.1.2, NFR1).

    pair는 '평가를 두 번 실행하면'이 둔다."""
    pair = ctx.extra.get("pair")
    assert pair is not None, "먼저 '평가를 두 번 실행하면'이 있어야 합니다"
    first, second = pair
    assert first.eval_id != second.eval_id, "두 번째 평가가 새 평가 행이어야 합니다"
    key = lambda r: (  # noqa: E731
        r.score_e,
        r.score_p,
        r.score_s,
        r.score_r,
        r.completion_c,
        r.classification_code,
        r.original_rank,
    )
    assert key(first) == key(second), (key(first), key(second))


@then("A정밀의 이전 평가는 SUPERSEDED로 남고 새 평가가 이전 평가를 가리킨다")
def _previous_superseded(ctx: ScenarioContext) -> None:
    """재평가하면 이전 평가는 SUPERSEDED, 새 평가가 이전 평가를 가리킨다(BR7.1·BR7.2)."""
    pair = ctx.extra.get("pair")
    assert pair is not None, "먼저 '평가를 두 번 실행하면'이 있어야 합니다"
    first_id, second_id = pair[0].eval_id, pair[1].eval_id
    run = model("evaluation", "EvaluationRun")
    with session_scope() as session:
        first = session.get(run, first_id)
        second = session.get(run, second_id)
        assert first is not None and second is not None
        assert first.run_status == "SUPERSEDED", first.run_status
        assert second.run_status == "CONFIRMED", second.run_status
        assert second.previous_eval_id == first_id, second.previous_eval_id
