"""#680: 영업 기록 전용 스위치와 영업 기록 글의 문(C4 kind SALES_RECORD)."""

import pytest
import yaml

from geosan.config.app_settings import (
    check_app_settings_file,
    load_app_settings,
    read_app_settings,
)
from geosan.config.errors import AppError, NotFoundError
from geosan.config.models import AppSetting
from geosan.evidence.sales_record_gate import (
    ScrubbedRecordText,
    reserve_sales_records,
    scrub_sales_record,
    scrub_sales_records,
)
from geosan.evidence.transfer import finish_search, month_usage
from geosan.storage.session import session_scope
from tests.unit.u2 import test_search_limits as support

search_env = support.search_env


def _clean():
    return [scrub_sales_record("박 대리님이 다음 주에 견적 회신하기로 함")]


def test_switch_is_off_in_both_example_settings(examples_dir):
    for name in ("app-settings.yaml", "app-settings-virtual.yaml"):
        assert load_app_settings(examples_dir / name).llm.sales_records_enabled is False


def test_old_database_copy_without_the_switch_reads_as_off(tmp_db):
    with session_scope() as session:
        row = session.get(AppSetting, "llm")
        row.value = {key: value for key, value in row.value.items() if key != "salesRecordsEnabled"}
    with session_scope() as session:
        assert read_app_settings(session).llm.sales_records_enabled is False


@pytest.mark.parametrize("value", ["true", 1, None])
def test_switch_accepts_only_true_or_false(app_settings_path, tmp_path, value):
    data = yaml.safe_load(app_settings_path.read_text(encoding="utf-8"))
    data["llm"]["salesRecordsEnabled"] = value
    path = tmp_path / "settings.yaml"
    path.write_text(yaml.safe_dump(data, allow_unicode=True), encoding="utf-8")
    check = check_app_settings_file(path)
    assert not check.ok
    assert [error.path for error in check.errors] == ["llm.salesRecordsEnabled"]


def test_scrub_removes_contacts_then_names_and_counts_both():
    item = scrub_sales_record("담당 홍길동, hong@example.com / 01000000000 로 자료 보냄")
    assert item.text == "담당 [이름], [연락처 제거] / [연락처 제거] 로 자료 보냄"
    assert (item.removed_contacts, item.removed_names) == (2, 1)


@pytest.mark.parametrize(
    "texts",
    [
        [],
        ["지우기를 거치지 않은 글"],
        [ScrubbedRecordText("김철수 과장에게 전달", 0, 0)],
        [ScrubbedRecordText("메일은 kim@example.com", 0, 0)],
        [ScrubbedRecordText("깨끗한 글", 0, 0), ScrubbedRecordText("02-000-0000", 0, 0)],
    ],
)
def test_one_bad_item_rejects_the_whole_bundle(search_env, texts):
    support.change_setting("llm", salesRecordsEnabled=True)
    with pytest.raises(AppError) as caught:
        reserve_sales_records(search_env[0].opp_id, texts, True, None, "park-lee")
    assert caught.value.status == 422
    (row,) = support.logs()
    assert (row.kind, row.decision, row.call_count) == ("SALES_RECORD", "REJECTED", 0)


def test_main_switch_off_blocks_even_when_records_switch_is_on(search_env):
    support.change_setting("llm", salesRecordsEnabled=True, mode="NONE")
    with pytest.raises(AppError) as caught:
        reserve_sales_records(search_env[0].opp_id, _clean(), True, None, "park-lee")
    assert caught.value.kind == "LLM_NOT_CONFIGURED"
    (row,) = support.logs()
    assert (row.kind, row.decision, row.call_count) == ("SALES_RECORD", "REJECTED", 0)


def test_missing_key_blocks(search_env):
    support.change_setting("llm", salesRecordsEnabled=True)
    with pytest.raises(AppError) as caught:
        reserve_sales_records(search_env[0].opp_id, _clean(), False, None, "park-lee")
    assert caught.value.kind == "LLM_NOT_CONFIGURED"


