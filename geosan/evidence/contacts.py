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


# ---------------------------------------------------------------------------
# 사람 이름 지우기 (#680, PM 결정 2026-11-13 #681 · 2026-11-14)
# ---------------------------------------------------------------------------

NAME_MARK = "[이름]"

PERSON_TITLES: tuple[str, ...] = tuple(
    "대표이사 공장장 본부장 센터장 지점장 파트장 그룹장 부사장 매니저 과장 대리 부장 차장 팀장 "
    "이사 대표 사장 회장 상무 전무 주임 사원 책임 수석 선임 실장 소장 계장 반장 조장".split()
)
"""이름 뒤에 붙는 직함. 직함 목록은 여기 한 곳에만 둔다(긴 것이 먼저 — 대표이사가 대표보다 앞)."""

PERSON_HONORIFICS: tuple[str, ...] = ("님", "씨")
"""이름 뒤에 붙는 호칭. 성씨 한 글자만 있을 때("손님", "성씨")에는 호칭만으로 지우지 않는다."""

_SURNAMES_2 = ("남궁", "황보", "제갈", "선우", "서문", "독고", "사공")
_SURNAMES_1 = (
    "김이박최정강조윤장임한오서신권황안송류유전홍고문양손배백허남심노하곽성차주우구"
    "나민진지엄채원천방공현함변염여추도소석선설마길"
)

NOT_NAME_WORDS: frozenset[str] = frozenset(
    (
        "구매 공장 공무 공정 공사 공동 설계 현장 도금 도장 주조 주물 전기 전자 전산 정비 조립 "
        "안전 원가 원청 하청 임원 임시 정식 신규 신입 현재 전체 이전 이번 지난 우리 고객 선생 "
        "주인 원장 전임 신임 공동 한국 현대 한화 고려 이메일 전화 주소 지역 지정 변경 이관 "
        "설비 공무원 설계자 임직원 전사원 정사원 신사원 이사장 방문 정리 정도 하나 한번 오늘 "
        "이후 이상 이하 이유 이름 성함 현황 문의 주문 주요 주간 주말 오전 오후 양산 양식 길이 "
        "유지 유효 심사 노후 허가 남은 서류 서울 성능 성사 차량 나중 민원 진행 지금 엄격 채용 "
        "천안 방식 방법 함께 변동 추가 추후 도착 도면 소개 석유 선정 설명 마감 길게 정말 정밀"
    ).split()
)
"""성씨 글자로 시작하지만 사람 이름이 아닌 낱말. 직함 앞·"담당" 뒤에 와도 지우지 않는다."""

_NOT_NAME_ENDINGS = "장팀부사처점"
"""이름이 이 글자로 끝나면 조직·직책 이름으로 본다(구매팀·고객사·지점장)."""

_PARTICLE_ENDINGS = "는가을를에의로도만와과됨함음임요다"
"""직함 없이 "담당 ○○○"처럼 앞말만 있을 때, 이 글자로 끝나는 세 글자는 이름으로 보지 않는다."""

_AMBIGUOUS_BARE = {("이", "책임")}
"""성씨 한 글자 + 직함이 흔한 말과 같은 경우("이 책임을 지고")는 지우지 않는다."""

_AFTER_TITLE = (
    r"(?=님|씨|[^가-힣]|$|이|가|은|는|을|를|께|에|의|도|만|과|와|랑|한테|으로|로|라|하고"
    r"|까지|부터|보다|처럼|입니다|였)"
)
_SURNAME = "(?:" + "|".join(_SURNAMES_2) + "|[" + _SURNAMES_1 + "])"
_MASK = "[○〇OＯ*＊xX]"
_NAME_BEFORE_TITLE = re.compile(
    rf"(?<![가-힣])(?P<name>{_SURNAME}(?:{_MASK}{{1,3}}|[가-힣]{{0,2}}?))(?P<gap>\s{{0,2}})"
    rf"(?P<title>{'|'.join(PERSON_TITLES + PERSON_HONORIFICS)}){_AFTER_TITLE}"
)
_NAME_AFTER_LABEL = re.compile(
    rf"(?P<label>(?:담당자?|성함|이름|{'|'.join(PERSON_TITLES)})(?:은|는|이|:)?\s{{0,2}})"
    rf"(?P<name>{_SURNAME}[가-힣]{{2}})(?![가-힣])"
)


def _is_name(name: str) -> bool:
    if name in NOT_NAME_WORDS or name in PERSON_TITLES or name[:2] in NOT_NAME_WORDS:
        return False
    return not (len(name) > 1 and name[-1] in _NOT_NAME_ENDINGS)


def _replace_before_title(match: re.Match[str]) -> str:
    name, title = match["name"], match["title"]
    bare = len(name) == 1
    if not _is_name(name) or (bare and title in PERSON_HONORIFICS):
        return match[0]
    if bare and (name, title) in _AMBIGUOUS_BARE:
        return match[0]
    return f"{NAME_MARK} {title}"


def _replace_after_label(match: re.Match[str]) -> str:
    name = match["name"]
    if not _is_name(name) or name[-1] in _PARTICLE_ENDINGS:
        return match[0]
    return f"{match['label']}{NAME_MARK}"


def scrub_person_names(text: str) -> tuple[str, int]:
    """글에서 사람 이름을 "[이름]"으로 바꾸고 바꾼 개수를 돌려준다. 직함은 남긴다.

    이 프로그램은 사람 이름을 저장하지 않아 견줄 이름 목록이 없다. 그래서 **모양으로만** 찾는다.

    잡는 것
      - 이름 + 직함·호칭: "김철수 과장", "김철수과장님", "박 대리", "이영희 님", "이영희씨"
      - 가려 쓴 이름 + 직함: "김○○ 과장", "박** 대리"
      - 앞말 + 세 글자 이름: "담당 홍길동", "담당자: 홍길동", "성함은 홍길동", "과장 김철수"

    못 잡는 것(한계)
      - 직함·호칭·앞말 없이 이름만 적은 것: "홍길동이 전화함", "철수 씨"(성 없이 이름만)
      - 영어·로마자 이름("Kim 과장"), 별명, 목록에 없는 성씨·직함
      - 성씨 한 글자 + 호칭("김 씨" — "손님"과 구분할 수 없음), 앞말 뒤의 두 글자·네 글자 이름
    잘못 지울 수 있는 것(안전한 쪽으로 틀림)
      - 성씨 글자로 시작하는 2~3자 낱말·회사 이름 + 직함: "한일 대표", "전 대표"(예전 대표)
    새 낱말이 걸리면 NOT_NAME_WORDS에 더한다. 전화·이메일은 scrub_contacts가 따로 지운다.
    """
    text = normalize_text(text)
    before = text.count(NAME_MARK)
    text = _NAME_BEFORE_TITLE.sub(_replace_before_title, text)
    text = _NAME_AFTER_LABEL.sub(_replace_after_label, text)
    return text, text.count(NAME_MARK) - before
