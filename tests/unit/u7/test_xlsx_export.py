"""#217: 생성한 엑셀을 다시 읽어 열·표시 줄·연락처 지우기·수식 차단을 확인한다."""

from dataclasses import fields, replace
from datetime import date
from io import BytesIO
from xml.etree import ElementTree as ET
from zipfile import ZipFile

import pytest
from openpyxl import load_workbook

from geosan.evidence.contacts import scrub_contacts
from geosan.records.xlsx_export import SHEET_NS, ExportRow, build_xlsx

NS = {"s": SHEET_NS}
MARK = "[연락처 제거]"


def sample(**changes):
    return replace(
        ExportRow("가상 기업", "아연도금", "77점 · 7/8", "접촉", date(2026, 11, 12), True),
        **changes,
    )


def build(rows):
    return build_xlsx(rows, scrub=scrub_contacts)


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
    result = build([sample()])
    values = cells(sheet(result))
    assert values["A1"] == "내부용·고객 제출용 아님 · 가상 데이터 포함"
    assert [values[f"{c}2"] for c in "ABCDE"] == ["회사", "공정", "점수", "단계", "다음 일정"]
    assert [values[f"{c}3"] for c in "ABCDE"] == [
        "가상 기업",
        "아연도금",
        "77점 · 7/8",
        "접촉",
        "2026-11-12",
    ]
    assert len(values) == 11
    assert result.removed_contact_count == 0


def test_row_has_no_field_for_memo_phone_reply_or_activity():
    """Given 엑셀 한 줄의 입력 칸 / When 칸 이름을 봄 / Then 메모·대표번호를 넣을 자리가 없다."""
    assert [item.name for item in fields(ExportRow)] == [
        "company",
        "process",
        "score",
        "stage",
        "next_schedule",
        "is_virtual",
    ]
    headers = [cells(sheet(build([sample()])))[f"{c}2"] for c in "ABCDE"]
    assert not {"영업 메모", "메모", "대표번호", "전화", "질문 답", "활동 이력"} & set(headers)


def test_file_opens_with_spreadsheet_reader():
    """Given 생성한 파일 / When 엑셀 읽기 도구로 엶 / Then 시트 하나와 같은 값이 읽힌다."""
    book = load_workbook(BytesIO(build([sample()]).content))
    assert book.sheetnames == ["추천 목록"]
    rows = [list(row) for row in book.active.iter_rows(values_only=True)]
    assert rows[1] == ["회사", "공정", "점수", "단계", "다음 일정"]
    assert rows[2] == ["가상 기업", "아연도금", "77점 · 7/8", "접촉", "2026-11-12"]


@pytest.mark.parametrize(
    "text",
    ["sales@example.invalid", "010-1234-5678", "01012345678", "(02) 1234-5678", "+82-10-1234-5678"],
)
def test_contact_is_removed_and_the_rest_of_the_cell_survives(text):
    """Given 연락처가 든 칸 / When 생성 / Then 연락처만 지워지고 나머지 글과 다른 칸은 남는다."""
    result = build([sample(company=f"가상 기업 {text} 문의", process=f"공정 {text}")])
    values = cells(sheet(result))
    assert values["A3"] == f"가상 기업 {MARK} 문의"
    assert values["B3"] == f"공정 {MARK}"
    assert values["C3"] == "77점 · 7/8"
    assert result.removed_contact_count == 2
    with ZipFile(BytesIO(result.content)) as archive:
        assert all(text.encode() not in archive.read(name) for name in archive.namelist())


def test_every_cell_goes_through_the_scrub_function():
    """Given 지우기 함수 / When 두 줄 생성 / Then 자료 칸 열 개가 모두 그 함수를 거친다."""
    seen = []

    def spy(text):
        seen.append(text)
        return text, 0

    build_xlsx([sample(), sample(company="가상 기업 2", next_schedule=None)], scrub=spy)
    assert len(seen) == 10 and "가상 기업 2" in seen and "" in seen


def test_formula_like_text_and_xml_characters_are_only_strings():
    """Given 수식 같은 회사명 / When 생성 / Then 수식·외부 링크 없이 글자로 담긴다."""
    value = '=HYPERLINK("https://example.invalid", "가상 & <기업>")'
    result = build([sample(company=value)])
    root = sheet(result)
    assert cells(root)["A3"] == value
    assert not root.findall(".//s:f", NS)
    assert all(c.attrib["t"] == "inlineStr" for c in root.findall(".//s:c", NS))


def test_empty_and_real_only_exports_do_not_claim_virtual_data():
    """Given 빈 목록 또는 실제 묶음 / When 생성 / Then 가상 포함 표시를 붙이지 않는다."""
    assert cells(sheet(build([]))) == {
        "A1": "내부용·고객 제출용 아님",
        "A2": "회사",
        "B2": "공정",
        "C2": "점수",
        "D2": "단계",
        "E2": "다음 일정",
    }
    values = cells(sheet(build([sample(is_virtual=False, next_schedule=None)])))
    assert "가상" not in values["A1"]
    assert values["E3"] == ""


@pytest.mark.parametrize(
    "value", ["가상\x00기업", "가" * 32768], ids=["control-character", "too-long"]
)
def test_invalid_workbook_text_fails_without_echoing_input(value):
    """Given 파일에 넣을 수 없는 글 / When 생성 / Then 깨진 성공 파일 대신 오류다."""
    with pytest.raises(ValueError) as error:
        build([sample(company=value)])
    assert value not in str(error.value)


def test_generator_preserves_order_and_marks_mixed_virtual_rows():
    """Given 가상·실제가 섞인 줄 / When 생성 / Then 순서가 그대로이고 가상 표시가 붙는다."""
    rows = (sample(company=f"가상 기업 {n}", is_virtual=n == 1) for n in range(3))
    values = cells(sheet(build(rows)))
    assert "가상 데이터 포함" in values["A1"]
    assert [values[f"A{n}"] for n in range(3, 6)] == ["가상 기업 0", "가상 기업 1", "가상 기업 2"]