@pytest.mark.parametrize("limit", [{"monthlyCallLimit": 1}, {"monthlyCostLimitUsd": 0.05}])
def test_monthly_limits_are_shared_with_other_ai_calls(search_env, limit):
    support.change_setting("llm", salesRecordsEnabled=True, **limit)
    opp_id = search_env[0].opp_id
    reserve_sales_records(opp_id, _clean(), True, None, "park-lee")
    with pytest.raises(AppError) as caught:
        reserve_sales_records(opp_id, _clean(), True, None, "park-lee")
    assert caught.value.kind == "LLM_LIMIT"
    assert [(row.decision, row.call_count) for row in support.logs()] == [
        ("ALLOWED", 1),
        ("REJECTED", 0),
    ]


def test_usage_is_settled_and_counted_in_month_usage(search_env):
    support.change_setting("llm", salesRecordsEnabled=True)
    ticket = reserve_sales_records(search_env[0].opp_id, _clean(), True, None, "park-lee")
    finish_search(ticket, 1000, 200, 0, None)
    with session_scope() as session:
        calls, cost = month_usage(session, ticket.llm)
    assert calls == 1 and float(cost) == pytest.approx(0.004)


def test_unknown_company_is_not_logged_or_sent(search_env):
    support.change_setting("llm", salesRecordsEnabled=True)
    with pytest.raises(NotFoundError):
        reserve_sales_records("opp-missing", _clean(), True, None, "park-lee")
    assert support.logs() == []


# ---------------------------------------------------------------------------
# #720: 회사 단위로 지운 글 묶음과 문의 재검사
# ---------------------------------------------------------------------------

COMPANY_MEMOS = [
    "김철수 과장과 통화. 010-0000-0000",
    "철수가 수요일에 샘플 보내기로. 홍길동 동석",
    "한일 대표번호로 전화. 전기아연도금 문의",
]


def test_company_bundle_removes_known_names_and_keeps_stored_text_alone():
    before = list(COMPANY_MEMOS)
    items = scrub_sales_records(COMPANY_MEMOS, ["한일정공", "전기아연도금"])
    assert COMPANY_MEMOS == before
    assert [item.text for item in items] == [
        "[이름] 과장과 통화. [연락처 제거]",
        "[이름]가 수요일에 샘플 보내기로. [이름] 동석",
        "한일 대표번호로 전화. 전기아연도금 문의",
    ]
    assert [(item.removed_contacts, item.removed_names) for item in items] == [
        (1, 1),
        (0, 2),
        (0, 0),
    ]
    assert "철수" not in repr(items[0])


def test_company_bundle_passes_the_gate(search_env):
    support.change_setting("llm", salesRecordsEnabled=True)
    items = scrub_sales_records(COMPANY_MEMOS, ["한일정공", "전기아연도금"])
    reserve_sales_records(search_env[0].opp_id, items, True, None, "park-lee")
    (row,) = support.logs()
    assert (row.kind, row.decision, row.call_count) == ("SALES_RECORD", "ALLOWED", 1)


@pytest.mark.parametrize(
    "extra",
    [
        ScrubbedRecordText("철수가 다시 전화함", 0, 0),  # 알아 둔 이름이 남은 글(지우기 전 글)
        ScrubbedRecordText("홍길동이 검토 중", 0, 0, True),  # 넉넉한 규칙에 걸리는 글
        ScrubbedRecordText("김철수 통화함", 0, 0, True),
    ],
)
def test_gate_rejects_a_bundle_where_a_known_or_name_like_word_is_left(search_env, extra):
    support.change_setting("llm", salesRecordsEnabled=True)
    items = [*scrub_sales_records(COMPANY_MEMOS), extra]
    with pytest.raises(AppError) as caught:
        reserve_sales_records(search_env[0].opp_id, items, True, None, "park-lee")
    assert caught.value.status == 422
    (row,) = support.logs()
    assert (row.kind, row.decision, row.call_count) == ("SALES_RECORD", "REJECTED", 0)


def test_single_text_scrub_still_passes_the_gate_as_before(search_env):
    support.change_setting("llm", salesRecordsEnabled=True)
    # 영업 비서가 쓰는 길(글 하나씩)은 그대로다: 넉넉한 규칙으로 다시 검사하지 않는다.
    item = scrub_sales_record("홍길동이 검토 중")
    assert (item.text, item.wide) == ("홍길동이 검토 중", False)
    reserve_sales_records(search_env[0].opp_id, [item], True, None, "park-lee")
