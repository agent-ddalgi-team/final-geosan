"""#932: 기존 고객 참고 자료(확장 기능, 기본 꺼짐) — 파일 넣기·MCP 도구 2개·찾기 조건 제안.

PM 결정 2026-11-26: 검증된 자료를 넣는다는 가정으로 기능만 만들고 배포하지 않는다. 받는 칸은 7개,
금액·연락처는 받지 않는다. AI는 제안만, 점수·순위는 바꾸지 않는다.
가상 고객 파일(examples/existing-customers-virtual.csv)과 임시 DB만 쓴다. 외부 AI는 부르지 않는다.
"""

from pathlib import Path

import pytest
from sqlalchemy import select

from geosan.api import mcp_tools
from geosan.api.coach_agent import lookup_instructions, openai_tools
from geosan.commands.customer_load import run_customer_load
from geosan.config.app_settings import read_app_settings
from geosan.config.errors import InputError
from geosan.config.models import AppSetting
from geosan.evaluation.models import EvaluationRun
from geosan.opportunity.existing_customers import (
    overview,
    pick_similar_customers,
    read_customer_file,
)
from geosan.opportunity.source_models import ExistingCustomer
from geosan.storage.session import session_scope
from tests.unit.u7 import test_coach_similar as cases
from tests.unit.u7 import test_mcp_server as mcp
from tests.unit.u7 import test_sales_assistant as support

dashboard_env = support.dashboard_env
assistant_env = support.assistant_env
mcp_env = mcp.mcp_env
call = mcp.call
text_of = mcp.text_of
set_industries = cases.set_industries

EXAMPLE = Path(__file__).resolve().parents[3] / "examples" / "existing-customers-virtual.csv"
PROCESSES = {
    "ZINC_PLATING": "아연도금(전기아연도금)",
    "ANODIZING": "아노다이징",
    "CHROMATE": "크로메이트",
}
INDUSTRIES = ["자동차 부품", "반도체 장비", "밸브·유체기기"]
LIST_NAMES = ["find_companies", "company_records", "similar_won", "similar_lost", "past_analyses"]


def write(tmp_path, text, name="기존고객_20261126.csv", encoding="utf-8"):
    path = tmp_path / name
    path.write_text(text, encoding=encoding)
    return path


def switch(enabled=True, similar_limit=3):
    with session_scope() as session:
        row = session.get(AppSetting, "existingCustomers")
        value = {"enabled": enabled, "similarLimit": similar_limit}
        if row is None:
            session.add(AppSetting(setting_key="existingCustomers", value=value))
        else:
            row.value = value


def load_example(echo=None):
    lines = []
    code = run_customer_load(EXAMPLE, virtual=True, echo=echo or lines.append)
    assert code == 0, lines
    return lines


def customer_logs():
    return [row for row in support.logs() if row[1] == "EXISTING_CUSTOMER"]


# ---------------------------------------------------------------------------
# 파일 읽기·검사
# ---------------------------------------------------------------------------


def test_reads_seven_columns_and_drops_the_rest(tmp_path):
    """Given 단가·담당자 칸이 섞인 파일 / When 읽기 / Then 7칸만 남고 나머지 칸 이름만 알린다."""
    path = write(
        tmp_path,
        "회사명,공정,단가,소재,산업,지역,인증,거래 시작,담당자\n"
        '"가정밀(가상)","아연도금, 크로메이트",1200,SPCC;SS400,자동차 부품,충남 천안시,'
        "IATF 16949,2019.3,가상담당\n"
        "나테크(가상),ANODIZING,,,반도체장비,,,2022,\n",
    )
    result = read_customer_file(path, PROCESSES, INDUSTRIES)
    assert result.dropped_columns == ["단가", "담당자"]
    first, second = result.rows
    assert first.process_codes == ("ZINC_PLATING", "CHROMATE")
    assert first.materials == ("SPCC", "SS400")
    assert first.since == "2019-03"
    assert first.region == "충남 천안시"
    # 띄어쓰기가 달라도 설정 산업군 이름으로 맞춘다. 연도만 적으면 연도만.
    assert second.industries == ("반도체 장비",)
    assert second.since == "2022"
    assert second.region is None
    # 버린 칸의 값은 어디에도 없다.
    assert "1200" not in repr(result.rows) and "가상담당" not in repr(result.rows)


