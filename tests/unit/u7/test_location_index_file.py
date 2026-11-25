"""#866: 위치 대조표를 메모리 대신 임시 SQLite 파일로 둔다(배포 서버 1GB 메모리 부족 해결).

가상 위치 CSV만 쓴다. 찾는 결과는 예전과 같아야 한다.
"""

import os

import pytest

from geosan.config.errors import InputError
from geosan.opportunity import location_csv
from geosan.opportunity.geocode_address import parse_address
from geosan.opportunity.location_csv import LocationIndex
from tests.unit.u7.test_geocoding import ADDRESS, csv_file


@pytest.fixture(autouse=True)
def own_temp_dir(tmp_path, monkeypatch):
    """대조표 파일을 이 시험의 임시 폴더에만 만든다."""
    folder = tmp_path / "cache"
    folder.mkdir()
    monkeypatch.setattr(location_csv.tempfile, "gettempdir", lambda: str(folder))
    return folder


def test_builds_one_file_and_reuses_it(tmp_path, own_temp_dir):
    path = csv_file(tmp_path)
    first = LocationIndex([str(path)]).lookup(parse_address(ADDRESS))
    files = list(own_temp_dir.glob("geosan-location-*.sqlite"))
    assert first is not None and first.source == "CSV" and len(files) == 1
    built_at = files[0].stat().st_mtime_ns
    again = LocationIndex([str(path)]).lookup(parse_address(ADDRESS))
    assert (again.lat, again.lng) == (first.lat, first.lng)
    assert files[0].stat().st_mtime_ns == built_at  # 다시 만들지 않음


def test_changed_csv_builds_a_new_file(tmp_path, own_temp_dir):
    path = csv_file(tmp_path)
    first = LocationIndex([str(path)]).lookup(parse_address(ADDRESS))
    csv_file(tmp_path, points=((1000500, 2000500),))
    stat = path.stat()
    os.utime(path, ns=(stat.st_atime_ns, stat.st_mtime_ns + 1_000_000_000))
    second = LocationIndex([str(path)]).lookup(parse_address(ADDRESS))
    assert (second.lat, second.lng) != (first.lat, first.lng)
    assert len(list(own_temp_dir.glob("geosan-location-*.sqlite"))) == 2


def test_two_different_points_for_one_address_give_no_answer(tmp_path):
    """같은 주소에 좌표가 둘이면 고르지 않는다(예전 규칙 그대로)."""
    path = csv_file(tmp_path, points=((1000000, 2000000), (1000900, 2000900)))
    assert LocationIndex([str(path)]).lookup(parse_address(ADDRESS)) is None


def test_bad_csv_leaves_no_half_built_file(tmp_path, own_temp_dir):
    bad = tmp_path / "bad.csv"
    bad.write_text("시도명,도로명\n충청남도,시험로\n", encoding="utf-8")
    with pytest.raises(InputError):
        LocationIndex([str(bad)])
    assert list(own_temp_dir.iterdir()) == []
