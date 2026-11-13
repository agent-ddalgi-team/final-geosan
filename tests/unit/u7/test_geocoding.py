"""좌표 연결 순서·주소 혼동·네이버 비저장·실제 SQLite와 API 연결을 검사한다."""

import csv
from datetime import UTC, date, datetime, timedelta

import pytest
from sqlalchemy import select

from geosan.commands.geocode import run_geocode
from geosan.config.app_settings import GeocodingSettings, read_app_settings, sync_app_settings
from geosan.config.errors import AppError, InputError
from geosan.evidence.transfer import TransferLog
from geosan.opportunity.geo_math import straight_distance_km, utmk_to_lat_lng
from geosan.opportunity.geo_store import customer_distances, store_public_coordinate
from geosan.opportunity.geocode_address import parse_address, same_address
from geosan.opportunity.geocode_http import GeocodeClient, reserve_call
from geosan.opportunity.geocoding import GeocodeResolver
from geosan.opportunity.location_csv import GeoPoint, LocationIndex
from geosan.opportunity.models import Customer, Opportunity
from geosan.rules.codes import DatasetKind
from geosan.storage.session import session_scope

ADDRESS = "충청남도 천안시 서북구 성거읍 시험로 10"
LOT = "충청남도 천안시 서북구 성거읍 시험리 10"
FIELDS = [
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
]


def csv_file(tmp_path, points=((1000000, 2000000),)):
    path = tmp_path / "locations.csv"
    with path.open("w", encoding="utf-8-sig", newline="") as stream:
        writer = csv.DictWriter(stream, fieldnames=FIELDS)
        writer.writeheader()
        for x, y in points:
            writer.writerow(
                dict(
                    zip(
                        FIELDS,
                        [
                            "충청남도",
                            "천안시 서북구",
                            "성거읍",
                            "441333001000",
                            "시험로",
                            "0",
                            "10",
                            "0",
                            x,
                            y,
                        ],
                        strict=True,
                    )
                )
            )
    return path


def candidate():
    return dict(
        roadAddrPart1=ADDRESS,
        jibunAddr=LOT,
        admCd="4413325320",
        rnMgtSn="441333001000",
        udrtYn="0",
        buldMnnm="10",
        buldSlno="0",
        bdMgtSn="test-building",
    )


class FakeClient:
    def __init__(self, search=None, coordinates=None, naver=None):
        self.calls = []
        self.values = {
            "search": search or [],
            "coordinates": coordinates or [],
            "naver": naver or [],
        }

    def __getattr__(self, name):
        def call(value):
            self.calls.append(name)
            return self.values[name]

        return call


def resolver(paths=(), naver=False):
    return GeocodeResolver(
        LocationIndex(list(paths)), GeocodingSettings(enabled=True, naver_fallback_enabled=naver)
    )


def test_csv_hit_skips_every_external_provider(tmp_path):
    client = FakeClient()
    point = resolver([str(csv_file(tmp_path))]).resolve(ADDRESS, client)
    assert point.source == "CSV"
    assert point.lat == pytest.approx(38, abs=1e-7)
    assert point.lng == pytest.approx(127.5, abs=1e-7)
    assert client.calls == []


def test_address_search_converts_parcel_back_to_same_csv(tmp_path):
    client = FakeClient(search=[candidate()])
    point = resolver([str(csv_file(tmp_path))]).resolve(LOT, client)
    assert point.source == "CSV"
    assert client.calls == ["search"]


def test_coordinate_api_used_only_after_csv_missing_and_codes_match():
    row = candidate()
    client = FakeClient(search=[row], coordinates=[dict(row, entX="1000000", entY="2000000")])
    service = resolver()
    assert service.resolve(ADDRESS, client).source == "JUSO"
    assert service.resolve(ADDRESS, client).source == "JUSO"
    assert client.calls == ["search", "coordinates"]


@pytest.mark.parametrize(
    "change",
    [
        {"bdMgtSn": "different-building"},
        {"buldSlno": "1"},
        {"entX": ""},
        {"entX": "0"},
        {"entX": "NaN"},
        {"entY": "Infinity"},
    ],
)
def test_mismatched_building_or_invalid_position_is_not_confirmed(change):
    row = dict(candidate(), entX="1000000", entY="2000000")
    row.update(change)
    client = FakeClient(search=[candidate()], coordinates=[row])
    assert resolver().resolve(ADDRESS, client) is None


def test_naver_is_last_and_its_result_is_never_reused():
    client = FakeClient(search=[candidate()], naver=[dict(roadAddress=ADDRESS, x="127.5", y="38")])
    service = resolver(naver=True)
    assert service.resolve(ADDRESS, client).source == "NAVER"
    assert client.calls == ["search", "coordinates", "naver"]
    assert service.resolve(ADDRESS, client).source == "NAVER"
    assert client.calls.count("naver") == 2
    assert service.public_cache == {}