def test_rejects_whole_file_with_line_reasons(tmp_path):
    """Given 연락처·모르는 공정·모르는 산업·같은 회사·틀린 날짜 / When 읽기 / Then 전체 거부."""
    path = write(
        tmp_path,
        "회사명,공정,산업,지역,거래 시작\n"
        "가정밀(가상),아연도금,자동차 부품,천안 041-555-1234,2019-03\n"
        "나테크(가상),레이저 용접,자동차 부품,,\n"
        "다산업(가상),아연도금,식품,,\n"
        "라금속(가상),아연도금,,,2019-13\n"
        "라금속(가상),아연도금,,,\n"
        "마부품(가상),,,,\n",
    )
    with pytest.raises(InputError) as caught:
        read_customer_file(path, PROCESSES, INDUSTRIES)
    fields = {(item.line, item.path) for item in caught.value.fields}
    assert fields == {
        (2, "지역"),
        (3, "공정"),
        (4, "산업"),
        (5, "거래 시작"),
        (7, "공정"),
    }
    # 같은 회사는 앞 줄이 틀려 넣지 않았으므로 6째 줄은 거부되지 않는다(5째 줄만 틀림).
    assert "아무것도 넣지 않았습니다" in caught.value.message


def test_rejects_missing_required_columns_and_empty_file(tmp_path):
    """Given 회사명·공정 칸이 없는 파일, 빈 파일 / When 읽기 / Then 거부."""
    with pytest.raises(InputError, match="공정"):
        read_customer_file(write(tmp_path, "회사명,산업\n가(가상),자동차 부품\n"), PROCESSES, [])
    with pytest.raises(InputError, match="비어"):
        read_customer_file(write(tmp_path, "", name="빈.csv"), PROCESSES, [])
    with pytest.raises(InputError, match="회사 줄이 없습니다"):
        read_customer_file(write(tmp_path, "회사명,공정\n,\n", name="b.csv"), PROCESSES, [])


def test_reads_cp949(tmp_path):
    """Given 엑셀에서 저장한 CP949 CSV / When 읽기 / Then 그대로 읽는다."""
    path = write(tmp_path, "회사명,공정\n가정밀(가상),아연도금\n", encoding="cp949")
    assert read_customer_file(path, PROCESSES, []).rows[0].company_name == "가정밀(가상)"


# ---------------------------------------------------------------------------
# 넣기 명령
# ---------------------------------------------------------------------------


def test_load_replaces_and_clear_removes(dashboard_env, tmp_path):
    """Given 예시 가상 파일 / When 넣기 두 번·지우기 / Then 통째로 바뀌고 꺼짐 안내가 나온다."""
    lines = load_example()
    assert lines[0].startswith("2026-")  # 파일 이름에 날짜가 없으면 넣은 날
    assert "기존 고객 7곳을 넣었습니다 (가상·거산 실제 사양 아님)" in lines[0]
    assert any("꺼져 있어" in line for line in lines)
    # 다시 넣으면 더하지 않고 바꾼다.
    small = write(tmp_path, "회사명,공정\n하나뿐(가상),아연도금\n")
    out = []
    assert run_customer_load(small, echo=out.append) == 0
    assert "2026-11-26 기준 기존 고객 1곳" in out[0]
    with session_scope() as session:
        rows = session.scalars(select(ExistingCustomer)).all()
        assert [row.company_name for row in rows] == ["하나뿐(가상)"]
        assert rows[0].is_virtual is False
    out = []
    assert run_customer_load(None, clear=True, echo=out.append) == 0
    assert out == ["기존 고객 1곳을 모두 지웠습니다."]
    with session_scope() as session:
        assert session.scalars(select(ExistingCustomer)).all() == []


