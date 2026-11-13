"""#610: 실제 임시 DB·실제 API로 추천 목록 세 묶음 시나리오를 확인한다. 외부 AI 호출 없음."""

from pytest_bdd import given, scenarios, then, when

from tests.unit.u7 import test_contact_list_api as support

contact_env = support.contact_env
scenarios("u7/contact_buckets.feature")


def _snapshot(client, **params):
    return [
        (card["oppId"], card["bucket"], card["bucketBasis"], card["rank"], card["rankAdjust"])
        for card in support.listing(client, **params)["data"]
    ]


def _pair(context):
    """지금 연락할 곳 묶음 안에서 견주는 두 회사의 카드(묶음 안 순서대로)."""
    watched = (context["first"], context["second"])
    return [card for card in context["now"] if card["oppId"] in watched]


@given("평가된 가상 회사 8곳이 있다", target_fixture="context")
def companies(contact_env):
    client, opp_ids = contact_env
    for opp_id in opp_ids:
        support.make_passed(opp_id)
    return {"client": client, "opp_ids": opp_ids}


@given("한 곳은 필수 탈락, 한 곳은 검토 대상 제외 의견, 한 곳은 거래 중이다")
def blocked_companies(context):
    failed, excluded, existing, *_rest = context["opp_ids"]
    support.set_state(failed, classification_code="FILTER_EXCLUDED", blocks_approval=True)
    support.give_opinion(context["client"], excluded, "NOT_TARGET")
    support.set_state(existing, relation_status="EXISTING_CONFIRMED")
    context["blocked"] = (failed, excluded, existing)


@given("한 곳은 아직 평가 전이고 공정 적합도가 상이다")
def unevaluated_high_fit(context):
    context["unevaluated"] = context["opp_ids"][0]
    support.make_unscored(context["unevaluated"], "HIGH")


@given(
    "지금 연락할 곳 두 곳 가운데 뒤쪽 회사와 같은 공정·산업에서 "
    "성사 3곳과 수요 없음 거절 2곳이 기록됐다"
)
def enough_results(context):
    context["first"], context["second"], _ = support.prepare_pair(
        context["client"], context["opp_ids"], won=3, lost=2
    )


@given("지금 연락할 곳 두 곳 가운데 뒤쪽 회사와 같은 공정·산업에서 성사 4곳만 기록됐다")
def few_results(context):
    context["first"], context["second"], _ = support.prepare_pair(
        context["client"], context["opp_ids"], won=4, lost=0
    )


@given("예전 기본 정렬의 순서와 번호를 적어 두었다")
def remember_default(context):
    context["before"] = [
        (card["oppId"], card["rank"]) for card in support.listing(context["client"])["data"]
    ]


@when("담당자가 추천 순으로 목록을 연다")
def open_contact(context):
    context["body"] = support.listing(context["client"], sort="contact")
    context["cards"] = {card["oppId"]: card for card in context["body"]["data"]}
    context["now"] = [card for card in context["body"]["data"] if card["bucket"] == "NOW"]


@when("담당자가 추천 순으로 목록을 두 번 연다")
def open_contact_twice(context):
    context["snapshots"] = [_snapshot(context["client"], sort="contact") for _ in range(2)]


@when("담당자가 예전 기본 정렬로 목록을 연다")
def open_default(context):
    client = context["client"]
    context["after"] = [
        [(card["oppId"], card["rank"]) for card in support.listing(client, **params)["data"]]
        for params in ({}, {"sort": "rank"})
    ]


@then("세 곳은 모두 나중 묶음이고 이유가 각각 필수 탈락, 제외 의견, 거래 중이다")
def blocked_are_later(context):
    cards = context["cards"]
    assert [(cards[key]["bucket"], cards[key]["bucketBasis"]) for key in context["blocked"]] == [
        ("LATER", "REQUIRED_FAILED"),
        ("LATER", "EXCLUDED_OPINION"),
        ("LATER", "EXISTING_CUSTOMER"),
    ]
    assert context["body"]["meta"]["bucketCounts"] == {"NOW": 5, "CHECK": 0, "LATER": 3}


@then("지금 연락할 곳 묶음에 그 세 곳이 없다")
def blocked_not_in_now(context):
    assert not {card["oppId"] for card in context["now"]} & set(context["blocked"])
    assert len(context["now"]) == 5


@then("그 회사는 확인 필요 묶음이고 지금 연락할 곳 묶음에 없다")
def unevaluated_is_check(context):
    card = context["cards"][context["unevaluated"]]
    assert (card["bucket"], card["bucketBasis"]) == ("CHECK", "NOT_EVALUATED_HIGH_FIT")
    assert context["unevaluated"] not in {item["oppId"] for item in context["now"]}
    assert context["body"]["meta"]["bucketCounts"] == {"NOW": 7, "CHECK": 1, "LATER": 0}


@then("뒤쪽이던 회사가 지금 연락할 곳 묶음의 첫 번째가 된다")
def moved_up(context):
    assert [card["oppId"] for card in _pair(context)] == [context["second"], context["first"]]
    assert context["now"][0]["oppId"] == context["second"] and context["now"][0]["rank"] == 1


@then("그 카드에 조정 한 단계 위, 성사 3곳, 센 거절 2곳, 이유 수요 없음이 온다")
def reason_on_card(context):
    adjust = context["now"][0]["rankAdjust"]
    assert (adjust["level"], adjust["wonCount"], adjust["lostCount"]) == (1, 3, 2)
    assert adjust["countedLostReasons"] == ["NO_DEMAND"]
    assert (adjust["processCode"], adjust["industry"]) == ("ANODIZING", support.PAIR)
    assert adjust["windowDays"] == 365


@then("지금 연락할 곳 묶음의 순서가 예전 추천 순 그대로다")
def order_kept(context):
    assert [card["oppId"] for card in _pair(context)] == [context["first"], context["second"]]


@then("두 카드 모두 조정 이유가 없다")
def no_reason(context):
    assert [card["rankAdjust"] for card in _pair(context)] == [None, None]


@then("두 번의 묶음·순서·번호가 같다")
def same_twice(context):
    first, second = context["snapshots"]
    assert first == second and len(first) == support.COMPANY_COUNT


@then("순서와 번호가 적어 둔 것과 같다")
def default_unchanged(context):
    assert context["after"] == [context["before"], context["before"]]
    assert [rank for _, rank in context["before"]] == list(range(1, support.COMPANY_COUNT + 1))
