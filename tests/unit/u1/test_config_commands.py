"""PM 세션 소유 명령(check-case·check-config·init-db·db merge-heads)·실행 설정 단위 테스트.

단위 테스트 지침 3장 표에는 없지만 같은 Standard 전략(부품당 5~8개)으로 PM 세션 소유 명령을 덮는다.
명령은 Typer 앱을 같은 프로세스에서 돌린다(CliRunner). 모든 데이터는 가상이다.
"""

from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any

import pytest
from typer.testing import CliRunner

from geosan.commands.app import app
from geosan.config.errors import InputError
from geosan.config.file_checks import check_capability_file, check_case_file
from geosan.config.registry import (
    DEFAULT_APP_SETTINGS_PATH,
    DEFAULT_RULE_CONFIG_PATH,
    load_runtime_config,
    register_config_files,
    set_active_dataset_kind,
)
from geosan.config.rule_config import load_rule_config, register_rule_config_version
from geosan.storage.session import session_scope
from tests import factories

EXAMPLES = Path(__file__).resolve().parents[3] / "examples"


def _run(*args: str) -> tuple[int, str]:
    result = CliRunner().invoke(app, list(args), catch_exceptions=False)
    return result.exit_code, result.output


def _write(tmp_path: Path, name: str, data: Any) -> Path:
    path = tmp_path / name
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    return path


# ---------------------------------------------------------------------------
# check-case
# ---------------------------------------------------------------------------


def test_check_case_passes_for_apjeong_with_and_without_capability() -> None:
    code, output = _run("check-case", str(EXAMPLES / "case-apjeong.json"))
    assert code == 0, output
    assert "검사 통과" in output and "역량 파일 없이 검사함" in output
    code, output = _run(
        "check-case",
        str(EXAMPLES / "case-apjeong.json"),
        "--capability",
        str(EXAMPLES / "capability-geosan.json"),
    )
    assert code == 0, output
    assert "묶음 VIRTUAL_REVIEWED" in output and "저장하지 않았습니다" in output


def test_check_case_lists_every_blank_in_template_and_exits_1() -> None:
    code, output = _run("check-case", str(EXAMPLES / "case-template.json"))
    assert code == 1
    assert "오류 7건" in output
    assert "3번째 줄 caseId: 비워 둘 수 없습니다" in output
    assert "중 하나여야 하는데 ''이 적혀 있습니다" in output


def test_check_case_rejects_contact_and_bad_paths(tmp_path: Path) -> None:
    data = factories.apjeong_case()
    data["evidence"][0]["quote"] = "문의 010-1234-5678 (가상)"
    path = _write(tmp_path, "contact.json", data)
    code, output = _run("check-case", str(path))
    assert code == 1 and "연락처는 저장하지 않습니다" in output

    code, output = _run("check-case", str(tmp_path / "없는파일.json"))
    assert code == 1 and "찾을 수 없습니다" in output

    code, output = _run("check-case", str(tmp_path / ".." / tmp_path.name / "contact.json"))
    assert code == 1 and "'..'" in output

    link = tmp_path / "link.json"
    link.symlink_to(path)
    code, output = _run("check-case", str(link))
    assert code == 1 and "심볼릭 링크" in output

    code, output = _run("check-case", str(tmp_path))
    assert code == 1 and "폴더가 아니라" in output


