"""#217: 엑셀 내려받기 창구를 실제 임시 SQLite·평가·API로 확인한다. 가상 사례만 쓴다.

외부 AI·검색 호출 없음. 엑셀은 응답 바이트를 다시 읽어 본다.
"""

from datetime import date
from io import BytesIO

import pytest
from openpyxl import load_workbook
from pydantic import ValidationError

from geosan.api.app import create_app
from geosan.api.models import AccessSession
from geosan.config import app_settings
from geosan.config.app_settings import (
    DEFAULT_APP_SETTINGS_PATH,
    load_app_settings,
    read_app_settings,
)
from geosan.config.errors import InputError
from geosan.config.models import AppSetting
from geosan.evaluation.ledger import latest_confirmed_evaluation
from geosan.evaluation.models import EvaluationRun
from geosan.evidence.export_guard import ExportItem, check_output_export
from geosan.opportunity.importer import import_case
from geosan.opportunity.models import Customer, Opportunity
from geosan.records.models import Note, Outcome
from geosan.records.xlsx_export import XLSX_MEDIA_TYPE
from geosan.storage.base import new_id
from geosan.storage.session import session_scope
from geosan.workflows.flow_evaluate import run_evaluation
from tests import factories
from tests.conftest import VIRTUAL_APP_SETTINGS_PATH
from tests.unit.u1.test_process_filter import process_env  # noqa: F401
from tests.unit.u1.test_snapshot_ledger import _write
from tests.unit.u7.test_dashboard_population import candidate_env  # noqa: F401

LIST_URL = "/api/v1/opportunities"
EXPORT_URL = "/api/v1/export/xlsx"
HEADERS = ["회사", "공정", "점수", "단계", "다음 일정"]
NOTICE = "내부용·고객 제출용 아님"
MEMO = "엑셀에 나가면 안 되는 가상 메모"
PHONE = "041-000-0000"


def set_export_enabled(enabled):
    """설정 사본의 엑셀 내려받기 스위치를 바꾼다(운영자가 설정을 켜고 등록한 것과 같은 상태)."""
    with session_scope() as session:
        session.get(AppSetting, "export").value = {"xlsxEnabled": enabled}


def mark_download_log_ready(monkeypatch, ready=True):
    """내려받은 기록이 준비됐는지 묻는 한 곳만 바꾼다(기록을 만든 뒤의 코드와 같은 상태)."""
    monkeypatch.setattr(app_settings, "XLSX_DOWNLOAD_LOG_READY", ready)


@pytest.fixture(autouse=True)
def export_switch_on(request, monkeypatch):
    """예시 설정은 꺼짐이 초기값이고, 내려받은 기록이 없는 지금은 켜는 설정을 받지 않는다.

    임시 DB를 쓰는 검사는 "기록이 준비된 뒤 스위치를 켠 상태"에서 시작한다.
    """
    if "tmp_db" in request.fixturenames:
        request.getfixturevalue("tmp_db")
        mark_download_log_ready(monkeypatch)
        set_export_enabled(True)


def sheet_rows(response):
    assert response.status_code == 200, response.text
    book = load_workbook(BytesIO(response.content))
    return [
        ["" if value is None else value for value in row]
        for row in book.active.iter_rows(values_only=True)
    ]


def all_cards(client, **params):
    response = client.get(LIST_URL, params={"pageSize": 50, **params})
    assert response.status_code == 200, response.text
    return response.json()["data"]


def add_outcome(opp_id, status="IN_PROGRESS", day=date(2026, 11, 20), note="가상 일정"):
    with session_scope() as session:
        session.add(
            Outcome(
                outcome_id=new_id("outcome"),
                opp_id=opp_id,
                status=status,
                next_schedule_at=day,
                next_schedule_note=note,
                version=1,
                created_by="park-lee",
                dataset_kind="VIRTUAL_REVIEWED",
                is_virtual=True,
            )
        )


def add_private_values(opp_id):
    """메모·대표번호·일정 내용은 가상 값이다. 엑셀 어디에도 나오면 안 된다."""
    with session_scope() as session:
        opportunity = session.get(Opportunity, opp_id)
        customer = session.get(Customer, opportunity.customer_id)
        customer.main_phone = PHONE
        customer.main_phone_source = "HOMEPAGE"
        session.add(
            Note(
                note_id=new_id("note"),
                opp_id=opp_id,
                staff_key="park-lee",
                text=MEMO,
                version=1,
                dataset_kind="VIRTUAL_REVIEWED",
                is_virtual=True,
            )
        )


