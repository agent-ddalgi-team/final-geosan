"""#274 발표 시연용 DB: 예시 파일 검사, 가상 기록 파일 검사, 기록 넣기 명령의 거부 경로, 시연 표시.

가상 자료만 쓴다(거산 실제 사양 아님). 외부 호출 없음.
사용자 흐름은 tests/features/u8/demo_db.feature.
"""

from __future__ import annotations

import json
import sqlite3
from pathlib import Path

import pytest
import yaml
from typer.testing import CliRunner

from geosan.commands import serve as serve_module
from geosan.commands.app import app
from geosan.commands.seed_demo_records import (
    DEFAULT_DEMO_RECORDS_PATH,
    check_demo_records_file,
)
from geosan.config.app_settings import (
    check_app_settings_file,
    is_demo_database,
    load_app_settings,
)
from geosan.config.file_checks import check_case_file
from geosan.config.loader import load_document
from geosan.config.sales_questions import check_sales_questions_file
from geosan.config.validators import scan_contacts
from geosan.storage.engine import dispose_engines
from geosan.storage.session import session_scope
from geosan.workflows.flow_evaluate import today_in_seoul
from tests.conftest import EXAMPLES_DIR
from tests.features.u8.test_demo_db_scenarios import (
    CASE_FILES,
    DEMO_SETTINGS,
    VIRTUAL_SETTINGS,
    build_db,
    outcome_count,
    run,
)

DEMO_CASES = sorted((EXAMPLES_DIR / "demo").glob("*.json"))
DEMO_FILES = [DEMO_SETTINGS, DEFAULT_DEMO_RECORDS_PATH, *DEMO_CASES]
# (#826) 일정 없이 마지막 접촉이 오래돼 "멈춘 회사"로 보이게 둔 시연 회사.
STALLED_DEMO_CASES = {"demo-af-machining", "demo-ag-electronics"}


@pytest.fixture
def demo_db(tmp_path, monkeypatch):
    try:
        yield build_db(tmp_path / "demo-test.db", monkeypatch, DEMO_SETTINGS)
    finally:
        dispose_engines()


def _records(tmp_path: Path, edit) -> Path:
    """예시 가상 기록 파일을 고쳐 쓴 임시 파일."""
    data = load_document(DEFAULT_DEMO_RECORDS_PATH).data
    edit(data)
    path = tmp_path / "records.json"
    path.write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")
    return path


# ---------------------------------------------------------------------------
# 예시 파일
# ---------------------------------------------------------------------------


def test_demo_example_files_have_no_contacts():
    """Given 시연용 예시 파일 전부 / When 연락처 검사 / Then 0건."""
    # (바뀜 2026-11-15 #765 — PM 결정) 가상 사례 5곳 → 17곳(A정밀은 examples/ 바로 아래)
    assert len(DEMO_CASES) == 35  # (#826) 17 → 35, 곳 수가 늘어 기대값을 바꿈
    for path in DEMO_FILES:
        document = load_document(path)
        assert scan_contacts(document.data, document=document) == [], path.name


def test_demo_cases_are_virtual_and_named_as_virtual():
    """Given 새 가상 사례 35곳 / When 읽기 / Then 가상 묶음·가상 이름, 사례 검사 통과."""
    names = []
    for path in DEMO_CASES:
        data = json.loads(path.read_text(encoding="utf-8"))
        assert data["isVirtual"] is True and data["datasetKind"] == "VIRTUAL_REVIEWED", path.name
        assert data["customer"]["name"].endswith("(가상)"), path.name
        assert "(가상)" in data["customer"]["address"], path.name
        assert data["customer"]["bizNumber"] is None and "homepageUrl" not in data["customer"]
        assert "expected" not in data
        assert check_case_file(path).errors == [], path.name
        names.append(data["customer"]["name"])
    assert len(set(names)) == 35


