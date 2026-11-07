"""C5·C9: 공식 단지 입주 조회를 공개 응답 검사·하루 호출 기록에 연결한다(#404).

30초·재시도 1회, 쪽 넘김마다 별도 기록. 실패는 받은 행과 미완료 사유를 함께 반환한다.
7일 저장·재사용은 조회별 행 연결 모델(#405) 반영 뒤 연결한다. 원문·키는 기록하지 않는다.
"""

import http.client
import os
import time
from dataclasses import dataclass
from pathlib import Path
from urllib.parse import unquote, urlencode

from sqlalchemy.exc import SQLAlchemyError

from geosan.config.app_settings import (
    DEFAULT_APP_SETTINGS_PATH,
    load_app_settings,
    read_app_settings,
)
from geosan.config.errors import AppError, InputError
from geosan.evidence.contacts import scrub_contacts
from geosan.evidence.public_source import FactoryRegistryLimitError, reserve_factory_registry
from geosan.evidence.reader import MAX_BYTES, interrupt_at
from geosan.opportunity.complex_rows import (
    ComplexFactoryRow,
    ComplexSourceError,
    combine_factory_rows,
    parse_complex_page,
)
from geosan.opportunity.factory_csv import SkippedRow
from geosan.opportunity.factory_store import _context
from geosan.opportunity.ingest_errors import storage_failure
from geosan.opportunity.source_models import SourceContract
from geosan.storage.session import session_scope

SOURCE_ID = "kicox-production-api"
API_HOST = "apis.data.go.kr"
API_PATH = "/B550624/fctryRegistInfo/getFctryListInIrsttService_v2"
TIMEOUT_SECONDS = 30  # C9 ExternalSourceApi
PAGE_SIZE = 1000  # C9 제공처 최대 건수


@dataclass(frozen=True)
class ComplexLookupResult:
    """정상으로 읽은 쪽의 집계. skipped_reason이 있으면 완전한 결과가 아니다."""

    rows: tuple[ComplexFactoryRow, ...] = ()
    raw_count: int = 0
    filtered_count: int = 0
    skipped_rows: tuple[SkippedRow, ...] = ()
    pages_read: int = 0
    skipped_reason: str | None = None


class _HttpError(Exception):
    def __init__(self, status):
        self.status = status
        super().__init__("공장등록 조회 응답 오류")


class _LookupDisabled(Exception):
    pass


def validate_complex_name(name: str) -> str:
    """공개 단지 이름만 받는다. 잘못된 값은 오류에 그대로 싣지 않는다."""
    if (
        not isinstance(name, str)
        or not name.strip()
        or len(name.strip()) > 200
        or any(ord(char) < 32 or ord(char) == 127 for char in name)
        or scrub_contacts(name)[1]
        or "://" in name
    ):
        raise InputError("공개 단지 이름을 확인해 주세요.")
    return name.strip()


def complex_settings(batch_id, db_path):
    """회차의 지역과 설정을 읽는다. 꺼져 있으면 조회 소스 승인·키를 요구하지 않는다."""
    with session_scope(db_path) as session:
        _, regions = _context(session, batch_id)
        settings = read_app_settings(session) or load_app_settings(DEFAULT_APP_SETTINGS_PATH)
        config = settings.ingestion.complex_list
        if config.enabled:
            source = session.get(SourceContract, SOURCE_ID)
            if source is None or source.confirmed_at is None:
                raise InputError("공장등록 조회 소스의 이용·저장 확인을 먼저 기록해 주세요.")
        return tuple(regions), config


def _request_page(name, key, page_no):
    """고정 HTTPS 주소로 한 번만 요청한다. 리다이렉트·숨은 재시도는 없다."""
    path = (
        API_PATH
        + "?"
        + urlencode(
            {
                # 포털의 일반 키·URL 인코딩된 키 모두 한 번만 인코딩해 보낸다. '+'는 보존한다.
                "serviceKey": unquote(key),
                "irsttNm": name,
                "pageNo": page_no,
                "numOfRows": PAGE_SIZE,
                "type": "XML",
            }
        )
    )
    deadline = time.monotonic() + TIMEOUT_SECONDS
    connection = http.client.HTTPSConnection(API_HOST, timeout=TIMEOUT_SECONDS)
    timer = None

    def left():
        seconds = deadline - time.monotonic()
        if seconds <= 0:
            raise TimeoutError("공장등록 조회 시간 초과")
        return seconds

    try:
        connection.connect()
        left()
        try:
            timer = interrupt_at(connection.sock, deadline)
        except AppError:
            raise TimeoutError("공장등록 조회 시간 초과") from None
        connection.sock.settimeout(left())
        connection.request("GET", path, headers={"Accept": "application/xml"})
        connection.sock.settimeout(left())
        response = connection.getresponse()
        if response.status != 200:
            raise _HttpError(response.status)
        chunks, size = [], 0
        while True:
            if connection.sock:
                connection.sock.settimeout(left())
            chunk = response.read1(65536)
            left()
            if not chunk:
                return b"".join(chunks)
            size += len(chunk)
            if size > MAX_BYTES:
                raise ComplexSourceError()
            chunks.append(chunk)
    finally:
        if timer:
            timer.cancel()
        connection.close()


