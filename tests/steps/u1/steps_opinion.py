"""S10 담당자 의견 단계 (의견 저장 요청 자체는 common.OPINION_PATTERN이 처리한다)."""

from __future__ import annotations

from pytest_bdd import given, parsers, then, when
from sqlalchemy import select

from tests.steps.u1._support import APJEONG_CASE_ID, ScenarioContext, model, session_scope
from tests.steps.u1.common import P, latest_eval, opp_id_for, save_opinion


def opinion_rows() -> list:
    opinion = model("records", "ReviewOpinion")
    opp_id = opp_id_for(APJEONG_CASE_ID)
    with session_scope() as session:
        rows = session.scalars(
            select(opinion).where(opinion.opp_id == opp_id).order_by(opinion.version.asc())
        ).all()
        session.expunge_all()
    return rows


@then(P("저장된 의견 행의 값은 {opinion:Code}이고 본 평가 ID는 최신 확정 평가다"))
def _opinion_row(opinion: str) -> None:
    rows = opinion_rows()
    assert rows, "의견 행이 없습니다"
    assert rows[-1].opinion == opinion
    assert rows[-1].eval_id == latest_eval().eval_id


@then(P("의견 응답은 {status:d}이고 fields에 {field} 오류가 있다"))
def _opinion_field_error(ctx: ScenarioContext, status: int, field: str) -> None:
    response = ctx.opinion_response
    assert response.status_code == status, response.text
    body = response.json()
    paths = [item["path"] for item in body["error"].get("fields", [])]
    assert field in paths, body


@then(P("A정밀의 의견 행은 {count:d}건이다"))
def _opinion_count(count: int) -> None:
    assert len(opinion_rows()) == count


@when(
    parsers.re(r'^담당자 키 "(?P<key>[a-z-]*)"로 A정밀에 의견 (?P<opinion>[A-Z_]+)[을를] 저장하면$')
)
def _save_with_key(ctx: ScenarioContext, key: str, opinion: str) -> None:
    save_opinion(ctx, key or None, opinion)


@then(P("의견 응답은 {status:d}이고 오류 형식에 message·nextAction·ref가 있다"))
def _error_shape(ctx: ScenarioContext, status: int) -> None:
    response = ctx.opinion_response
    assert response.status_code == status, response.text
    error = response.json()["error"]
    assert all(key in error for key in ("message", "nextAction", "ref")), error


@given("A정밀의 최신 확정 평가 ID를 기억했다")
def _remember_eval(ctx: ScenarioContext) -> None:
    ctx.remembered_eval_id = latest_eval().eval_id


@then("저장된 의견 행의 본 평가 ID는 기억한 평가 ID이다")
def _opinion_uses_remembered(ctx: ScenarioContext) -> None:
    rows = opinion_rows()
    assert rows and rows[-1].eval_id == ctx.remembered_eval_id
    assert ctx.remembered_eval_id != latest_eval().eval_id, "재평가가 새 평가를 만들지 않았습니다"


@then(P("A정밀의 의견 행은 {count:d}건이고 version {v2:d} 행은 version {v1:d} 행을 가리킨다"))
def _opinion_chain(count: int, v2: int, v1: int) -> None:
    rows = opinion_rows()
    assert len(rows) == count, [(r.version, r.opinion) for r in rows]
    by_version = {r.version: r for r in rows}
    assert by_version[v2].previous_opinion_id == by_version[v1].opinion_id


@then(
    P(
        "의견 응답은 {status:d}이고 version {version:d}이며 "
        "meta.previousValue의 의견은 {opinion:Code}이다"
    )
)
def _previous_value(ctx: ScenarioContext, status: int, version: int, opinion: str) -> None:
    response = ctx.opinion_response
    assert response.status_code == status, response.text
    body = response.json()
    assert body["data"]["version"] == version, body
    previous = body["meta"].get("previousValue")
    assert previous and previous.get("opinion") == opinion, body["meta"]
