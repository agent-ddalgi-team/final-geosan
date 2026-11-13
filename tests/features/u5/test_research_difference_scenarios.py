"""#677 시나리오: 다시 조사한 AI 공정 제안이 확정 값과 다를 때(실제 API·임시 DB, 가짜 AI 응답).

실제 홈페이지 접속과 실제 AI 호출은 하지 않는다. 가상 사례만 쓴다(거산 실제 사양 아님).
"""

from pytest_bdd import given, parsers, scenarios, then, when
from sqlalchemy import select

from geosan.opportunity.models import OppProcessLink
from geosan.storage.base import utcnow
from geosan.storage.session import session_scope
from tests.unit.u1 import test_homepage_api as support
from tests.unit.u2 import test_item_proposals as proposals

search_env = support.search_env
extract_env = support.extract_env
homepage_env = support.homepage_env

scenarios("u5/research_difference.feature")

STAFF = "park-lee"
NEW = proposals.PROCESS
ITEM = f"PL:{NEW}"


def _rows(opp_id, *, current=True):
    """공정 연결 행을 {공정 코드: 열 값 전체}로. current=False면 이력으로 남은 행."""
    with session_scope() as session:
        query = select(OppProcessLink).where(OppProcessLink.opp_id == opp_id)
        query = query.where(
            OppProcessLink.superseded_at.is_(None)
            if current
            else OppProcessLink.superseded_at.is_not(None)
        )
        return {
            row.process_code: {col.name: getattr(row, col.name) for col in row.__table__.columns}
            for row in session.scalars(query)
        }


def _detail(context):
    response = context["client"].get(f"/api/v1/opportunities/{context['opp_id']}")
    assert response.status_code == 200, response.text
    return response.json()["data"]


def _proposal_lines(context):
    return [row for row in _detail(context)["reviewItems"] if row["itemId"].startswith("PL:")]


def _rerun(context):
    proposals.use(context["transport"], proposals.proposals())
    response = support.post(context["env"], {})
    assert response.status_code == 200, response.text


def _check(context, checked):
    response = context["client"].post(
        f"/api/v1/opportunities/{context['opp_id']}/review-items/{ITEM}/check",
        json={"checked": checked, "evalId": _detail(context)["evalId"]},
        headers={"X-Staff-Key": STAFF},
    )
    assert response.status_code == 200, response.text
    context["meta"] = response.json()["meta"]


@given("담당자가 공정을 확정한 가상 회사가 있다", target_fixture="context")
def confirmed_company(homepage_env):
    client, case, transport = homepage_env
    with session_scope() as session:
        # 사례 파일의 공정 연결을 담당자가 확정한 모양으로 바꾼다.
        for row in session.scalars(
            select(OppProcessLink).where(OppProcessLink.opp_id == case.opp_id)
        ):
            row.source, row.state = "STAFF", "CONFIRMED"
            row.confirmed_by, row.confirmed_at = STAFF, utcnow()
    confirmed = _rows(case.opp_id)
    assert confirmed and NEW not in confirmed
    return {
        "env": homepage_env,
        "client": client,
        "opp_id": case.opp_id,
        "transport": transport,
        "confirmed": confirmed,
    }


@given("다시 조사에서 AI가 다른 공정을 제안해 두었다")
@when("담당자가 다시 조사를 눌렀고 AI가 다른 공정을 제안한다")
def rerun_with_other_process(context):
    _rerun(context)


def _only_confirmed_fields(rows):
    """재평가가 다시 쓰는 판정 결과 칸은 빼고, 사람이 정한 값만 견준다."""
    derived = {"current_result", "current_reason", "source_eval_id"}
    return {
        code: {key: value for key, value in row.items() if key not in derived}
        for code, row in rows.items()
    }


@then("담당자가 확정한 공정 연결은 한 글자도 바뀌지 않는다")
def confirmed_untouched(context):
    now = {code: row for code, row in _rows(context["opp_id"]).items() if code != NEW}
    assert _only_confirmed_fields(now) == _only_confirmed_fields(context["confirmed"])


@then("상세에 확정 공정과 함께 AI 새 제안 한 줄이 보인다")
def proposal_is_shown(context):
    current = _rows(context["opp_id"])
    assert (current[NEW]["source"], current[NEW]["state"]) == ("AI", "PENDING")
    assert [row["itemId"] for row in _proposal_lines(context)] == [ITEM]
    codes = {row["processCode"] for row in _detail(context)["processLinks"]}
    assert set(context["confirmed"]) <= codes


@given("담당자가 그 AI 제안에 확정 값 유지를 골랐다")
@when("담당자가 그 AI 제안에 확정 값 유지를 고른다")
def keep_confirmed(context):
    _check(context, False)


@then("AI 새 제안 줄이 사라지고 확정 공정만 남는다")
def only_confirmed_left(context):
    assert _proposal_lines(context) == []
    assert set(_rows(context["opp_id"])) == set(context["confirmed"])
    confirmed_untouched(context)


@then("AI 제안 행은 지워지지 않고 이력으로 남는다")
def proposal_kept_as_history(context):
    history = _rows(context["opp_id"], current=False)
    assert (history[NEW]["source"], history[NEW]["state"]) == ("AI", "PENDING")
    assert context["meta"]["reevaluated"] is True


@then(parsers.parse('활동 이력에 "{text}" 한 줄이 남는다'))
def activity_line(context, text):
    url = f"/api/v1/opportunities/{context['opp_id']}/activity"
    rows = context["client"].get(url).json()["data"]
    lines = [row for row in rows if row["kind"] == "NOTE" and text in row["summary"]]
    assert len(lines) == 1
    assert lines[0]["actor"] == STAFF


@when("담당자가 그 AI 제안을 확정한다")
def add_proposal(context):
    _check(context, True)


@then("두 공정이 모두 확정이고 새 공정의 확정자는 그 담당자다")
def both_confirmed(context):
    current = _rows(context["opp_id"])
    assert set(current) == set(context["confirmed"]) | {NEW}
    assert (current[NEW]["source"], current[NEW]["state"], current[NEW]["confirmed_by"]) == (
        "STAFF",
        "CONFIRMED",
        STAFF,
    )
    assert _proposal_lines(context) == []