def _page(batch_id, name, key, page_no, regions, db_path):
    for attempt in range(2):  # 외부 읽기만 1회 재시도(C9). DB 저장은 이 try 밖에 둔다.
        current_regions, config = complex_settings(batch_id, db_path)
        if set(current_regions) != set(regions):
            raise InputError("조회하는 동안 회차의 찾기 지역이 바뀌었습니다.")
        if not config.enabled:
            raise _LookupDisabled()
        reserve_factory_registry(batch_id=batch_id, db_path=db_path)
        try:
            return _request_page(name, key, page_no)
        except _HttpError as error:
            if error.status not in (408, 429) and not 500 <= error.status < 600:
                raise ComplexSourceError() from None
        except (OSError, http.client.HTTPException):
            pass  # 아래에서 한 번만 재시도하며, 두 번째 실패는 명시적으로 전달한다.
        if attempt == 1:
            raise ComplexSourceError() from None


def fetch_complex_list(
    batch_id: str, complex_name: str, *, db_path: Path | str | None = None
) -> ComplexLookupResult:
    """한 단지를 끝까지 읽는다. 호출·판독 실패는 부분 결과와 기존 사유 코드로 반환.

    입력·회차·소스 확인·저장 오류는 전파한다. 실패를 성공처럼 보이게 하지 않으려면 호출자가
    skipped_reason을 반드시 회차 집계에 반영해야 한다. 저장·캐시·AI·회사 등록은 하지 않는다.
    """
    if not isinstance(batch_id, str) or not batch_id.strip():
        raise InputError("후보 찾기 회차 번호를 확인해 주세요.")
    name = validate_complex_name(complex_name)
    try:
        regions, config = complex_settings(batch_id, db_path)
        if not config.enabled:
            return ComplexLookupResult(skipped_reason="DISABLED")
        key = os.environ.get("DATA_GO_KR_SERVICE_KEY", "").strip()
        if not key or any(char.isspace() for char in key):
            return ComplexLookupResult(skipped_reason="SOURCE_ERROR")
        rows, skipped = (), ()
        raw_count = filtered_count = pages_read = 0
        page_no, total, reason = 1, None, None
        while True:
            current_regions, current_config = complex_settings(batch_id, db_path)
            if set(current_regions) != set(regions):
                raise InputError("조회하는 동안 회차의 찾기 지역이 바뀌었습니다.")
            if not current_config.enabled:
                reason = "DISABLED"
                break
            try:
                xml = _page(batch_id, name, key, page_no, regions, db_path)
                page = parse_complex_page(
                    xml, regions=regions, expected_page=page_no, page_size=PAGE_SIZE
                )
                del xml
                if total is not None and page.total_count != total:
                    raise ComplexSourceError()
                combined = combine_factory_rows((), rows + page.rows)
            except FactoryRegistryLimitError:
                reason = "DAILY_LIMIT"
                break
            except _LookupDisabled:
                reason = "DISABLED"
                break
            except ComplexSourceError as error:
                reason = error.skipped_reason
                break
            rows = combined.added_rows
            skipped += page.skipped_rows
            raw_count += page.raw_count
            filtered_count += page.filtered_count
            pages_read += 1
            total = page.total_count
            if not page.has_more:
                break
            page_no += 1
        # 마지막 응답을 기다리는 동안 회차·범위가 바뀐 경우도 오래된 결과를 넘기지 않는다.
        current_regions, current_config = complex_settings(batch_id, db_path)
        if set(current_regions) != set(regions):
            raise InputError("조회하는 동안 회차의 찾기 지역이 바뀌었습니다.")
        if not current_config.enabled:
            reason = "DISABLED"
        return ComplexLookupResult(
            rows,
            raw_count,
            filtered_count,
            skipped,
            pages_read,
            reason or ("SOURCE_ERROR" if skipped else None),
        )
    except SQLAlchemyError as error:
        raise storage_failure(
            error, operation="factory", message="공장등록 조회 기록을 저장하지 못했습니다."
        ) from None
