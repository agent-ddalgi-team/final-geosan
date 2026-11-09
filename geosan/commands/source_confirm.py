"""C8·#489: 운영자가 확인한 소스 이용·저장 조건을 기존 확인표에 한 번만 기록한다."""

import logging
import re
from datetime import date
from urllib.parse import urlsplit

import typer

from geosan.config.app_settings import (
    DEFAULT_APP_SETTINGS_PATH,
    load_app_settings,
    read_app_settings,
)
from geosan.config.errors import AppError, InputError, RunFailedError, exit_code_for
from geosan.evidence.transfer import KST
from geosan.opportunity.source_models import SourceContract
from geosan.storage.base import utcnow
from geosan.storage.engine import database_path
from geosan.storage.session import session_scope

logger = logging.getLogger(__name__)

# #489 PM 승인: 설정 키를 늘리지 않고 소스 ID별 문구를 이 명령 안에 둔다.
_SOURCES = {
    "kicox-factory-csv": {
        "source_name": "산단공 전국등록공장현황 파일",
        "allowed_use": (
            "이용허락범위 제한 없음. 공개 공장현황으로 영업 후보를 찾고 "
            "공정·지역·산업 적합도를 판단"
        ),
        "terms_ref": "https://www.data.go.kr/data/15105482/fileData.do",
        "allowed_storage": (
            "회사명·단지명·생산품·공장주소와 기준일·지역·행 식별값·판단용 지문 저장. "
            "대표자 이름·팩스·전화·개인 연락처는 읽는 즉시 버림"
        ),
    },
    "kicox-production-api": {
        "source_name": "산단공 공장등록생산정보 조회",
        "allowed_use": (
            "이용허락범위 제한 없음. 공개 공장등록 자료로 단지 입주 후보를 찾고 "
            "회사의 등록 정보를 확인"
        ),
        "terms_ref": "https://www.data.go.kr/data/15087611/openapi.do",
        "allowed_storage": (
            "회사명·단지명·생산품·공장주소·업종·공장관리번호와 조회일·지역·행 식별값·"
            "판단용 지문 저장. 대표자 이름·팩스·전화·개인 연락처는 읽는 즉시 버림"
        ),
    },
}


def _confirmation_date(value: str | None, today: date) -> date:
    if value is None:
        return today
    try:
        if not re.fullmatch(r"[0-9]{4}-[0-9]{2}-[0-9]{2}", value):
            raise ValueError
        confirmed = date.fromisoformat(value)
    except ValueError:
        raise InputError("확인일은 실제 날짜를 YYYY-MM-DD 형식으로 넣어 주세요.") from None
    if confirmed > today:
        raise InputError("확인일은 서울 기준 오늘보다 미래일 수 없습니다.")
    return confirmed


def _terms_ref(value: str) -> str:
    try:
        parsed = urlsplit(value)
        if (
            not value.strip()
            or value != value.strip()
            or any(character.isspace() for character in value)
            or parsed.scheme not in {"http", "https"}
            or not parsed.hostname
            or parsed.username is not None
            or parsed.password is not None
        ):
            raise ValueError
    except ValueError:
        raise InputError("약관 주소는 확인한 http 또는 https 주소로 넣어 주세요.") from None
    return value


def run_source_confirm(
    source_id: str,
    *,
    staff_key: str,
    terms: str | None,
    on: str | None,
    echo=typer.echo,
) -> int:
    try:
        source = _SOURCES.get(source_id)
        if source is None:
            raise InputError("소스는 kicox-factory-csv 또는 kicox-production-api를 넣어 주세요.")
        source_values = source | {
            "terms_ref": _terms_ref(terms if terms is not None else source["terms_ref"])
        }
        if not database_path().is_file():
            raise InputError("데이터베이스가 없습니다. 먼저 geosan init-db를 실행해 주세요.")
        with session_scope() as session:
            # 같은 소스를 동시에 확인해도 하나만 기록하며 저장은 재시도하지 않는다.
            session.connection().exec_driver_sql("BEGIN IMMEDIATE")
            settings = read_app_settings(session) or load_app_settings(DEFAULT_APP_SETTINGS_PATH)
            if not settings.is_recording_staff(staff_key):
                raise InputError(
                    "설정에 등록된 기록 담당자 키를 넣어 주세요. 보기 전용은 처리할 수 없습니다."
                )
            now = utcnow()
            confirmed_at = _confirmation_date(on, now.astimezone(KST).date())
            if session.get(SourceContract, source_id) is not None:
                raise InputError("이미 소스 확인 기록이 있습니다. 기존 기록은 덮어쓰지 않습니다.")
            session.add(
                SourceContract(
                    source_id=source_id,
                    **source_values,
                    confirmed_by=staff_key,
                    confirmed_at=confirmed_at,
                    created_by=staff_key,
                    created_at=now,
                    is_virtual=False,
                    dataset_kind=None,
                )
            )
        echo(f"{source['source_name']} · {confirmed_at.isoformat()} 이용·저장 확인을 저장했습니다.")
        return 0
    except Exception as exc:
        error = (
            exc
            if isinstance(exc, AppError)
            else RunFailedError(
                "소스 이용·저장 확인을 저장하지 못했습니다. 변경을 되돌렸습니다.",
                next_action="geosan init-db로 DB 상태를 확인해 주세요.",
            )
        )
        logger.error("소스 확인 실패: ref=%s type=%s", error.ref, type(exc).__name__)
        echo(f"{error.message} {error.next_action} (문의 번호: {error.ref})")
        return exit_code_for(error)