def test_headers_columns_and_virtual_notice(process_env):  # noqa: F811
    """Given 가상 회사 3곳 / When 내려받기 / Then 엑셀 형식·파일 이름·표시 줄·다섯 열이다."""
    client, _, _ = process_env
    response = client.get(EXPORT_URL)
    assert response.status_code == 200
    assert response.headers["content-type"] == XLSX_MEDIA_TYPE
    disposition = response.headers["content-disposition"]
    assert disposition.startswith('attachment; filename="geosan-list-')
    # 한글 파일 이름 "거산_추천목록_<날짜>.xlsx"
    assert "filename*=UTF-8''%EA%B1%B0%EC%82%B0_%EC%B6%94%EC%B2%9C%EB%AA%A9%EB%A1%9D_" in (
        disposition
    )
    assert disposition.endswith(".xlsx")
    rows = sheet_rows(response)
    assert rows[0][0] == f"{NOTICE} · 가상 데이터 포함"
    assert rows[1] == HEADERS
    assert len(rows) == 2 + 3 and all(len(row) == 5 for row in rows)


def test_rows_match_the_list_in_order_with_card_values(process_env):  # noqa: F811
    """Given 단계·일정이 있는 회사 / When 내려받기 / Then 목록과 같은 순서·같은 값이다."""
    client, ids, _ = process_env
    add_outcome(ids[1])
    cards = all_cards(client)
    names = {row["processCode"]: row["processName"] for row in _process_counts(client)}
    rows = sheet_rows(client.get(EXPORT_URL))[2:]
    assert [row[0] for row in rows] == [card["title"] for card in cards]
    for row, card in zip(rows, cards, strict=True):
        assert row[1] == ", ".join(names[code] for code in card["processCodes"])
        assert row[2] == card["scoreDisplay"]
        assert row[3:] == (["접촉", "2026-11-20"] if card["oppId"] == ids[1] else ["미접촉", ""])


def _process_counts(client):
    return client.get(LIST_URL).json()["meta"]["processCounts"]


@pytest.mark.parametrize(
    "params",
    [
        {"process": "ANODIZING"},
        {"process": "ZINC_PLATING"},
        {"stage": "IN_PROGRESS"},
        {"stage": "NOT_EXECUTED"},
        {"bookmarked": "true"},
        {"opinion": "NONE"},
        {"q": "A정밀"},
        {"q": "없는 회사 이름"},
        {"sort": "recent"},
    ],
    ids=lambda value: "&".join(f"{k}-{v}" for k, v in value.items()),
)
def test_filters_give_the_same_companies_as_the_list(process_env, params):  # noqa: F811
    """Given 걸러 보기 조건 / When 같은 조건으로 내려받기 / Then 화면 목록과 같은 회사·순서다."""
    client, ids, _ = process_env
    add_outcome(ids[0])
    cards = all_cards(client, **params)
    rows = sheet_rows(client.get(EXPORT_URL, params=params))[2:]
    assert [row[0] for row in rows] == [card["title"] for card in cards]


def test_all_pages_are_exported_not_only_the_first(process_env):  # noqa: F811
    """Given 한 쪽에 1곳씩 보는 목록 / When 내려받기 / Then 쪽과 상관없이 3곳 전부다."""
    client, _, _ = process_env
    assert len(client.get(LIST_URL, params={"pageSize": 1}).json()["data"]) == 1
    assert len(sheet_rows(client.get(EXPORT_URL))[2:]) == 3


def test_unsupported_filter_is_rejected_like_the_list(process_env):  # noqa: F811
    """Given 목록이 모르는 조건 / When 내려받기 / Then 목록과 같은 입력 오류이고 파일이 없다."""
    client, _, _ = process_env
    for params in ({"filter": "NO_SUCH_FILTER"}, {"sort": "distance"}, {"process": "NOPE"}):
        listed = client.get(LIST_URL, params=params)
        exported = client.get(EXPORT_URL, params=params)
        assert exported.status_code == listed.status_code == 400
        assert exported.headers["content-type"] == "application/json"


