"""규칙 엔진 단독 시나리오 단계 (reading_example2.feature).

`geosan.rules.engine.evaluate`(Step 13, 유동렬)를 직접 부른다. DB·명령을 거치지 않는다.
"""

from __future__ import annotations

from datetime import date

import pytest
from pytest_bdd import given, then, when

from geosan.config.loader import load_document
from geosan.rules.models import EvaluationInput
from tests.steps.u1._support import DATA_DIR, ScenarioContext, lazy_attr
from tests.steps.u1.common import P

CONTACT_CODES = {"CONTACT_URGENT", "CONTACT_PLANNED", "CONTACT_REVIEW"}


def engine_evaluate():
    return lazy_attr("geosan.rules.engine", "evaluate", "Step 13 (유동렬)")


@given("읽기 예시 2 입력 파일을 읽었다")
def _load_ex2(ctx: ScenarioContext) -> None:
    ctx.engine_input = EvaluationInput.model_validate(
        load_document(DATA_DIR / "reading_example2.json").data
    )


@given("A정밀 입력 파일을 읽었다")
def _load_apjeong(ctx: ScenarioContext) -> None:
    ctx.engine_input = EvaluationInput.model_validate(
        load_document(DATA_DIR / "apjeong-input.json").data
    )


@given("기한 체크를 뺐다")
def _drop_readiness(ctx: ScenarioContext) -> None:
    ctx.engine_input.readiness_check = None


@when("규칙 엔진으로 평가하면")
def _evaluate(ctx: ScenarioContext) -> None:
    ctx.engine_outputs = [engine_evaluate()(ctx.engine_input)]


@when("규칙 엔진으로 두 번 평가하면")
def _evaluate_twice(ctx: ScenarioContext) -> None:
    evaluate = engine_evaluate()
    ctx.engine_outputs = [evaluate(ctx.engine_input), evaluate(ctx.engine_input)]


def output(ctx: ScenarioContext):
    assert ctx.engine_outputs, "먼저 규칙 엔진으로 평가해야 합니다"
    return ctx.engine_outputs[-1]


@then(P("합계는 E {e:d}, P {p:d}, S {s:g}, C {c:g}이다"))
def _totals(ctx: ScenarioContext, e: int, p: int, s: float, c: float) -> None:
    totals = output(ctx).totals
    assert (totals.E, totals.P) == (e, p), totals
    assert totals.S == pytest.approx(s, abs=1e-9), totals
    assert totals.C == pytest.approx(c, abs=1e-9), totals


@then(P("합계는 E {e:d}, P {p:d}, S {s:g}, C {c:g}이고 R은 {r:d}, F는 {f:d}, T는 {t:d}이다"))
def _totals_full(
    ctx: ScenarioContext, e: int, p: int, s: float, c: float, r: int, f: int, t: int
) -> None:
    totals = output(ctx).totals
    assert (totals.E, totals.P, totals.R, totals.F, totals.T) == (e, p, r, f, t), totals
    assert totals.S == pytest.approx(s, abs=1e-9), totals
    assert totals.C == pytest.approx(c, abs=1e-9), totals


@then("분류는 접촉 후보가 아니다")
def _not_contact(ctx: ScenarioContext) -> None:
    assert output(ctx).classification_code not in CONTACT_CODES


@then(P("항목 행은 {count:d}개이고 미확보 항목 {unavailable:d}개의 점수는 null이다"))
def _items_unavailable(ctx: ScenarioContext, count: int, unavailable: int) -> None:
    items = output(ctx).items
    assert len(items) == count
    nulls = [i for i in items if i.state == "UNAVAILABLE"]
    assert len(nulls) == unavailable
    assert all(i.score is None for i in nulls)
    assert all(i.score is not None for i in items if i.state != "UNAVAILABLE")


@then(
    "항목 점수는 NEW_PRODUCT 25, NEW_MATERIAL 20, NEW_RECORD 10, NEW_PERF 5, SIG_EXPAND 10, "
    "SIG_ORDER 0, SIG_BID 7이고 SIG_HIRE는 null이다"
)
def _item_scores(ctx: ScenarioContext) -> None:
    scores = {item.item_code: item.score for item in output(ctx).items}
    assert scores == {
        "NEW_PRODUCT": 25,
        "NEW_MATERIAL": 20,
        "NEW_RECORD": 10,
        "NEW_PERF": 5,
        "SIG_EXPAND": 10,
        "SIG_ORDER": 0,
        "SIG_BID": 7,
        "SIG_HIRE": None,
    }, scores


@then(P('요구 판정 표시는 "{n1}" {d1:Code}, "{n2}" {d2:Code}, "{n3}" {d3:Code}이다'))
def _req_displays(
    ctx: ScenarioContext, n1: str, d1: str, n2: str, d2: str, n3: str, d3: str
) -> None:
    by_req = {}
    for check in output(ctx).requirement_checks:
        req = next(r for r in ctx.engine_input.requirements if r.req_id == check.req_id)
        by_req[req.name] = check.display_result
    assert by_req == {n1: d1, n2: d2, n3: d3}, by_req


@then(P("필터 상태는 {filter_state:Code}, 핵심 근거는 {core:Code}, 시점 요건 셋은 모두 참이다"))
def _filter_core_timing(ctx: ScenarioContext, filter_state: str, core: str) -> None:
    out = output(ctx)
    assert out.filter_state == filter_state
    assert out.core_evidence_met == core
    assert (out.timing.direct_signal, out.timing.agreed_window, out.timing.readiness) == (
        True,
        True,
        True,
    ), out.timing


@then(P("분류는 {code:Code}이고 정렬 그룹은 {group:Code}, 유효 기한은 {day}이다"))
def _class_group_valid_until(ctx: ScenarioContext, code: str, group: str, day: str) -> None:
    out = output(ctx)
    assert out.classification_code == code
    assert out.sort_key.group == group
    assert out.sort_key.valid_until == date.fromisoformat(day)


@then(P("분류는 {code:Code}이고 정렬 그룹은 {group:Code}이다"))
def _class_group(ctx: ScenarioContext, code: str, group: str) -> None:
    out = output(ctx)
    assert (out.classification_code, out.sort_key.group) == (code, group)


@then(P('표시값은 승인을 막지 않고 점수 표시는 "{display}"이다'))
def _display(ctx: ScenarioContext, display: str) -> None:
    out = output(ctx).display
    assert out.blocks_approval is False
    assert out.score_display == display


@then(P("질문 후보는 {count:d}개이고 {keyword} 요구를 가리킨다"))
def _question_candidates(ctx: ScenarioContext, count: int, keyword: str) -> None:
    candidates = output(ctx).question_candidates
    assert len(candidates) == count, candidates
    target = next(r for r in ctx.engine_input.requirements if r.req_id == candidates[0].target_id)
    assert keyword in target.name


@then("두 출력은 완전히 같다")
def _deterministic(ctx: ScenarioContext) -> None:
    first, second = ctx.engine_outputs
    assert first.model_dump() == second.model_dump()
