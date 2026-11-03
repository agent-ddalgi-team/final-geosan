"""#217 내부용 엑셀 생성. 기록 조회와 분리하고 허용된 다섯 열만 받는다.

단계·일정 조회 연결은 #209 반영 뒤 API에서 한다. 등급 검사·전송 로그는 U2 연결 대상이다.
"""

from __future__ import annotations

import re
from collections.abc import Iterable
from dataclasses import dataclass
from datetime import date
from io import BytesIO
from xml.etree import ElementTree as ET
from zipfile import ZIP_DEFLATED, ZipFile

from geosan.config.validators import find_contact

SHEET_NS = "http://schemas.openxmlformats.org/spreadsheetml/2006/main"
REL_NS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
PACKAGE_REL_NS = "http://schemas.openxmlformats.org/package/2006/relationships"
CONTENT_NS = "http://schemas.openxmlformats.org/package/2006/content-types"
HEADERS = ("회사", "공정", "점수", "단계", "다음 일정")
INVALID_XML = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f\ud800-\udfff\ufffe\uffff]")


@dataclass(frozen=True, slots=True)
class ExportRow:
    """표시값을 전달한다. 메모·대표번호·근거 본문은 입력 칸 자체가 없다."""

    company: str
    process: str
    score: str
    stage: str
    next_schedule: date | None
    is_virtual: bool


@dataclass(frozen=True, slots=True)
class ExportResult:
    content: bytes
    removed_cell_count: int


def _xml(root: ET.Element) -> bytes:
    return ET.tostring(root, encoding="utf-8", xml_declaration=True)


def _text_cell(row: ET.Element, ref: str, text: str) -> None:
    if len(text) > 32767 or INVALID_XML.search(text):
        # 원문은 오류·로그에 포함하지 않는다. 깨진 파일을 성공으로 내보내지 않는다.
        raise ValueError("엑셀에 담을 수 없는 길이 또는 문자가 있습니다.")
    cell = ET.SubElement(row, "c", {"r": ref, "t": "inlineStr"})
    inline = ET.SubElement(cell, "is")
    ET.SubElement(inline, "t", {"xml:space": "preserve"}).text = text


def build_xlsx(rows: Iterable[ExportRow]) -> ExportResult:
    """연락처가 든 칸 전체를 비우며, 수식처럼 보이는 글도 문자열로만 기록한다."""
    records = list(rows)
    if len(records) > 1_048_574:
        raise ValueError("엑셀 한 시트의 행 수를 넘었습니다.")
    sheet = ET.Element("worksheet", {"xmlns": SHEET_NS})
    views = ET.SubElement(sheet, "sheetViews")
    view = ET.SubElement(views, "sheetView", {"workbookViewId": "0"})
    ET.SubElement(view, "pane", {"ySplit": "2", "topLeftCell": "A3", "state": "frozen"})
    columns = ET.SubElement(sheet, "cols")
    for index, width in enumerate((32, 38, 22, 22, 18), 1):
        ET.SubElement(
            columns,
            "col",
            {"min": str(index), "max": str(index), "width": str(width), "customWidth": "1"},
        )
    data = ET.SubElement(sheet, "sheetData")
    notice = "내부용·고객 제출용 아님"
    if any(record.is_virtual for record in records):
        notice += " · 가상 데이터 포함"
    _text_cell(ET.SubElement(data, "row", {"r": "1"}), "A1", notice)
    header = ET.SubElement(data, "row", {"r": "2"})
    for column, text in zip("ABCDE", HEADERS, strict=True):
        _text_cell(header, f"{column}2", text)
    removed = 0
    for index, record in enumerate(records, 3):
        row = ET.SubElement(data, "row", {"r": str(index)})
        values = (
            record.company,
            record.process,
            record.score,
            record.stage,
            record.next_schedule.isoformat() if record.next_schedule else "",
        )
        for column, text in zip("ABCDE", values, strict=True):
            if find_contact(text):
                text = ""
                removed += 1
            _text_cell(row, f"{column}{index}", text)
    ET.SubElement(sheet, "autoFilter", {"ref": f"A2:E{len(records) + 2}"})

    workbook = ET.Element("workbook", {"xmlns": SHEET_NS, "xmlns:r": REL_NS})
    sheets = ET.SubElement(workbook, "sheets")
    ET.SubElement(sheets, "sheet", {"name": "추천 목록", "sheetId": "1", "r:id": "rId1"})
    root_rels = ET.Element("Relationships", {"xmlns": PACKAGE_REL_NS})
    ET.SubElement(
        root_rels,
        "Relationship",
        {"Id": "rId1", "Type": f"{REL_NS}/officeDocument", "Target": "xl/workbook.xml"},
    )
    workbook_rels = ET.Element("Relationships", {"xmlns": PACKAGE_REL_NS})
    ET.SubElement(
        workbook_rels,
        "Relationship",
        {"Id": "rId1", "Type": f"{REL_NS}/worksheet", "Target": "worksheets/sheet1.xml"},
    )
    content_types = ET.Element("Types", {"xmlns": CONTENT_NS})
    ET.SubElement(
        content_types,
        "Default",
        {
            "Extension": "rels",
            "ContentType": "application/vnd.openxmlformats-package.relationships+xml",
        },
    )
    ET.SubElement(content_types, "Default", {"Extension": "xml", "ContentType": "application/xml"})
    for path, kind in (
        ("/xl/workbook.xml", "sheet.main"),
        ("/xl/worksheets/sheet1.xml", "worksheet"),
    ):
        ET.SubElement(
            content_types,
            "Override",
            {
                "PartName": path,
                "ContentType": (
                    f"application/vnd.openxmlformats-officedocument.spreadsheetml.{kind}+xml"
                ),
            },
        )
    buffer = BytesIO()
    with ZipFile(buffer, "w", compression=ZIP_DEFLATED) as archive:
        for path, root in (
            ("[Content_Types].xml", content_types),
            ("_rels/.rels", root_rels),
            ("xl/workbook.xml", workbook),
            ("xl/_rels/workbook.xml.rels", workbook_rels),
            ("xl/worksheets/sheet1.xml", sheet),
        ):
            archive.writestr(path, _xml(root))
    return ExportResult(content=buffer.getvalue(), removed_cell_count=removed)
