"""주소 전용 외부 조회. 고정 호스트만 호출하고 요청·응답 본문과 키는 기록하지 않는다."""

import http.client
import json
import os
import ssl
from datetime import UTC, timedelta
from decimal import Decimal
from pathlib import Path
from urllib.parse import urlencode

import certifi
from sqlalchemy import func, select

from geosan.config.app_settings import read_app_settings
from geosan.config.errors import AppError, InputError
from geosan.evidence.transfer import KST, TransferLog
from geosan.opportunity.geocode_address import parse_address, same_address
from geosan.opportunity.models import Customer, Opportunity
from geosan.storage.base import new_id, utcnow
from geosan.storage.session import session_scope

TIMEOUT_SECONDS = 10  # 계약 C9의 외부 읽기 시간 제한
MAX_RESPONSE_BYTES = 1024 * 1024


def geocode_error(kind="GEOCODE_FAILED"):
    return AppError(
        "좌표 조회를 완료하지 못했습니다.",
        "운영 담당자가 좌표 API 상태를 확인한 뒤 다시 실행해 주세요.",
        status=503,
        kind=kind,
    )


class HttpFailure(Exception):
    def __init__(self, status):
        self.status = status


def request_json(host, path, *, method, body=None, headers=None):
    """다른 주소로의 이동을 따라가지 않아 키가 다른 호스트에 전송되지 않는다."""
    connection = http.client.HTTPSConnection(
        host, timeout=TIMEOUT_SECONDS, context=ssl.create_default_context(cafile=certifi.where())
    )
    try:
        connection.request(method, path, body=body, headers=headers or {})
        response = connection.getresponse()
        if response.status != 200:
            raise HttpFailure(response.status)
        raw = response.read(MAX_RESPONSE_BYTES + 1)
        if len(raw) > MAX_RESPONSE_BYTES:
            raise ValueError("Response too large")
        data = json.loads(raw.decode("utf-8"))
        if not isinstance(data, dict):
            raise ValueError("Unexpected response shape")
        return data
    finally:
        connection.close()


def reserve_call(opp_id: str, expected_address: str, db_path: Path | str | None, *, naver=False):
    error = None
    with session_scope(db_path) as session:
        session.connection().exec_driver_sql("BEGIN IMMEDIATE")
        opportunity = session.get(Opportunity, opp_id)
        customer = session.get(Customer, opportunity.customer_id) if opportunity else None
        settings = read_app_settings(session)
        if not settings or not settings.geocoding.enabled:
            raise InputError("좌표 외부 조회 설정이 꺼져 있습니다.")
        if naver and not settings.geocoding.naver_fallback_enabled:
            raise InputError("네이버 실시간 좌표 보완 설정이 꺼져 있습니다.")
        if not customer or customer.is_virtual or customer.security_grade != "PUBLIC":
            raise InputError("공개 자료의 실제 회사 주소만 조회할 수 있습니다.")
        if customer.address != expected_address:
            raise InputError("회사 주소가 바뀌어 좌표 조회를 중단했습니다.")
        if parse_address(customer.address) is None:
            raise InputError("공개 주소의 구성 요소를 확인하지 못해 조회하지 않았습니다.")
        now = utcnow()
        start = now.astimezone(KST).replace(hour=0, minute=0, second=0, microsecond=0)
        count = session.scalar(
            select(func.coalesce(func.sum(TransferLog.call_count), 0)).where(
                TransferLog.purpose == "EXTERNAL_GEOCODE",
                TransferLog.occurred_at >= start.astimezone(UTC),
                TransferLog.occurred_at < (start + timedelta(days=1)).astimezone(UTC),
            )
        )
        rejected = count >= settings.geocoding.daily_call_limit
        log_id = new_id("transfer")
        session.add(
            TransferLog(
                transfer_log_id=log_id,
                occurred_at=now,
                opp_id=opp_id,
                purpose="EXTERNAL_GEOCODE",
                kind="GEOCODE",
                mode="NONE",
                security_grade="PUBLIC",
                decision="REJECTED" if rejected else "ALLOW",
                reject_reason="DAILY_LIMIT" if rejected else None,
                call_count=0 if rejected else 1,
                requested_by="SYSTEM",
                cost_usd=Decimal(0),
                created_by="SYSTEM",
                dataset_kind=customer.dataset_kind,
                is_virtual=False,
            )
        )
        if rejected:
            error = AppError(
                "오늘 좌표 변환 한도를 초과했습니다.",
                "다음 날 다시 조회해 주세요.",
                status=503,
                kind="GEOCODE_LIMIT",
            )
    if error:
        raise error
    return log_id


