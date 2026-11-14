"""공공좌표의 저장 및 요청 안에서만 사용하는 거리 계산."""

from geosan.config.errors import InputError
from geosan.opportunity.geo_math import straight_distance_km
from geosan.opportunity.geocode_address import parse_address
from geosan.opportunity.geocode_http import GeocodeClient
from geosan.opportunity.geocoding import GeocodeResolver
from geosan.opportunity.location_csv import GeoPoint, location_index, valid_point
from geosan.opportunity.models import Customer
from geosan.storage.base import utcnow
from geosan.storage.session import session_scope


def store_public_coordinate(customer_id, expected_address, point, db_path=None):
    if point.source not in {"CSV", "JUSO"} or not valid_point(point.lat, point.lng):
        raise InputError("DB에는 유효한 공공자료 좌표만 저장할 수 있습니다.")
    with session_scope(db_path) as session:
        customer = session.get(Customer, customer_id)
        if not customer or customer.is_virtual or customer.security_grade != "PUBLIC":
            raise InputError("공개 자료의 실제 회사만 좌표를 저장할 수 있습니다.")
        if customer.address != expected_address:
            raise InputError("회사 주소가 바뀌어 좌표를 저장하지 않았습니다.")
        customer.lat, customer.lng = point.lat, point.lng
        customer.geocode_source = point.source
        customer.geocoded_at = utcnow()


def stored_point(customer):
    if customer.is_virtual or customer.security_grade != "PUBLIC":
        return None
    if customer.geocode_source not in {"CSV", "JUSO", "MANUAL"}:
        return None
    if not valid_point(customer.lat, customer.lng):
        return None
    return GeoPoint(customer.lat, customer.lng, customer.geocode_source)


def distance(point, settings):
    if not point or settings.geosan.lat is None or settings.geosan.lng is None:
        return None
    return round(
        straight_distance_km(settings.geosan.lat, settings.geosan.lng, point.lat, point.lng), 1
    )


def customer_points(session, customers, opp_ids, settings, *, live=True):
    """이번 요청의 좌표만 반환한다. 네이버 결과는 공용 캐시·DB·파일에 저장하지 않는다.

    `live=False`면 저장된 공공좌표만 쓰고 외부 조회를 하지 않는다. 목록·대시보드 지도는 이렇게
    부른다(#686, PM 결정 2026-11-13): 못 찾은 회사를 요청마다 다시 물어 느려지고 호출이 쌓였다.
    네이버 실시간 보완은 회사 한 곳의 자세히 보기에서만 한다.
    """
    customers = list({c.customer_id: c for c in customers}.values())
    points = {c.customer_id: stored_point(c) for c in customers}
    if (
        not live
        or not settings.geocoding.enabled
        or not settings.geocoding.naver_fallback_enabled
        or settings.geosan.lat is None
    ):
        return points
    pending = [
        (c.customer_id, c.address, opp_ids[c.customer_id])
        for c in customers
        if stored_point(c) is None
        and not c.is_virtual
        and c.security_grade == "PUBLIC"
        and parse_address(c.address) is not None
    ]
    if not pending:
        return points
    # 접속 확인 쓰기는 요청 의존성에서 먼저 완료했다. 이 읽기 세션은 커밋하지 않는다.
    resolver = GeocodeResolver(
        location_index(settings.geocoding.location_csv_files), settings.geocoding
    )
    for customer_id, address, opp_id in pending:
        point = resolver.resolve(address, GeocodeClient(opp_id, address))
        if point and point.source in {"CSV", "JUSO"}:
            store_public_coordinate(customer_id, address, point)
        points[customer_id] = point
    return points


def customer_distances(session, customers, opp_ids, settings, *, live=True):
    """카드·상세가 같은 좌표 처리로 직선거리만 읽는다. 목록은 `live=False`(#686)."""
    return {
        customer_id: distance(point, settings)
        for customer_id, point in customer_points(
            session, customers, opp_ids, settings, live=live
        ).items()
    }
