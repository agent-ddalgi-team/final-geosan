"""#948 이름으로 회사 넣기: 실제 임시 DB와 API로 찾기·넣기·관심·목록 표시를 확인한다.

가상 자료만 쓴다(거산 실제 사양 아님). 외부 호출은 없다(가상 묶음이라 자동 조사도 돌지 않는다).
"""

import hashlib
from datetime import date

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select

from geosan.api.app import create_app
from geosan.opportunity.models import (
    Customer,
    IngestBatch,
    MergeCandidate,
    Opportunity,
)
from geosan.opportunity.queries import normalize_address, normalize_name
from geosan.opportunity.source_models import SourceFactoryRow
from geosan.records.models import Bookmark, ReviewOpinion
from geosan.storage.base import utcnow
from geosan.storage.session import session_scope

COMMON = {"dataset_kind": "VIRTUAL_REVIEWED", "is_virtual": True}
STAFF = {"X-Staff-Key": "park-lee"}
LOOKUP = "/api/v1/companies/lookup"
ADD = "/api/v1/companies"


def factory_row(row_id, name, address, product="볼트", **changes):
    values = dict(
        row_id=row_id,
        source_id="kicox-factory-csv",
        company_name=name,
        address=address,
        region="충남",
        product=product,
        product_hash=hashlib.sha256(product.encode()).hexdigest(),
        file_date=date(2025, 12, 31),
        loaded_at=utcnow(),
        **COMMON,
    )
    return SourceFactoryRow(**(values | changes))


@pytest.fixture
def client(tmp_db):
    with session_scope() as session:
        session.add(factory_row("row-a", "(주)가상진행금속", "충남 천안시 가상로 1"))
        session.add(factory_row("row-b", "가상진행금속 2공장", "충남 아산시 가상로 2"))
        session.add(
            factory_row(
                "row-gone",
                "가상진행금속 옛공장",
                "충남 당진시 옛길 3",
                missing_since=date(2026, 1, 1),
            )
        )
        session.add(factory_row("row-c", "다른회사", "충남 서산시 길 4"))
    with TestClient(create_app()) as test_client:
        yield test_client


def rows(model):
    with session_scope() as session:
        return list(session.scalars(select(model)))


def add(client, body, headers=STAFF):
    return client.post(ADD, json=body, headers=headers)


def listed_bookmarks(client):
    response = client.get("/api/v1/opportunities", params={"bookmarked": "true"})
    assert response.status_code == 200, response.text
    return response.json()


def test_lookup_finds_factory_rows_by_part_of_the_name(client):
    """Given 공장 자료 / When "진행금속"으로 찾기 / Then 이름이 든 행만, 정확히 같은 이름 먼저."""
    response = client.get(LOOKUP, params={"name": " 가상진행금속 "})
    assert response.status_code == 200, response.text
    data = response.json()["data"]
    assert [item["rowId"] for item in data["factories"]] == ["row-a", "row-b"]
    first = data["factories"][0]
    assert first["companyName"] == "(주)가상진행금속" and first["oppId"] is None
    assert first["product"] == "볼트" and first["region"] == "충남"
    assert data["existing"] == [] and data["truncated"] is False


@pytest.mark.parametrize("name", ["", " ", "가", "가" * 51])
def test_lookup_rejects_too_short_or_too_long_names(client, name):
    response = client.get(LOOKUP, params={"name": name})
    assert response.status_code == 400


def test_add_from_factory_row_creates_bookmarked_company_in_the_list(client):
    """Given 공장 자료 한 행 / When [관심 기업으로 넣기] / Then 관심 기업 목록·상세에 보인다."""
    response = add(client, {"rowId": "row-a"})
    assert response.status_code == 200, response.text
    data = response.json()["data"]
    assert data["created"] is True and data["researchQueued"] is False  # 가상 회사는 조사 안 함
    (customer,) = rows(Customer)
    assert customer.name == "(주)가상진행금속" and customer.address == "충남 천안시 가상로 1"
    assert customer.discovery_source == "STAFF_ADDED"
    assert customer.relation_status == "UNCONFIRMED" and customer.security_grade == "PUBLIC"
    assert customer.fit_level is None and customer.pick_reason is None
    assert customer.homepage_url is None
    (batch,) = rows(IngestBatch)
    assert customer.ingest_batch_id == batch.batch_id
    assert (batch.source_id, batch.status, batch.new_count) == ("STAFF_ADDED", "DONE", 1)
    (opportunity,) = rows(Opportunity)
    assert opportunity.item == "볼트" and opportunity.purpose == "NEW_PROPOSAL"
    (bookmark,) = rows(Bookmark)
    assert bookmark.active and bookmark.source == "MANUAL" and bookmark.staff_key == "park-lee"
    body = listed_bookmarks(client)
    assert [card["oppId"] for card in body["data"]] == [opportunity.opp_id]
    assert body["data"][0]["discoverySource"] == "STAFF_ADDED"
    # 담당자가 넣은 회차는 목록 머리의 "지난 새 후보 찾기" 요약이 아니다.
    assert body["meta"]["latestIngest"] is None
    detail = client.get(f"/api/v1/opportunities/{opportunity.opp_id}")
    assert detail.status_code == 200, detail.text
    # 다시 찾으면 이미 넣은 회사로 안내한다.
    found = client.get(LOOKUP, params={"name": "가상진행금속"}).json()["data"]
    assert found["existing"] == [
        {
            "oppId": opportunity.opp_id,
            "companyName": "(주)가상진행금속",
            "address": "충남 천안시 가상로 1",
            "bookmarked": True,
        }
    ]
    assert found["factories"][0]["oppId"] == opportunity.opp_id