def test_load_refuses_bad_file_and_keeps_old_rows(dashboard_env, tmp_path):
    """Given 이미 넣은 고객 / When 틀린 파일 / Then 종료 1, 줄 이유를 보이고 옛 고객은 그대로."""
    load_example()
    bad = write(tmp_path, "회사명,공정\n가(가상),레이저 용접\n")
    out = []
    assert run_customer_load(bad, echo=out.append) == 1
    assert any("2째 줄 [공정]" in line for line in out)
    assert run_customer_load(None, echo=out.append) == 1  # 파일도 --clear도 없음
    with session_scope() as session:
        assert len(session.scalars(select(ExistingCustomer)).all()) == 7


def test_customers_never_change_scores(dashboard_env):
    """Given 평가가 끝난 회사들 / When 기존 고객을 넣고 켬 / Then 평가 기록은 그대로다."""
    with session_scope() as session:
        before = len(session.scalars(select(EvaluationRun)).all())
    load_example()
    switch(True)
    with session_scope() as session:
        assert len(session.scalars(select(EvaluationRun)).all()) == before


# ---------------------------------------------------------------------------
# 고르기·모습
# ---------------------------------------------------------------------------


def test_pick_similar_orders_by_overlap_then_recent(dashboard_env):
    """Given 예시 고객 7곳 / When 아연도금·자동차 부품 기준 / Then 겹침 많은 순 → 최근 거래 순."""
    load_example()
    with session_scope() as session:
        picked = pick_similar_customers(session, ["ZINC_PLATING", "CHROMATE"], ["자동차 부품"], 4)
        names = [item.customer.company_name for item in picked]
        view = overview(session)
    # 가정밀: 공정 2·산업 1 / 사부품(2024-02)·나금속(2021-07): 공정 1·산업 1 / 라산업: 공정 1
    assert names == [
        "가상고객 가정밀(가상)",
        "가상고객 사부품(가상)",
        "가상고객 나금속(가상)",
        "가상고객 라산업(가상)",
    ]
    assert view.total == 7 and view.has_virtual
    assert view.processes[0] == ("ZINC_PLATING", 4)
    assert view.industries[0] == ("자동차 부품", 3)


# ---------------------------------------------------------------------------
# MCP 도구(스위치 두 개)
# ---------------------------------------------------------------------------


def tool_names(server):
    reply = server.handle({"jsonrpc": "2.0", "id": 9, "method": "tools/list"})
    return [tool["name"] for tool in reply["result"]["tools"]]


def test_customer_tools_hidden_and_refused_while_off(mcp_env):
    """Given 기존 고객을 넣었지만 꺼짐(기본) / When 목록·호출 / Then 안 보이고 값 없이 거부."""
    server, opp_ids = mcp_env
    load_example()
    assert tool_names(server) == LIST_NAMES
    text, is_error = text_of(call(server, "similar_customers", {"oppId": opp_ids[0]}))
    assert is_error and text == mcp_tools.CUSTOMERS_OFF_MESSAGE
    assert "가정밀" not in text
    assert customer_logs() == [(opp_ids[0], "EXISTING_CUSTOMER", "REJECTED", 0)]
    # 코치에 알리는 도구 목록에도 없다.
    with session_scope() as session:
        settings = read_app_settings(session)
    assert [tool["name"] for tool in openai_tools(settings)] == LIST_NAMES


def test_customer_tools_return_scrubbed_copy_when_on(mcp_env):
    """Given 스위치 켬 / When 비슷한 기존 고객·기존 고객 모습 / Then 값과 전송 기록 1행씩."""
    server, opp_ids = mcp_env
    a = opp_ids[0]
    load_example()
    switch(True, similar_limit=2)
    # A정밀(가상)은 아노다이징 회사다. 산업을 자동차 부품으로 두면 산업만 겹치는 고객도 후보가 된다.
    set_industries(a, ["자동차 부품"])
    assert tool_names(server) == [*LIST_NAMES, "similar_customers", "customer_overview"]
    text, is_error = text_of(call(server, "similar_customers", {"oppId": a}))
    assert not is_error, text
    assert "기존 고객 2곳" in text
    # 공정이 겹치는 다테크 먼저, 산업만 겹치는 고객 가운데 가장 최근 거래(사부품 2024-02).
    assert text.index("가상고객 다테크(가상)") < text.index("가상고객 사부품(가상)")
    assert "겹치는 것(A정밀 기준): 공정 아노다이징" in text
    assert "거래 시작: 2024-02" in text and "인증: IATF 16949" in text
    assert "가정밀" not in text  # 상한 2곳
    assert "[가상·거산 실제 사양 아님]" in text
    text, is_error = text_of(call(server, "customer_overview", {"oppId": a}, request_id=2))
    assert not is_error, text
    assert "기존 고객 7곳" in text and "아연도금(전기아연도금) 4곳" in text
    assert "자동차 부품 3곳" in text and "A정밀의 공정·산업: 아노다이징" in text
    assert customer_logs() == [
        (a, "EXISTING_CUSTOMER", "ALLOWED", 1),
        (a, "EXISTING_CUSTOMER", "ALLOWED", 1),
    ]
    # 하루 MCP 한도는 영업 기록 도구와 함께 센다.
    with session_scope() as session:
        assert mcp_tools.mcp_calls_today(session) == 2