def test_demo_cases_have_their_own_card_reason():
    """Given 가상 사례 35곳 / When 카드 추천 이유 / Then 회사마다 다른 문장, 80자 안(#790).

    없으면 카드가 "확인 후 연락 검토: 현재 평가점수 70, 조사 항목 배점 합계 100" 같은
    기계 문장이 된다.
    """
    reasons = []
    for path in DEMO_CASES:
        data = json.loads(path.read_text(encoding="utf-8"))
        reason = data["opportunity"].get("cardReason")
        assert reason and reason.endswith("(가상 홈페이지·소식)"), path.name
        assert len(reason.removesuffix(" (가상 홈페이지·소식)")) <= 80, path.name
        # 그 회사의 품목 이름(공정 앞 부분)이 문장에 들어 있다.
        assert data["opportunity"]["item"].split()[-2] in reason, path.name
        assert check_case_file(path).warnings == [], path.name
        reasons.append(reason)
    assert len(set(reasons)) == 35


def test_demo_files_do_not_mention_real_companies():
    """Given 실제 기업 사례 18곳의 이름 / When 시연용 파일에서 찾기 / Then 0건."""
    real_names = set()
    for path in (EXAMPLES_DIR / "cases").glob("*.json"):
        name = json.loads(path.read_text(encoding="utf-8"))["customer"]["name"]
        core = name.replace("(주)", "").replace("㈜", "").replace("주식회사", "").strip()
        real_names.add(core)
    assert len(real_names) >= 10
    for path in DEMO_FILES:
        text = path.read_text(encoding="utf-8")
        assert [name for name in real_names if name in text] == [], path.name


def test_demo_settings_keep_outside_calls_off_and_mark_demo():
    """Given 시연용 설정 / When 읽기 / Then 시연 표시, 검색 꺼짐, 영업 기록 AI만 켬(#802)."""
    settings = load_app_settings(DEMO_SETTINGS)
    assert settings.brand.demo is True and settings.brand.demo_label == "시연용 · 가상 자료"
    assert settings.active_dataset_kind.value == "VIRTUAL_REVIEWED"
    # #802(PM 결정 2026-11-20): 시연에서 [AI 분석 받기]를 보여 주려고 영업 기록 AI만 켠다.
    assert settings.llm.mode == "EXTERNAL" and settings.llm.sales_records_enabled
    assert not settings.homepage_discovery.enabled and not settings.homepage_discovery.auto_research
    assert not settings.candidate_web_search.enabled and not settings.ingestion.ai_pick.enabled
    assert not settings.geocoding.enabled and not settings.access_protection.enabled
    # 시연용 설정은 가상 설정과 brand 두 칸, 거산 공장 좌표(시연 지도용, #811 PM 결정 2026-11-16),
    # llm(#802)만 다르다(한쪽만 고쳐 어긋나는 것을 막는다).
    demo = settings.model_dump()
    virtual = load_app_settings(VIRTUAL_SETTINGS).model_dump()
    assert virtual["geosan"]["lat"] is None and virtual["geosan"]["lng"] is None
    assert (demo["geosan"]["lat"], demo["geosan"]["lng"]) == (36.87, 127.19)
    demo["brand"].update(demo_label=None, demo=False)
    demo["geosan"].update(lat=None, lng=None)
    demo["llm"] = virtual["llm"]
    assert demo == virtual


@pytest.mark.parametrize("name", ["app-settings.yaml", "app-settings-virtual.yaml"])
def test_other_settings_are_not_demo(name):
    """Given 실제·가상 설정 / When 읽기 / Then 시연 표시가 없다(기본 false)."""
    assert load_app_settings(EXAMPLES_DIR / name).brand.demo is False