def test_check_case_reports_semantic_errors_after_shape_is_valid(tmp_path: Path) -> None:
    data = factories.apjeong_case()
    data["itemInputs"][2]["matchRate"] = 0.8
    data["itemInputs"][6]["matchRate"] = "간접 관련"
    data["itemInputs"][0]["signalRefs"] = [0]
    data["itemInputs"][4]["signalRefs"] = [0]
    data["requirements"][0]["linkProcessCode"] = None
    data["requirements"][1]["linkProcessCode"] = "ANODIZING"
    data["expected"]["requirementResults"]["없는 요구"] = "PASS"
    data["signals"][0]["deadlineAt"] = None
    path = _write(tmp_path, "semantic.json", data)
    report = check_case_file(path, EXAMPLES / "capability-geosan.json")
    by_path = {e.path: e.message for e in report.errors}
    assert "0.8" in by_path["itemInputs[2].matchRate"]
    assert "relation DIRECT" in by_path["itemInputs[6].matchRate"]
    assert "시점 항목이 아니라" in by_path["itemInputs[0].signalRefs"]
    assert "EXPANSION 신호를 써야" in by_path["itemInputs[4].signalRefs"]
    assert "linkProcessCode를 꼭" in by_path["requirements[0].linkProcessCode"]
    assert "null이어야" in by_path["requirements[1].linkProcessCode"]
    assert "없는 요구 이름" in by_path["expected.requirementResults.없는 요구"]
    assert any("마감일을 적어" in w for w in report.warnings)
    code, output = _run("check-case", str(path))
    assert code == 1 and "검사 실패" in output


def test_check_case_warns_about_unknown_capability_refs_and_rejects_bad_refs(
    tmp_path: Path,
) -> None:
    data = factories.apjeong_case()
    data["processLinks"][0]["processCode"] = "CHROME_PLATING"
    data["requirements"][0]["linkProcessCode"] = "CHROME_PLATING"
    data["itemInputs"][1]["usedCapabilityRefs"][1]["name"] = "없는 역량"
    data["itemInputs"][2]["usedCapabilityRefs"][0]["industry"] = "없는 산업"
    data["itemInputs"][2]["usedCapabilityRefs"].append(
        {"kind": "CAPABILITY", "processCode": "ANODIZING"}
    )
    data["itemInputs"][3]["usedCapabilityRefs"].append(
        {"kind": "DELIVERY_RECORD", "processCode": "ANODIZING"}
    )
    data["itemInputs"][5]["itemCode"] = "SIG_BID"
    data["readinessCheck"]["checkedAt"] = "2026-10-19T09:00:00"
    path = _write(tmp_path, "refs.json", data)
    report = check_case_file(path, EXAMPLES / "capability-geosan.json")
    messages = " / ".join(e.message for e in report.errors)
    assert "시간대" in messages
    report_warn = check_case_file(
        _write(tmp_path, "refs2.json", _fix_checked_at(data)), EXAMPLES / "capability-geosan.json"
    )
    by_path = {e.path: e.message for e in report_warn.errors}
    assert "이름(name)을 꼭" in by_path["itemInputs[2].usedCapabilityRefs[1].name"]
    assert "산업(industry)을 꼭" in by_path["itemInputs[3].usedCapabilityRefs[1].industry"]
    assert "항목당 한 줄" in by_path["itemInputs[6].itemCode"]
    warnings = " / ".join(report_warn.warnings)
    assert "없는 역량" in warnings and "없는 산업" in warnings


def _fix_checked_at(data: dict[str, Any]) -> dict[str, Any]:
    data["readinessCheck"]["checkedAt"] = "2026-10-19T09:00:00+09:00"
    return data


