"""#529: 선택 지역 밖 웹 후보의 판단 승인·재사용을 막는다."""

from decimal import Decimal

import pytest
from pytest_bdd import given, parsers, scenarios, then, when

from geosan.config.errors import InputError
from geosan.opportunity.candidate_pick import pick_candidates
from geosan.opportunity.source_models import WebCandidate
from geosan.storage.session import session_scope
from tests.fakes.web_candidate_search import BATCH, logs
from tests.fakes.web_candidate_storage import setup_web_storage
from tests.unit.u3.test_web_candidate_regions import judgment_count, save_for_regions

scenarios("u3/web_candidate_regions.feature")


@given(
    parsers.parse('천안시를 고르고 주소 "{address}"인 웹 후보를 보관했다'), target_fixture="context"
)
def ready(tmp_db, app_settings_path, monkeypatch, address):
    calls = setup_web_storage(app_settings_path, monkeypatch)
    saved = save_for_regions(["천안시"], address)
    return {"calls": calls, "saved": saved}


@when("보관한 웹 후보를 판단한다")
def pick(context):
    context["judgments"] = pick_candidates(BATCH, context["saved"].candidate_ids, source_kind="WEB")


@when("같은 웹 후보를 다시 판단한다")
def reuse(context):
    assert (
        pick_candidates(BATCH, context["saved"].candidate_ids, source_kind="WEB")
        == context["judgments"]
    )


@when("보관 후보의 주소가 아산시로 바뀐다")
def move(context):
    with session_scope() as session:
        session.get(WebCandidate, context["saved"].candidate_ids[0]).address = "충남 아산시"


@when("보관한 웹 후보의 판단을 요청하면 지역 오류가 난다")
def reject(context):
    with pytest.raises(InputError, match="지역"):
        pick_candidates(BATCH, context["saved"].candidate_ids, source_kind="WEB")


@then("추가 AI 호출과 판단 기록이 없고 검색 비용만 남는다")
def no_extra_call(context):
    assert not context["calls"]["pick"] and judgment_count() == 0
    assert [row.cost_usd for row in logs()] == [Decimal("0.014")]


@then("AI 판단은 한 번만 부르고 같은 판단 기록을 쓴다")
def one_judgment(context):
    assert len(context["calls"]["pick"]) == judgment_count() == 1
    assert [row.cost_usd for row in logs()] == [Decimal("0.014"), Decimal("0.004")]
