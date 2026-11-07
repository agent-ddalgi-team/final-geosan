"""#390 가상 XML·실제 임시 CSV를 읽는다. 외부 API·AI·DB 호출은 없다."""

from xml.etree import ElementTree as ET

from pytest_bdd import given, scenarios, then, when

from geosan.opportunity.complex_rows import (
    ComplexSourceError,
    combine_factory_rows,
    parse_complex_page,
)
from geosan.opportunity.factory_csv import read_factory_csv

scenarios("u3/complex_rows.feature")


def xml(rows, *, total=None, code="00"):
    root = ET.Element("response")
    header = ET.SubElement(root, "header")
    ET.SubElement(header, "resultCode").text = code
    ET.SubElement(header, "resultMsg").text = "PRIVATE_ERROR_MARKER"
    body = ET.SubElement(root, "body")
    items = ET.SubElement(body, "items")
    for name, address, number, product in rows:
        record = ET.SubElement(items, "item")
        for key, value in {
            "cmpnyNm": name,
            "rnAdres": address,
            "fctryManageNo": number,
            "mainProductCn": product,
            "irsttNm": "가상아산단지",
            "indutyNm": "제조업",
            "rprsntvNm": "PRIVATE_PERSON_MARKER",
            "cmpnyTelno": "PRIVATE_PHONE_MARKER",
            "cmpnyFxnum": "PRIVATE_FAX_MARKER",
            "hmpadr": "PRIVATE_HOME_MARKER",
        }.items():
            ET.SubElement(record, key).text = value
    for key, value in {
        "pageNo": 1,
        "numOfRows": 3,
        "totalCount": len(rows) if total is None else total,
    }.items():
        ET.SubElement(body, key).text = str(value)
    return ET.tostring(root, encoding="utf-8")


@given("기존 공장 하나가 들어 있는 가상 공장현황 파일이 있다", target_fixture="file_rows")
def factory_file(tmp_path):
    path = tmp_path / "factory.csv"
    path.write_text(
        "순번,회사명,단지명,생산품,공장주소\n"
        "1,가상볼트,가상아산단지,파일 볼트,충남 아산시 가상길 1\n",
        encoding="utf-8",
    )
    return read_factory_csv(path, regions=["충남"]).rows


@given(
    "기존 공장 새 공장 다른 지역 공장과 개인정보 표식이 섞인 가상 조회 응답이 있다",
    target_fixture="response",
)
def mixed_response():
    return xml(
        [
            ("가상볼트", "충남 아산시 가상길 1", "1", "조회 볼트"),
            ("가상너트", "충남 아산시 가상길 2", "2", "너트"),
            ("가상전북", "전북특별자치도 고창군 가상길 3", "3", "볼트"),
        ]
    )


@given(
    "첫 페이지에는 전북 공장만 있고 전체 건수는 다음 페이지까지 남은 응답이 있다",
    target_fixture="response",
)
def more_response():
    return xml(
        [("가상전북", "전북 고창군 가상길 1", str(index), "볼트") for index in range(3)], total=4
    )


@given("하루 호출 한도 오류와 개인정보 표식이 있는 가상 응답이 있다", target_fixture="response")
def limit_response():
    return xml([], code="22")


@given("두 공장이라고 적혔지만 한 공장만 들어 있는 가상 응답이 있다", target_fixture="response")
def incomplete_response():
    return xml([("가상볼트", "충남 아산시 가상길 1", "1", "볼트")], total=2)


@given("같은 공장관리번호에 생산품이 서로 다른 가상 응답이 있다", target_fixture="response")
def conflicting_response():
    return xml([("가상볼트", "충남 아산시 가상길 1", "1", product) for product in ("볼트", "너트")])


def read(response):
    return parse_complex_page(response, regions=["충남"], expected_page=1, page_size=3)


@when("충남 주소의 공개 칸만 읽어 파일과 합친다", target_fixture="outcome")
def combine(response, file_rows):
    return combine_factory_rows(file_rows, read(response).rows)


@when("충남 주소의 공개 칸만 읽는다", target_fixture="outcome")
def read_page(response):
    try:
        return read(response)
    except ComplexSourceError as error:
        return error


@when("충남 주소의 공개 칸만 읽어 파일 없이 합친다", target_fixture="outcome")
def combine_without_file(response):
    try:
        return combine_factory_rows([], read(response).rows)
    except ComplexSourceError as error:
        return error


@then("파일의 기존 생산품은 그대로이고 새 입주 공장 하나만 더해진다")
def combined(outcome):
    assert len(outcome.file_rows) == len(outcome.added_rows) == 1
    assert outcome.file_rows[0].product == "파일 볼트"
    assert outcome.added_rows[0].company_name == "가상너트" and outcome.duplicate_count == 1


@then("개인정보 표식과 다른 지역 공장은 결과에 없다")
def safe_public(outcome, caplog):
    assert "PRIVATE_" not in repr(outcome) + caplog.text
    assert "가상전북" not in repr(outcome)


@then("현재 공장 행은 비었지만 다음 페이지가 필요하다고 알린다")
def next_page(outcome):
    assert outcome.rows == () and outcome.has_more and outcome.raw_count == 3


@then("원문 없는 하루 한도 오류로 알린다")
def limited(outcome, caplog):
    assert isinstance(outcome, ComplexSourceError) and outcome.skipped_reason == "DAILY_LIMIT"
    assert "PRIVATE_" not in str(outcome.to_error_body()) + caplog.text


@then("조회 응답 오류로 알린다")
def source_error(outcome):
    assert isinstance(outcome, ComplexSourceError) and outcome.skipped_reason == "SOURCE_ERROR"