def test_demo_mark_must_be_boolean(tmp_path):
    """Given brand.demo에 글자 / When 설정 검사 / Then 그 칸의 오류."""
    text = DEMO_SETTINGS.read_text(encoding="utf-8").replace("demo: true", 'demo: "yes"')
    path = tmp_path / "bad.yaml"
    path.write_text(text, encoding="utf-8")
    code, out = run("check-config", EXAMPLES_DIR / "rule-config.yaml", path)
    assert code == 1 and "brand.demo" in out


def test_schema_file_lists_demo_mark():
    schema = json.loads(
        (EXAMPLES_DIR.parent / "contracts/app-settings.schema.json").read_text("utf-8")
    )
    brand = schema["properties"]["brand"]
    assert brand["properties"]["demo"]["type"] == "boolean"
    assert "demo" not in brand["required"]


# ---------------------------------------------------------------------------
# 가상 기록 파일
# ---------------------------------------------------------------------------


def test_example_records_file_gives_in_progress_companies_a_next_schedule():
    """Given 예시 가상 기록 파일 / When 다음 일정 / Then 일정이 있는 진행 중 10곳의
    마지막 접촉에만(#790, #826).

    대시보드 달력·"오늘 확인할 것"이 시연에서 비지 않게 한다. 끝난 회사(성사·거절·보류)에는 없다.
    """
    records = check_demo_records_file(DEFAULT_DEMO_RECORDS_PATH).records
    assert records is not None
    scheduled = {}
    for company in records.companies:
        closing = any(
            answer.question_id == "CLOSE_RESULT"
            for contact in company.contacts
            for answer in contact.answers
        )
        *earlier, last = company.contacts
        assert all(contact.next_in_days is None for contact in earlier), company.case_id
        if closing:
            assert last.next_in_days is None, company.case_id
        else:
            # (#826) 일정 없이 오래 멈춘 회사 2곳(멈춘 회사 시연용)은 다음 일정이 없다.
            if company.case_id in STALLED_DEMO_CASES:
                assert last.next_in_days is None, company.case_id
                continue
            assert last.next_in_days is not None and last.next_note, company.case_id
            # (바뀜 2026-11-17 #826) 회사 이름에 이미 "(가상)"이 있어
            # 다음 일정 글에는 붙이지 않는다.
            assert "(가상)" not in last.next_note, company.case_id
            scheduled[company.case_id] = last.next_in_days
    assert len(scheduled) == 10
    assert sorted(scheduled.values()) == [0, 0, 1, 2, 3, 4, 6, 7, 10, 12]


def test_example_records_file_matches_cases_and_questions():
    """Given 예시 가상 기록 파일 / When 검사
    / Then 가상 사례 36곳과 같고 답 id가 유효(#765·#826)."""
    check = check_demo_records_file(DEFAULT_DEMO_RECORDS_PATH)
    assert check.errors == [] and check.records is not None
    case_ids = {json.loads(path.read_text("utf-8"))["caseId"] for path in CASE_FILES}
    assert {company.case_id for company in check.records.companies} == case_ids
    questions = check_sales_questions_file(EXAMPLES_DIR / "sales-questions.yaml").questions
    memo_max = load_app_settings(DEMO_SETTINGS).records.memo_line_max_length
    for company in check.records.companies:
        assert 2 <= len(company.contacts) <= 3
        # 접촉은 옛날 → 최근 순서이고 모두 최근 12개월 안이다.
        days = [contact.days_ago for contact in company.contacts]
        assert days == sorted(days, reverse=True) and max(days) < 365
        for contact in company.contacts:
            assert contact.memo and contact.memo.startswith("(가상)")
            assert len(contact.memo) <= memo_max
            for answer in contact.answers:
                question = questions.question(answer.question_id)
                assert question and question.option(answer.answer_id), answer


