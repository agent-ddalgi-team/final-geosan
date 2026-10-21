"""소개서 묶음(BROCHURE) 시나리오 단계 (brochure_dataset.feature)."""

from __future__ import annotations

from pathlib import Path

from pytest_bdd import given, then

from tests import factories
from tests.steps.u1._support import ScenarioContext, model, session_scope, write_json
from tests.steps.u1.common import (
    P,
    cards,
    confirmed_evals,
    import_case_file,
    latest_eval,
    opp_id_for,
    requirement_checks,
    waiting_questions,
)

CONTACT_CODES = {"CONTACT_URGENT", "CONTACT_PLANNED", "CONTACT_REVIEW"}


def eval_of(case_id: str):
    rows = confirmed_evals(opp_id_for(case_id))
    assert rows, f"{case_id}의 확정 평가가 없습니다"
    return rows[0]


@given(P('실제 기업 형식의 소개서 사례 파일 "{case_id}"을 투입했다'))
def _import_brochure_case(ctx: ScenarioContext, tmp_path: Path, case_id: str) -> None:
    path = write_json(tmp_path, f"{case_id}.json", factories.brochure_case(case_id))
    import_case_file(path, ctx)


@given(P('필수 요구가 없는 소개서 사례 파일 "{case_id}"을 투입했다'))
def _import_brochure_case_no_required(ctx: ScenarioContext, tmp_path: Path, case_id: str) -> None:
    path = write_json(
        tmp_path, f"{case_id}.json", factories.brochure_case(case_id, with_required_now=False)
    )
    import_case_file(path, ctx)


@given(P('소재 일치를 "{step}"으로 낮춘 소개서 사례 파일 "{case_id}"을 투입했다'))
def _import_brochure_case_lower(
    ctx: ScenarioContext, tmp_path: Path, step: str, case_id: str
) -> None:
    assert step == "일부 가능"
    path = write_json(
        tmp_path, f"{case_id}.json", factories.brochure_case_with_lower_material(case_id)
    )
    import_case_file(path, ctx)


@then(P('기회 "{case_id}"의 분류는 {code:Code}이고 "{name}" 판정 표시는 {display:Code}이다'))
def _class_and_display(case_id: str, code: str, name: str, display: str) -> None:
    run = eval_of(case_id)
    assert run.classification_code == code
    row = requirement_checks(run.eval_id).get(name)
    assert row is not None, f"요구 '{name}'의 판정 행이 없습니다"
    assert row.display_result == display


@then(P('기회 "{case_id}"의 점수 표시는 "{prefix}"로 시작하고 승인을 막는다'))
def _score_display_blocks(case_id: str, prefix: str) -> None:
    run = eval_of(case_id)
    assert run.score_display.startswith(prefix), run.score_display
    assert run.blocks_approval is True


@then(P('기회 "{case_id}"에 연결된 WAITING 질문 중 "{keyword}"에 관한 것이 있다'))
def _question_about(case_id: str, keyword: str) -> None:
    rows = waiting_questions(opp_id_for(case_id))
    assert any(keyword in r.question_text for r in rows), [r.question_text for r in rows]


@then(P("추천 목록 meta의 묶음은 {kind:Code}이고 가상 데이터 표시는 없다"))
def _list_meta_brochure(ctx: ScenarioContext, kind: str) -> None:
    ctx.list_response = None
    cards(ctx)
    meta = ctx.list_response["meta"]
    assert meta["datasetKind"] == kind
    assert meta["hasVirtualData"] is False


@then(P('기회 "{case_id}"의 분류는 {code:Code}이고 점수 표시는 "{prefix}"로 시작한다'))
def _class_and_score(case_id: str, code: str, prefix: str) -> None:
    run = eval_of(case_id)
    assert run.classification_code == code
    assert run.score_display.startswith(prefix), run.score_display


@then(P('기회 "{case_id}"은 접촉 후보가 아니다'))
def _not_contact(case_id: str) -> None:
    assert eval_of(case_id).classification_code not in CONTACT_CODES


@then(P('추천 목록에서 "{first}"이 "{second}"보다 앞에 있다'))
def _order(ctx: ScenarioContext, first: str, second: str) -> None:
    ctx.list_response = None
    ids = [card["oppId"] for card in cards(ctx)]
    first_id, second_id = opp_id_for(first), opp_id_for(second)
    assert first_id in ids and second_id in ids, ids
    assert ids.index(first_id) < ids.index(second_id), ids


@then(P('평가 묶음의 정렬 규칙에 "{word}"가 적혀 있다'))
def _sort_rule(word: str) -> None:
    batch_model = model("evaluation", "EvaluationBatch")
    run = latest_eval("c-co-housing")
    with session_scope() as session:
        batch = session.get(batch_model, run.batch_id)
        assert batch is not None and word in batch.sort_rule, getattr(batch, "sort_rule", None)


@then(P("A정밀의 분류는 {wrong:Code}가 아니라 {code:Code}이다"))
def _apjeong_not_urgent(wrong: str, code: str) -> None:
    run = latest_eval()
    assert run.classification_code != wrong
    assert run.classification_code == code


@then(P("A정밀의 평가 스냅샷에 들어간 거산 값은 모두 {kind:Code} 묶음이다"))
def _snapshot_dataset(kind: str) -> None:
    snapshot = latest_eval().input_snapshot
    processes = snapshot["capability"]["processes"]
    assert processes, "스냅샷에 거산 공정이 없습니다"
    assert all(p["datasetKind"] == kind for p in processes), {p["datasetKind"] for p in processes}
    assert snapshot["datasetKind"] == kind
