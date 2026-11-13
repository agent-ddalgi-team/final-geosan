"""홈페이지 검색에 쓸 사례 파일 입력(C4)과 검색 결과(C9)."""

import re
import unicodedata
from collections.abc import Callable
from pathlib import Path
from typing import Annotated, Literal
from urllib.parse import urlsplit

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
from geosan.opportunity.queries import public_origin_condition, store_case_homepage
from geosan.rules.codes import SecurityGrade
from geosan.storage.session import session_scope

Nonblank = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1)]
Confidence = Annotated[float, Field(strict=True, ge=0, le=1, allow_inf_nan=False)]
_confidence = TypeAdapter(Confidence)
_http_url = TypeAdapter(HttpUrl)

# #511: 공식 홈페이지가 아닌 공개 페이지의 종류. 회사가 직접 운영하는 블로그·SNS·쇼핑몰과
# 공공·지자체 페이지뿐이다. 채용·유료 기업 정보·기업 정보 모음 사이트는 종류에 없다.
UNOFFICIAL_PAGE_KINDS = ("BLOG", "SNS", "SHOP", "PUBLIC_PAGE")
PageKind = Literal["OFFICIAL", "BLOG", "SNS", "SHOP", "PUBLIC_PAGE"]
# 새 열 없이 저장된 이유 글(homepage_reason) 맨 앞에 남기는 표시. 우리 코드만 붙인다.
_UNOFFICIAL_MARK = re.compile(r"^\[공식 아님:(BLOG|SNS|SHOP|PUBLIC_PAGE)\] ")
BLOCKED_SITE_REASON = "막는 사이트(채용·유료 기업 정보 등)의 주소라 쓰지 않았습니다."
UNOFFICIAL_OFF_REASON = "공식 홈페이지가 아닌 페이지라 쓰지 않았습니다."
UNSAFE_PAGE_REASON = "주소에 사람 이름·연락처 꼴이 있어 쓰지 않았습니다."


def unofficial_page_kind(status: str | None, source: str | None, reason: str | None) -> str | None:
    """저장된 홈페이지가 '확인 필요'인 공개 페이지(공식 아님)면 그 종류, 아니면 None (#511).

    담당자가 [맞음]·주소 고치기로 확정하면(CONFIRMED·STAFF) 더는 공개 페이지로 보지 않는다.
    """
    if status != "NEEDS_CONFIRMATION" or source != "AI" or not reason:
        return None
    marked = _UNOFFICIAL_MARK.match(reason)
    return marked[1] if marked else None


def _blocked_host(url: str, blocked_domains: list[str]) -> bool:
    """후보 찾기와 같은 방식: 도메인 자체와 하위 도메인을 막는다. 페이지를 열지 않는다."""
    host = (urlsplit(url).hostname or "").lower().rstrip(".")
    return any(host == domain or host.endswith("." + domain) for domain in blocked_domains)


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
    # #511: 설정 research.allowUnofficialPage가 켜져 있을 때만 검색이 채운다. 없으면 공식으로 본다.
    page_kind: PageKind | None = Field(default=None, alias="pageKind")

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
        """기준값과 같으면 찾음, 미만이면 확인 필요. 주소가 없으면 확신도와 관계없이 못 찾음.

        공식이 아닌 공개 페이지(#511)는 확신도가 높아도 언제나 확인 필요다.
        """
        threshold = _confidence.validate_python(min_confidence)
        if self.url is None:
            return "NOT_FOUND"
        if self.page_kind in UNOFFICIAL_PAGE_KINDS:
            return "NEEDS_CONFIRMATION"
        return "NEEDS_CONFIRMATION" if self.confidence < threshold else "AI_FOUND"


def _apply_public_page_rule(
    result: HomepageSearchResult, *, allow: bool, blocked_domains: list[str]
) -> HomepageSearchResult:
    """공식이 아닌 공개 페이지를 받을지 정한다 (#511, C9).

    - 꺼져 있으면 공식이 아닌 페이지는 못 찾음으로 바꾼다(공식 결과는 그대로).
    - 켜져 있으면 막는 사이트(채용·유료 기업 정보)의 주소는 공식이라고 와도 버리고,
      공개 페이지는 주소에 사람 이름·연락처 꼴이 없을 때만 이유 글 앞에 표시를 붙여 받는다.
    """
    unofficial = result.page_kind in UNOFFICIAL_PAGE_KINDS

    def dropped(reason: str) -> HomepageSearchResult:
        return result.model_copy(update={"url": None, "page_kind": None, "reason": reason})

    if result.url is None:
        return result.model_copy(update={"page_kind": None}) if result.page_kind else result
    if not allow:
        return dropped(UNOFFICIAL_OFF_REASON) if unofficial else result
    if _blocked_host(result.url, blocked_domains):
        return dropped(BLOCKED_SITE_REASON)
    if not unofficial:
        return result
    from geosan.opportunity.candidate_web_results import source_url

    # 후보 찾기의 출처 주소 검사를 그대로 쓴다(막는 사이트·사람 이름·연락처 꼴).
    if source_url(result.url, tuple(blocked_domains)) is None:
        return dropped(UNSAFE_PAGE_REASON)
    return result.model_copy(update={"reason": f"[공식 아님:{result.page_kind}] {result.reason}"})


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
            # 사례 파일 회사와 후보 찾기로 들어온 회사(#492). 출처 없는 회사는 검색하지 않는다.
            .where(Opportunity.opp_id == opp_id, public_origin_condition())
        ).one_or_none()
        early = read_app_settings(session) or load_app_settings(DEFAULT_APP_SETTINGS_PATH)
        # #511: 기본 꺼짐. 꺼져 있으면 검색 요청·응답 모양이 전과 같다.
        allow_public_page = early.research.allow_unofficial_page
        blocked_domains = list(early.candidate_web_search.blocked_domains)
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

        response = search_openai(
            opp_id, name, address, db_path, allow_public_page=allow_public_page
        )
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
    result = _apply_public_page_rule(
        result, allow=allow_public_page, blocked_domains=blocked_domains
    )
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