@pytest.mark.parametrize(
    "rows",
    [
        [dict(roadAddress=ADDRESS.replace("10", "11"), x="127.5", y="38")],
        [
            dict(roadAddress=ADDRESS, x="127.5", y="38"),
            dict(roadAddress=ADDRESS, x="127.6", y="38"),
        ],
        [dict(roadAddress=ADDRESS, x="0", y="0")],
    ],
)
def test_naver_other_address_multiple_positions_and_zero_are_unconfirmed(rows):
    client = FakeClient(naver=rows)
    assert resolver(naver=True).resolve(ADDRESS, client) is None


@pytest.mark.parametrize("tail", [" 담당 김시험 과장", " 010-1234-5678", " test@example.com"])
def test_contacts_and_person_headings_are_not_sent(tail):
    client = FakeClient()
    assert resolver(naver=True).resolve(ADDRESS + tail, client) is None
    assert client.calls == []


def test_address_suffix_is_not_transmitted_and_underground_is_distinct():
    parsed = parse_address(ADDRESS + ", 시험회사 3층")
    assert parsed.query == ADDRESS
    assert parse_address(ADDRESS.replace("시험로 10", "시험로10")).query == ADDRESS
    assert not same_address(parsed, parse_address(ADDRESS.replace("시험로 10", "시험로 지하 10")))
    assert parse_address("충청남도 천안시 서북구 산업단지 A블록") is None


def test_math_uses_projection_origin_and_known_great_circle_distance():
    assert utmk_to_lat_lng(1000000, 2000000) == pytest.approx((38, 127.5), abs=1e-7)
    assert straight_distance_km(0, 0, 0, 1) == pytest.approx(111.19508, abs=0.001)
    assert straight_distance_km(38, 127.5, 38, 127.5) == 0
    with pytest.raises(ValueError):
        straight_distance_km(float("nan"), 0, 0, 0)


@pytest.fixture
def public_company(tmp_db):
    with session_scope() as session:
        settings = read_app_settings(session)
        settings.active_dataset_kind = DatasetKind.BROCHURE
        settings.geocoding.enabled = True
        settings.geosan.lat, settings.geosan.lng = 38, 127.5
        sync_app_settings(session, settings)
        common = dict(dataset_kind="BROCHURE", is_virtual=False, created_by="test")
        session.add(
            Customer(
                customer_id="cust-geocode",
                name="시험공장",
                normalized_name="시험공장",
                address=ADDRESS,
                relation_status="UNCONFIRMED",
                security_grade="PUBLIC",
                **common,
            )
        )
        session.flush()
        session.add(
            Opportunity(
                opp_id="opp-geocode",
                customer_id="cust-geocode",
                item="시험부품",
                purpose="NEW_PROPOSAL",
                **common,
            )
        )
    return tmp_db


def test_naver_coordinates_cannot_enter_database(public_company):
    with pytest.raises(InputError):
        store_public_coordinate("cust-geocode", ADDRESS, GeoPoint(38, 127.5, "NAVER"))
    with session_scope() as session:
        customer = session.get(Customer, "cust-geocode")
        assert customer.lat is None and customer.geocode_source is None


def test_cli_writes_public_coordinates_then_reuses_without_api(public_company, tmp_path, capsys):
    with session_scope() as session:
        settings = read_app_settings(session)
        settings.geocoding.location_csv_files = [str(csv_file(tmp_path))]
        settings.geocoding.location_csv_base_date = date(2026, 10, 31)
        sync_app_settings(session, settings)
    assert run_geocode(True) == 0
    assert "공공좌표 저장 1곳" in capsys.readouterr().out
    assert run_geocode(True) == 0
    assert "기존 재사용 1곳" in capsys.readouterr().out
    with session_scope() as session:
        assert session.get(Customer, "cust-geocode").geocode_source == "CSV"
        assert session.scalars(select(TransferLog)).all() == []


def test_daily_limit_counts_failed_calls_and_resets_in_korea(public_company, monkeypatch):
    now = datetime(2026, 11, 13, 14, 59, tzinfo=UTC)
    monkeypatch.setattr("geosan.opportunity.geocode_http.utcnow", lambda: now)
    with session_scope() as session:
        settings = read_app_settings(session)
        settings.geocoding.daily_call_limit = 1
        sync_app_settings(session, settings)
    reserve_call("opp-geocode", ADDRESS, None)
    with pytest.raises(AppError) as error:
        reserve_call("opp-geocode", ADDRESS, None)
    assert error.value.kind == "GEOCODE_LIMIT"
    now += timedelta(minutes=1)
    reserve_call("opp-geocode", ADDRESS, None)
    with session_scope() as session:
        rows = session.scalars(select(TransferLog)).all()
        assert sum(r.call_count for r in rows) == 2
        assert any(r.decision == "REJECTED" for r in rows)