@pytest.mark.parametrize(
    ("edit", "expected"),
    [
        (lambda d: d["companies"][0].update(phone="x"), "phone"),
        (lambda d: d["companies"][0]["contacts"][0].update(daysAgo=-1), "daysAgo"),
        (lambda d: d["companies"][0]["contacts"][0].update(method="FAX"), "method"),
        (lambda d: d["companies"].append(d["companies"][0]), "두 번"),
        (lambda d: d["companies"][0]["contacts"][0].update(memo="문의 010-1234-5678"), "연락처"),
        (lambda d: d.update(companies=[]), "companies"),
        (lambda d: d["companies"][0]["contacts"][0].update(nextInDays=-1), "nextInDays"),
        (lambda d: d["companies"][0]["contacts"][0].update(nextInDays="3"), "nextInDays"),
        (lambda d: d["companies"][0]["contacts"][0].update(nextNote="(가상) 확인"), "nextNote"),
        # (#811) 가상 위치: 숫자만, 범위 안, 위도·경도 둘 다, 모르는 키 거부
        (lambda d: d["companies"][0].update(location={"lat": "36.8", "lng": 127.1}), "lat"),
        (lambda d: d["companies"][0].update(location={"lat": 91, "lng": 127.1}), "lat"),
        (lambda d: d["companies"][0].update(location={"lat": 36.8, "lng": 181}), "lng"),
        (lambda d: d["companies"][0].update(location={"lat": 36.8}), "lng"),
        (lambda d: d["companies"][0].update(location={"lat": True, "lng": 127.1}), "lat"),
        (
            lambda d: d["companies"][0].update(location={"lat": 36.8, "lng": 127.1, "x": 1}),
            "x",
        ),
    ],
)
def test_records_file_errors(tmp_path, edit, expected):
    """Given 틀린 가상 기록 파일 / When 검사 / Then 그 칸의 오류가 나오고 내용은 버린다."""
    check = check_demo_records_file(_records(tmp_path, edit))
    assert check.records is None
    assert any(expected in f"{error.path} {error.message}" for error in check.errors), check.errors


# ---------------------------------------------------------------------------
# 기록 넣기 명령의 거부 경로
# ---------------------------------------------------------------------------


def test_seed_refuses_bad_file_before_touching_db(demo_db, tmp_path):
    """Given 연락처가 든 파일 / When 넣기 / Then 종료 코드 1, 기록 0건."""
    path = _records(
        tmp_path, lambda d: d["companies"][0]["contacts"][0].update(memo="a@example.com")
    )
    code, out = run("seed-demo-records", path)
    assert code == 1 and "연락처" in out and "아무것도 넣지 않았습니다" in out
    assert outcome_count(demo_db) == 0


def test_schedule_note_with_virtual_mark_is_refused(tmp_path):
    """Given 다음 일정 글에 "(가상)" / When 파일 검사 / Then 거부(#826).

    회사 이름에 이미 "(가상)"이 있어, 글에도 붙이면 대시보드 "오늘 일정"에
    "G정공(가상) (가상) 소개서…"처럼 두 번 보였다.
    """

    def edit(data):
        contact = data["companies"][6]["contacts"][-1]
        assert contact.get("nextNote"), contact  # G정공(가상)의 다음 일정
        contact["nextNote"] = "(가상) 소개서 받아 보셨는지 확인 전화"

    check = check_demo_records_file(_records(tmp_path, edit))
    assert check.records is None
    assert any("(가상)을 붙이지 않습니다" in error.message for error in check.errors)


def test_seed_refuses_when_database_is_missing(tmp_path, monkeypatch):
    monkeypatch.setenv("GEOSAN_DB_PATH", str(tmp_path / "none.db"))
    code, out = run("seed-demo-records")
    assert code == 1 and "데이터베이스 파일이 없습니다" in out
    assert not (tmp_path / "none.db").exists()


def test_seed_refuses_unknown_case_and_inserts_nothing(demo_db, tmp_path):
    """Given DB에 없는 회사가 섞인 파일 / When 넣기 / Then 다른 회사도 넣지 않는다."""
    path = _records(tmp_path, lambda d: d["companies"][5].update(caseId="demo-unknown"))
    code, out = run("seed-demo-records", path)
    assert code == 1 and "'demo-unknown' 사례가 DB에 없습니다" in out
    assert outcome_count(demo_db) == 0


