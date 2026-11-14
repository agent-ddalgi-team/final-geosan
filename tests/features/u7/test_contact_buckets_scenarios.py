"""#675: 실제 임시 DB·실제 API로 추천 목록의 근거 상태 묶음 시나리오를 확인한다. 외부 AI 호출 없음.

#610의 세 묶음(지금 연락할 곳 / 확인 필요 / 나중) 시나리오를 PM 결정(2026-11-13)에 따라 바꿨다.
"""

from pytest_bdd import given, scenarios, then, when

from tests.unit.u7 import test_contact_list_api as support
from tests.unit.u7.test_bookmark import set_bookmark

contact_env = support.contact_env
scenarios("u7/contact_buckets.feature")

BUCKET_ORDER = ["EVIDENCE_READY", "EVIDENCE_SOME", "NO_HOMEPAGE", "NOT_RESEARCHED", "CLOSED"]


def _snapshot(client, **params):
    return [
        (card["oppId"], card["bucket"], card["bucketBasis"], card["rank"], card["rankAdjust"])
        for card in support.listing(client, **params)["data"]
    ]


def _pair(context):
    """견주는 두 회사의 카드(목록에 온 순서대로)."""
    watched = (context["first"], context["second"])
    return [card for card in context["body"]["data"] if card["oppId"] in watched]


def _bucket(context, name):
    return [card for card in context["body"]["data"] if card["bucket"] == name]


@given("평가된 가상 회사 8곳이 있다", target_fixture="context")
def companies(contact_env):
    client, opp_ids = contact_env
    for opp_id in opp_ids:
        support.make_passed(opp_id)
    return {"client": client, "opp_ids": opp_ids}


@given(
    "근거 3건, 근거 1건, 홈페이지만 찾음, 홈페이지 못 찾음, 조사 전, "
    "거절로 끝난 회사가 한 곳씩 있다"
)
def one_of_each(context):
    three, one, homepage_only, not_found, not_run, lost, *_rest = context["opp_ids"]
    support.keep_evidence(three, 3)
    support.keep_evidence(one, 1)
    support.keep_evidence(homepage_only, 0)
    support.set_homepage(homepage_only, "https://example.invalid/", "AI_FOUND")
    support.keep_evidence(not_found, 0)
    support.set_homepage(not_found, None, "NOT_FOUND")
    support.keep_evidence(not_run, 0)
    support.close(context["client"], lost, status="LOST", reason="NO_DEMAND")
    context["expected"] = {
        three: ("EVIDENCE_READY", "EVIDENCE_ENOUGH"),
        one: ("EVIDENCE_SOME", "EVIDENCE_FEW"),
        homepage_only: ("EVIDENCE_SOME", "HOMEPAGE_ONLY"),
        not_found: ("NO_HOMEPAGE", "HOMEPAGE_NOT_FOUND"),
        not_run: ("NOT_RESEARCHED", "RESEARCH_NOT_RUN"),
        lost: ("CLOSED", "CLOSED_OR_HOLD"),
    }


@given("한 곳은 필수 탈락, 한 곳은 검토 대상 제외 의견, 한 곳은 거래 중이다")
def blocked_companies(context):
    failed, excluded, existing, *_rest = context["opp_ids"]
    support.set_state(failed, classification_code="FILTER_EXCLUDED", blocks_approval=True)
    support.give_opinion(context["client"], excluded, "NOT_TARGET")
    support.set_state(existing, relation_status="EXISTING_CONFIRMED")
    context["blocked"] = (failed, excluded, existing)


@given("근거 조금 묶음의 두 곳 가운데 추천 순이 앞선 회사는 적합도 중, 뒤선 회사는 적합도 상이다")
def two_fit_levels(context):
    front, back, *_rest = support.rank_order(context["client"], context["opp_ids"])
    for opp_id, fit_level in ((front, "MEDIUM"), (back, "HIGH")):
        support.keep_evidence(opp_id, 1)
        support.set_state(opp_id, fit_level=fit_level)
    context["medium"], context["high"] = front, back


@given("한 곳을 관심으로 골랐다")
def one_bookmarked(context):
    context["picked"] = context["opp_ids"][2]
    assert set_bookmark(context["client"], context["picked"], True).status_code == 200


@given(
    "근거 있음 두 곳 가운데 뒤쪽 회사와 같은 공정·산업에서 성사 3곳과 수요 없음 거절 2곳이 기록됐다"
)
def enough_results(context):
    context["first"], context["second"], _ = support.prepare_pair(
        context["client"], context["opp_ids"], won=3, lost=2
    )


@given("근거 있음 두 곳 가운데 뒤쪽 회사와 같은 공정·산업에서 성사 4곳만 기록됐다")
def few_results(context):
    context["first"], context["second"], _ = support.prepare_pair(
        context["client"], context["opp_ids"], won=4, lost=0
    )


@given("그 두 곳의 근거가 1건씩만 남았다")
def pair_has_one_evidence(context):
    for opp_id in (context["first"], context["second"]):
        support.keep_evidence(opp_id, 1)


@given("예전 기본 정렬의 순서와 번호를 적어 두었다")
def remember_default(context):
    context["before"] = [
        (card["oppId"], card["rank"]) for card in support.listing(context["client"])["data"]
    ]


@when("담당자가 추천 순으로 목록을 연다")
def open_contact(context):
    context["body"] = support.listing(context["client"], sort="contact")
    context["cards"] = {card["oppId"]: card for card in context["body"]["data"]}
    context["ready"] = _bucket(context, "EVIDENCE_READY")


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