def test_memo_main_phone_and_schedule_note_never_appear(process_env):  # noqa: F811
    """Given 메모·대표번호·일정 내용이 있는 회사 / When 내려받기 / Then 열도 값도 없다."""
    client, ids, _ = process_env
    add_private_values(ids[0])
    add_outcome(ids[0], note="엑셀에 나가면 안 되는 일정 내용")
    detail = client.get(f"{LIST_URL}/{ids[0]}").json()["data"]
    assert detail["header"]["mainPhone"] == PHONE
    rows = sheet_rows(client.get(EXPORT_URL))
    assert rows[1] == HEADERS
    text = "\n".join(str(value) for row in rows for value in row)
    for private in (MEMO, PHONE, "일정 내용", "메모", "대표번호", "park-lee"):
        assert private not in text


def test_contact_in_free_text_cell_is_scrubbed(process_env):  # noqa: F811
    """Given 품목 글에 전화·이메일이 섞임 / When 내려받기 / Then 연락처만 지워진 채로 나간다."""
    client, ids, _ = process_env
    with session_scope() as session:
        session.get(Opportunity, ids[0]).item = "가상 브래킷 010-1234-5678 a@example.invalid"
    card = next(card for card in all_cards(client) if card["oppId"] == ids[0])
    assert "010-1234-5678" in card["title"]
    response = client.get(EXPORT_URL)
    row = next(row for row in sheet_rows(response)[2:] if "가상 브래킷" in row[0])
    assert row[0].endswith("가상 브래킷 [연락처 제거] [연락처 제거]")
    assert b"010-1234-5678" not in response.content
    text = "\n".join(str(value) for line in sheet_rows(response) for value in line)
    assert "010-1234-5678" not in text and "example.invalid" not in text


def test_notice_without_virtual_rows(process_env):  # noqa: F811
    """Given 가상이 아닌 평가만 있음 / When 내려받기 / Then 가상 표시 없이 내부용 표시만 있다."""
    client, _, _ = process_env
    with session_scope() as session:
        for run in session.query(EvaluationRun):
            run.is_virtual = False
    assert all(not card["isVirtual"] for card in all_cards(client))
    assert sheet_rows(client.get(EXPORT_URL))[0][0] == NOTICE


def test_company_before_scoring_shows_score_pending_text(candidate_env):  # noqa: F811
    """Given 점수 전 후보 / When 내려받기 / Then 점수 칸에 "점수 전"이라고 적힌다."""
    client, opp_id = candidate_env
    card = next(card for card in all_cards(client) if card["oppId"] == opp_id)
    assert card["scoreState"] == "NONE"
    rows = sheet_rows(client.get(EXPORT_URL))[2:]
    assert [row[2] for row in rows if row[0] == card["title"]] == ["점수 전"]


def test_unconfirmed_score_is_marked(process_env):  # noqa: F811
    """Given 확인 전 점수 / When 내려받기 / Then 점수 뒤에 "(확인 전)"이 붙는다."""
    client, ids, _ = process_env
    with session_scope() as session:
        latest_confirmed_evaluation(session, ids[0]).classification_code = "FILTER_PENDING"
    cards = all_cards(client)
    assert [card["scoreState"] for card in cards].count("PENDING") == 1
    rows = sheet_rows(client.get(EXPORT_URL))[2:]
    assert [row[2] for row in rows] == [
        f"{card['scoreDisplay']} (확인 전)"
        if card["scoreState"] == "PENDING"
        else card["scoreDisplay"]
        for card in cards
    ]


@pytest.mark.parametrize("grade", ["FORBIDDEN", "UNKNOWN", "NOT_A_GRADE"])
def test_rejected_grade_stops_the_whole_export(process_env, grade):  # noqa: F811
    """Given 내보낼 수 없는 등급의 회사 / When 내려받기 / Then 422이고 파일이 나가지 않는다."""
    client, ids, _ = process_env
    with session_scope() as session:
        # 시험 자료의 기회 3건은 같은 가상 회사 하나에 달려 있다.
        customer_ids = {session.get(Opportunity, opp_id).customer_id for opp_id in ids}
        assert len(customer_ids) == 1
        session.get(Customer, customer_ids.pop()).security_grade = grade
    response = client.get(EXPORT_URL)
    assert response.status_code == 422
    assert response.headers["content-type"] == "application/json"
    assert "content-disposition" not in response.headers
    assert not response.content.startswith(b"PK")
    error = response.json()["error"]
    assert error["kind"] == "EXPORT_REJECTED"
    assert error["message"] and error["nextAction"] and error["ref"]
    assert sorted(item["refId"] for item in error["rejectedItems"]) == sorted(ids)
    assert all(item["reason"] for item in error["rejectedItems"])
    # 목록 조회는 그대로 된다(내려받기만 멈춘다).
    assert len(all_cards(client)) == 3


