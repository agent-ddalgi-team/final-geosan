"""#980 대표번호·대표명 채우기와 [고치기](PM 결정 2026-11-28).

팩토리온 전화번호(지역번호만)·공장등록 조회 대표자명으로 채우고, 담당자가 적거나 지운 값(MANUAL)은
자동으로 덮지 않는다. 실제 임시 DB·실제 API로 본다. 외부 호출 없음. 가상 자료만 쓴다.
"""

from datetime import date

import pytest
from sqlalchemy import select

from geosan.opportunity.complex_store import fill_representatives
from geosan.opportunity.factory_profile import (
    ProfileIndex,
    apply_to_customer,
    company_phone,
    read_factoryon,
    store_profiles,
)
from geosan.opportunity.models import Customer, DiscoveryPath, Opportunity
from geosan.opportunity.queries import store_company_research
from geosan.opportunity.source_models import SourceFactoryRow
from geosan.records.models import Note
from geosan.storage.base import utcnow
from geosan.storage.session import session_scope
from tests.unit.u3 import test_company_info_fix as fixing
from tests.unit.u3 import test_factory_profile as profiles
from tests.unit.u3 import test_staff_add_company as support

client = support.client
STAFF, VIEWER = support.STAFF, {"X-Staff-Key": "viewer"}
PREFIXES = ["02", "031", "041", "042", "044"]


@pytest.mark.parametrize(
    ("value", "expected"),
    [
        ("041-123-4567", "041-123-4567"),
        ("(041) 1234-5678", "041-1234-5678"),
        ("0215551234", "02-1555-1234"),
        ("031.555.1234", "031-555-1234"),
        ("010-1234-5678", None),  # 휴대폰은 버린다
        ("070-1234-5678", None),  # 설정 앞자리 밖
        ("041-12-345", None),  # 자리 수가 모자람
        ("", None),
    ],
)
def test_company_phone_keeps_only_area_code_numbers(value, expected):
    assert company_phone(value, PREFIXES) == expected


def test_factoryon_phone_column_is_read_only_with_prefixes(tmp_path):
    """Given 전화번호 칸이 있는 팩토리온 엑셀 / When 앞자리 설정을 주고 읽음
    Then 지역번호 번호만 남고, 휴대폰은 버리며, 설정이 없으면 읽지 않는다."""
    path = profiles.factoryon_file(
        tmp_path,
        [
            profiles.row(),
            profiles.row(**{"회사명": "가상둘", "전화번호": "010-9999-0000"}),
        ],
    )
    rows = read_factoryon([path], profiles.REGIONS, PREFIXES).rows
    assert [row.main_phone for row in rows] == ["041-000-0000", None]
    assert [row.main_phone for row in read_factoryon([path], profiles.REGIONS).rows] == [
        None,
        None,
    ]


def _customer(**values) -> Customer:
    base = dict(
        customer_id="cust-x",
        name="(주)가상볼트",
        normalized_name="가상볼트",
        address="충청남도 천안시 서북구 가상로 1",
        normalized_address="충청남도천안시서북구가상로1",
        relation_status="UNCONFIRMED",
        security_grade="PUBLIC",
        created_by="system",
        is_virtual=False,
    )
    return Customer(**(base | values))


