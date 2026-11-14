"""#274 발표 시연용 DB: 예시 파일 검사, 가상 기록 파일 검사, 기록 넣기 명령의 거부 경로, 시연 표시.

가상 자료만 쓴다(거산 실제 사양 아님). 외부 호출 없음.
사용자 흐름은 tests/features/u8/demo_db.feature.
"""

from __future__ import annotations

import json
import sqlite3
from pathlib import Path

import pytest
from typer.testing import CliRunner

from geosan.commands import serve as serve_module
from geosan.commands.app import app
from geosan.commands.seed_demo_records import (
    DEFAULT_DEMO_RECORDS_PATH,
    check_demo_records_file,
)
from geosan.config.app_settings import is_demo_database, load_app_settings
from geosan.config.file_checks import check_case_file
from geosan.config.loader import load_document
from geosan.config.sales_questions import check_sales_questions_file
from geosan.config.validators import scan_contacts
from geosan.storage.engine import dispose_engines
from geosan.storage.session import session_scope
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
    assert len(DEMO_CASES) == 5
    for path in DEMO_FILES:
        document = load_document(path)
        assert scan_contacts(document.data, document=document) == [], path.name


def test_demo_cases_are_virtual_and_named_as_virtual():
    """Given 새 가상 사례 5곳 / When 읽기 / Then 가상 묶음·가상 이름, 사례 검사 통과."""
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
    assert len(set(names)) == 5


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
    """Given 시연용 설정 / When 읽기 / Then 시연 표시·띠 문구, AI·검색·조사 꺼짐."""
    settings = load_app_settings(DEMO_SETTINGS)
    assert settings.brand.demo is True and settings.brand.demo_label == "시연용 · 가상 자료"
    assert settings.active_dataset_kind.value == "VIRTUAL_REVIEWED"
    assert settings.llm.mode == "NONE"
    assert not settings.homepage_discovery.enabled and not settings.homepage_discovery.auto_research
    assert not settings.candidate_web_search.enabled and not settings.ingestion.ai_pick.enabled
    assert not settings.geocoding.enabled and not settings.access_protection.enabled
    # 시연용 설정은 가상 설정과 brand 두 칸만 다르다(한쪽만 고쳐 어긋나는 것을 막는다).
    demo = settings.model_dump()
    virtual = load_app_settings(VIRTUAL_SETTINGS).model_dump()
    demo["brand"].update(demo_label=None, demo=False)
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


def test_example_records_file_matches_cases_and_questions():
    """Given 예시 가상 기록 파일 / When 검사 / Then 가상 사례 6곳과 같고 답 id가 유효."""
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
    assert code == 0 and "넣은 회사 5곳(성사 2·거절 3)" in out and "건너뛴 회사 1곳" in out
    assert outcome_count(demo_db) == 15


def test_seed_goes_through_the_normal_save_path(demo_db):
    """Given 넣은 뒤 / When DB 확인 / Then 관심·답·통화 신호가 화면 저장과 같게 따라왔다."""
    code, out = run("seed-demo-records")
    assert code == 0, out
    connection = sqlite3.connect(str(demo_db))
    try:
        count = lambda sql: connection.execute(sql).fetchone()[0]  # noqa: E731
        assert count("SELECT count(DISTINCT opp_id) FROM rec_bookmark WHERE active = 1") == 6
        assert count("SELECT count(*) FROM rec_outcome_answer") > 40
        assert count("SELECT count(*) FROM rec_outcome WHERE is_virtual = 0") == 0
        assert count("SELECT count(*) FROM rec_outcome WHERE attempted_at IS NULL") == 0
        assert (
            count("SELECT count(*) FROM rec_outcome WHERE status = 'WON' AND reason IS NOT NULL")
            == 0
        )
        lost = connection.execute(
            "SELECT lost_reason_code FROM rec_outcome WHERE status = 'LOST' ORDER BY 1"
        ).fetchall()
        assert [row[0] for row in lost] == ["INCUMBENT_SUPPLIER", "LEAD_TIME", "PRICE"]
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


def test_deploy_setting_with_normal_db_still_starts(tmp_db, monkeypatch):
    """Given 시연 표시 없는 DB / When 배포 주소·비밀번호로 시작 / Then 전처럼 시작된다."""
    started = []
    monkeypatch.setattr(serve_module, "_run_server", lambda port, host: started.append(host))
    monkeypatch.setattr(serve_module, "port_in_use", lambda port, host: False)
    monkeypatch.setenv("GEOSAN_PASSWORD", "virtual-test-value")
    result = CliRunner().invoke(app, ["serve", "--host", "0.0.0.0", "--port", "18775"])
    assert result.exit_code == 0, result.output
    assert started == ["0.0.0.0"]
    assert "시연용 DB" not in result.output