def test_one_rejected_company_stops_the_others_too(process_env, tmp_path):  # noqa: F811
    """Given 통과 회사와 금지 등급 회사가 섞임 / When 내려받기 / Then 걸러 내지 않고 전체 중단."""
    client, ids, _ = process_env
    other = import_case(
        _write(tmp_path, "other.json", factories.apjeong_renamed_customer("other", "가상 B정밀"))
    ).opp_id
    assert run_evaluation().ok
    with session_scope() as session:
        other_customer = session.get(Opportunity, other).customer_id
        assert other_customer != session.get(Opportunity, ids[0]).customer_id
        session.get(Customer, other_customer).security_grade = "FORBIDDEN"
    response = client.get(EXPORT_URL)
    assert response.status_code == 422
    assert [item["refId"] for item in response.json()["error"]["rejectedItems"]] == [other]
    assert not response.content.startswith(b"PK")


def test_viewer_and_no_staff_key_can_download_like_other_reads(process_env):  # noqa: F811
    """Given 담당자 키 없음·보기 전용 / When 내려받기 / Then 다른 읽기처럼 받을 수 있다."""
    client, _, _ = process_env
    for headers in ({}, {"X-Staff-Key": "viewer"}):
        assert client.get(EXPORT_URL, headers=headers).status_code == 200


def test_access_protection_applies(process_env):  # noqa: F811
    """Given 접속 보호 켬·접속 확인 없음 / When 내려받기 / Then 401이고 파일이 나가지 않는다."""
    client, _, _ = process_env
    with session_scope() as session:
        session.get(AppSetting, "accessProtection").value = {"enabled": True}
        assert session.query(AccessSession).count() == 0
    response = client.get(EXPORT_URL)
    assert response.status_code == 401
    assert not response.content.startswith(b"PK")


def test_example_settings_keep_the_export_switch_off():
    """Given 저장소의 예시 설정 두 벌 / When 읽음 / Then 엑셀 내려받기는 꺼져 있다."""
    for path in (DEFAULT_APP_SETTINGS_PATH, VIRTUAL_APP_SETTINGS_PATH):
        assert load_app_settings(path).export.xlsx_enabled is False


def test_switch_off_blocks_the_export_before_anything_is_read(process_env):  # noqa: F811
    """Given 스위치 꺼짐 / When 내려받기 / Then 422 EXPORT_DISABLED이고 파일이 나가지 않는다."""
    client, _, _ = process_env
    set_export_enabled(False)
    for params in ({}, {"stage": "IN_PROGRESS"}, {"filter": "NOPE"}):
        response = client.get(EXPORT_URL, params=params)
        assert response.status_code == 422, response.text
        error = response.json()["error"]
        assert error["kind"] == "EXPORT_DISABLED"
        assert error["message"] == "엑셀 내려받기가 꺼져 있습니다."
        assert error["nextAction"] and error["ref"]
        assert "content-disposition" not in response.headers
        assert not response.content.startswith(b"PK")
    assert len(all_cards(client)) == 3


def test_switch_can_be_turned_on_again_without_restart(process_env):  # noqa: F811
    """Given 꺼서 막힌 뒤 / When 설정을 켬 / Then 같은 서버에서 바로 엑셀이 내려온다."""
    client, _, _ = process_env
    set_export_enabled(False)
    assert client.get(EXPORT_URL).status_code == 422
    set_export_enabled(True)
    assert sheet_rows(client.get(EXPORT_URL))[1] == HEADERS


def test_access_protection_comes_before_the_switch(process_env):  # noqa: F811
    """Given 접속 보호 켬·스위치 꺼짐 / When 접속 확인 없이 내려받기 / Then 401이 먼저다."""
    client, _, _ = process_env
    set_export_enabled(False)
    with session_scope() as session:
        session.get(AppSetting, "accessProtection").value = {"enabled": True}
    assert client.get(EXPORT_URL).status_code == 401


