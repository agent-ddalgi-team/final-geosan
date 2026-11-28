"""#984: 실제 임시 DB·API로 달력 날짜 메모 시나리오를 확인한다.

외부 AI 호출 없음. 메모 글은 모두 가상이다.
"""

from datetime import datetime, timedelta

from pytest_bdd import given, parsers, scenarios, then, when

from tests.unit.u7 import test_day_memo as memo

memo_client = memo.memo_client
scenarios("u7/day_memo.feature")

DAY = "2026-11-05"
NEXT_DAY = "2026-11-06"


@given("날짜 메모가 하나도 없는 가상 묶음", target_fixture="client")
def empty_calendar(memo_client):
    assert memo.read(memo_client, "2026-10-01", "2026-12-31") == []
    return memo_client


@given(
    parsers.re(r'영업 담당이 11월 5일에 "(?P<text>.+)"(이라고|라고) 남겼다'),
    target_fixture="saved",
)
@when(
    parsers.re(r'영업 담당이 11월 5일에 "(?P<text>.+)"(이라고|라고) 남긴다'),
    target_fixture="saved",
)
def sales_writes(client, text):
    return memo.added(client, DAY, text, memo.SALES)


@when("검수 담당이 그 메모를 지우려 한다", target_fixture="refused")
def tech_tries_to_delete(client, saved):
    return memo.remove(client, saved["memoId"], memo.TECH)


@when("영업 담당이 그 메모를 지운다", target_fixture="deleted")
def writer_deletes(client, saved):
    response = memo.remove(client, saved["memoId"], memo.SALES)
    assert response.status_code == 200, response.text
    return response.json()["data"]


@when("보기 전용이 11월 5일에 메모를 남기려 한다", target_fixture="refused")
def viewer_tries_to_write(client):
    return memo.add(client, DAY, "가상 메모: 보기 전용이 적으려 함", memo.VIEWER)


@then("검수 담당이 11월 5일을 읽으면 그 메모가 보인다", target_fixture="seen")
def tech_reads(client, saved):
    rows = memo.read(client, DAY, DAY, memo.TECH)
    assert rows == [saved]
    return rows[0]


@then(parsers.parse('그 메모에 쓴 사람 "{name}"과 쓴 시각이 실린다'))
def writer_and_time(seen, name):
    assert (seen["staffKey"], seen["staffName"]) == ("park-lee", name)
    # 고정 시계는 부를 때마다 1초씩 간다. 앞 단계의 읽기 한 번 뒤에 남겼으므로 1초 뒤 시각이다.
    written_at = datetime.fromisoformat(seen["createdAt"])
    assert written_at.tzinfo is not None
    assert written_at == memo.START + timedelta(seconds=1)


@then("11월 6일을 읽으면 메모가 없다")
def next_day_is_empty(client):
    assert memo.read(client, NEXT_DAY, NEXT_DAY) == []


@then("거부되고 그 메모는 11월 5일에 그대로 보인다")
def refused_and_still_shown(client, refused, saved):
    assert refused.status_code == 403, refused.text
    assert memo.read(client, DAY, DAY) == [saved]


@then("11월 5일을 읽으면 메모가 없다")
def day_is_empty(client, deleted, saved):
    assert deleted == {"memoId": saved["memoId"], "deleted": True}
    assert memo.read(client, DAY, DAY) == []


@then("지운 메모의 행은 지운 시각·지운 사람과 함께 남아 있다")
def row_is_kept(saved):
    row = memo.stored(saved["memoId"])
    assert row["text"] == saved["text"]
    assert row["deleted_at"] is not None and row["deleted_by"] == "park-lee"


@then("남기기가 거부된다")
def write_refused(refused):
    assert refused.status_code == 403, refused.text


@then("보기 전용이 11월 5일을 읽으면 메모 한 건이 그대로 보인다")
def viewer_reads(client, saved):
    assert memo.read(client, DAY, DAY, memo.VIEWER) == [saved]
