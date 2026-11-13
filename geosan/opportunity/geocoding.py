"""#222: 위치 CSV → 주소검색·같은 CSV → 좌표제공 → 네이버 실시간 보완."""

from geosan.config.errors import InputError
from geosan.opportunity.geo_math import utmk_to_lat_lng
from geosan.opportunity.geocode_address import matches_juso, parse_address, same_address
from geosan.opportunity.location_csv import GeoPoint, LocationIndex, valid_point

CODES = ("admCd", "rnMgtSn", "udrtYn", "buldMnnm", "buldSlno")


class GeocodeResolver:
    """한 실행의 공공 조회 결과만 다시 쓴다. 네이버 결과는 캐시에 넣지 않는다."""

    def __init__(self, index: LocationIndex, settings):
        self.index = index
        self.settings = settings
        self.public_cache = {}
        self.search_cache = {}
        self.coordinate_cache = {}

    def resolve(self, address, client):
        target = parse_address(address)
        if target is None:
            return None
        key = target.query
        if key in self.public_cache:
            return self.public_cache[key]
        point = self.index.lookup(target)
        if point:
            self.public_cache[key] = point
            return point
        if not self.settings.enabled:
            return None
        if key not in self.search_cache:
            self.search_cache[key] = client.search(key)
        candidates = [r for r in self.search_cache[key] if matches_juso(target, r)]
        roads = {p.key for r in candidates if (p := parse_address(r.get("roadAddrPart1")))}
        if len(roads) == 1:
            for row in candidates:
                road = parse_address(row.get("roadAddrPart1"))
                point = self.index.lookup(road, row.get("rnMgtSn")) if road else None
                if point:
                    self.public_cache[key] = point
                    return point
            point = self._coordinates(candidates, client, target.query)
            if point:
                self.public_cache[key] = point
                return point
        if self.settings.naver_fallback_enabled:
            return self.live_naver(address, client)
        return None

    def _coordinates(self, candidates, client, address):
        expected = {}
        for row in candidates:
            try:
                key = tuple(str(row[f]) for f in CODES)
                if any(not value.isdigit() for value in key):
                    raise ValueError
                expected.setdefault(key, set()).add(row["bdMgtSn"])
            except (KeyError, ValueError):
                raise InputError("행안부 주소 응답의 건물 코드를 확인하지 못했습니다.") from None
        points = set()
        for key, building_ids in expected.items():
            if key not in self.coordinate_cache:
                self.coordinate_cache[key] = client.coordinates(dict(zip(CODES, key, strict=True)))
            rows = self.coordinate_cache[key]
            accepted = []
            for row in rows:
                if (
                    tuple(str(row.get(f)) for f in CODES) != key
                    or row.get("bdMgtSn") not in building_ids
                ):
                    continue
                try:
                    x, y = float(row["entX"]), float(row["entY"])
                    if x <= 0 or y <= 0:
                        return None
                    accepted.append(utmk_to_lat_lng(x, y))
                except (ValueError, TypeError, KeyError, OverflowError):
                    return None
            if not accepted:
                return None
            points.update(accepted)
        if len(points) != 1:
            return None
        return GeoPoint(*points.pop(), "JUSO", address)

    def live_naver(self, address, client):
        """반환값은 이번 호출의 거리·지도 표시에만 쓰고 저장하지 않는다."""
        target = parse_address(address)
        if target is None:
            return None
        accepted = set()
        for row in client.naver(target.query):
            choices = [parse_address(row.get(key)) for key in ["roadAddress", "jibunAddress"]]
            if not any(other and same_address(target, other) for other in choices):
                continue
            try:
                lat, lng = float(row["y"]), float(row["x"])
            except (TypeError, ValueError, KeyError):
                continue
            if valid_point(lat, lng) and lat != 0 and lng != 0:
                accepted.add((lat, lng))
        if len(accepted) != 1:
            return None
        return GeoPoint(*accepted.pop(), "NAVER", target.query)
