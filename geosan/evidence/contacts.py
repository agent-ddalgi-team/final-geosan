"""공개 본문에서 대표번호를 먼저 찾고, 외부 전송 전 연락처를 제거한다."""

import re
import unicodedata

from geosan.config.validators import CONTACT_PATTERNS

_EXTRA_PHONE = re.compile(r"(?<!\d)(?:0\d{8,10}|1[568]\d{2}[ .-]?\d{4})(?!\d)")
_PERSON = re.compile(
    r"담당|직통|팩스|fax|mobile|휴대|[가-힣]{2,4}\s*(?:님|대리|과장|부장|차장|팀장)", re.I
)


def normalize_text(text: str) -> str:
    return unicodedata.normalize("NFKC", text).replace("\u200b", "").replace("\ufeff", "")


def scrub_contacts(text: str) -> tuple[str, int]:
    text = normalize_text(text)
    count = 0
    for pattern in [pattern for _, pattern in CONTACT_PATTERNS] + [_EXTRA_PHONE]:
        text, removed = pattern.subn("[연락처 제거]", text)
        count += removed
    return text, count


def extract_main_phone(
    text: str, page_url: str, prefixes: list[str]
) -> tuple[str | None, str | None]:
    for line in normalize_text(text).splitlines():
        if _PERSON.search(line):
            continue
        named = re.search(r"(?<![가-힣])([가-힣]{2,4})\s+\(?0\d", line)
        if named and named[1] not in {
            "대표전화",
            "대표번호",
            "전화",
            "본사",
            "공장",
            "고객센터",
            "연락처",
            "사무실",
        }:
            continue
        matches = []
        for prefix in prefixes:
            if prefix.startswith("01"):
                continue
            pattern = re.compile(
                rf"(?<!\d)\(?{re.escape(prefix)}\)?[ .-]*(\d{{3,4}})[ .-]*(\d{{4}})(?!\d)"
            )
            match = pattern.search(line)
            if match:
                matches.append((match.start(), f"{prefix}-{match[1]}-{match[2]}"))
        if matches:
            return min(matches)[1], page_url
    return None, None
