"""#512: 회사명 조회의 제공처만 대체한다. 설정·한도 기록은 실제 DB다."""

from datetime import date
from xml.etree import ElementTree as ET

from geosan.opportunity import complex_source as transport
from geosan.opportunity.candidate_web_results import WebSearchCandidate
from geosan.opportunity.source_models import SourceContract
from geosan.storage.session import session_scope
from tests.fakes.web_candidate_search import prepare


def setup_registry(path, monkeypatch):
    prepare(path)
    monkeypatch.setenv("DATA_GO_KR_SERVICE_KEY", "synthetic")
    with session_scope() as session:
        session.add(
            SourceContract(
                source_id=transport.SOURCE_ID,
                source_name="가상 공장 조회",
                allowed_use="검사",
                allowed_storage="검사",
                confirmed_at=date(2026, 1, 1),
            )
        )


def candidate(**changes):
    return WebSearchCandidate(
        **{
            "company_name": "가상볼트",
            "address": "충남 아산시 가상로 1",
            "source_url": "https://bolt.example/products",
            "snippet": "볼트와 너트 생산",
            **changes,
        }
    )


def xml(rows=(), *, page=1, total=None, code="00", fields=None):
    root = ET.Element("response")
    header = ET.SubElement(root, "header")
    ET.SubElement(header, "resultCode").text = code
    ET.SubElement(header, "resultMsg").text = "PRIVATE_ERROR_MARKER"
    body = ET.SubElement(root, "body")
    items = ET.SubElement(body, "items")
    for name, address, number in rows:
        item = ET.SubElement(items, "item")
        for field, value in {
            "cmpnyNm": name,
            "rnAdres": address,
            "fctryManageNo": number,
            "mainProductCn": "볼트와 너트",
            "indutyNm": "금속가공 제조업",
            "rprsntvNm": "PRIVATE_PERSON_MARKER",
            "cmpnyFxnum": "PRIVATE_FAX_MARKER",
            "cmpnyTelno": "PRIVATE_PHONE_MARKER",
            "hmpadr": "PRIVATE_HOMEPAGE_MARKER",
            **(fields or {}),
        }.items():
            ET.SubElement(item, field).text = value
    for field, value in {
        "pageNo": page,
        "numOfRows": transport.PAGE_SIZE,
        "totalCount": len(rows) if total is None else total,
    }.items():
        ET.SubElement(body, field).text = str(value)
    return ET.tostring(root, encoding="utf-8")


MATCH = ("(주)가상볼트", "충남 아산시 가상로 1", "F1")


def responses(monkeypatch, *values):
    calls, remaining = [], iter(values)

    def request(name, key, page, *, company_lookup):
        assert company_lookup is True and key == "synthetic"
        calls.append((name, page))
        value = next(remaining)
        if isinstance(value, Exception):
            raise value
        return value

    monkeypatch.setattr(transport, "_request_page", request)
    return calls
