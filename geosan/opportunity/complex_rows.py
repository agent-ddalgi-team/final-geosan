"""산단공 단지 입주 XML 읽기(C5·C9, #390).

공식 필드: https://www.data.go.kr/data/15087611/openapi.do
getFctryListInIrsttService_v2. 네트워크·저장·AI 호출은 하지 않는다.
호출자는 소스 이용 확인·하루 한도·재시도·캐시를 별도로 처리해야 한다.
원본 XML·대표자·전화·팩스·홈페이지·오류 원문은 결과나 로그에 남기지 않는다.
"""

import hashlib
import re
from collections.abc import Sequence
from dataclasses import dataclass
from typing import Literal
from xml.etree import ElementTree as ET

from geosan.config.errors import AppError, InputError
from geosan.evidence.contacts import scrub_contacts
from geosan.opportunity.factory_csv import FactoryRow, SkippedRow, _region_name


class ComplexSourceError(AppError):
    """회차의 기존 complexListSkippedReason에 쓸 사유. 새 API 오류 kind는 만들지 않는다."""

    def __init__(self, reason: Literal["SOURCE_ERROR", "DAILY_LIMIT"] = "SOURCE_ERROR"):
        super().__init__(
            "산단공 조회의 하루 한도에 도달했습니다."
            if reason == "DAILY_LIMIT"
            else "산단공 입주 목록 응답을 확인하지 못했습니다.",
            "받은 결과와 공장현황 파일로 계속하고, 조회 상태를 확인해 주세요.",
            status=503,
        )
        self.skipped_reason = reason


@dataclass(frozen=True, slots=True)
class ComplexFactoryRow(FactoryRow):
    industry_name: str | None
    factory_manage_no: str | None


@dataclass(frozen=True, slots=True)
class ComplexPage:
    page_no: int
    page_size: int
    total_count: int
    rows: tuple[ComplexFactoryRow, ...]
    raw_count: int
    filtered_count: int
    skipped_rows: tuple[SkippedRow, ...]

    @property
    def has_more(self) -> bool:
        return self.page_no * self.page_size < self.total_count


@dataclass(frozen=True, slots=True)
class CombinedFactoryRows:
    """파일 원문은 유지하고 조회에서 더할 행만 구분한다. 회사 등록·병합 결과는 아니다."""

    file_rows: tuple[FactoryRow, ...]
    added_rows: tuple[ComplexFactoryRow, ...]
    duplicate_count: int


def combine_factory_rows(
    file_rows: Sequence[FactoryRow], complex_rows: Sequence[ComplexFactoryRow]
) -> CombinedFactoryRows:
    """주소로 거른 응답을 파일과 합친다(C5). CSV의 생산품별 원문은 바꾸지 않는다.

    파일과 이름·주소가 같은 조회 행은 제외한다. 조회의 같은 관리번호가 다른 내용으로
    오면 전체 결합을 거부한다. 번호가 없으면 완전히 같은 행만 중복으로 본다.
    번호가 다르거나 번호 없이 생산품이 다른 행은 임의로 합치지 않는다.
    조회 실패·미완료 여부와 건수는 호출자가 별도로 보존해야 한다.
    """
    if (
        not isinstance(file_rows, Sequence)
        or not isinstance(complex_rows, Sequence)
        or isinstance(file_rows, (str, bytes))
        or isinstance(complex_rows, (str, bytes))
        or any(type(row) is not FactoryRow for row in file_rows)
        or any(type(row) is not ComplexFactoryRow for row in complex_rows)
    ):
        raise InputError("파일 읽기와 조회 응답 검사를 마친 공장 행을 넘겨 주세요.")
    file_keys = {row.identity_key for row in file_rows}
    seen_numbers: dict[str, ComplexFactoryRow] = {}
    seen_rows: set[ComplexFactoryRow] = set()
    added, duplicates = [], 0
    for row in complex_rows:
        number = row.factory_manage_no
        if number:
            previous = seen_numbers.get(number)
            if previous is not None and previous != row:
                raise ComplexSourceError()
            seen_numbers[number] = row
        if row.identity_key in file_keys or row in seen_rows:
            duplicates += 1
        else:
            added.append(row)
        seen_rows.add(row)
    return CombinedFactoryRows(tuple(file_rows), tuple(added), duplicates)


class _NoDtd(ET.TreeBuilder):
    def doctype(self, name, pubid, system):
        # 문자열 검색과 달리 UTF-16 XML에서도 엔티티 선언 전에 거부한다.
        raise ComplexSourceError()


def _one(parent, tag, *, required=True):
    nodes = parent.findall(tag)
    if len(nodes) > 1 or (required and not nodes):
        raise ComplexSourceError()
    return nodes[0] if nodes else None


def _text(parent, tag, *, required=True):
    node = _one(parent, tag, required=required)
    if node is None:
        return ""
    if len(node):
        raise ComplexSourceError()
    return (node.text or "").strip()