def test_transport_retry_is_once_and_each_call_is_recorded(public_company, monkeypatch):
    monkeypatch.setenv("JUSO_SEARCH_KEY", "test-only")
    calls = []

    def request(*args, **kwargs):
        calls.append(1)
        if len(calls) == 1:
            raise OSError("private-request-body")
        return dict(results=dict(common=dict(errorCode="0", totalCount="0"), juso=[]))

    monkeypatch.setattr("geosan.opportunity.geocode_http.request_json", request)
    assert GeocodeClient("opp-geocode", ADDRESS).search(ADDRESS) == []
    with session_scope() as session:
        rows = session.scalars(select(TransferLog).order_by(TransferLog.occurred_at)).all()
        assert len(rows) == 2
        assert {r.decision for r in rows} == {"FAILED", "SUCCESS"}
        assert all("private" not in (r.reject_reason or "") for r in rows)


def test_api_key_error_is_failed_not_empty_success(public_company, monkeypatch):
    monkeypatch.setenv("JUSO_SEARCH_KEY", "test-only")
    monkeypatch.setattr(
        "geosan.opportunity.geocode_http.request_json",
        lambda *a, **k: dict(results=dict(common=dict(errorCode="E0001", totalCount="0"), juso=[])),
    )
    with pytest.raises(AppError):
        GeocodeClient("opp-geocode", ADDRESS).search(ADDRESS)
    with session_scope() as session:
        rows = session.scalars(select(TransferLog)).all()
        assert len(rows) == 1 and rows[0].decision == "FAILED"


def test_missing_key_does_not_send_request(public_company, monkeypatch):
    monkeypatch.delenv("NCP_MAPS_KEY_ID", raising=False)
    monkeypatch.delenv("NCP_MAPS_KEY", raising=False)
    with pytest.raises(AppError) as error:
        GeocodeClient("opp-geocode", ADDRESS).naver(ADDRESS)
    assert error.value.kind == "GEOCODE_NOT_CONFIGURED"


def test_changed_address_cannot_save_stale_coordinate(public_company):
    with session_scope() as session:
        session.get(Customer, "cust-geocode").address = ADDRESS.replace("10", "20")
    with pytest.raises(InputError):
        store_public_coordinate("cust-geocode", ADDRESS, GeoPoint(38, 127.5, "CSV"))


def test_live_distance_uses_result_without_persisting_it(public_company, monkeypatch):
    with session_scope() as session:
        settings = read_app_settings(session)
        settings.geocoding.naver_fallback_enabled = True
        monkeypatch.setattr(GeocodeClient, "search", lambda *args: [])
        monkeypatch.setattr(GeocodeResolver, "live_naver", lambda *a: GeoPoint(38, 127.5, "NAVER"))
        customer = session.get(Customer, "cust-geocode")
        assert customer_distances(
            session, [customer], {"cust-geocode": "opp-geocode"}, settings
        ) == {"cust-geocode": 0.0}
    with session_scope() as session:
        customer = session.get(Customer, "cust-geocode")
        assert customer.lat is None and customer.lng is None and customer.geocode_source is None


def test_detail_http_has_real_stored_distance(public_company):
    from fastapi.testclient import TestClient

    from geosan.api.app import create_app

    store_public_coordinate("cust-geocode", ADDRESS, GeoPoint(38, 127.5, "CSV"))
    with TestClient(create_app()) as client:
        response = client.get("/api/v1/opportunities/opp-geocode")
    assert response.status_code == 200
    assert response.json()["data"]["header"]["distanceKm"] == 0.0


def test_csv_configuration_requires_date_and_naver_requires_enabled():
    from pydantic import ValidationError

    with pytest.raises(ValidationError):
        GeocodingSettings(location_csv_files=["x.csv"])
    with pytest.raises(ValidationError):
        GeocodingSettings(naver_fallback_enabled=True)


def test_coordinate_migration_preserves_existing_company(public_company):
    from alembic import command

    from geosan.storage.migrate import alembic_config, upgrade_to_head

    command.downgrade(alembic_config(public_company), "opp_009")
    assert upgrade_to_head(public_company) == ["rec_014"]
    with session_scope() as session:
        customer = session.get(Customer, "cust-geocode")
        assert customer.address == ADDRESS and customer.name == "시험공장"
        assert customer.relation_status == "UNCONFIRMED"
        assert customer.lat is None and customer.lng is None