def test_capability_file_semantic_errors(tmp_path: Path) -> None:
    data = factories.capability_file()
    data["processes"].append(dict(data["processes"][0]))
    iso = factories.find_qualification(data, "ISO 9001")
    iso["scopes"].append(
        {
            "scopeKind": "PROCESS",
            "processCode": None,
            "customerRef": None,
            "applicability": "APPLIES",
            "basis": None,
            "reviewStatus": "REVIEWED",
        }
    )
    iso["scopes"].append(
        {
            "scopeKind": "CUSTOMER",
            "processCode": "ANODIZING",
            "customerRef": "cust",
            "applicability": "APPLIES",
            "basis": None,
            "reviewStatus": "REVIEWED",
        }
    )
    iso["scopes"].append(
        {
            "scopeKind": "OPPORTUNITY",
            "processCode": None,
            "customerRef": None,
            "applicability": "APPLIES",
            "basis": None,
            "reviewStatus": "REVIEWED",
        }
    )
    iso["scopes"].append(
        {
            "scopeKind": "CUSTOMER",
            "processCode": None,
            "customerRef": None,
            "applicability": "APPLIES",
            "basis": None,
            "reviewStatus": "REVIEWED",
        }
    )
    iso["validTo"] = "2020-01-01"
    data["qualifications"].append(dict(data["qualifications"][1]))
    report = check_capability_file(_write(tmp_path, "cap.json", data))
    messages = " / ".join(f"{e.path}: {e.message}" for e in report.errors)
    assert "공정 코드 'ZINC_PLATING'가 1번째 공정에도" in messages
    assert "processCode를 꼭 적어야" in messages
    assert "scopeKind가 CUSTOMER면 processCode는 null" in messages
    assert "기회 범위(OPPORTUNITY) 자격을 받지 않습니다" in messages  # PM 결정 2026-10-22, #38
    assert "customerRef(고객 상호명)를 꼭 적어야" in messages
    assert "validTo" in messages and "앞입니다" in messages
    assert "같은 자격" in messages


def test_capability_file_rejects_same_date_status_history(tmp_path: Path) -> None:
    """Given 한 자격에 날짜가 같은 이력 둘 / When 검사 / Then 줄·항목·이유로 거부한다(#57)."""
    data = factories.capability_with_status("ISO 9001", "SUSPENDED", "2026-10-19")
    for history in factories.find_qualification(data, "ISO 9001")["statuses"]:
        history.update(occurredAt="2026-10-19", confirmedAt="2026-10-19")
    report = check_capability_file(_write(tmp_path, "cap.json", data))
    assert not report.ok and report.capability is None
    [error] = report.errors
    assert error.path == "qualifications[0].statuses[1].occurredAt"
    assert error.line is not None and error.line > 0
    assert "1번째 상태 이력과 같습니다" in error.message and "#57" in error.message


def test_capability_file_rejects_same_blank_date_status_history(tmp_path: Path) -> None:
    """Given 날짜가 둘 다 비어 있는 이력 둘 / When 검사 / Then 같은 쌍이므로 거부한다(PM 결정)."""
    data = factories.capability_with_status("ISO 9001", "SUSPENDED", "2026-10-19")
    for history in factories.find_qualification(data, "ISO 9001")["statuses"]:
        history.update(occurredAt=None, confirmedAt=None)
    report = check_capability_file(_write(tmp_path, "cap.json", data))
    assert not report.ok
    assert any("비어 있음" in e.message for e in report.errors)


def test_capability_file_allows_same_dates_in_different_qualifications(tmp_path: Path) -> None:
    """Given 자격마다 이력 하나, 날짜만 같음 / When 검사 / Then 자격 간 중복은 허용한다(#57)."""
    data = factories.capability_file()
    for qual in data["qualifications"]:
        for history in qual["statuses"]:
            history.update(occurredAt="2026-10-19", confirmedAt="2026-10-19")
    report = check_capability_file(_write(tmp_path, "cap.json", data))
    assert report.ok, report.error_lines()


# ---------------------------------------------------------------------------
# check-config · init-db · db merge-heads
# ---------------------------------------------------------------------------


