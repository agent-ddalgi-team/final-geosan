"""로더·검사기 단위 테스트 (Step 12, 단위 테스트 지침 3장 config/ 8개 + 보강 3개).

줄 번호 문구, 모르는 키, `_설명` 무시, 연락처 3패턴, BOM, 단계 이름→숫자, 비밀 키 오류, min>max.
모든 데이터는 가상이며 연락처는 '패턴이 거부되는지'를 보기 위한 가짜 번호다.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import pytest

from geosan.config.app_settings import check_app_settings_file, find_secret_keys
from geosan.config.errors import InputError
from geosan.config.file_checks import check_capability_file, check_case_file
from geosan.config.loader import load_document
from geosan.config.rule_config import (
    MatchRateError,
    check_rule_config_file,
    load_rule_config,
    resolve_match_rate,
)
from geosan.config.validators import find_contact, format_field_error, scan_contacts
from tests import factories


def _write(tmp_path: Path, name: str, data: Any, *, bom: bool = False) -> Path:
    path = tmp_path / name
    text = json.dumps(data, ensure_ascii=False, indent=2)
    path.write_bytes((b"\xef\xbb\xbf" if bom else b"") + text.encode("utf-8"))
    return path


def test_allowed_value_error_has_line_number_and_contract_wording(tmp_path: Path) -> None:
    """허용 값 밖은 '<줄>번째 줄 <경로>: … 중 하나여야 하는데 '<값>'이 적혀 있습니다' 꼴 (BR2.2)."""
    data = factories.apjeong_case()
    data["requirements"][1]["reqLevel"] = "필수요"
    path = _write(tmp_path, "case.json", data)
    report = check_case_file(path)
    assert not report.ok
    lines = report.error_lines()
    assert len(lines) == 1
    expected_line = _line_of(path, '"reqLevel": "필수요"')
    assert lines[0] == (
        f"{expected_line}번째 줄 requirements[1].reqLevel: 'REQUIRED', 'PREFERRED', "
        "'NOT_REQUIRED', 'UNKNOWN' 중 하나여야 하는데 '필수요'이 적혀 있습니다"
    )


def test_unknown_key_is_an_error_with_its_name(tmp_path: Path) -> None:
    """`_설명` 밖의 모르는 키는 조용히 사라지지 않고 오류다(BR2.2)."""
    data = factories.apjeong_case()
    data["requirements"][0]["reqlevel"] = "REQUIRED"
    data["extraTopLevel"] = 1
    report = check_case_file(_write(tmp_path, "case.json", data))
    messages = {e.path: e.message for e in report.errors}
    assert "모르는 키 'reqlevel'" in messages["requirements[0].reqlevel"]
    assert "모르는 키 'extraTopLevel'" in messages["extraTopLevel"]
    assert all(e.line is not None for e in report.errors)


def test_description_keys_are_ignored_at_any_depth(tmp_path: Path) -> None:
    """`_설명` 키는 어느 깊이에 있든 무시되고 검사·데이터에서 빠진다(C7)."""
    data = factories.apjeong_case()
    data["_설명"] = "맨 위 설명"
    data["customer"]["_설명"] = "고객 설명 — 연락처 패턴도 여기 있으면 무시: 010-0000-0000"
    data["itemInputs"][0]["usedCapabilityRefs"].append(
        {"kind": "PROCESS", "processCode": "ANODIZING", "_설명": "깊은 곳 설명"}
    )
    path = _write(tmp_path, "case.json", data)
    document = load_document(path)
    assert "_설명" not in document.data
    assert "_설명" not in document.data["customer"]
    assert "_설명" not in document.data["itemInputs"][0]["usedCapabilityRefs"][0]
    report = check_case_file(path)
    assert report.ok, report.error_lines()


@pytest.mark.parametrize(
    ("text", "kind"),
    [
        ("문의는 sales@example.com 으로", "이메일"),
        ("대표번호 02-123-4567", "전화번호"),
        ("담당 041.123.4567", "전화번호"),
        ("(031) 1234-5678", "전화번호"),
        ("휴대폰 010-1234-5678", "전화번호"),
        ("휴대폰 01012345678", "전화번호"),
        ("국제 +82-10-1234-5678", "전화번호"),
        ("국제 +82 2 123 4567", "전화번호"),
    ],
)
def test_contact_patterns_are_detected(text: str, kind: str) -> None:
    """이메일·국내 전화(변형 포함)·+82 패턴을 한 검사기가 모두 잡는다(BR2.1)."""
    assert find_contact(text) == kind


@pytest.mark.parametrize(
    "text",
    [
        "2026-10-20 마감, 2024-06-10 견적",
        "VIRTUAL-ISO9001-0001 / 5~25 μm / 0~30일 1.0",
        "2026-10-19T09:00:00+09:00",
        "밸브 바디 아노다이징 외주 협력사 모집 (가상)",
    ],
)
def test_dates_and_codes_are_not_contacts(text: str) -> None:
    """날짜·인증 번호·시각·보통 문장은 연락처로 오인하지 않는다."""
    assert find_contact(text) is None


def test_contact_in_file_is_rejected_with_line_and_path(tmp_path: Path) -> None:
    """파일 자유 문장에 연락처가 있으면 칸 경로·줄 번호와 함께 거부된다. 사업자번호는 제외."""
    data = factories.apjeong_case()
    data["evidence"][1]["quote"] = "밸브 생산 — 문의 041-123-4567 (가상)"
    data["notes"].append("담당 sales@example.com")
    data["customer"]["bizNumber"] = "0101234567"
    path = _write(tmp_path, "case.json", data)
    report = check_case_file(path)
    paths = {e.path: e for e in report.errors}
    assert "evidence[1].quote" in paths and "notes[2]" in paths
    assert "customer.bizNumber" not in paths
    assert paths["evidence[1].quote"].message.startswith("연락처는 저장하지 않습니다")
    assert paths["evidence[1].quote"].line == _line_of(path, "041-123-4567")
    assert scan_contacts({"a": {"b": ["ok", "x@y.kr"]}}) and format_field_error(
        scan_contacts({"a": {"b": ["ok", "x@y.kr"]}})[0]
    ).startswith("a.b[1]: 연락처는 저장하지 않습니다")


def test_utf8_bom_is_accepted_and_other_encodings_are_rejected(tmp_path: Path) -> None:
    """UTF-8 BOM은 허용하고(줄 번호도 그대로), CP949 같은 인코딩은 쉬운 말 오류다."""
    data = factories.apjeong_case()
    bom_path = _write(tmp_path, "bom.json", data, bom=True)
    assert check_case_file(bom_path).ok
    cp949 = tmp_path / "cp949.json"
    cp949.write_bytes(json.dumps(data, ensure_ascii=False).encode("cp949", errors="replace"))
    with pytest.raises(InputError) as exc_info:
        load_document(cp949)
    assert "UTF-8로 저장해 주세요" in exc_info.value.message
    report = check_case_file(cp949)
    assert not report.ok and "UTF-8" in report.errors[0].message


def test_match_rate_step_names_convert_to_numbers_and_out_of_step_is_rejected() -> None:
    """단계 이름은 설정 표로 숫자가 되고, 단계 밖 숫자(0.8)는 단계 목록과 함께 거부된다 (BR4.2)."""
    config = load_rule_config(Path("examples/rule-config.yaml"))
    assert resolve_match_rate(config, "NEW_MATERIAL", "정확히 일치") == 1.0
    assert resolve_match_rate(config, "NEW_MATERIAL", "일부 가능") == 0.5
    assert resolve_match_rate(config, "NEW_RECORD", 0.67) == 0.67
    assert resolve_match_rate(config, "NEW_RECORD", "0.33") == 0.33
    assert resolve_match_rate(config, "SIG_BID", None) is None
    with pytest.raises(MatchRateError) as exc_info:
        resolve_match_rate(config, "NEW_RECORD", 0.8)
    assert str(exc_info.value) == (
        "NEW_RECORD의 일치도 단계 '동일 부품'(1), '동일 산업'(0.67), '인접 산업'(0.33) 중 하나여야 "
        "하는데 '0.8'이 적혀 있습니다"
    )
    with pytest.raises(MatchRateError):
        resolve_match_rate(config, "NEW_PRODUCT", "거의 해당")


def test_secret_keys_in_app_settings_are_rejected(tmp_path: Path) -> None:
    """password·apiKey·token 같은 키는 어느 깊이든 오류다(BR11.3, 보안 설계 3장)."""
    assert find_secret_keys({"llm": {"apiKey": "x"}, "a": [{"Password": "y"}], "token": 1}) == [
        "llm.apiKey",
        "a[0].Password",
        "token",
    ]
    path = tmp_path / "app.yaml"
    path.write_text(
        "staff:\n  - { key: park-lee, displayName: 박 이사 }\n"
        "activeDatasetKind: VIRTUAL_REVIEWED\n"
        "ingestion: { regions: [], productKeywords: [], maxCandidates: 10 }\n"
        "llm:\n  mode: NONE\n  model: null\n  monthlyCallLimit: 0\n  costPerThousandTokens: 0\n"
        "  apiKey: 'should-not-be-here'\n"
        "homepageDiscovery: { enabled: false, termsConfirmed: false }\n"
        "brand: { logoUrl: null, brandName: 거산, colorPrimary: '#1F5FBF', demoLabel: null }\n"
        "accessProtection: { enabled: false }\n",
        encoding="utf-8",
    )
    result = check_app_settings_file(path)
    assert not result.ok
    assert result.errors[0].path == "llm.apiKey"
    assert result.errors[0].line == 10
    assert "비밀 값 키" in result.errors[0].message
    assert check_app_settings_file(Path("examples/app-settings.yaml")).ok


def test_capability_numeric_min_over_max_and_missing_unit_are_errors(tmp_path: Path) -> None:
    """숫자 사양은 min ≤ max이고 단위가 있어야 한다(BR1.2). 설비는 설명용이어야 한다."""
    data = factories.capability_file()
    anodizing = next(p for p in data["processes"] if p["code"] == "ANODIZING")
    thickness = next(c for c in anodizing["capabilities"] if c["name"] == "피막 두께")
    thickness["numericMin"], thickness["numericMax"], thickness["unit"] = 30, 25, None
    line_equipment = next(c for c in anodizing["capabilities"] if c["capKind"] == "EQUIPMENT")
    line_equipment["isDescriptiveOnly"] = False
    report = check_capability_file(_write(tmp_path, "cap.json", data))
    by_path = {e.path: e.message for e in report.errors}
    assert "processes[1].capabilities[0].numericMax" in by_path
    assert (
        "최대값(25)이 최소값(30)보다 작습니다" in by_path["processes[1].capabilities[0].numericMax"]
    )
    assert "단위가 꼭 있어야" in by_path["processes[1].capabilities[0].unit"]
    assert "설명용이라 true" in by_path["processes[1].capabilities[3].isDescriptiveOnly"]
    assert check_capability_file(Path("examples/capability-geosan.json")).ok


def test_duplicate_key_and_rule_config_semantics(tmp_path: Path) -> None:
    """같은 키 두 번은 줄 번호와 함께 오류이고, 규칙 설정의 8항목·분류 문구 누락도 잡는다."""
    dup = tmp_path / "dup.json"
    dup.write_text('{\n "caseId": "a",\n "caseId": "b"\n}\n', encoding="utf-8")
    with pytest.raises(InputError) as exc_info:
        load_document(dup)
    assert exc_info.value.fields[0].line == 3
    assert "두 번 나옵니다" in exc_info.value.fields[0].message

    document = load_document(Path("examples/rule-config.yaml"))
    broken = dict(document.data)
    broken["newProfileItems"] = broken["newProfileItems"][:-1]
    broken["classificationLabels"] = {
        k: v for k, v in broken["classificationLabels"].items() if k != "LOW"
    }
    path = tmp_path / "rule.json"
    path.write_text(json.dumps(broken, ensure_ascii=False, default=str), encoding="utf-8")
    result = check_rule_config_file(path)
    assert not result.ok
    messages = " / ".join(e.message for e in result.errors)
    assert "8항목" in messages or "newProfileItems" in " ".join(e.path for e in result.errors)
    assert "LOW" in messages


def _line_of(path: Path, needle: str) -> int:
    for number, line in enumerate(path.read_text(encoding="utf-8-sig").splitlines(), start=1):
        if needle in line:
            return number
    raise AssertionError(f"'{needle}'이 파일에 없습니다")