@pytest.mark.parametrize("previous", ["opp_010", "rec_013"])
def test_merge_preserves_coordinates_and_record_cancellation_from_either_branch(tmp_path, previous):
    import sqlite3

    from alembic import command

    from geosan.storage.migrate import alembic_config, upgrade_to_head
    from tests.unit.u3.test_ingest_tables import _insert_filled

    db = tmp_path / "both-features.db"
    command.upgrade(alembic_config(db), previous)
    with sqlite3.connect(db) as connection:
        _insert_filled(connection, "opp_customer", customer_id="cust-both", name="가상 공장")
        _insert_filled(connection, "opp_opportunity", opp_id="opp-both", customer_id="cust-both")
        _insert_filled(
            connection, "rec_note", note_id="note-both", opp_id="opp-both", text="보존 메모"
        )
        if previous == "opp_010":
            connection.execute("UPDATE opp_customer SET lat=38, lng=127.5, geocode_source='CSV'")
        else:
            connection.execute(
                "UPDATE rec_note SET cancel_reason='잘못 입력', cancelled_by='tester'"
            )
        snapshots = {}
        for table in ["opp_customer", "opp_opportunity", "rec_note"]:
            columns = [row[1] for row in connection.execute(f"PRAGMA table_info({table})")]
            snapshots[table] = (columns, connection.execute(f"SELECT * FROM {table}").fetchall())
    assert upgrade_to_head(db) == ["rec_014"]
    assert upgrade_to_head(db) == ["rec_014"]
    with sqlite3.connect(db) as connection:
        for table, (columns, rows) in snapshots.items():
            selected = ",".join(columns)
            assert connection.execute(f"SELECT {selected} FROM {table}").fetchall() == rows
        assert connection.execute("SELECT lat,lng FROM opp_customer").fetchone() == (
            (38.0, 127.5) if previous == "opp_010" else (None, None)
        )
        assert connection.execute("SELECT cancel_reason FROM rec_note").fetchone() == (
            ("잘못 입력",) if previous == "rec_013" else (None,)
        )
        assert connection.execute("PRAGMA foreign_key_check").fetchall() == []


def test_cli_database_failure_does_not_print_coordinate_parameters(
    public_company, tmp_path, monkeypatch, capsys
):
    from sqlalchemy.exc import OperationalError

    with session_scope() as session:
        settings = read_app_settings(session)
        settings.geocoding.location_csv_files = [str(csv_file(tmp_path))]
        settings.geocoding.location_csv_base_date = date(2026, 10, 31)
        sync_app_settings(session, settings)

    def fail(*a, **k):
        raise OperationalError(
            "private coordinates", "private parameters", RuntimeError("private details")
        )

    monkeypatch.setattr("geosan.commands.geocode.store_public_coordinate", fail)
    assert run_geocode(True) == 2
    output = capsys.readouterr().out
    assert "private" not in output and "실패" in output


@pytest.mark.parametrize("protected", [False, True])
def test_live_naver_http_logs_without_locking_or_storing_result(
    public_company, monkeypatch, protected
):
    from fastapi.testclient import TestClient

    from geosan.api.access_session import COOKIE_NAME, token_fingerprint
    from geosan.api.app import create_app
    from geosan.api.models import AccessSession
    from geosan.storage.base import utcnow

    for key in ["JUSO_SEARCH_KEY", "NCP_MAPS_KEY_ID", "NCP_MAPS_KEY"]:
        monkeypatch.setenv(key, "test-only")

    def response(host, *args, **kwargs):
        if host == "business.juso.go.kr":
            return {"results": {"common": {"errorCode": "0", "totalCount": "0"}, "juso": []}}
        return {
            "status": "OK",
            "meta": {"totalCount": 1},
            "addresses": [{"roadAddress": ADDRESS, "x": "127.5", "y": "38"}],
        }

    monkeypatch.setattr("geosan.opportunity.geocode_http.request_json", response)
    token = "a" * 43
    with session_scope() as session:
        settings = read_app_settings(session)
        settings.geocoding.naver_fallback_enabled = True
        settings.access_protection.enabled = protected
        sync_app_settings(session, settings)
        if protected:
            session.add(
                AccessSession(
                    session_id=token_fingerprint(token),
                    expires_at=utcnow() + timedelta(hours=1),
                    last_seen_at=utcnow(),
                )
            )
    with TestClient(create_app()) as client:
        if protected:
            client.cookies.set(COOKIE_NAME, token)
        result = client.get("/api/v1/opportunities/opp-geocode")
    assert result.status_code == 200
    assert result.json()["data"]["header"]["distanceKm"] == 0.0
    with session_scope() as session:
        assert session.get(Customer, "cust-geocode").lat is None
        logs = session.scalars(select(TransferLog)).all()
        assert len(logs) == 2 and all(v.decision == "SUCCESS" for v in logs)
