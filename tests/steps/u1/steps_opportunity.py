"""S02·S04·S06 기회 식별·이력 분리·관계 미확인 단계."""

from __future__ import annotations

from pathlib import Path

from pytest_bdd import then, when
from sqlalchemy import select

from tests import factories
from tests.steps.u1._support import (
    APJEONG_CASE_ID,
    ScenarioContext,
    model,
    session_scope,
    write_json,
)
from tests.steps.u1.common import P, all_evals, evaluate, import_case_file, latest_eval, opp_id_for


@when("발견 경로를 하나 더 붙인 A정밀 사례 파일을 다시 투입하면")
def _reimport_with_path(ctx: ScenarioContext, tmp_path: Path) -> None:
    path = write_json(
        tmp_path, "case-extra-path.json", factories.apjeong_with_extra_discovery_path()
    )
    import_case_file(path, ctx)


@then("A정밀 기회는 한 건이다")
def _one_opportunity() -> None:
    opp_id_for(APJEONG_CASE_ID)


@then(P("A정밀 발견 경로의 현재 행은 {count:d}건이다"))
def _discovery_paths(count: int) -> None:
    path = model("opportunity", "DiscoveryPath")
    opp_id = opp_id_for(APJEONG_CASE_ID)
    with session_scope() as session:
        rows = session.scalars(
            select(path).where(path.opp_id == opp_id, path.superseded_at.is_(None))
        ).all()
    assert len(rows) == count, [(r.source_id, r.origin_key) for r in rows]


@when("A정밀 사례 파일을 그대로 다시 투입하면")
def _reimport_same(ctx: ScenarioContext) -> None:
    import_case_file(Path(factories.EXAMPLES_DIR) / "case-apjeong.json", ctx)


@then(P("A정밀 요구 행은 옛 행 {old:d}건과 현재 행 {current:d}건이다"))
def _requirement_rows(old: int, current: int) -> None:
    requirement = model("opportunity", "Requirement")
    opp_id = opp_id_for(APJEONG_CASE_ID)
    with session_scope() as session:
        rows = session.scalars(select(requirement).where(requirement.opp_id == opp_id)).all()
        superseded = [r for r in rows if r.superseded_at is not None]
        live = [r for r in rows if r.superseded_at is None]
    assert (len(superseded), len(live)) == (old, current), (len(superseded), len(live))


@when('상호에 "(주)"를 붙이고 caseId를 바꾼 A정밀 사례 파일을 투입하면')
def _import_renamed(ctx: ScenarioContext, tmp_path: Path) -> None:
    path = write_json(
        tmp_path, "case-renamed.json", factories.apjeong_renamed_customer("apjeong-second-item")
    )
    import_case_file(path, ctx)


@then("고객은 한 건이고 기회는 두 건이다")
def _customer_and_opps() -> None:
    customer = model("opportunity", "Customer")
    opportunity = model("opportunity", "Opportunity")
    with session_scope() as session:
        n_customers = len(session.scalars(select(customer)).all())
        n_opps = len(session.scalars(select(opportunity)).all())
    assert (n_customers, n_opps) == (1, 2), (n_customers, n_opps)


# ---------------------------------------------------------------------------
# S04
# ---------------------------------------------------------------------------


@when("2024년 견적 이력을 뺀 A정밀 사례 파일을 다시 투입하고 평가하면")
def _reimport_without_interaction(ctx: ScenarioContext, tmp_path: Path) -> None:
    path = write_json(
        tmp_path, "case-no-interaction.json", factories.apjeong_without_interactions()
    )
    import_case_file(path, ctx)
    evaluate(ctx)


@then("A정밀의 두 평가는 E, P, S, R과 분류가 같다")
def _two_evals_equal() -> None:
    rows = all_evals()
    assert len(rows) >= 2, "평가가 두 건 이상 있어야 합니다"
    first, second = rows[-2], rows[-1]
    key = lambda r: (r.score_e, r.score_p, r.score_s, r.score_r, r.classification_code)  # noqa: E731
    assert key(first) == key(second), (key(first), key(second))


@then("A정밀의 두 평가 스냅샷 모두 hasLinkedInteraction이 false이다")
def _snapshots_no_linked() -> None:
    rows = all_evals()[-2:]
    for row in rows:
        snapshot = row.input_snapshot
        assert snapshot["opportunity"]["hasLinkedInteraction"] is False, snapshot["opportunity"]


# ---------------------------------------------------------------------------
# S06 (관계 미확인) — 투입 단계는 common에 있다
# ---------------------------------------------------------------------------


@then(P("A정밀의 분류는 {code:Code}이고 확정 평가는 {count:d}건이다"))
def _class_and_count(code: str, count: int) -> None:
    rows = [r for r in all_evals() if r.run_status == "CONFIRMED"]
    assert latest_eval().classification_code == code
    assert len(rows) == count