def _number(parent, tag):
    value = _text(parent, tag)
    if not re.fullmatch(r"[0-9]+", value):
        raise ComplexSourceError()
    try:
        return int(value)
    except ValueError:
        raise ComplexSourceError() from None


def _public_row(item, regions):
    # 허용한 필드만 읽는다. 다른 필드는 반환·로그·오류 문구에 옮기지 않는다.
    company = _text(item, "cmpnyNm", required=False)
    address = _text(item, "rnAdres", required=False)
    if not company or not address:
        return "회사명 또는 공장주소가 비어 있음"
    region = _region_name(address.split()[0].rstrip(","))
    if region not in regions:
        return None
    product = _text(item, "mainProductCn", required=False)
    complex_name = _text(item, "irsttNm", required=False)
    industry = _text(item, "indutyNm", required=False)
    number = _text(item, "fctryManageNo", required=False)
    if any(
        scrub_contacts(value)[1] for value in (company, address, product, complex_name, industry)
    ):
        return "공개 본문에 연락처 형식이 있어 확인 필요"
    # 공장관리번호는 전화번호와 달리 공개 식별자다. 숫자열을 연락처로 잘라내지 않는다.
    if number and not re.fullmatch(r"[A-Za-z0-9_-]+", number):
        return "공장관리번호 형식 확인 필요"
    return ComplexFactoryRow(
        company_name=company,
        complex_name=complex_name or None,
        product=product,
        address=address,
        region=region,
        product_hash=hashlib.sha256(product.encode("utf-8")).hexdigest(),
        industry_name=industry or None,
        factory_manage_no=number or None,
    )


def parse_complex_page(
    xml: bytes | str,
    *,
    regions: Sequence[str],
    expected_page: int,
    page_size: int,
) -> ComplexPage:
    """요청한 한 쪽을 검사한다. 실패·잘못된 페이지·빠진 행을 빈 성공으로 바꾸지 않는다.

    page_size는 실제 요청값이고 C9의 공급자 최대 1000건까지 허용한다.
    has_more는 지역 필터 뒤 행 수가 아닌 공급자의 전체 건수로 계산한다.
    누락·연락처가 있는 개별 행은 값 없이 원본 순서와 사유만 반환한다(C5 skippedRows).
    """
    if (
        isinstance(regions, (str, bytes))
        or not isinstance(regions, Sequence)
        or not regions
        or any(not isinstance(region, str) or not region.strip() for region in regions)
    ):
        raise InputError("찾을 지역을 하나 이상 골라 주세요.")
    if type(expected_page) is not int or expected_page < 1:
        raise InputError("요청한 조회 페이지를 확인해 주세요.")
    if type(page_size) is not int or not 1 <= page_size <= 1000:
        raise InputError("조회 한 페이지의 건수는 1~1000 사이여야 합니다.")
    if not isinstance(xml, (bytes, str)):
        raise InputError("조회 응답은 XML 바이트 또는 문자열이어야 합니다.")
    selected = {_region_name(region) for region in regions}
    try:
        root = ET.fromstring(xml, parser=ET.XMLParser(target=_NoDtd()))
    except (ET.ParseError, ValueError, LookupError):
        raise ComplexSourceError() from None
    if root.tag == "OpenAPI_ServiceResponse":
        code = _text(_one(root, "cmmMsgHeader"), "returnReasonCode")
        raise ComplexSourceError("DAILY_LIMIT" if code == "22" else "SOURCE_ERROR")
    if root.tag != "response":
        raise ComplexSourceError()
    code = _text(_one(root, "header"), "resultCode")
    if code != "00":
        raise ComplexSourceError("DAILY_LIMIT" if code == "22" else "SOURCE_ERROR")
    body = _one(root, "body")
    page = _number(body, "pageNo")
    size = _number(body, "numOfRows")
    total = _number(body, "totalCount")
    if page != expected_page or size != page_size:
        raise ComplexSourceError()
    offset = (page - 1) * size
    if (total == 0 and page != 1) or (total > 0 and offset >= total):
        raise ComplexSourceError()
    items_node = _one(body, "items", required=total != 0)
    items = list(items_node) if items_node is not None else []
    if items_node is not None and (
        (items_node.text or "").strip() or any((item.tail or "").strip() for item in items)
    ):
        raise ComplexSourceError()
    if any(item.tag != "item" for item in items) or len(items) != min(size, total - offset):
        raise ComplexSourceError()
    rows, skipped, filtered = [], [], 0
    for index, item in enumerate(items, start=offset + 1):
        row = _public_row(item, selected)
        if row is None:
            filtered += 1
        elif isinstance(row, str):
            skipped.append(SkippedRow(index, row))
        else:
            rows.append(row)
    return ComplexPage(page, size, total, tuple(rows), len(items), filtered, tuple(skipped))
