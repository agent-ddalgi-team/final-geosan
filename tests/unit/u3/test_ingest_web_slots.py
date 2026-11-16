"""#823(#314, PM 결정 2026-11-17): 웹 후보 몫(candidateWebSearch.reservedSlots).

웹 갈래가 켜져 있으면 회차 최대 건수 가운데 웹 몫만큼은 웹 후보를 위해 비워 두고, 웹 후보가 덜
나오면 남은 자리는 공공자료 다음 순서로 채운다. 웹 검색·공장등록 조회의 바깥 통신만 가짜다.
"""

import pytest
from pydantic import ValidationError
from sqlalchemy import select

from geosan.config.app_settings import (
    CandidateWebSearchSettings,
    read_app_settings,
    sync_app_settings,
)
from geosan.config.models import AppSetting
from geosan.opportunity.models import Customer
from geosan.storage.session import session_scope
from tests.unit.u3.test_flow_ingest import ingest_env as ingest_env  # noqa: F401
from tests.unit.u3.test_flow_ingest import new_batch, saved
from tests.unit.u3.test_ingest_web_branch import saved_after, web_company
from tests.unit.u3.test_ingest_web_branch import web_env as web_env  # noqa: F401

PUBLIC = [f"가상 볼트{n}사" for n in range(1, 7)]


@pytest.fixture
def slots_env(web_env, factory_file):  # noqa: F811
    """공공자료에서 아연도금 회사 6곳이 맞게 공장현황 파일을 바꾼다(모두 같은 판단)."""
    path = factory_file(
        [
            [n, name, "가상단지", "가상 볼트", f"충청남도 당진시 가상길 {n}"]
            for n, name in enumerate(PUBLIC, start=1)
        ]
    )
    dated = path.with_name("factories_20251231.csv")
    dated.write_bytes(path.read_bytes())
    with session_scope() as session:
        row = session.get(AppSetting, "ingestion")
        row.value = row.value | {"factoryCsvPath": str(dated)}
    return web_env


def set_slots(reserved, enabled=True):
    with session_scope() as session:
        settings = read_app_settings(session)
        settings.candidate_web_search.reserved_slots = reserved
        settings.candidate_web_search.enabled = enabled
        sync_app_settings(session, settings)


def listed():
    with session_scope() as session:
        return {
            row.name: row.discovery_source
            for row in session.scalars(select(Customer).order_by(Customer.name))
        }


def public_names(rows):
    return sorted(name for name, source in rows.items() if source == "FACTORY_FILE")


def web_names(rows):
    return sorted(name for name, source in rows.items() if source == "WEB_SEARCH")


def test_web_slots_keep_room_for_web_companies(slots_env):
    """Given 최대 4곳 · 웹 몫 2 · 웹 후보 2곳 / When 후보 찾기 / Then 공공자료 2곳 + 웹 2곳."""
    set_slots(2)
    slots_env.found = [
        web_company("가상 웹A사", "충청남도 아산시 가상길 9"),
        web_company("가상 웹B사", "충청남도 아산시 가상길 10"),
    ]
    batch = saved_after(new_batch(maximum=4))
    rows = listed()
    assert web_names(rows) == ["가상 웹A사", "가상 웹B사"]
    assert len(public_names(rows)) == 2
    assert (batch.status, batch.new_count) == ("DONE", 4)


def test_fewer_web_companies_leave_no_empty_seat(slots_env):
    """Given 최대 4곳 · 웹 몫 2 · 웹 후보 1곳 / When 후보 찾기
    / Then 남은 1자리는 공공자료 다음 회사로."""
    set_slots(2)
    batch = saved_after(new_batch(maximum=4))
    rows = listed()
    assert web_names(rows) == ["가상 웹볼트사"]
    assert len(public_names(rows)) == 3
    assert (batch.new_count, batch.picked_count) == (4, 3)


def test_zero_slots_keeps_the_old_rule(slots_env):
    """Given 웹 몫 0 / When 최대 4곳 찾기
    / Then 지금처럼 공공자료가 4자리를 다 채우고 웹 후보는 안 들어온다."""
    set_slots(0)
    batch = saved_after(new_batch(maximum=4))
    rows = listed()
    assert len(public_names(rows)) == 4 and web_names(rows) == []
    assert batch.new_count == 4


def test_web_off_fills_every_seat_with_public_companies(slots_env):
    """Given 웹 몫 2인데 웹 갈래 꺼짐 / When 최대 4곳 / Then 검색 없이 공공자료 4곳."""
    set_slots(2, enabled=False)
    batch = saved_after(new_batch(maximum=4))
    assert slots_env.searches == 0
    assert len(public_names(listed())) == 4 and batch.new_count == 4


def test_daily_limit_skip_still_fills_the_reserved_seats(slots_env):
    """Given 웹 몫 2 · 하루 검색 한도에 닿음 / When 최대 4곳 / Then 웹은 건너뛰고 공공자료 4곳."""
    set_slots(2)
    slots_env.skipped = "DAILY_LIMIT"
    batch = saved_after(new_batch(maximum=4))
    assert len(public_names(listed())) == 4
    assert (batch.new_count, batch.web_skipped_reason) == (4, "DAILY_LIMIT")


def test_slots_never_exceed_the_batch_maximum(slots_env):
    """Given 웹 몫 5 · 최대 2곳 · 웹 후보 1곳 / When 후보 찾기
    / Then 웹 1곳 + 공공자료 1곳(최대 2곳을 넘지 않음)."""
    set_slots(5)
    batch = saved_after(new_batch(maximum=2))
    rows = listed()
    assert web_names(rows) == ["가상 웹볼트사"] and len(public_names(rows)) == 1
    assert saved(batch.batch_id).new_count == 2


def test_turning_on_without_blocked_sites_is_refused():
    with pytest.raises(ValidationError):
        CandidateWebSearchSettings(enabled=True, blocked_domains=[], reserved_slots=5)


def test_negative_slots_are_refused():
    with pytest.raises(ValidationError):
        CandidateWebSearchSettings(reserved_slots=-1)


def test_old_settings_without_the_key_read_zero():
    assert CandidateWebSearchSettings().reserved_slots == 0
