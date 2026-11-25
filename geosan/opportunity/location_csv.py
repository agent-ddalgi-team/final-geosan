"""내려받은 위치정보요약DB의 도로명·건물번호를 대조한다. 원본은 읽기만 한다.

#866: 64만 줄을 파이썬 사전으로 들고 있으면 약 490MB를 써서 배포 서버(1GB)가 후보 찾기 때
메모리 부족으로 꺼졌다. 같은 대조표를 임시 폴더의 SQLite 파일로 한 번 만들어 두고 찾을 때만 읽는다.
파일 이름에 원본 경로·수정 시각·크기의 지문을 넣어, 원본이 바뀌면 새로 만든다.
"""

import csv
import hashlib
import os
import sqlite3
import tempfile
from dataclasses import dataclass, field
from functools import lru_cache
from math import isfinite
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


_REQUIRED = {
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
_SCHEMA = (
    "CREATE TABLE loc (province TEXT, city TEXT, road TEXT, main INTEGER, sub INTEGER, "
    "under INTEGER, town TEXT, road_code TEXT, x REAL, y REAL)"
)
_KEY = "province = ? AND city = ? AND road = ? AND main = ? AND sub = ? AND under = ?"


def _rows(paths):
    """CSV 한 줄씩 대조표 행으로 바꾼다. 형식이 다르면 InputError(원본 내용은 오류에 넣지 않음)."""
    for name in paths:
        try:
            with Path(name).open(encoding="utf-8-sig", newline="") as stream:
                reader = csv.DictReader(stream)
                if not _REQUIRED.issubset(reader.fieldnames or []):
                    raise InputError("위치 CSV 제목 줄이 위치정보요약DB 형식과 다릅니다.")
                for row in reader:
                    try:
                        x, y = float(row["X좌표"]), float(row["Y좌표"])
                        ok = isfinite(x) and isfinite(y) and x > 0 and y > 0
                    except (ValueError, OverflowError):
                        ok = False
                    yield (
                        row["시도명"],
                        compact(row["시군구명"]),
                        compact(row["도로명"]),
                        int(row["건물본번"]),
                        int(row["건물부번"]),
                        int(row["지하여부"] == "1"),
                        compact(row["읍면동명"]),
                        row["도로명코드"],
                        x if ok else None,
                        y if ok else None,
                    )
        except (OSError, UnicodeError, ValueError, csv.Error):
            raise InputError(
                "위치 CSV를 읽지 못했습니다. 파일·문자 인코딩·건물번호를 확인해 주세요."
            ) from None


def _cache_path(paths) -> Path:
    try:
        signature = [
            (str(Path(name).resolve()), Path(name).stat().st_mtime_ns, Path(name).stat().st_size)
            for name in paths
        ]
    except OSError:
        raise InputError("위치 CSV 파일을 확인할 수 없습니다.") from None
    digest = hashlib.sha256(repr(signature).encode("utf-8")).hexdigest()[:20]
    return Path(tempfile.gettempdir()) / f"geosan-location-{digest}.sqlite"


def _build(paths, target: Path) -> None:
    """임시 이름으로 다 만든 뒤 바꿔 단다. 중간에 실패하면 반쯤 만든 파일을 남기지 않는다."""
    work = target.with_name(f"{target.name}.{os.getpid()}.building")
    work.unlink(missing_ok=True)
    try:
        with sqlite3.connect(work) as con:
            con.execute(_SCHEMA)
            batch = []
            for row in _rows(paths):
                batch.append(row)
                if len(batch) >= 5000:
                    con.executemany("INSERT INTO loc VALUES (?,?,?,?,?,?,?,?,?,?)", batch)
                    batch.clear()
            con.executemany("INSERT INTO loc VALUES (?,?,?,?,?,?,?,?,?,?)", batch)
            con.execute("CREATE INDEX loc_key ON loc (province, road, main, sub, under, city)")
        con.close()
        os.replace(work, target)
    except BaseException:
        work.unlink(missing_ok=True)
        raise


class LocationIndex:
    def __init__(self, paths: list[str]):
        self._path = _cache_path(paths)
        if not self._path.exists():
            _build(paths, self._path)

    def _query(self, sql: str, params: tuple) -> list[tuple]:
        con = sqlite3.connect(f"{self._path.as_uri()}?mode=ro", uri=True)
        try:
            return con.execute(sql, params).fetchall()
        except sqlite3.Error:
            raise InputError("위치 대조표를 읽지 못했습니다. 서버를 다시 켜 주세요.") from None
        finally:
            con.close()

    def lookup(self, address: Address, road_code: str | None = None) -> GeoPoint | None:
        if address.kind != "ROAD":
            return None
        province, city, road, main, sub, under = address.key
        key = (province, city, road, main, sub, int(under))
        options = self._query(f"SELECT town, road_code, x, y FROM loc WHERE {_KEY}", key)
        if not options and compact(address.city).endswith("시"):
            # 구가 붙은 시(예: 천안시서북구)는 시 이름으로 시작하는 시군구를 모두 본다.
            prefix = compact(address.city)
            options = [
                row[1:]
                for row in self._query(
                    "SELECT city, town, road_code, x, y FROM loc WHERE province = ? AND "
                    "road = ? AND main = ? AND sub = ? AND under = ?",
                    (province, road, main, sub, int(under)),
                )
                if row[0].startswith(prefix)
            ]
        options = [
            p
            for p in options
            if (not address.town or p[0] == address.town) and (not road_code or p[1] == road_code)
        ]
        points = {None if p[2] is None else (p[2], p[3]) for p in options}
        if None in points or len(points) != 1:
            return None
        try:
            lat, lng = utmk_to_lat_lng(*points.pop())
        except (ValueError, OverflowError):
            return None
        return GeoPoint(lat, lng, "CSV", address.query)
