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


def customer_distances(session, customers, opp_ids, settings):
    """API 요청의 거리만 반환한다. 네이버 응답·거리·좌표를 어디에도 저장하지 않는다."""
    distances = {c.customer_id: distance(stored_point(c), settings) for c in customers}
    if (
        not settings.geocoding.enabled
        or not settings.geocoding.naver_fallback_enabled
        or settings.geosan.lat is None
    ):
        return distances
    pending = [
        (c.customer_id, c.address, opp_ids[c.customer_id])
        for c in customers
        if stored_point(c) is None
        and not c.is_virtual
        and c.security_grade == "PUBLIC"
        and parse_address(c.address) is not None
    ]
    if not pending:
        return distances
    # 접속 확인 쓰기는 요청 의존성에서 먼저 완료했다. 이 읽기 세션은 커밋하지 않는다.
    resolver = GeocodeResolver(
        location_index(settings.geocoding.location_csv_files), settings.geocoding
    )
    for customer_id, address, opp_id in pending:
        point = resolver.resolve(address, GeocodeClient(opp_id, address))
        if point and point.source in {"CSV", "JUSO"}:
            store_public_coordinate(customer_id, address, point)
        distances[customer_id] = distance(point, settings)
    return distances