def test_check_config_without_db_only_checks(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("GEOSAN_DB_PATH", str(tmp_path / "none.db"))
    code, output = _run("check-config")
    assert code == 0, output
    assert "version v0.17-d" in output and "DB 없음" in output


def test_check_config_registers_version_and_settings_with_db(tmp_db: Path) -> None:
    code, output = _run(
        "check-config", str(DEFAULT_RULE_CONFIG_PATH), str(DEFAULT_APP_SETTINGS_PATH)
    )
    assert code == 0, output
    assert "규칙 버전 v0.17-d (DRAFT) 등록" in output
    with session_scope(tmp_db) as session:
        runtime = load_runtime_config(session)
        assert runtime.rule_version.rule_version == "v0.17-d"
        assert runtime.app_settings.active_dataset_kind == "BROCHURE"  # 예시 기본값(시연용, #91)
        assert runtime.notices == []
    code, output = _run("check-config")
    assert code == 0 and "바꾸지 않았습니다" in output


def test_check_config_rejects_secret_key_and_bad_rule_config(tmp_path: Path) -> None:
    app_yaml = tmp_path / "app.yaml"
    app_yaml.write_text(
        DEFAULT_APP_SETTINGS_PATH.read_text(encoding="utf-8") + "\npassword: nope-nope-nope\n",
        encoding="utf-8",
    )
    code, output = _run("check-config", str(DEFAULT_RULE_CONFIG_PATH), str(app_yaml))
    assert code == 1 and "비밀 값 키" in output and "password" in output

    rule_yaml = tmp_path / "rule.yaml"
    rule_yaml.write_text(
        DEFAULT_RULE_CONFIG_PATH.read_text(encoding="utf-8").replace(
            'hypothesisNote: "기업 승인 전 가설"', 'hypothesisNote: "확정"'
        ),
        encoding="utf-8",
    )
    code, output = _run("check-config", str(rule_yaml), str(DEFAULT_APP_SETTINGS_PATH))
    assert code == 1 and "hypothesisNote" in output

    code, output = _run("check-config", str(tmp_path / "없음.yaml"))
    assert code == 1 and "찾을 수 없습니다" in output


def test_init_db_and_merge_heads_commands(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("GEOSAN_DB_PATH", str(tmp_path / "cli.db"))
    code, output = _run("init-db")
    assert code == 0 and "준비 완료" in output and "rec_008" in output
    code, output = _run("init-db")
    assert code == 0 and "이미 최신" in output
    code, output = _run("db", "merge-heads")
    assert code == 0 and "하나(rec_008)" in output
    assert os.path.exists(tmp_path / "cli.db")


# ---------------------------------------------------------------------------
# registry (실행 설정)
# ---------------------------------------------------------------------------


def test_registry_first_run_registers_defaults_and_dataset_switch(bare_db: Path) -> None:
    with session_scope(bare_db) as session:
        runtime = load_runtime_config(session)
        assert runtime.rule_version.status == "DRAFT"
        assert len(runtime.notices) == 2
        assert runtime.app_settings.is_recording_staff("park-lee")
        assert not runtime.app_settings.is_recording_staff("viewer")
        assert not runtime.app_settings.is_recording_staff("nobody")
        set_active_dataset_kind(session, "BROCHURE", updated_by="test")
    with session_scope(bare_db) as session:
        assert load_runtime_config(session).app_settings.active_dataset_kind == "BROCHURE"
        with pytest.raises(InputError):
            set_active_dataset_kind(session, "NOPE")


def test_registry_refuses_changed_fixed_version_and_updates_draft_hash(
    tmp_db: Path, tmp_path: Path
) -> None:
    rule_copy = tmp_path / "rule-config.yaml"
    # Windows의 줄바꿈 변환으로 같은 내용의 파일 해시가 달라지지 않게 복사한다(#118).
    rule_copy.write_bytes(DEFAULT_RULE_CONFIG_PATH.read_bytes())
    with session_scope(tmp_db) as session:
        runtime = register_config_files(session, rule_copy, DEFAULT_APP_SETTINGS_PATH)
        assert runtime.rule_config_path == rule_copy.resolve()
    # 같은 내용(해시)을 다른 version으로 등록하려 하면 거부한다
    with session_scope(tmp_db) as session:
        config = load_rule_config(DEFAULT_RULE_CONFIG_PATH)
        config.version = "v0.17-e"  # 파일 버전(v0.17-d)과 다른 값
        with pytest.raises(InputError, match="같은 내용"):
            register_rule_config_version(session, config, DEFAULT_RULE_CONFIG_PATH)
    # DRAFT 상태에서 내용이 바뀌면 해시를 갱신한다
    rule_copy.write_text(
        rule_copy.read_text(encoding="utf-8").replace("maxHoursDefault: 2", "maxHoursDefault: 3"),
        encoding="utf-8",
    )
    with session_scope(tmp_db) as session:
        runtime = load_runtime_config(session)
        assert any("해시를 파일 내용으로 갱신" in n for n in runtime.notices)
        runtime.rule_version.status = "FIXED"
    # FIXED 상태에서 내용이 또 바뀌면 거부한다(BR7.6)
    rule_copy.write_text(
        rule_copy.read_text(encoding="utf-8").replace("maxHoursDefault: 3", "maxHoursDefault: 4"),
        encoding="utf-8",
    )
    with session_scope(tmp_db) as session:
        with pytest.raises(InputError, match="고정 버전"):
            load_runtime_config(session)
    # 등록된 파일이 사라지면 안내한다
    rule_copy.unlink()
    with session_scope(tmp_db) as session:
        with pytest.raises(InputError, match="없습니다"):
            load_runtime_config(session)


def test_set_active_dataset_kind_on_empty_db_keeps_settings_readable(bare_db: Path) -> None:
    """앱 설정 사본이 없는 DB에서 활성 묶음부터 바꿔도 실행 설정을 읽을 수 있다(이슈 #44 재현)."""
    with session_scope(bare_db) as session:
        assert set_active_dataset_kind(session, "BROCHURE", updated_by="test") == "BROCHURE"
    with session_scope(bare_db) as session:
        runtime = load_runtime_config(session)
        assert runtime.app_settings.active_dataset_kind == "BROCHURE"
        assert runtime.app_settings.is_recording_staff("park-lee")  # 나머지는 예시 파일 값
        assert not any("앱 설정 사본이 없어" in n for n in runtime.notices)


def test_brochure_capability_example_is_pending_and_contact_free() -> None:
    """회사소개서 묶음 예시(BROCHURE, #17): 검사 통과, 전부 검수 대기, 연락처 없음."""
    report = check_capability_file(EXAMPLES / "capability-geosan-brochure.json")
    assert report.ok, report.error_lines()
    cap = report.capability
    assert cap is not None and cap.dataset_kind == "BROCHURE"
    assert {p.code for p in cap.processes} == {
        p.code
        for p in check_capability_file(EXAMPLES / "capability-geosan.json").capability.processes
    }  # 가상 묶음과 같은 공정 코드 9개
    assert all(p.review_status == "PENDING" for p in cap.processes)
    assert all(c.review_status == "PENDING" for p in cap.processes for c in p.capabilities)
    assert all(q.review_status == "PENDING" for q in cap.qualifications)
    assert all(s.review_status == "PENDING" for q in cap.qualifications for s in q.scopes)
    assert any(q.official_name == "AS9100D" and q.number for q in cap.qualifications)
    raw = (EXAMPLES / "capability-geosan-brochure.json").read_text(encoding="utf-8")
    assert "소개서 기준·거산 확인 전" in raw
    # UNKNOWN·UNCONFIRMED로 둔 항목마다 왜 그런지(이유)와 다음 할 일을 적어 둔다(PM 지시 2026-10-22)
    for qual in cap.qualifications:
        for scope in qual.scopes:
            if scope.applicability == "UNKNOWN":
                assert scope.basis and "이유:" in scope.basis and "다음 할 일:" in scope.basis, (
                    qual.official_name,
                    scope.process_code,
                )
        for entry in qual.statuses:
            if entry.status == "UNCONFIRMED":
                assert entry.reason and "이유:" in entry.reason and "다음 할 일:" in entry.reason, (
                    qual.official_name
                )
    # 소개서의 전화·이메일은 옮기지 않는다(CON-11)
    assert "@" not in raw and "041-" not in raw