def finish_call(log_id, db_path, success):
    with session_scope(db_path) as session:
        row = session.get(TransferLog, log_id)
        if row is None:
            raise InputError("좌표 조회 전송 기록을 찾을 수 없습니다.")
        row.decision = "SUCCESS" if success else "FAILED"
        row.reject_reason = None if success else "GEOCODE_FAILED"


class GeocodeClient:
    def __init__(self, opp_id, expected_address, db_path=None):
        self.opp_id = opp_id
        self.expected_address = expected_address
        self.db_path = db_path

    def _request(self, host, path, method, body, headers, validate):
        for attempt in range(2):  # C9: 외부 읽기만 1회 재시도
            log_id = reserve_call(
                self.opp_id,
                self.expected_address,
                self.db_path,
                naver=host == "maps.apigw.ntruss.com",
            )
            try:
                result = validate(
                    request_json(host, path, method=method, body=body, headers=headers)
                )
            except (OSError, http.client.HTTPException, HttpFailure) as error:
                finish_call(log_id, self.db_path, False)
                retryable = not isinstance(error, HttpFailure) or error.status >= 500
                if attempt == 0 and retryable:
                    continue
                raise geocode_error() from None
            except (ValueError, UnicodeError, KeyError, TypeError, AppError):
                finish_call(log_id, self.db_path, False)
                raise geocode_error() from None
            finish_call(log_id, self.db_path, True)
            return result
        raise geocode_error()

    def _juso(self, endpoint, fields, key_name):
        key = os.environ.get(key_name, "").strip()
        if not key:
            raise AppError(
                "행안부 좌표 조회 키가 설정되지 않았습니다.",
                "운영 환경의 승인키를 확인해 주세요.",
                status=503,
                kind="GEOCODE_NOT_CONFIGURED",
            )
        fields = {**fields, "confmKey": key, "resultType": "json"}
        return self._request(
            "business.juso.go.kr",
            "/addrlink/" + endpoint,
            "POST",
            urlencode(fields).encode("utf-8"),
            {"Content-Type": "application/x-www-form-urlencoded; charset=utf-8"},
            self._juso_rows,
        )

    @staticmethod
    def _juso_rows(data):
        result = data.get("results")
        if not isinstance(result, dict) or not isinstance(result.get("common"), dict):
            raise geocode_error()
        if str(result["common"].get("errorCode")) != "0":
            raise geocode_error()
        rows = result.get("juso") or []
        if not isinstance(rows, list) or any(not isinstance(v, dict) for v in rows):
            raise geocode_error()
        try:
            total = int(result["common"]["totalCount"])
        except (KeyError, TypeError, ValueError):
            raise geocode_error() from None
        if total > 100:
            return []
        if total != len(rows):
            raise geocode_error()
        return rows

    def search(self, query):
        query = self._address_query(query)
        return self._juso(
            "addrLinkApi.do",
            dict(keyword=query, currentPage=1, countPerPage=100, addInfoYn="Y", hstryYn="Y"),
            "JUSO_SEARCH_KEY",
        )

    def coordinates(self, codes):
        if set(codes) != {"admCd", "rnMgtSn", "udrtYn", "buldMnnm", "buldSlno"} or any(
            not isinstance(value, str) or not value.isdigit() for value in codes.values()
        ):
            raise InputError("좌표 조회에는 확인된 주소 코드만 보낼 수 있습니다.")
        return self._juso("addrCoordApi.do", codes, "JUSO_COORD_KEY")

    def naver(self, query):
        query = self._address_query(query)
        key_id = os.environ.get("NCP_MAPS_KEY_ID", "").strip()
        key = os.environ.get("NCP_MAPS_KEY", "").strip()
        if not key_id or not key:
            raise AppError(
                "네이버 실시간 좌표 조회 키가 설정되지 않았습니다.",
                "운영 환경에 Maps 서버용 ID와 키를 설정해 주세요.",
                status=503,
                kind="GEOCODE_NOT_CONFIGURED",
            )
        return self._request(
            "maps.apigw.ntruss.com",
            "/map-geocode/v2/geocode?" + urlencode(dict(query=query, count=100)),
            "GET",
            None,
            {
                "Accept": "application/json",
                "x-ncp-apigw-api-key-id": key_id,
                "x-ncp-apigw-api-key": key,
            },
            self._naver_rows,
        )

    def _address_query(self, query):
        target = parse_address(self.expected_address)
        supplied = parse_address(query)
        if not target or not supplied or not same_address(target, supplied):
            raise InputError("회사 공개 주소와 다른 검색어는 전송할 수 없습니다.")
        return supplied.query

    @staticmethod
    def _naver_rows(data):
        if data.get("status") != "OK" or not isinstance(data.get("addresses"), list):
            raise geocode_error()
        if data.get("meta", {}).get("totalCount") != len(data["addresses"]):
            raise geocode_error()
        return data["addresses"]