def test_seed_refuses_non_virtual_company(demo_db):
    """Given 시연 DB 안에 가상이 아닌 회사 / When 넣기 / Then 거부, 기록 0건."""
    connection = sqlite3.connect(str(demo_db))
    try:
        connection.execute(
            "UPDATE opp_opportunity SET is_virtual = 0 WHERE case_id = 'demo-b-metal'"
        )
        connection.commit()
    finally:
        connection.close()
    code, out = run("seed-demo-records")
    assert code == 1 and "가상 사례가 아니어서" in out
    assert outcome_count(demo_db) == 0


@pytest.mark.parametrize("staff", ["viewer", "nobody"])
def test_seed_refuses_non_recording_staff(demo_db, tmp_path, staff):
    code, out = run("seed-demo-records", _records(tmp_path, lambda d: d.update(staffKey=staff)))
    assert code == 1 and "기록 담당자가 아닙니다" in out
    assert outcome_count(demo_db) == 0


def test_seed_rolls_back_company_with_wrong_answer(demo_db, tmp_path):
    """Given 둘째 회사에 없는 보기 / When 넣기 / Then 그 회사만 취소, 다시 넣으면 이어진다."""

    def edit(data):
        data["companies"][1]["contacts"][-1]["answers"][0]["answerId"] = "NO_SUCH"

    code, out = run("seed-demo-records", _records(tmp_path, edit))
    assert code == 1 and "demo-b-metal" in out and "앞 회사 1곳은 저장됨" in out
    assert outcome_count(demo_db) == 3  # A정밀 3건만. B금속의 앞 접촉 2건은 남지 않는다.
    code, out = run("seed-demo-records")
    # (바뀜 2026-11-17 #826 — PM 결정: 18곳 → 36곳) A정밀을 건너뛰고 35곳: 성사 8·거절 11.
    assert code == 0 and "넣은 회사 35곳(성사 8·거절 11)" in out and "건너뛴 회사 1곳" in out
    assert outcome_count(demo_db) == 83


def test_seed_goes_through_the_normal_save_path(demo_db):
    """Given 넣은 뒤 / When DB 확인 / Then 관심·답·통화 신호가 화면 저장과 같게 따라왔다."""
    code, out = run("seed-demo-records")
    assert code == 0, out
    connection = sqlite3.connect(str(demo_db))
    try:
        count = lambda sql: connection.execute(sql).fetchone()[0]  # noqa: E731
        # (#765, #826) 접촉을 남긴 36곳 모두 관심으로 켜진다.
        assert count("SELECT count(DISTINCT opp_id) FROM rec_bookmark WHERE active = 1") == 36
        assert count("SELECT count(*) FROM rec_outcome_answer") > 40
        assert count("SELECT count(*) FROM rec_outcome WHERE is_virtual = 0") == 0
        assert count("SELECT count(*) FROM rec_outcome WHERE attempted_at IS NULL") == 0
        assert (
            count("SELECT count(*) FROM rec_outcome WHERE status = 'WON' AND reason IS NOT NULL")
            == 0
        )
        # (#790, #826) 일정이 있는 진행 중 10곳은 마지막 접촉에 다음 일정이 들어가
        # 대시보드 달력에 보인다. 오늘은 2곳.
        today = today_in_seoul()
        upcoming = connection.execute(
            "SELECT o.next_schedule_at, o.next_schedule_note FROM rec_outcome o "
            "WHERE o.next_schedule_at IS NOT NULL AND o.version = ("
            " SELECT max(version) FROM rec_outcome WHERE opp_id = o.opp_id)"
        ).fetchall()
        assert len(upcoming) == 10
        assert sum(1 for day, _ in upcoming if day == today.isoformat()) == 2
        # (바뀜 2026-11-17 #826) 회사 이름에 이미 "(가상)"이 있어 일정 글에는 붙이지 않는다.
        assert all("(가상)" not in note for _, note in upcoming)
        lost = connection.execute(
            "SELECT lost_reason_code FROM rec_outcome WHERE status = 'LOST' ORDER BY 1"
        ).fetchall()
        # (바뀜 2026-11-17 #826 — 18곳 → 36곳) 거절 11곳.
        assert [row[0] for row in lost] == [
            "INCUMBENT_SUPPLIER",
            "INCUMBENT_SUPPLIER",
            "LEAD_TIME",
            "LEAD_TIME",
            "LEAD_TIME",
            "NO_DEMAND",
            *["PRICE"] * 5,
        ]
    finally:
        connection.close()