@pytest.mark.parametrize(
    ("before", "expected"),
    [
        ({}, ("041-000-0000", "FACTORYON")),
        (
            {"main_phone": "041-111-1111", "main_phone_source": "FACTORYON"},
            ("041-000-0000", "FACTORYON"),
        ),
        (
            {"main_phone": "041-222-2222", "main_phone_source": "HOMEPAGE"},
            ("041-222-2222", "HOMEPAGE"),
        ),
        (
            {"main_phone": "041-333-3333", "main_phone_source": "MANUAL"},
            ("041-333-3333", "MANUAL"),
        ),
        ({"main_phone": None, "main_phone_source": "MANUAL"}, (None, "MANUAL")),  # 담당자가 지움
    ],
)
def test_profile_phone_fills_only_empty_or_factoryon_numbers(tmp_db, tmp_path, before, expected):
    profiles.confirm("factoryon-xlsx")
    path = profiles.factoryon_file(tmp_path, [profiles.row()])
    with session_scope() as session:
        store_profiles(session, read_factoryon([path], profiles.REGIONS, PREFIXES).rows)
        customer = _customer(main_phone_confirmed_by="park-lee", **before)
        apply_to_customer(customer, ProfileIndex(session), [])
        assert (customer.main_phone, customer.main_phone_source) == expected
        if before.get("main_phone_source") == "FACTORYON":
            # 번호가 바뀌었으니 전의 [맞음] 확인은 지운다.
            assert customer.main_phone_confirmed_by is None


def test_research_does_not_overwrite_a_number_the_staff_typed(tmp_db):
    """Given 담당자가 적은 대표번호(MANUAL) / When 홈페이지 조사가 다른 번호를 찾음
    Then 번호는 그대로다."""
    with session_scope() as session:
        customer = _customer(main_phone="041-333-3333", main_phone_source="MANUAL")
        session.add(customer)
        session.flush()
        expected = (
            customer.name,
            customer.address,
            customer.normalized_address,
            customer.homepage_url,
            customer.homepage_status,
            customer.homepage_fetched_at,
            customer.researched_at,
            customer.main_phone,
            customer.main_phone_confirmed_at,
        )
        store_company_research(
            session,
            customer.customer_id,
            expected=expected,
            line="가상 한 줄",
            highlights=[],
            phone="041-999-9999",
            phone_source_url="https://example.invalid",
        )
        assert (customer.main_phone, customer.main_phone_source) == ("041-333-3333", "MANUAL")


def test_staff_edits_phone_and_representative_without_values_in_history(client):
    """Given 직접 넣은 회사 / When 대표번호·대표명 [고치기] → 지우기
    Then MANUAL로 저장되고 확인 표시가 붙으며, 활동 이력에는 번호·이름 없이 한 줄씩 남는다."""
    opp_id = fixing.added(client)
    response = fixing.fix(
        client, opp_id, mainPhone="(041) 555-1234", representativeName=" 홍  길동 "
    )
    assert response.status_code == 200, response.text
    data = response.json()["data"]
    assert (data["mainPhone"], data["mainPhoneSource"]) == ("041-555-1234", "MANUAL")
    assert (data["representativeName"], data["representativeNameSource"]) == ("홍 길동", "MANUAL")
    customer = fixing.customer_of(opp_id)
    assert customer.main_phone_confirmed_by == "park-lee"
    header = client.get(f"/api/v1/opportunities/{opp_id}").json()["data"]["header"]
    assert header["representativeName"] == "홍 길동"
    assert header["representativeNameSource"] == "MANUAL"
    assert header["mainPhoneSource"] == "MANUAL"

    cleared = fixing.fix(client, opp_id, mainPhone="", representativeName="")
    assert cleared.status_code == 200, cleared.text
    customer = fixing.customer_of(opp_id)
    assert (customer.main_phone, customer.main_phone_source) == (None, "MANUAL")
    assert customer.main_phone_confirmed_at is None
    assert (customer.representative_name, customer.representative_name_source) == (None, "MANUAL")
    lines = fixing.notes(opp_id)
    assert lines[-2:] == ["대표번호 입력 / 대표명 입력", "대표번호 지움 / 대표명 지움"]
    assert not any("555" in line or "홍" in line for line in lines)


