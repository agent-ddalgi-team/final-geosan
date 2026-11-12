"""#532: 기존 회사 확인을 선정 앞에 연결할 수 있도록 실제 DB로 검증한다."""

from pytest_bdd import given, scenarios, then, when

from geosan.opportunity.models import Customer, MergeCandidate, Opportunity
from tests.unit.u3.test_candidate_registration import existing, judgment, rows, snapshot
from tests.unit.u3.test_candidate_registration import registration_context as registration_context
from tests.unit.u3.test_web_existing_candidates import (
    candidate,
    ranked_new_example,
    registered,
    saved_web,
)
from tests.unit.u3.test_web_existing_candidates import web_context as web_context

scenarios("u3/web_existing_candidates.feature")


@given("웹 후보를 보관할 수 있는 회차가 있다", target_fixture="context")
def ready(web_context):
    return {}


@when("기존 회사와 새 후보의 기존 여부를 확인하고 새 후보를 적합도 순으로 고른다")
def rank(context):
    context["ranked"] = ranked_new_example()


@then("기존 회사가 빠지고 새 회사 중 적합도가 높은 후보가 먼저 남는다")
def selected(context):
    ids, known, remaining = context["ranked"]
    assert known == {ids["가상볼트"]}
    assert [row.row_id for row in remaining[:1]] == [ids["가상브라켓"]]
    assert len(rows(Customer)) == 1 and not rows(Opportunity)


@given("이름은 같지만 주소 없는 웹 후보와 기존 회사가 있다")
def no_address(context):
    existing()
    context["saved"] = saved_web(candidate(address=None))


@given("이름과 주소가 같은 웹 후보와 사례 회사가 있다")
def same(context):
    existing(pick_reason="담당자가 적은 기존 이유")
    context["before"] = snapshot(Customer)
    context["saved"] = saved_web(candidate())


@when("웹 후보의 기존 회사 여부를 확인한다")
def lookup(context):
    context["known"] = registered(*(judgment(key) for key in context["saved"].candidate_ids))


@then("그 후보는 기존 회사로 제외하지 않고 자동 합치지도 않는다")
def ambiguous(context):
    assert not context["known"] and not rows(MergeCandidate)
    assert len(rows(Customer)) == 1


@then("기존 회사 번호 대신 웹 후보 번호를 반환하고 원래 회사의 값을 보존한다")
def preserved(context):
    assert context["known"] == set(context["saved"].candidate_ids)
    assert snapshot(Customer) == context["before"]
    assert not rows(Opportunity)