def test_screen_settings_tell_whether_the_export_is_on(process_env):  # noqa: F811
    """Given 스위치 켬·끔 / When 화면 설정 조회 / Then export.xlsxEnabled가 설정 값 그대로다."""
    client, _, _ = process_env
    for enabled in (True, False):
        set_export_enabled(enabled)
        response = client.get("/api/v1/config/ui")
        assert response.status_code == 200, response.text
        assert response.json()["data"]["export"] == {"xlsxEnabled": enabled}


def test_settings_file_without_the_section_reads_as_off(tmp_path):
    """Given #217 전 설정 파일(export 묶음 없음) / When 읽음 / Then 오류 없이 꺼짐으로 읽는다."""
    lines = DEFAULT_APP_SETTINGS_PATH.read_text(encoding="utf-8").splitlines()
    start = lines.index("export:")
    old_file = tmp_path / "old-app-settings.yaml"
    old_file.write_text("\n".join(lines[:start] + lines[start + 2 :]), encoding="utf-8")
    assert "xlsxEnabled" not in old_file.read_text(encoding="utf-8")
    assert load_app_settings(old_file).export.xlsx_enabled is False


@pytest.mark.parametrize("example_value", [True, False])
def test_old_settings_copy_without_the_section_reads_the_example_value(
    process_env,  # noqa: F811
    tmp_path,
    monkeypatch,
    example_value,
):
    """Given #217 전 DB 사본(export 없음) / When 읽음 / Then 예시 파일 값으로 읽고 창구도 따른다."""
    client, _, _ = process_env
    example = tmp_path / "app-settings.yaml"
    example.write_text(
        DEFAULT_APP_SETTINGS_PATH.read_text(encoding="utf-8").replace(
            "xlsxEnabled: false", f"xlsxEnabled: {str(example_value).lower()}"
        ),
        encoding="utf-8",
    )
    assert load_app_settings(example).export.xlsx_enabled is example_value
    monkeypatch.setattr(app_settings, "DEFAULT_APP_SETTINGS_PATH", example)
    with session_scope() as session:
        session.delete(session.get(AppSetting, "export"))
    with session_scope() as session:
        assert read_app_settings(session).export.xlsx_enabled is example_value
    assert client.get(EXPORT_URL).status_code == (200 if example_value else 422)


def _example_with_switch(tmp_path, value):
    path = tmp_path / "app-settings.yaml"
    path.write_text(
        DEFAULT_APP_SETTINGS_PATH.read_text(encoding="utf-8").replace(
            "xlsxEnabled: false", f"xlsxEnabled: {value}"
        ),
        encoding="utf-8",
    )
    return path


def test_download_log_is_not_ready_yet():
    """Given 지금 코드 / When 준비 여부를 물음 / Then 내려받은 기록은 아직 없다(#217)."""
    assert app_settings.xlsx_download_log_ready() is False


def test_settings_file_that_turns_the_switch_on_is_refused_until_the_log_exists(tmp_path):
    """Given 내려받은 기록 없음 / When 스위치를 켠 설정 파일 검사 / Then 칸·줄·이유와 함께 거부."""
    path = _example_with_switch(tmp_path, "true")
    lines = path.read_text(encoding="utf-8").splitlines()
    result = app_settings.check_app_settings_file(path)
    assert result.settings is None
    assert [(e.path, e.message) for e in result.errors] == [
        ("export.xlsxEnabled", app_settings.XLSX_ENABLE_BLOCKED_MESSAGE)
    ]
    assert lines[result.errors[0].line - 1].strip() == "xlsxEnabled: true"
    with pytest.raises(InputError) as caught:
        load_app_settings(path)
    assert "export.xlsxEnabled" in caught.value.next_action
    assert "기록을 만들기 전에는 켤 수 없으니" in caught.value.next_action


def test_settings_file_with_the_switch_off_passes_while_the_log_is_missing(tmp_path):
    """Given 내려받은 기록 없음 / When 스위치를 끈 설정 파일 검사 / Then 통과한다."""
    result = app_settings.check_app_settings_file(_example_with_switch(tmp_path, "false"))
    assert result.errors == []
    assert result.settings.export.xlsx_enabled is False