def test_customer_tools_need_sales_records_switch_too(mcp_env):
    """Given 기존 고객 스위치만 켬 / When 영업 기록 스위치 꺼짐 / Then 거부(둘 다 켜야 함)."""
    server, opp_ids = mcp_env
    load_example()
    switch(True)
    support.use_external_ai(salesRecordsEnabled=False)
    text, is_error = text_of(call(server, "customer_overview", {"oppId": opp_ids[0]}))
    assert is_error and "가정밀" not in text and "7곳" not in text


def test_customer_overview_with_no_rows_says_so(mcp_env):
    """Given 켰지만 기존 고객을 아직 안 넣음 / When 모습 / Then 돌려줄 기록이 없다고 한다."""
    server, opp_ids = mcp_env
    switch(True)
    text, is_error = text_of(call(server, "customer_overview", {"oppId": opp_ids[0]}))
    assert not is_error and "돌려줄 기록이 없습니다" in text


def test_coach_gets_customer_tools_and_hint_only_when_on(assistant_env):
    """Given 스위치 켬 / When 코치 도구 목록·지시문 / Then 기존 고객 도구·맞춤 질문 안내."""
    switch(True)
    with session_scope() as session:
        settings = read_app_settings(session)
    names = [tool["name"] for tool in openai_tools(settings)]
    assert names[-2:] == ["similar_customers", "customer_overview"]
    on = lookup_instructions("opp-1", 3, customers=True)
    off = lookup_instructions("opp-1", 3)
    assert "similar_customers" in on and "물어볼 질문" in on
    assert "similar_customers" not in off


# ---------------------------------------------------------------------------
# 신규 거래처 찾기 "기존 고객과 닮은 조건"
# ---------------------------------------------------------------------------


def suggestions(client):
    response = client.get("/api/v1/existing-customers/suggestions")
    assert response.status_code == 200, response.text
    return response.json()


def test_suggestions_empty_while_off(dashboard_env):
    """Given 기존 고객을 넣었지만 꺼짐 / When 제안 / Then 값이 하나도 없다."""
    client, _ = dashboard_env
    load_example()
    body = suggestions(client)
    assert body["data"] == {
        "enabled": False,
        "total": 0,
        "processes": [],
        "industries": [],
        "regions": [],
    }


def test_suggestions_count_conditions_when_on(dashboard_env):
    """Given 켬 / When 제안 / Then 공정·산업·지역을 고객 수 많은 순으로, 찾기 조건 값만."""
    client, _ = dashboard_env
    load_example()
    switch(True)
    body = suggestions(client)
    data = body["data"]
    assert data["enabled"] is True and data["total"] == 7
    assert data["processes"][0] == {
        "code": "ZINC_PLATING",
        "label": "아연도금(전기아연도금)",
        "count": 4,
    }
    assert data["industries"][0] == {"name": "자동차 부품", "count": 3}
    # "충남 천안시" 2곳 → 천안시 2, 충남(천안·아산·당진) 4. 경기 화성시는 찾기 지역이 아니라 빠진다.
    regions = {item["name"]: item["count"] for item in data["regions"]}
    assert regions["충남"] == 4 and regions["천안시"] == 2
    assert "화성시" not in regions
    assert body["meta"]["hasVirtualData"] is True
