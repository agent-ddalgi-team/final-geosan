"""공식 XML 모양의 가상 응답 검사. 네트워크·실제 인증키·운영 DB를 쓰지 않는다."""

import hashlib
from dataclasses import asdict
from xml.etree import ElementTree as ET

import pytest

from geosan.config.errors import InputError
from geosan.opportunity.complex_rows import ComplexSourceError, parse_complex_page


def item(**changes):
    return {
        "cmpnyNm": "가상볼트",
        "rnAdres": "충청남도 아산시 가상길 1",
        "mainProductCn": "볼트·너트",
        "irsttNm": "가상아산단지",
        "indutyNm": "볼트 제조업",
        "fctryManageNo": "2026000000001",
    } | changes


def document(items=None, *, page=1, size=1000, total=None, code="00"):
    items = [item()] if items is None else items
    root = ET.Element("response")
    header = ET.SubElement(root, "header")
    ET.SubElement(header, "resultCode").text = code
    ET.SubElement(header, "resultMsg").text = "PRIVATE_MESSAGE_MARKER"
    body = ET.SubElement(root, "body")
    rows = ET.SubElement(body, "items")
    for values in items:
        record = ET.SubElement(rows, "item")
        for tag, value in values.items():
            ET.SubElement(record, tag).text = value
    for tag, value in {
        "pageNo": page,
        "numOfRows": size,
        "totalCount": len(items) if total is None else total,
    }.items():
        ET.SubElement(body, tag).text = str(value)
    return ET.tostring(root, encoding="utf-8", xml_declaration=True)


def parse(xml, **changes):
    return parse_complex_page(
        xml, **({"regions": ["충남"], "expected_page": 1, "page_size": 1000} | changes)
    )


def test_read_only_public_columns_and_preserve_provider_identifier(caplog):
    xml = document(
        [
            item(
                rprsntvNm="PRIVATE_PERSON_MARKER",
                cmpnyTelno="PRIVATE_PHONE_MARKER",
                cmpnyFxnum="PRIVATE_FAX_MARKER",
                hmpadr="PRIVATE_HOMEPAGE_MARKER",
                unknown="PRIVATE_EXTRA_MARKER",
            )
        ]
    )
    result = parse(xml)
    row = result.rows[0]
    assert asdict(row) == {
        "company_name": "가상볼트",
        "complex_name": "가상아산단지",
        "product": "볼트·너트",
        "address": "충청남도 아산시 가상길 1",
        "region": "충남",
        "product_hash": hashlib.sha256("볼트·너트".encode()).hexdigest(),
        "industry_name": "볼트 제조업",
        "factory_manage_no": "2026000000001",
    }
    assert (result.raw_count, result.filtered_count, result.skipped_rows) == (1, 0, ())
    assert not result.has_more
    assert "PRIVATE_" not in repr(result) + caplog.text


def test_filter_by_address_not_similar_complex_name():
    result = parse(
        document(
            [
                item(),
                item(irsttNm="고창아산농공단지", rnAdres="전북특별자치도 고창군 가상길 2"),
                item(cmpnyNm="가상세종", rnAdres="세종특별자치시, 가상길 3"),
            ]
        ),
        regions=["충청남도", "세종"],
    )
    assert [row.company_name for row in result.rows] == ["가상볼트", "가상세종"]
    assert result.raw_count == 3 and result.filtered_count == 1


def test_nonmanufacturer_and_own_plating_are_not_silently_removed():
    result = parse(
        document(
            [
                item(cmpnyNm="가상물류", indutyNm="물류업", mainProductCn="운송"),
                item(cmpnyNm="가상표면", indutyNm="도금업", mainProductCn="아노다이징"),
            ]
        )
    )
    assert len(result.rows) == 2 and not result.skipped_rows


def test_optional_fields_and_blank_product_are_preserved():
    result = parse(document([{"cmpnyNm": " 가상공장 ", "rnAdres": " 충남 아산시 가상길 1 "}]))
    row = result.rows[0]
    assert row.company_name == "가상공장" and row.product == ""
    assert row.complex_name is row.industry_name is row.factory_manage_no is None


@pytest.mark.parametrize("missing", ["cmpnyNm", "rnAdres"])
def test_missing_required_value_is_reported_with_row_number_only(missing):
    values = item()
    values.pop(missing)
    result = parse(document([item(), values]))
    assert len(result.rows) == 1
    assert result.skipped_rows[0].row_no == 2
    assert result.skipped_rows[0].reason == "회사명 또는 공장주소가 비어 있음"


@pytest.mark.parametrize("field", ["cmpnyNm", "rnAdres", "mainProductCn", "irsttNm", "indutyNm"])
def test_contacts_in_public_columns_are_not_forwarded(field, caplog):
    value = (
        "충남 가상길 test@example.invalid PRIVATE_MARKER"
        if field == "rnAdres"
        else "test@example.invalid PRIVATE_MARKER"
    )
    result = parse(document([item(**{field: value})]))
    assert result.rows == () and len(result.skipped_rows) == 1
    assert "PRIVATE_MARKER" not in repr(result) + caplog.text
    assert "test@example.invalid" not in repr(result)