# ---------------------------------------------------------------------------
# 시연 표시와 서버 시작
# ---------------------------------------------------------------------------


def test_demo_mark_is_read_from_the_settings_copy(tmp_db, bare_db):
    """Given 가상 설정 사본 / When 시연 표시 확인 / Then 없음. 사본이 비어도 없음."""
    with session_scope(tmp_db) as session:
        assert is_demo_database(session) is False
        session.execute(__import__("sqlalchemy").text("DELETE FROM cfg_app_setting"))
        assert is_demo_database(session) is False


def test_demo_settings_can_be_registered_again(demo_db):
    """Given 시연 DB / When 시연용 설정을 다시 등록 / Then 통과(시연 표시 유지)."""
    code, out = run("check-config", EXAMPLES_DIR / "rule-config.yaml", DEMO_SETTINGS)
    assert code == 0, out
    with session_scope(demo_db) as session:
        assert is_demo_database(session)


def test_deploy_setting_with_normal_db_still_starts(tmp_db, tmp_path, monkeypatch):
    """Given 시연 표시 없는 DB(보호 켬, #736) / When 배포 주소·비밀번호로 시작 / Then 시작된다."""
    # #736: 배포 주소는 접속 보호가 켜진 설정이어야 시작한다. 가상 설정에서 보호만 켜 등록한다.
    protected = tmp_path / "app-settings-protected.yaml"
    protected.write_text(
        VIRTUAL_SETTINGS.read_text(encoding="utf-8").replace(
            "accessProtection:\n  enabled: false", "accessProtection:\n  enabled: true"
        ),
        encoding="utf-8",
    )
    code, out = run("check-config", EXAMPLES_DIR / "rule-config.yaml", protected)
    assert code == 0, out
    started = []
    monkeypatch.setattr(serve_module, "_run_server", lambda port, host: started.append(host))
    monkeypatch.setattr(serve_module, "port_in_use", lambda port, host: False)
    monkeypatch.setenv("GEOSAN_PASSWORD", "virtual-test-value")
    result = CliRunner().invoke(app, ["serve", "--host", "0.0.0.0", "--port", "18775"])
    assert result.exit_code == 0, result.output
    assert started == ["0.0.0.0"]
    assert "시연용 DB" not in result.output


# ---------- #719 품질 검토: 내 PC 주소가 아니면 배포로 본다 ----------


@pytest.mark.parametrize("host", ["0.0.0.0", "::", "192.168.0.10", "10.0.0.5", "example.org", ""])
def test_any_host_that_is_not_this_pc_counts_as_deploy(monkeypatch, host):
    """Given 비밀번호 없는 환경 / When 내 PC 주소가 아닌 주소로 들음 / Then 배포 설정으로 본다."""
    monkeypatch.delenv("GEOSAN_PASSWORD", raising=False)
    assert serve_module._is_deploy_setting(host)