def test_settings_file_that_turns_the_switch_on_passes_once_the_log_exists(tmp_path, monkeypatch):
    """Given 내려받은 기록 준비됨 / When 스위치를 켠 설정 파일 검사 / Then 통과한다."""
    mark_download_log_ready(monkeypatch)
    assert load_app_settings(_example_with_switch(tmp_path, "true")).export.xlsx_enabled is True


def test_old_settings_copy_with_the_switch_on_is_refused_until_the_log_exists(
    process_env,  # noqa: F811
    monkeypatch,
):
    """Given DB 사본에 켜짐이 들어 있고 기록 없음 / When 읽음 / Then 거부하고 파일도 안 나간다."""
    client, _, _ = process_env
    assert client.get(EXPORT_URL).status_code == 200
    mark_download_log_ready(monkeypatch, ready=False)
    with session_scope() as session:
        assert session.get(AppSetting, "export").value == {"xlsxEnabled": True}
        with pytest.raises(ValidationError) as caught:
            read_app_settings(session)
    errors = caught.value.errors()
    assert [error["loc"] for error in errors] == [("export", "xlsxEnabled")]
    assert app_settings.XLSX_ENABLE_BLOCKED_MESSAGE in errors[0]["msg"]
    response = client.get(EXPORT_URL)
    assert response.status_code == 500
    assert not response.content.startswith(b"PK")
    set_export_enabled(False)
    with session_scope() as session:
        assert read_app_settings(session).export.xlsx_enabled is False
    assert client.get(EXPORT_URL).status_code == 422


def test_switch_value_must_be_true_or_false(tmp_path):
    """Given 스위치에 글자 "yes" / When 설정 파일 읽음 / Then 받지 않는다."""
    broken = tmp_path / "app-settings.yaml"
    broken.write_text(
        DEFAULT_APP_SETTINGS_PATH.read_text(encoding="utf-8").replace(
            "xlsxEnabled: false", 'xlsxEnabled: "yes"'
        ),
        encoding="utf-8",
    )
    with pytest.raises((InputError, ValueError)):
        load_app_settings(broken)


@pytest.mark.parametrize(
    "item,allowed",
    [
        (ExportItem("a", "OPPORTUNITY_INFO", "PUBLIC"), True),
        (ExportItem("a", "INTERNAL_HISTORY", "INTERNAL_ONLY"), True),
        (ExportItem("a", "CUSTOMER_RELATION", "EXTERNAL_AI_OK"), True),
        (ExportItem("a", "NOTE", "INTERNAL_ONLY"), False),
        (ExportItem("a", None, "PUBLIC"), False),
        (ExportItem("a", "", "PUBLIC"), False),
        (ExportItem("a", "OPPORTUNITY_INFO", "FORBIDDEN"), False),
        (ExportItem("a", "OPPORTUNITY_INFO", "UNKNOWN"), False),
        (ExportItem("a", "OPPORTUNITY_INFO", None), False),
    ],
)
def test_output_export_rules(item, allowed):
    """Given 항목 하나 / When 출력 검사 / Then 약속 C4의 허용 종류·등급만 통과한다."""
    decision = check_output_export([item])
    assert decision.allowed is allowed
    assert [row["refId"] for row in decision.rejected_items] == ([] if allowed else ["a"])


def test_output_export_rejects_all_when_one_item_fails():
    """Given 통과 2건·거부 1건 / When 출력 검사 / Then 전체 거부이고 걸린 항목만 알려 준다."""
    decision = check_output_export(
        [
            ExportItem("ok-1", "OPPORTUNITY_INFO", "PUBLIC"),
            ExportItem("memo", "NOTE", "INTERNAL_ONLY"),
            ExportItem("ok-2", "INTERNAL_HISTORY", "INTERNAL_ONLY"),
        ]
    )
    assert decision.allowed is False
    assert [row["refId"] for row in decision.rejected_items] == ["memo"]
    assert check_output_export([]).allowed is True


def test_openapi_describes_the_contract_path():
    """Given 앱이 만든 명세 / When 엑셀 경로를 봄 / Then 약속의 200·422 설명이 있다."""
    operation = create_app().openapi()["paths"]["/api/v1/export/xlsx"]
    assert list(operation) == ["get"]
    responses = operation["get"]["responses"]
    assert list(responses["200"]["content"]) == [XLSX_MEDIA_TYPE]
    assert responses["422"]["description"] == "kind EXPORT_REJECTED, rejectedItems[]"
