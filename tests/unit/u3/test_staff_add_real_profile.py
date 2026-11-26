"""#966: 실제 자료 묶음에서 이름으로 회사를 넣으면 공장 정보·자체 도금 표시까지 붙는다.

#948 시험은 가상 자료만 써서 공장 정보 옮기기 길을 지나지 않았다. 이 길에서 막 만든 회사의
자체 도금 표시가 비어 있어 넣기가 멈췄다(시험 서버 POST /companies 500).
실제 임시 SQLite만 쓴다. 회사·주소는 시험용으로 지어낸 값이다. 외부 호출 없음.
"""

from __future__ import annotations

import hashlib
from datetime import date

import pytest

from geosan.opportunity.factory_profile import ProfileIndex, apply_to_customer, company_key
from geosan.opportunity.models import Customer
from geosan.opportunity.queries import normalize_address
from geosan.opportunity.source_models import FactoryProfile, SourceFactoryRow
from geosan.opportunity.staff_add import add_company
from geosan.storage.base import new_id, utcnow
from geosan.storage.session import session_scope

KIND = "COMPANY_CONFIRMED"
NAME = "(주)시험도금공업"
ADDRESS = "경기도 화성시 시험로 7"


def _seed(*, codes: list[str]) -> None:
    with session_scope() as session:
        session.add(
            SourceFactoryRow(
                row_id="row-real",
                source_id="kicox-factory-csv",
                company_name=NAME,
                address=ADDRESS,
                region="경기",
                product="볼트 도금",
                product_hash=hashlib.sha256("볼트 도금".encode()).hexdigest(),
                file_date=date(2025, 12, 31),
                loaded_at=utcnow(),
                dataset_kind=KIND,
                is_virtual=False,
            )
        )
        session.add(
            FactoryProfile(
                profile_id=new_id("fprof"),
                source_id="factoryon-xlsx",
                file_date=date(2026, 11, 26),
                company_name=NAME,
                normalized_name=company_key(NAME),
                address=ADDRESS,
                normalized_address=normalize_address(ADDRESS) or "",
                region="경기",
                raw_materials="철강재",
                employee_count=8,
                industry_codes=codes,
                industry_name="도금업",
                scale="소기업",
                loaded_at=utcnow(),
                created_by="system",
                is_virtual=False,
            )
        )


@pytest.mark.parametrize(("codes", "suspected"), [(["25922"], True), (["25941"], False)])
def test_add_real_factory_row_copies_profile_and_plating_mark(tmp_db, codes, suspected):
    """Given 실제 자료 묶음의 공장 행 + 팩토리온 행 / When 이름으로 넣기
    Then 멈추지 않고 원자재·업종명이 붙고, 도금 업종번호면 자체 도금 표시가 켜진다."""
    _seed(codes=codes)
    with session_scope() as session:
        result = add_company(
            session,
            staff="park-lee",
            dataset_kind=KIND,
            row_id="row-real",
            surface_codes=["25922", "25923"],
        )
        customer = session.get(Customer, result.opportunity.customer_id)
        assert result.created is True
        assert customer.factory_raw_materials == "철강재"
        assert customer.factory_industry_name == "도금업"
        assert customer.own_plating_line_suspected is suspected
        assert customer.own_plating_line_source == ("INDUSTRY_CODE" if suspected else None)


def test_fresh_customer_with_empty_mark_counts_as_not_marked(tmp_db):
    """Given 아직 저장 전이라 자체 도금 표시가 빈 회사 / When 공장 정보 옮기기
    Then 빈 값을 '표시 없음'으로 세어 바뀐 수 +1을 돌려준다(예전에는 여기서 멈춤)."""
    _seed(codes=["25922"])
    with session_scope() as session:
        customer = Customer(name=NAME, address=ADDRESS)
        assert customer.own_plating_line_suspected is None
        attached, change = apply_to_customer(customer, ProfileIndex(session, [NAME]), ["25922"])
        assert (attached, change) == (True, 1)