@pytest.mark.parametrize("host", ["127.0.0.1", "localhost", "::1"])
def test_this_pc_addresses_are_not_deploy_without_a_password(monkeypatch, host):
    monkeypatch.delenv("GEOSAN_PASSWORD", raising=False)
    assert not serve_module._is_deploy_setting(host)
    monkeypatch.setenv("GEOSAN_PASSWORD", "virtual-test-value")
    assert serve_module._is_deploy_setting(host)


@pytest.mark.parametrize("host", ["::", "192.168.0.10", "localhost", "::1"])
def test_serve_still_accepts_only_the_two_listed_hosts(tmp_db, monkeypatch, host):
    """듣는 주소는 약속대로 127.0.0.1·0.0.0.0만 받는다. 다른 주소는 시작 전에 종료 코드 1."""
    started = []
    monkeypatch.setattr(serve_module, "_run_server", lambda port, host: started.append(host))
    monkeypatch.setattr(serve_module, "port_in_use", lambda port, host: False)
    result = CliRunner().invoke(app, ["serve", "--host", host, "--port", "18775"])
    assert result.exit_code == 1, result.output
    assert "127.0.0.1 또는 0.0.0.0" in result.output and started == []


# ---------- #720: 시연용 설정에서는 웹 검색·홈페이지 검색을 켤 수 없다 ----------
# #802(PM 결정 2026-11-20): 영업 기록 AI(llm.mode·salesRecordsEnabled)는 시연에서 보여 줄 수
# 있게 허용한다.

MESSAGE = "시연용 설정에서는 웹 검색·홈페이지 검색을 켤 수 없습니다"


def _demo_settings_with(tmp_path, edit):
    data = yaml.safe_load(DEMO_SETTINGS.read_text(encoding="utf-8"))
    edit(data)
    path = tmp_path / "demo-edited.yaml"
    path.write_text(yaml.safe_dump(data, allow_unicode=True, sort_keys=False), encoding="utf-8")
    return path


@pytest.mark.parametrize(
    ("edit", "expected"),
    [
        (lambda data: data["homepageDiscovery"].update(enabled=True), "homepageDiscovery.enabled"),
        (
            lambda data: data["homepageDiscovery"].update(autoResearch=True),
            "homepageDiscovery.autoResearch",
        ),
        (
            lambda data: data["candidateWebSearch"].update(enabled=True),
            "candidateWebSearch.enabled",
        ),
    ],
)
def test_demo_settings_cannot_turn_on_web_search(tmp_path, edit, expected):
    """Given 시연 표시가 있는 설정 / When 웹 검색·홈페이지 검색을 켬 / Then check-config가 거부."""
    path = _demo_settings_with(tmp_path, edit)
    check = check_app_settings_file(path)
    assert not check.ok
    assert [(error.path, error.message) for error in check.errors] == [(expected, MESSAGE)]
    code, out = run("check-config", EXAMPLES_DIR / "rule-config.yaml", path)
    assert code == 1 and MESSAGE in out


def test_demo_settings_may_turn_on_sales_record_ai():
    """#802: 시연 설정은 영업 기록 AI를 켠 채로 통과한다(단추를 누를 때만 부르고 기록은 가상)."""
    check = check_app_settings_file(DEMO_SETTINGS)
    assert check.ok
    assert check.settings.llm.mode == "EXTERNAL" and check.settings.llm.sales_records_enabled
    assert not check.settings.homepage_discovery.enabled
    assert not check.settings.candidate_web_search.enabled


def test_same_switches_are_fine_without_the_demo_mark(tmp_path):
    """Given 시연 표시가 없는 설정 / When 같은 스위치를 켬 / Then 이 검사에는 걸리지 않는다."""

    def edit(data):
        data["brand"].update(demo=False, demoLabel=None)
        data["llm"].update(salesRecordsEnabled=True)
        data["candidateWebSearch"].update(enabled=True)

    assert check_app_settings_file(_demo_settings_with(tmp_path, edit)).ok


def test_shipped_demo_settings_pass_the_check():
    assert check_app_settings_file(DEMO_SETTINGS).ok
