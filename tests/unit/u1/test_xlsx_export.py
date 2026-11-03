"""#217: 생성한 ZIP·XML을 다시 읽어 열·내용·연락처 제거·수식 차단을 확인한다."""

from dataclasses import replace
from datetime import date
from io import BytesIO
from xml.etree import ElementTree as ET
from zipfile import ZipFile

import pytest

from geosan.records.xlsx_export import SHEET_NS, ExportRow, build_xlsx

NS = {"s": SHEET_NS}


def sample(**changes):
    return replace(
        ExportRow("가상 기업", "아연도금", "77점 · 7/8", "관심", date(2026, 11, 12), True),
        **changes,
    )


def sheet(result):
    with ZipFile(BytesIO(result.content)) as archive:
        assert archive.testzip() is None
        for name in archive.namelist():
            ET.fromstring(archive.read(name))
        return ET.fromstring(archive.read("xl/worksheets/sheet1.xml"))


def cells(root):
    return {cell.attrib["r"]: "".join(cell.itertext()) for cell in root.findall(".//s:c", NS)}


def test_five_columns_notice_dates_and_no_private_columns():
    """Given 가상 기록 / When 생성 / Then 다섯 열·내부용 표시만 담긴다."""
    result = build_xlsx([sample()])
    values = cells(sheet(result))
    assert values["A1"] == "내부용·고객 제출용 아님 · 가상 데이터 포함"
    assert [values[f"{c}2"] for c in "ABCDE"] == ["회사", "공정", "점수", "단계", "다음 일정"]
    assert [values[f"{c}3"] for c in "ABCDE"] == [
        "가상 기업",
        "아연도금",
        "77점 · 7/8",
        "관심",
        "2026-11-12",
    ]
    assert len(values) == 11
    assert "영업 메모" not in values.values() and "대표번호" not in values.values()
    assert result.removed_cell_count == 0


@pytest.mark.parametrize(
    "text",
    ["sales@example.invalid", "010-1234-5678", "01012345678", "(02) 1234-5678", "+82-10-1234-5678"],
)
def test_contact_cell_is_entirely_blank_and_other_cells_survive(text):
    """Given 연락처 포함 칸 / When 생성 / Then 칸 전체를 지우고 개수를 센다."""
    result = build_xlsx([sample(company=f"가상 {text}", process=f"공정 {text}")])
    values = cells(sheet(result))
    assert values["A3"] == values["B3"] == ""
    assert values["C3"] == "77점 · 7/8"
    assert result.removed_cell_count == 2
    with ZipFile(BytesIO(result.content)) as archive:
        assert all(text.encode() not in archive.read(name) for name in archive.namelist())


def test_formula_like_text_and_xml_characters_are_only_strings():
    """Given 수식 같은 회사명 / When 생성 / Then 수식·외부 링크 없이 글자로 담긴다."""
    value = '=HYPERLINK("https://example.invalid", "가상 & <기업>")'
    result = build_xlsx([sample(company=value)])
    root = sheet(result)
    assert cells(root)["A3"] == value
    assert not root.findall(".//s:f", NS)
    assert all(c.attrib["t"] == "inlineStr" for c in root.findall(".//s:c", NS))


def test_empty_and_real_only_exports_do_not_claim_virtual_data():
    """Given 빈 목록 또는 실제 묶음 / When 생성 / Then 가상 포함 표시를 붙이지 않는다."""
    assert cells(sheet(build_xlsx([]))) == {
        "A1": "내부용·고객 제출용 아님",
        "A2": "회사",
        "B2": "공정",
        "C2": "점수",
        "D2": "단계",
        "E2": "다음 일정",
    }
    values = cells(sheet(build_xlsx([sample(is_virtual=False, next_schedule=None)])))
    assert "가상" not in values["A1"]
    assert values["E3"] == ""


@pytest.mark.parametrize(
    "value", ["가상\x00기업", "가" * 32768], ids=["control-character", "too-long"]
)
def test_invalid_workbook_text_fails_without_echoing_input(value):
    """Given 파일에 넣을 수 없는 글 / When 생성 / Then 깨진 성공 파일 대신 오류다."""
    with pytest.raises(ValueError) as error:
        build_xlsx([sample(company=value)])
    assert value not in str(error.value)


def test_generator_preserves_order_and_marks_mixed_virtual_rows():
    rows = (sample(company=f"가상 기업 {n}", is_virtual=n == 1) for n in range(3))
    values = cells(sheet(build_xlsx(rows)))
    assert "가상 데이터 포함" in values["A1"]
    assert [values[f"A{n}"] for n in range(3, 6)] == ["가상 기업 0", "가상 기업 1", "가상 기업 2"]
