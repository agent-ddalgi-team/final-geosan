"""홈페이지 검색에 쓸 사례 파일 입력(C4)과 검색 결과(C9)."""

import re
import unicodedata
from collections.abc import Callable
from pathlib import Path
from typing import Annotated, Literal

from pydantic import (
    AwareDatetime,
    BaseModel,
    ConfigDict,
    Field,
    HttpUrl,
    StringConstraints,
    TypeAdapter,
    ValidationError,
    field_validator,
)
from sqlalchemy import select

from geosan.config.app_settings import (
    DEFAULT_APP_SETTINGS_PATH,
    load_app_settings,
    read_app_settings,
)
from geosan.config.errors import AppError, InputError
from geosan.config.validators import find_contact
from geosan.opportunity.models import Customer, Opportunity
from geosan.opportunity.queries import store_case_homepage
from geosan.rules.codes import SecurityGrade
from geosan.storage.session import session_scope

Nonblank = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1)]
Confidence = Annotated[float, Field(strict=True, ge=0, le=1, allow_inf_nan=False)]
_confidence = TypeAdapter(Confidence)
_http_url = TypeAdapter(HttpUrl)


def _contains_contact(text: str) -> bool:
    normalized = unicodedata.normalize("NFKC", text)
    if find_contact(normalized):
        return True
    # 구분 기호 없는 지역번호, 050 안심번호와 전국 대표번호도 외부 검색에서 제외한다.
    compact = re.sub(r"[\s.()\-]", "", normalized)
    return bool(re.search(r"(?<!\d)(?:0\d{8,11}|\+82\d{8,11}|1[568]\d{6})(?!\d)", compact))


class HomepageSearchResult(BaseModel):
    """찾지 못한 정상 응답은 url=null이다. 잘못된 응답은 검증 오류로 남긴다."""

    model_config = ConfigDict(extra="forbid", frozen=True, hide_input_in_errors=True)

    provider: Literal["OPENAI_WEB_SEARCH"]
    url: str | None
    confidence: Confidence
    reason: Nonblank
    fetched_at: AwareDatetime = Field(alias="fetchedAt")

    @field_validator("url")
    @classmethod
    def validate_homepage_url(cls, value: str | None) -> str | None:
        if value is None:
            return None
        if not re.match(r"^https?://[^/\\?#\s]", value, re.IGNORECASE) or any(
            ch.isspace() or ch == "\\" or ord(ch) < 32 for ch in value
        ):
            raise ValueError("홈페이지 주소는 http 또는 https 주소여야 합니다.")
        url = _http_url.validate_python(value)
        if url.username is not None or url.password is not None:
            raise ValueError("로그인 정보가 있는 홈페이지 주소는 사용할 수 없습니다.")
        return value

    def status(
        self, min_confidence: float
    ) -> Literal["AI_FOUND", "NEEDS_CONFIRMATION", "NOT_FOUND"]:
        """기준값과 같으면 찾음, 미만이면 확인 필요. 주소가 없으면 확신도와 관계없이 못 찾음."""
        threshold = _confidence.validate_python(min_confidence)
        if self.url is None:
            return "NOT_FOUND"
        return "NEEDS_CONFIRMATION" if self.confidence < threshold else "AI_FOUND"


def find_case_homepage(
    opp_id: str,
    *,
    search: Callable[[str, str], object] | None = None,
    db_path: Path | str | None = None,
) -> HomepageSearchResult:
    """공개 사례를 검색하고 검증된 결과를 상세 조회에 쓸 수 있도록 저장한다 (C4·C9).

    검색 어댑터가 전송 기록·호출 한도를 맡는다. DB 읽기는 어댑터를 부르기 전에 끝낸다.
    """
    with session_scope(db_path) as session:
        customer = session.execute(
            select(
                Customer.customer_id,
                Customer.name,
                Customer.normalized_address,
                Customer.security_grade,
                Customer.homepage_status,
            )
            .join(Opportunity, Opportunity.customer_id == Customer.customer_id)
            .where(Opportunity.opp_id == opp_id, Opportunity.case_id.is_not(None))
        ).one_or_none()
    if customer is None or customer.security_grade != SecurityGrade.PUBLIC:
        if search is None:
            from geosan.evidence.transfer import record_search_rejection

            record_search_rejection(opp_id, "공개 사례 출처 미확인", db_path)
        raise InputError("공개 사례로 확인된 회사만 홈페이지를 검색할 수 있습니다.")
    if customer.homepage_status == "CONFIRMED":
        raise InputError("이미 확인한 홈페이지가 있습니다.")
    name, address = customer.name.strip(), (customer.normalized_address or "").strip()
    if not name or not address:
        if search is None:
            from geosan.evidence.transfer import record_search_rejection

            record_search_rejection(opp_id, "회사명 또는 주소 누락", db_path)
        raise InputError("홈페이지를 검색하려면 회사명과 주소가 모두 필요합니다.")
    if _contains_contact(name) or _contains_contact(address):
        if search is None:
            from geosan.evidence.transfer import record_search_rejection

            record_search_rejection(opp_id, "검색 식별값에 연락처 포함", db_path)
        raise InputError("회사명 또는 주소에 연락처가 있어 검색할 수 없습니다.")
    if search is None:
        from geosan.evidence.openai_search import search_openai

        response = search_openai(opp_id, name, address, db_path)
    else:
        response = search(name, address)
    try:
        result = HomepageSearchResult.model_validate(response)
    except ValidationError:
        raise AppError(
            message="홈페이지 검색 응답의 형식이 올바르지 않습니다.",
            next_action="다시 조사해 주세요.",
            status=503,
        ) from None
    with session_scope(db_path) as session:
        settings = read_app_settings(session) or load_app_settings(DEFAULT_APP_SETTINGS_PATH)
        store_case_homepage(
            session,
            opp_id,
            customer.customer_id,
            customer.name,
            customer.normalized_address,
            result,
            settings.homepage_discovery.min_confidence,
        )
    return result