def test_add_by_name_only_keeps_the_homepage_the_staff_gave(client):
    """Given 공장 자료에 없는 회사 / When 이름·홈페이지만 넣기 / Then 담당자 확인 홈페이지."""
    response = add(client, {"companyName": "가상거래처", "homepageUrl": " https://example.com/ "})
    assert response.status_code == 200, response.text
    (customer,) = rows(Customer)
    assert customer.address is None and customer.normalized_address is None
    assert customer.homepage_url == "https://example.com/"
    assert (customer.homepage_status, customer.homepage_source) == ("CONFIRMED", "STAFF")
    (opportunity,) = rows(Opportunity)
    assert opportunity.item == "생산품 확인 전"


@pytest.mark.parametrize(
    "body",
    [
        {"companyName": "가상거래처 010-1234-5678"},
        {"companyName": "가상거래처", "address": "충남 천안시 sales@example.com"},
        {"companyName": "가상거래처", "homepageUrl": "ftp://example.com"},
        {"companyName": " "},
        {},
        {"rowId": "row-a", "companyName": "다른 이름"},
    ],
)
def test_bad_input_saves_nothing(client, body):
    response = add(client, body)
    assert response.status_code == 400, response.text
    assert not rows(Customer) and not rows(IngestBatch) and not rows(Bookmark)


def test_unknown_or_dropped_factory_row_is_not_found(client):
    assert add(client, {"rowId": "row-none"}).status_code == 404
    assert add(client, {"rowId": "row-gone"}).status_code == 404
    assert not rows(Customer)


def test_viewer_cannot_add(client):
    response = add(client, {"rowId": "row-a"}, headers={"X-Staff-Key": "viewer"})
    assert response.status_code == 403
    assert not rows(Customer)


def existing_customer(name, address):
    with session_scope() as session:
        customer = Customer(
            customer_id="cust-old",
            name=name,
            normalized_name=normalize_name(name),
            address=address,
            normalized_address=normalize_address(address),
            relation_status="EXISTING_CONFIRMED",
            security_grade="PUBLIC",
            discovery_source="CASE_FILE",
            **COMMON,
        )
        session.add(customer)
        session.flush()
        session.add(
            Opportunity(
                opp_id="opp-old",
                customer_id="cust-old",
                item="기존 품목",
                purpose="NEW_PROPOSAL",
                **COMMON,
            )
        )


def test_same_company_is_not_created_twice_and_gets_bookmarked(client):
    """Given 이름·주소가 같은 회사가 이미 있음 / Then 새로 만들지 않고 그 회사의 관심을 켠다."""
    existing_customer("가상진행금속", "충남  천안시 가상로 1")
    response = add(client, {"rowId": "row-a"})
    assert response.status_code == 200, response.text
    assert response.json()["data"] | {"researchQueued": None} == {
        "oppId": "opp-old",
        "created": False,
        "researchQueued": None,
    }
    assert [c.customer_id for c in rows(Customer)] == ["cust-old"] and not rows(IngestBatch)
    (bookmark,) = rows(Bookmark)
    assert bookmark.opp_id == "opp-old" and bookmark.active
    # 이름만으로 넣어도 같은 이름이 있으면 그 회사로 간다. 관심이 이미 켜져 있으면 새 행이 없다.
    again = add(client, {"companyName": "(주) 가상진행금속"})
    assert again.json()["data"]["oppId"] == "opp-old" and len(rows(Bookmark)) == 1


def test_same_name_at_another_address_is_added_with_a_check_pair(client):
    existing_customer("가상진행금속", "충남 공주시 다른길 9")
    response = add(client, {"rowId": "row-a"})
    assert response.json()["data"]["created"] is True
    (pair,) = rows(MergeCandidate)
    assert pair.customer_id_a == "cust-old" and pair.status == "PENDING"
    assert pair.match_basis == "회사명은 같고 공장주소가 달라 확인 필요"


def test_excluded_company_is_not_bookmarked_again(client):
    existing_customer("가상진행금속", "충남 천안시 가상로 1")
    with session_scope() as session:
        session.add(
            ReviewOpinion(
                opinion_id="opinion-1",
                opp_id="opp-old",
                eval_id="eval-old",
                opinion="NOT_TARGET",
                staff_name="park-lee",
                recorded_at=utcnow(),
                version=1,
                **COMMON,
            )
        )
    response = add(client, {"rowId": "row-a"})
    assert response.status_code == 422
    assert response.json()["error"]["kind"] == "BOOKMARK_EXCLUDED"
    assert not rows(Bookmark)
