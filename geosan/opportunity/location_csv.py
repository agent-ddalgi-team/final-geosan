"""내려받은 위치정보요약DB의 도로명·건물번호를 대조한다. 원본은 읽기만 한다."""

import csv
from collections import defaultdict
from dataclasses import dataclass, field
from functools import lru_cache
from pathlib import Path

from geosan.config.errors import InputError
from geosan.opportunity.geo_math import utmk_to_lat_lng
from geosan.opportunity.geocode_address import Address, compact


@lru_cache(maxsize=1)
def _cached_index(signatures):
    return LocationIndex([name for name, _mtime, _size in signatures])


def location_index(paths):
    """공공 CSV 색인만 재사용한다. 파일 변경은 다음 요청에서 다시 읽는다."""
    try:
        signatures = tuple(
            (str(Path(name).resolve()), Path(name).stat().st_mtime_ns, Path(name).stat().st_size)
            for name in paths
        )
    except OSError:
        raise InputError("위치 CSV 파일을 확인할 수 없습니다.") from None
    return _cached_index(signatures)


@dataclass(frozen=True, repr=False)
class GeoPoint:
    lat: float
    lng: float
    source: str
    matched_address: str = field(repr=False, default="")


def valid_point(lat, lng) -> bool:
    from math import isfinite

    return (
        all(
            isinstance(v, (int, float)) and not isinstance(v, bool) and isfinite(v)
            for v in [lat, lng]
        )
        and -90 <= lat <= 90
        and -180 <= lng <= 180
    )


class LocationIndex:
    def __init__(self, paths: list[str]):
        self.rows = defaultdict(list)
        required = {
            "시도명",
            "시군구명",
            "읍면동명",
            "도로명코드",
            "도로명",
            "지하여부",
            "건물본번",
            "건물부번",
            "X좌표",
            "Y좌표",
        }
        for name in paths:
            try:
                with Path(name).open(encoding="utf-8-sig", newline="") as stream:
                    reader = csv.DictReader(stream)
                    if not required.issubset(reader.fieldnames or []):
                        raise InputError("위치 CSV 제목 줄이 위치정보요약DB 형식과 다릅니다.")
                    for row in reader:
                        key = (
                            row["시도명"],
                            compact(row["시군구명"]),
                            compact(row["도로명"]),
                            int(row["건물본번"]),
                            int(row["건물부번"]),
                            row["지하여부"] == "1",
                        )
                        try:
                            x, y = float(row["X좌표"]), float(row["Y좌표"])
                            point = utmk_to_lat_lng(x, y) if x > 0 and y > 0 else None
                        except (ValueError, OverflowError):
                            point = None
                        self.rows[key].append((compact(row["읍면동명"]), row["도로명코드"], point))
            except (OSError, UnicodeError, ValueError, csv.Error):
                raise InputError(
                    "위치 CSV를 읽지 못했습니다. 파일·문자 인코딩·건물번호를 확인해 주세요."
                ) from None

    def lookup(self, address: Address, road_code: str | None = None) -> GeoPoint | None:
        if address.kind != "ROAD":
            return None
        options = self.rows.get(address.key, [])
        if not options and compact(address.city).endswith("시"):
            options = [
                v
                for key, values in self.rows.items()
                if key[0] == address.province
                and key[1].startswith(compact(address.city))
                and key[2:] == address.key[2:]
                for v in values
            ]
        options = [
            p
            for p in options
            if (not address.town or p[0] == address.town) and (not road_code or p[1] == road_code)
        ]
        points = {p[2] for p in options}
        if None in points or len(points) != 1:
            return None
        lat, lng = points.pop()
        return GeoPoint(lat, lng, "CSV", address.query)