@when("담당자가 관심 기업을 뺀 기본 목록과 함께 보는 목록을 연다")
def open_both(context):
    client = context["client"]
    context["hidden"] = support.listing(client, sort="contact", hideBookmarked="true")
    context["together"] = support.listing(client, sort="contact")


@then("묶음이 근거 있음, 근거 조금, 홈페이지 없음, 조사 전, 끝난 회사 순서로 온다")
def buckets_in_order(context):
    seen = [card["bucket"] for card in context["body"]["data"]]
    assert sorted(seen, key=BUCKET_ORDER.index) == seen
    assert list(dict.fromkeys(seen)) == BUCKET_ORDER


@then("여섯 회사가 각각 제 묶음에 들고 묶음별 곳 수가 맞다")
def each_in_its_bucket(context):
    cards = context["cards"]
    assert {
        key: (cards[key]["bucket"], cards[key]["bucketBasis"]) for key in context["expected"]
    } == context["expected"]
    # 손대지 않은 두 곳은 사례 파일 근거 5건이라 근거 있음이다.
    assert context["body"]["meta"]["bucketCounts"] == {
        "EVIDENCE_READY": 3,
        "EVIDENCE_SOME": 2,
        "NO_HOMEPAGE": 1,
        "NOT_RESEARCHED": 1,
        "CLOSED": 1,
    }
    assert context["body"]["meta"]["total"] == support.COMPANY_COUNT


@then("세 곳은 모두 끝난 회사 묶음이고 이유가 각각 필수 탈락, 제외 의견, 거래 중이다")
def blocked_are_closed(context):
    cards = context["cards"]
    assert [(cards[key]["bucket"], cards[key]["bucketBasis"]) for key in context["blocked"]] == [
        ("CLOSED", "REQUIRED_FAILED"),
        ("CLOSED", "EXCLUDED_OPINION"),
        ("CLOSED", "EXISTING_CUSTOMER"),
    ]
    assert context["body"]["meta"]["bucketCounts"] == {
        "EVIDENCE_READY": 5,
        "EVIDENCE_SOME": 0,
        "NO_HOMEPAGE": 0,
        "NOT_RESEARCHED": 0,
        "CLOSED": 3,
    }
    # 끝난 회사는 목록의 맨 아래다.
    assert [card["bucket"] for card in context["body"]["data"][-3:]] == ["CLOSED"] * 3


@then("근거 있음 묶음에 그 세 곳이 없다")
def blocked_not_in_ready(context):
    assert not {card["oppId"] for card in context["ready"]} & set(context["blocked"])
    assert len(context["ready"]) == 5


@then("근거 조금 묶음에서 적합도 상인 회사가 첫 번째, 중인 회사가 두 번째다")
def high_fit_first(context):
    some = _bucket(context, "EVIDENCE_SOME")
    assert [(card["oppId"], card["rank"]) for card in some] == [
        (context["high"], 1),
        (context["medium"], 2),
    ]


@then("기본 목록에는 그 회사가 없고 곳 수와 묶음별 곳 수가 7곳 기준이다")
def picked_is_hidden(context):
    body = context["hidden"]
    assert context["picked"] not in {card["oppId"] for card in body["data"]}
    assert len(body["data"]) == body["meta"]["total"] == support.COMPANY_COUNT - 1
    assert sum(body["meta"]["bucketCounts"].values()) == support.COMPANY_COUNT - 1
    assert {row["count"] for row in body["meta"]["processCounts"] if row["count"]} == {
        support.COMPANY_COUNT - 1
    }
    assert sum(
        row["count"] for row in body["meta"]["regionCounts"] if row["region"] == "천안시"
    ) == (support.COMPANY_COUNT - 1)


@then("함께 보는 목록에는 그 회사가 있고 8곳이다")
def picked_is_shown(context):
    body = context["together"]
    assert context["picked"] in {card["oppId"] for card in body["data"]}
    assert body["meta"]["total"] == support.COMPANY_COUNT
    assert sum(body["meta"]["bucketCounts"].values()) == support.COMPANY_COUNT


@then("두 목록 모두 관심 기업이 1곳이라고 알려 준다")
def bookmarked_count(context):
    assert context["hidden"]["meta"]["bookmarkedCount"] == 1
    assert context["together"]["meta"]["bookmarkedCount"] == 1


@then("뒤쪽이던 회사가 근거 있음 묶음의 첫 번째가 된다")
def moved_up(context):
    assert [card["oppId"] for card in _pair(context)] == [context["second"], context["first"]]
    assert context["ready"][0]["oppId"] == context["second"] and context["ready"][0]["rank"] == 1


@then("그 카드에 조정 한 단계 위, 성사 3곳, 센 거절 2곳, 이유 수요 없음이 온다")
def reason_on_card(context):
    adjust = context["ready"][0]["rankAdjust"]
    assert (adjust["level"], adjust["wonCount"], adjust["lostCount"]) == (1, 3, 2)
    assert adjust["countedLostReasons"] == ["NO_DEMAND"]
    assert (adjust["processCode"], adjust["industry"]) == ("ANODIZING", support.PAIR)
    assert adjust["windowDays"] == 365


@then("근거 있음 묶음의 순서가 예전 추천 순 그대로다")
def order_kept(context):
    assert [card["oppId"] for card in _pair(context)] == [context["first"], context["second"]]
    assert {card["bucket"] for card in _pair(context)} == {"EVIDENCE_READY"}


@then("두 곳은 근거 조금 묶음에 예전 추천 순 그대로 있다")
def some_keeps_order(context):
    assert [(card["oppId"], card["bucket"]) for card in _pair(context)] == [
        (context["first"], "EVIDENCE_SOME"),
        (context["second"], "EVIDENCE_SOME"),
    ]


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
