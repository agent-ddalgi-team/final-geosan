"""C9 후보 검색 결과 검사. 검색 도구가 실제로 돌려준 출처만 받는다(#493)."""

import json
import re
from dataclasses import dataclass
from datetime import datetime, timedelta
from urllib.parse import unquote, urlsplit, urlunsplit

from geosan.evidence.contacts import normalize_text, scrub_contacts
from geosan.evidence.openai_search import _extra_searches_ignored_at_limit

# 이름을 담는 역할·표제도 받지 않는다. 임의의 문장 속 인명을 완전히 판별하는 기능은 아니다.
_PERSON = re.compile(
    r"대표자?|담당자?|성명|연락처|팩스|휴대폰|이메일|전화|\b(?:CEO|FAX|E-?MAIL)\b|[가-힣]{2,4}\s*(?:님|과장|부장|차장|팀장)",
    re.I,
)


def safe_public_text(value: str) -> bool:
    normalized = normalize_text(unquote(value))
    return not scrub_contacts(normalized)[1] and not _PERSON.search(normalized)


def source_url(value, blocked_domains) -> str | None:
    """도메인 경계·하위 도메인을 검사한다. 페이지를 열거나 DNS를 조회하지 않는다."""
    if not isinstance(value, str) or not value:
        return None
    if any(c.isspace() or ord(c) < 32 or c == "\\" for c in value):
        return None
    try:
        parts = urlsplit(value)
        host = (parts.hostname or "").encode("idna").decode("ascii").lower().rstrip(".")
        if (
            parts.scheme not in {"https", "http"}
            or parts.username is not None
            or parts.password is not None
            or parts.port not in {None, 80, 443}
            or not re.fullmatch(r"(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}", host)
            or host.endswith((".localhost", ".local", ".internal"))
            or any(host == domain or host.endswith("." + domain) for domain in blocked_domains)
        ):
            return None
        # 공공데이터포털 자료 경로의 8자리 식별자는 전화번호가 아니다(#515).
        # 그 위치만 가리고 검사하며, 질의·조각·다른 경로의 숫자와 인명 검사는 유지한다.
        privacy_text = value
        resource = re.fullmatch(r"/data/([0-9]{8})/(?:fileData|openapi)\.do", parts.path)
        if host in {"data.go.kr", "www.data.go.kr"} and resource:
            start, end = resource.span(1)
            privacy_text = parts._replace(
                path=parts.path[:start] + "resource" + parts.path[end:]
            ).geturl()
        if not safe_public_text(privacy_text):
            return None
        port = f":{parts.port}" if parts.port is not None else ""
        return urlunsplit((parts.scheme, host + port, parts.path or "/", parts.query, ""))
    except (ValueError, UnicodeError):
        return None


@dataclass(frozen=True)
class WebSearchCandidate:
    company_name: str
    address: str | None
    source_url: str
    snippet: str | None


def parse_search_results(response: dict, blocked_domains: tuple[str, ...], maximum: int):
    """잘못된 응답은 실패, 출처·개인정보 위반 행은 제외로 구분한다."""
    if (
        response.get("status") != "completed"
        or response.get("error")
        or response.get("incomplete_details")
    ):
        raise ValueError("응답 미완료")
    searches = [item for item in response["output"] if item["type"] == "web_search_call"]
    if (
        not searches
        or not any(
            item.get("status") == "completed" and item.get("action", {}).get("type") == "search"
            for item in searches
        )
        or (
            any(item["status"] != "completed" for item in searches)
            and not _extra_searches_ignored_at_limit(response, searches)
        )
    ):
        raise ValueError("검색 미완료")
    messages = [item for item in response["output"] if item["type"] == "message"]
    if any(
        item.get("status") != "completed" or item.get("role") != "assistant" for item in messages
    ):
        raise ValueError("답변 미완료")
    parts = [part for item in messages for part in item["content"]]
    texts = [part for part in parts if part["type"] == "output_text"]
    if len(texts) != 1 or any(part["type"] == "refusal" for part in parts):
        raise ValueError("답변 누락")
    # 모델이 JSON에 쓴 주소만으로 출처를 인정하지 않는다.
    raw_sources = [
        source["url"]
        for item in searches
        if item["status"] == "completed"
        for source in item["action"].get("sources", [])
    ] + [
        annotation["url"]
        for part in texts
        for annotation in part.get("annotations", [])
        if annotation["type"] == "url_citation"
    ]
    sources = {url for raw in raw_sources if (url := source_url(raw, blocked_domains))}
    answer = json.loads(texts[0]["text"])
    if not isinstance(answer, list) or len(answer) > maximum:
        raise ValueError("후보 목록 형식 또는 건수")
    candidates = []
    seen = set()
    for item in answer:
        if not isinstance(item, dict) or set(item) - {
            "companyName",
            "address",
            "sourceUrl",
            "homepageUrl",
            "snippet",
        }:
            raise ValueError("후보 칸 형식")
        name, address, snippet = item.get("companyName"), item.get("address"), item.get("snippet")
        if (
            not isinstance(name, str)
            or not name.strip()
            or any(
                value is not None and not isinstance(value, str)
                for value in (address, snippet, item.get("sourceUrl"), item.get("homepageUrl"))
            )
        ):
            raise ValueError("후보 내용 형식")
        url = source_url(item.get("sourceUrl"), blocked_domains)
        if (
            url not in sources
            or not url
            or any(
                not safe_public_text(value)
                for value in (name, address, snippet)
                if isinstance(value, str)
            )
        ):
            continue
        homepage = item.get("homepageUrl")
        if homepage is not None and source_url(homepage, blocked_domains) is None:
            continue
        identity = (normalize_text(name).strip(), normalize_text(address or "").strip())
        if identity in seen:
            continue
        seen.add(identity)
        candidates.append(WebSearchCandidate(name.strip(), address, url, snippet))
    return tuple(candidates), len(answer) - len(candidates)


def can_reuse_search(
    *,
    stored_hash: str,
    current_hash: str,
    searched_at: datetime,
    expires_at: datetime,
    cache_days: int,
    now: datetime,
) -> bool:
    """저장 연결 전의 순수 판정 부품. 보관 설정을 줄여도 옛 만료일을 그대로 믿지 않는다."""
    times = (searched_at, expires_at, now)
    if (
        not stored_hash
        or stored_hash != current_hash
        or type(cache_days) is not int
        or cache_days < 1
    ):
        return False
    if any(not isinstance(t, datetime) or t.tzinfo is None or t.utcoffset() is None for t in times):
        return False
    return searched_at <= now < min(expires_at, searched_at + timedelta(days=cache_days))
