"""검색 출처, 개인정보 제외, 보관 만료 경계는 외부 호출 없이 검사한다."""

from datetime import UTC, datetime, timedelta

import pytest

from geosan.opportunity.candidate_web_results import (
    can_reuse_search,
    parse_search_results,
    source_url,
)
from tests.fakes.web_candidate_search import candidate, response

BLOCKED = ("jobkorea.co.kr", "nicebizinfo.com")


@pytest.mark.parametrize(
    "url",
    [
        None,
        "",
        "javascript:alert(1)",
        "https://user:pass@bolt.example/",
        "http://127.0.0.1/",
        "https://localhost/",
        "https://server.local/",
        "https://bolt.example:bad/",
        "https://bolt.example:444/",
        "https://bolt.example/\n",
        "https://bolt.example\\@other.example/",
        "https://JOBKOREA.CO.KR./x",
        "https://jobs.jobkorea.co.kr/x",
        "https://nicebizinfo.com/x",
        "https://bolt.example/?email=a%40example.com",
    ],
)
def test_invalid_or_blocked_source(url):
    assert source_url(url, BLOCKED) is None


def test_domain_boundary_and_fragment():
    assert (
        source_url("https://jobkorea.co.kr.example/path#part", BLOCKED)
        == "https://jobkorea.co.kr.example/path"
    )


def test_source_must_come_from_tool_and_duplicates_do_not_hide_distinct_addresses():
    rows = [
        candidate(),
        candidate(sourceUrl="https://bolt.example/other"),
        candidate(companyName="다른회사", sourceUrl="https://invented.example/"),
        candidate(address="충남 천안시"),
        candidate(sourceUrl=None),
        candidate(sourceUrl="https://jobs.jobkorea.co.kr/job"),
    ]
    result, dropped = parse_search_results(
        response(
            rows,
            sources=[
                "https://bolt.example/products",
                "https://bolt.example/other",
                "https://jobs.jobkorea.co.kr/job",
            ],
        ),
        BLOCKED,
        10,
    )
    assert [r.address for r in result] == ["충남 아산시", "충남 천안시"]
    assert dropped == 4


@pytest.mark.parametrize(
    "field,value",
    [
        ("snippet", "문의: a@example.com"),
        ("address", "충남 010-1234-5678"),
        ("companyName", "담당자 홍길동"),
        ("snippet", "홍길동 과장"),
        ("snippet", "대표: 홍길동"),
        ("homepageUrl", "https://bolt.example/?phone=010-1234-5678"),
    ],
)
def test_personal_fields_are_dropped_without_returning_original(field, value):
    assert parse_search_results(response([candidate(**{field: value})]), BLOCKED, 10) == ((), 1)


def test_citation_annotations_are_also_actual_sources():
    data = response(sources=[])
    data["output"][1]["content"][0]["annotations"] = [
        {"type": "url_citation", "url": candidate()["sourceUrl"]}
    ]
    assert len(parse_search_results(data, BLOCKED, 10)[0]) == 1


@pytest.mark.parametrize(
    "mutation",
    [
        lambda r: r.update(status="incomplete"),
        lambda r: r["output"][0].update(status="searching"),
        lambda r: r["output"][0]["action"].update(type="open_page"),
        lambda r: r["output"][1].update(role="user"),
        lambda r: r["output"][1]["content"][0].update(text="not json"),
        lambda r: r["output"][1]["content"][0].update(text='{"companyName":"가상"}'),
        lambda r: r["output"][1]["content"][0].update(text='[{"companyName":2}]'),
        lambda r: r["output"][1]["content"].append({"type": "refusal"}),
    ],
)
def test_malformed_or_unfinished_result_is_failure(mutation):
    data = response()
    mutation(data)
    with pytest.raises(ValueError):
        parse_search_results(data, BLOCKED, 10)


def test_empty_is_valid_but_over_limit_and_unknown_fields_fail():
    assert parse_search_results(response([]), BLOCKED, 10) == ((), 0)
    for data in [
        response([candidate(), candidate()]),
        response([candidate(contact="not allowed")]),
    ]:
        with pytest.raises(ValueError):
            parse_search_results(data, BLOCKED, 1)


def test_completed_search_with_ignored_extra_tool_attempt():
    data = response()
    data.update(max_tool_calls=1, tool_usage={"web_search": {"num_requests": 1}})
    data["output"].insert(
        1, {"type": "web_search_call", "status": "searching", "action": {"type": "search"}}
    )
    assert len(parse_search_results(data, BLOCKED, 10)[0]) == 1


def _searched(times):
    """실제 응답 모양(#706 실측): 허용한 횟수만큼 completed, 그 뒤 시도 하나는 searching."""
    data = response()
    done = next(item for item in data["output"] if item["type"] == "web_search_call")
    start = data["output"].index(done)
    data["output"][start + 1 : start + 1] = [
        *({**done} for _ in range(times - 1)),
        {"type": "web_search_call", "status": "searching", "action": {"type": "search"}},
    ]
    data.update(max_tool_calls=times, tool_usage={"web_search": {"num_requests": times}})
    return data


def test_three_completed_searches_with_one_ignored_attempt_are_read():
    assert len(parse_search_results(_searched(3), BLOCKED, 10, searches_per_run=3)[0]) == 1


@pytest.mark.parametrize("change", ["limit", "usage", "unfinished"])
def test_unfinished_search_inside_the_allowed_count_is_still_a_failure(change):
    data = _searched(3)
    if change == "limit":
        data["max_tool_calls"] = 5
    elif change == "usage":
        data["tool_usage"]["web_search"]["num_requests"] = 2
    else:
        calls = [item for item in data["output"] if item["type"] == "web_search_call"]
        calls[1]["status"] = "searching"
    with pytest.raises(ValueError):
        parse_search_results(data, BLOCKED, 10, searches_per_run=3)


def test_cache_expiry_conditions_and_shortened_retention():
    start = datetime(2026, 11, 9, tzinfo=UTC)
    values = dict(
        stored_hash="same",
        current_hash="same",
        searched_at=start,
        expires_at=start + timedelta(days=15),
        cache_days=15,
        now=start,
    )
    assert can_reuse_search(**values)
    assert can_reuse_search(**(values | {"now": start + timedelta(days=15, microseconds=-1)}))
    for changed in [
        {"now": start + timedelta(days=15)},
        {"now": start - timedelta(seconds=1)},
        {"current_hash": "changed"},
        {"cache_days": 0},
        {"cache_days": True},
        {"now": start.replace(tzinfo=None)},
        {"expires_at": start},
        {"cache_days": 1, "now": start + timedelta(days=2)},
    ]:
        assert not can_reuse_search(**(values | changed))