def test_unexpected_management_number_is_skipped_without_exposing_it():
    result = parse(document([item(fctryManageNo="test@example.invalid PRIVATE_MARKER")]))
    assert result.rows == () and result.skipped_rows[0].reason == "공장관리번호 형식 확인 필요"
    assert "PRIVATE_MARKER" not in repr(result)


def test_pagination_uses_raw_total_even_if_no_rows_match_selected_region():
    first = parse(document([item(rnAdres="전북 고창군 가상길 1")], size=1, total=2), page_size=1)
    assert first.rows == () and first.filtered_count == 1 and first.has_more
    second = parse(document(page=2, size=1, total=2), expected_page=2, page_size=1)
    assert len(second.rows) == 1 and not second.has_more


def test_skipped_row_number_is_absolute_across_pages():
    result = parse(
        document([item(cmpnyNm="")], page=2, size=1, total=2), expected_page=2, page_size=1
    )
    assert result.skipped_rows[0].row_no == 2


@pytest.mark.parametrize("no_items_node", [False, True])
def test_explicit_empty_success_is_distinct_from_errors(no_items_node):
    xml = document([])
    if no_items_node:
        xml = xml.replace(b"<items />", b"")
    result = parse(xml)
    assert result.rows == () and result.raw_count == result.total_count == 0
    assert not result.has_more


@pytest.mark.parametrize("encoding", ["utf-8", "utf-16"])
def test_declared_xml_encodings(encoding):
    root = ET.fromstring(document())
    assert parse(ET.tostring(root, encoding=encoding, xml_declaration=True)).raw_count == 1


@pytest.mark.parametrize("code", ["01", "02", "03", "11", "20", "22", "30"])
@pytest.mark.parametrize("gateway", [False, True])
def test_provider_errors_never_become_empty_success(code, gateway, caplog):
    xml = document(code=code)
    if gateway:
        xml = (
            "<OpenAPI_ServiceResponse><cmmMsgHeader><errMsg>PRIVATE_MESSAGE_MARKER</errMsg>"
            f"<returnReasonCode>{code}</returnReasonCode></cmmMsgHeader></OpenAPI_ServiceResponse>"
        )
    with pytest.raises(ComplexSourceError) as caught:
        parse(xml)
    assert caught.value.skipped_reason == ("DAILY_LIMIT" if code == "22" else "SOURCE_ERROR")
    assert caught.value.status == 503 and caught.value.kind is None
    assert "PRIVATE_MESSAGE_MARKER" not in str(caught.value.to_error_body()) + caplog.text


@pytest.mark.parametrize(
    "changes",
    [{"page": 2}, {"size": 10}, {"total": 0}, {"total": 2}, {"total": -1}, {"page": "x"}],
)
def test_wrong_page_or_incomplete_count_is_an_error(changes):
    with pytest.raises(ComplexSourceError):
        parse(document(**changes))


def test_empty_out_of_range_page_is_not_an_empty_success():
    with pytest.raises(ComplexSourceError):
        parse(document([], page=2, total=0), expected_page=2)


@pytest.mark.parametrize(
    "xml",
    [
        b"",
        b"not XML PRIVATE_MARKER",
        b"<response>",
        b"<html>PRIVATE_MARKER</html>",
        b"<response><header><resultCode>00</resultCode></header></response>",
        document().replace(b"<pageNo>1</pageNo>", b"<pageNo>1</pageNo><pageNo>1</pageNo>"),
        document().replace(b"<items>", b"<items><unexpected />"),
        document().replace(b"<totalCount>1</totalCount>", b"<totalCount />"),
        document().replace(b"<cmpnyNm>", b"<cmpnyNm><nested>PRIVATE_MARKER</nested>"),
        document().replace(b"<cmpnyNm>", b"<cmpnyNm>duplicate</cmpnyNm><cmpnyNm>"),
    ],
)
def test_malformed_or_ambiguous_xml_is_rejected_without_raw_text(xml, caplog):
    with pytest.raises(ComplexSourceError) as caught:
        parse(xml)
    assert "PRIVATE_MARKER" not in str(caught.value.to_error_body()) + caplog.text


@pytest.mark.parametrize("encoding", ["utf-8", "utf-16"])
def test_dtd_and_entities_are_rejected_before_expansion(encoding):
    xml = (
        f'<?xml version="1.0" encoding="{encoding}"?>'
        '<!DOCTYPE response [<!ENTITY secret "PRIVATE_MARKER">]><response>&secret;</response>'
    ).encode(encoding)
    with pytest.raises(ComplexSourceError):
        parse(xml)


@pytest.mark.parametrize("regions", [None, "충남", [], [None], [1], [""]])
def test_invalid_regions_are_caller_errors(regions):
    with pytest.raises(InputError):
        parse(document(), regions=regions)


@pytest.mark.parametrize(
    "changes",
    [
        {"expected_page": 0},
        {"expected_page": True},
        {"page_size": 0},
        {"page_size": 1001},
        {"page_size": True},
    ],
)
def test_invalid_pagination_is_a_caller_error(changes):
    with pytest.raises(InputError):
        parse(document(), **changes)


def test_non_xml_input_is_a_caller_error():
    with pytest.raises(InputError):
        parse(None)