@pytest.mark.parametrize(
    ("body", "field", "message"),
    [
        ({"mainPhone": "010-1234-5678"}, "mainPhone", "휴대폰 번호는 [상대 담당자 연락처]에"),
        ({"mainPhone": "070-1234-5678"}, "mainPhone", "지역번호로 시작하는"),
        ({"mainPhone": "041-555-1234 내선"}, "mainPhone", "지역번호로 시작하는"),
        ({"representativeName": "홍길동 010"}, "representativeName", "숫자·@ 없이"),
        ({"representativeName": "가" * 21}, "representativeName", "숫자·@ 없이"),
    ],
)
def test_wrong_phone_or_name_is_rejected(client, body, field, message):
    opp_id = fixing.added(client)
    response = fixing.fix(client, opp_id, **body)
    assert response.status_code == 400, response.text
    error = response.json()["error"]
    assert error["fields"][0]["path"] == field
    assert message in error["message"]
    assert fixing.customer_of(opp_id).main_phone is None


def test_viewer_cannot_edit_phone(client):
    opp_id = fixing.added(client)
    response = fixing.fix(client, opp_id, staff=VIEWER, mainPhone="041-555-1234")
    assert response.status_code == 403


def test_registry_representative_fills_new_and_existing_companies(client):
    """Given 공장등록 조회 행에 대표자명 / When 그 행으로 회사를 넣고, 다른 회사는 다음 조회 때
    Then 새 회사는 REGISTRY로 채워지고, 이미 있던 회사는 빈 대표명만 채우며 MANUAL은 그대로다."""
    with session_scope() as session:
        session.add(
            support.factory_row(
                "row-api",
                "가상조회회사",
                "충남 아산시 가상로 5",
                source_id="kicox-production-api",
                file_date=None,
                fetched_at=utcnow(),
                representative_name="김대표",
            )
        )
    response = support.add(client, {"rowId": "row-api"})
    assert response.status_code == 200, response.text
    opp_id = response.json()["data"]["oppId"]
    customer = fixing.customer_of(opp_id)
    assert (customer.representative_name, customer.representative_name_source) == (
        "김대표",
        "REGISTRY",
    )
    # 이미 있던 두 회사: 하나는 비어 있고, 하나는 담당자가 적었다.
    empty_id, manual_id = fixing.added(client, "가상빈회사"), fixing.added(client, "가상손회사")
    assert fixing.fix(client, manual_id, representativeName="박손님").status_code == 200
    with session_scope() as session:
        for opp, row_id, name in [(empty_id, "row-e", "이조회"), (manual_id, "row-m", "최조회")]:
            session.add(
                support.factory_row(
                    row_id,
                    "가상",
                    "충남 아산시 가상로 6",
                    source_id="kicox-production-api",
                    file_date=None,
                    representative_name=name,
                )
            )
            session.add(
                DiscoveryPath(
                    path_id=f"path-{row_id}",
                    opp_id=opp,
                    path_kind="PROCESS_DEMAND",
                    source_id="kicox-production-api",
                    origin_key=row_id,
                    discovered_at=date(2026, 11, 28),
                    created_by="system",
                    **support.COMMON,
                )
            )
    with session_scope() as session:
        assert fill_representatives(session, True) == 1
    assert fixing.customer_of(empty_id).representative_name == "이조회"
    manual = fixing.customer_of(manual_id)
    assert (manual.representative_name, manual.representative_name_source) == ("박손님", "MANUAL")


def test_lookup_response_has_no_representative_name(client):
    """이름 찾기(#948) 응답에는 대표자명을 싣지 않는다."""
    with session_scope() as session:
        row = session.get(SourceFactoryRow, "row-a")
        row.representative_name = "숨은대표"
    body = client.get(support.LOOKUP, params={"name": "가상진행금속"}).text
    assert "숨은대표" not in body


def test_history_lines_are_program_notes(client):
    opp_id = fixing.added(client)
    assert fixing.fix(client, opp_id, mainPhone="041-555-1234").status_code == 200
    with session_scope() as session:
        kinds = session.scalars(select(Note.kind).where(Note.opp_id == opp_id)).all()
        opportunity = session.get(Opportunity, opp_id)
        assert opportunity is not None
    assert "CHANGE" in kinds
