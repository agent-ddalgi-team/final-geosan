"""공개 본문에서 대표번호를 먼저 찾고, 외부 전송 전 연락처를 제거한다."""

import re
import unicodedata
from collections.abc import Iterable, Sequence

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


# ---------------------------------------------------------------------------
# 넉넉하게 지우기 + 회사 단위로 알아 둔 이름 지우기 (#720, PM 결정 2026-11-14)
# 이름은 이 PC 안에만, AI에는 직함과 내용만. 위 scrub_person_names(글 하나, 직함·호칭·앞말이
# 있을 때만)는 그대로 두고 그 위에 얹는다. 덜 지우는 것보다 더 지우는 쪽으로 틀린다.
# ---------------------------------------------------------------------------

NAME_PARTICLES: tuple[str, ...] = (
    "이라는 이라고 께서 한테 에게 이랑 하고 라는 라고 이가 이는 이도 이를 이와 "
    "이 가 은 는 께 과 와 도 랑 을 를 의"
).split()
"""이름 뒤에 붙는 조사(긴 것이 먼저). 낱말이 이 조사로 끝나야 한다("홍길동이 ", "철수한테 ")."""

_AFFECTIONATE_PARTICLES = ("이한테", "이랑", "이가", "이는", "이도", "이를", "이와")
"""받침 있는 이름을 부르는 꼴("지원이가"). 흔한 낱말과 같은 두 글자 이름은 이 꼴일 때만 지운다."""

GIVEN_NAME_SYLLABLES: frozenset[str] = frozenset(
    "건경광규균근길나남다덕도동두라란람련령례룡린림명미민범병봉빈삼상서석선섭성세솔송수숙순승시신"
    "아애양언엽영예옥완용우욱운웅원유윤율은익인임재정종주준지진찬창채천철춘충태택학한향헌혁현형"
    "혜호홍화환훈휘흥희기강"
)
"""이름(성 뒤 두 글자)에 흔히 쓰는 글자. 직함 없이 적힌 세 글자 낱말은 뒤 두 글자가 모두 여기에
있을 때만 이름으로 본다("홍길동" ○, "이메일"·"신제품" ×). 목록에 없는 글자를 쓴 이름은 남는다."""

_SAFE_NAME_FINALS = frozenset(
    "민준욱훈희영현진호연윤아우석철태혁빈림린경숙순옥미혜란환범섭엽웅찬창흥휘"
)
"""흔한 낱말로 시작하는 세 글자("이동욱"·"조성민")는 끝 글자가 여기에 있을 때만 이름으로 본다.
"이동중"·"지원서"·"정수기"·"안정성"처럼 낱말 꼬리로 흔한 글자(중·서·기·성·도·화…)는 뺐다."""

_NOT_NAME_TAILS = frozenset("나서 라서 인지 한지 서도 나도 라도 지도 한다 란다".split())
"""직함 없이 적힌 세 글자가 이 두 글자로 끝나면 풀이말로 본다("지나서", "원한다")."""

_ORG_TAILS = frozenset("과실팀부반조직원자처소계국")
"""직함 앞의 세 글자가 흔한 낱말 + 이 글자면 부서·직무로 본다("설계실 팀장", "공무과 대리")."""

NOT_NAME_WORDS_WIDE: frozenset[str] = NOT_NAME_WORDS | frozenset(
    (
        # 성씨 글자로 시작하는 흔한 두 글자 낱말(세 글자 낱말의 앞 두 글자로도 본다)
        "이동 이용 이익 이해 이송 이월 이중 이외 이내 이미 이제 이런 이것 이쪽 이력 이슈 이사 "
        "박스 최종 최근 최소 최대 최신 최초 최고 최저 최적 최우선 "
        "정상 정기 정확 정보 정수 정산 정지 정책 정품 정량 정규 정해 정한 "
        "강도 강화 강판 강재 강조 조건 조정 조율 조사 조회 조치 조금 조만 조성 조달 조업 조기 "
        "윤활 장비 장기 장점 장소 장착 장치 장갑 임가 임박 임대 "
        "한계 한도 한정 한편 한참 한동 한달 한주 한글 한해 오류 오차 오염 오더 오픈 오래 "
        "서로 서비 서면 서명 신청 신뢰 신속 신용 신한 신호 신고 신경 신제 신선 "
        "권한 권장 황동 황산 안내 안정 안건 안쪽 송부 송장 송금 "
        "유통 유리 유사 유의 유연 유상 유무 유형 유독 유해 유출 유입 유선 유용 "
        "전달 전부 전환 전망 전문 전용 전착 전해 전처 전반 전량 전수 전후 전국 전날 전년 "
        "전략 전력 전압 전류 홍보 고민 고장 고정 고가 고급 고온 고압 고속 고무 고철 "
        "문제 문서 문자 양쪽 양면 양호 양해 손실 손상 손해 "
        "배송 배치 배관 배출 배합 배정 배경 백색 허용 심각 노력 노출 노화 노즐 "
        "하자 하도 하반 하루 하중 하단 하부 성분 성적 성형 성공 성과 성수 성장 성격 "
        "차이 차후 차주 차기 차단 차례 차질 주기 주의 주력 주로 주변 주목 주식 "
        "우선 우려 우수 우천 구조 구성 구간 구분 구입 구체 구형 구두 나머 나사 민감 "
        "진척 진단 진공 진입 지원 지연 지시 지속 지급 지그 지침 지표 지점 채택 채널 "
        "원료 원인 원래 원자 원재 원칙 원활 원본 원단 천천 방청 방향 방침 방지 방안 "
        "공급 공유 공문 공간 공구 공기 공차 공개 공지 공용 현금 현실 현물 함량 "
        "변화 변형 변색 변수 염수 염산 염색 여부 여유 여기 여러 여름 여전 "
        "추세 추정 추진 추천 추석 도입 도료 도막 도구 도움 도중 "
        "소재 소량 소요 소형 소모 소통 소식 소결 석출 "
        "선택 선적 선호 선행 선반 선박 선급 설치 설정 설날 마찰 마모 마진 마무 마음 마지 "
        # 지명
        "안산 안양 안성 김포 김해 김천 구미 구로 성남 하남 남양 고양 원주 진주 전주 여수 "
        "양주 서산 강릉 강원 강남 강서 강동 마산 송도 송파 노원 주안 "
        # 님·씨 앞에 오지만 이름이 아닌 말
        "교수 총무 간사 직원 사모 부모 아버 어머 여러분 하느 아저 아가 누구 본인 상대 그분 "
        "담당자 관계자 책임자 실무자 대표자 사용자 작업자 기술자 운전자 결정권자 모든"
    ).split()
)
"""넉넉하게 지울 때만 쓰는 예외 낱말. NOT_NAME_WORDS에 그대로 더하면 scrub_person_names가
"이동욱 과장" 같은 이름을 덜 지우게 되므로(앞 두 글자 규칙) 따로 두고 새 함수만 쓴다."""

_PARTICLES = "|".join(NAME_PARTICLES)
_TITLE_OR_HONORIFIC = "|".join(PERSON_TITLES + PERSON_HONORIFICS)
_ENGLISH_NAME = r"[A-Z][a-z]+(?:\s[A-Z][a-z]+)?"
_ENGLISH_BEFORE_TITLE = re.compile(
    rf"(?<![A-Za-z])(?P<name>(?:(?:Mr|Ms|Mrs|Dr)\.?\s?)?{_ENGLISH_NAME})(?P<gap>\s{{0,2}})"
    rf"(?P<title>{_TITLE_OR_HONORIFIC}){_AFTER_TITLE}"
)
_ENGLISH_AFTER_MR = re.compile(rf"(?<![A-Za-z])(?:Mr|Ms|Mrs|Dr)\.?\s?(?P<name>{_ENGLISH_NAME})")
_ANY_BEFORE_HONORIFIC = re.compile(
    rf"(?<![가-힣])(?P<name>[가-힣]{{2,3}})\s?(?P<title>님|씨)(?=(?:{_PARTICLES})?(?![가-힣]))"
)
_BARE_FULL_NAME = re.compile(
    rf"(?<![가-힣])(?P<name>{_SURNAME}[가-힣]{{2}})(?=(?:{_PARTICLES})?(?![가-힣]))"
)
_WORD = re.compile(r"[가-힣A-Za-z0-9]{2,}")


def _keep_set(keep_words: Iterable[str]) -> frozenset[str]:
    return frozenset(word for item in keep_words for word in _WORD.findall(normalize_text(item)))


def _protected(name: str, keep: frozenset[str]) -> bool:
    return len(name) > 1 and any(word.startswith(name) for word in keep)


def _is_name_wide(name: str, keep: frozenset[str], *, titled: bool) -> bool:
    """넉넉한 쪽의 이름 판정. titled는 바로 뒤에 직함·호칭이 있을 때(더 믿을 만함)."""
    if name in PERSON_TITLES or name[:2] in PERSON_TITLES or name in NOT_NAME_WORDS_WIDE:
        return False
    if _protected(name, keep) or (len(name) > 1 and name[-1] in _NOT_NAME_ENDINGS):
        return False
    if name[:2] in NOT_NAME_WORDS_WIDE:
        finals = (GIVEN_NAME_SYLLABLES - _ORG_TAILS) if titled else _SAFE_NAME_FINALS
        return len(name) == 3 and name[2] in finals
    return True


def _is_titled_name(name: str, keep: frozenset[str]) -> bool:
    """직함·호칭 바로 앞의 낱말이 이름인지. scrub_person_names가 지우는 것은 빠짐없이 지운다."""
    if _protected(name, keep):
        return False
    return _is_name(name) or _is_name_wide(name, keep, titled=True)


def _is_bare_full_name(name: str, keep: frozenset[str]) -> bool:
    """직함·호칭 없이 적힌 낱말이 "성씨 + 이름에 흔한 두 글자"인지(넉넉한 규칙 ③)."""
    given = name[-2:]
    if given in _NOT_NAME_TAILS or not all(letter in GIVEN_NAME_SYLLABLES for letter in given):
        return False
    return _is_name_wide(name, keep, titled=False)


def _given_name(name: str) -> str | None:
    """성을 뗀 두 글자 이름("김철수" → "철수", "남궁민수" → "민수"). 없으면 None."""
    for surname in (*_SURNAMES_2, *_SURNAMES_1):
        if name.startswith(surname) and len(name) - len(surname) == 2:
            return name[len(surname) :]
    return None


def collect_person_names(texts: Iterable[str], keep_words: Iterable[str] = ()) -> frozenset[str]:
    """글 묶음에서 직함·호칭·앞말과 함께 한 번이라도 나온 이름과, 성을 뗀 이름을 모은다.

    직함 없이 적혔어도 넉넉한 규칙 ③(성씨 + 이름에 흔한 두 글자)에 걸린 이름도 함께 모은다.

    돌려주는 이름은 지우는 데만 쓰고 저장하거나 밖으로 보내지 않는다.
    """
    keep = _keep_set(keep_words)
    found: set[str] = set()
    for raw in texts:
        text = normalize_text(raw)
        for match in _NAME_BEFORE_TITLE.finditer(text):
            name = match["name"]
            if len(name) > 1 and re.fullmatch("[가-힣]+", name) and _is_titled_name(name, keep):
                found.add(name)
        for match in _NAME_AFTER_LABEL.finditer(text):
            name = match["name"]
            if _is_name_wide(name, keep, titled=False) and name[-1] not in _PARTICLE_ENDINGS:
                found.add(name)
        for match in _ANY_BEFORE_HONORIFIC.finditer(text):
            if _is_name_wide(match["name"], keep, titled=True):
                found.add(match["name"])
        for pattern in (_ENGLISH_BEFORE_TITLE, _ENGLISH_AFTER_MR):
            for match in pattern.finditer(text):
                name = re.sub(r"^(?:Mr|Ms|Mrs|Dr)\.?\s?", "", match["name"])
                found.update(part for part in name.split() if not _protected(part, keep))
        for match in _BARE_FULL_NAME.finditer(text):
            if _is_bare_full_name(match["name"], keep):
                found.add(match["name"])
    found |= {given for name in found if (given := _given_name(name))}
    return frozenset(name for name in found if not _protected(name, keep))


def _scrub_known(text: str, known: frozenset[str], keep: frozenset[str]) -> str:
    for name in sorted(known, key=len, reverse=True):
        if _protected(name, keep):
            continue
        if not re.fullmatch("[가-힣]+", name):
            text = re.sub(rf"(?<![A-Za-z]){re.escape(name)}(?![A-Za-z])", NAME_MARK, text)
        elif len(name) >= 3:
            text = re.sub(rf"(?<![가-힣]){name}", NAME_MARK, text)
        else:
            common = name in NOT_NAME_WORDS_WIDE
            particles = "|".join(_AFFECTIONATE_PARTICLES) if common else _PARTICLES
            text = re.sub(
                rf"(?<![가-힣]){name}(?=\s?(?:{_TITLE_OR_HONORIFIC}){_AFTER_TITLE}"
                rf"|(?:{particles})(?![가-힣]))",
                NAME_MARK,
                text,
            )
    return text


def has_known_person_name(
    text: str, known_names: Iterable[str], keep_words: Iterable[str] = ()
) -> bool:
    """글에 알아 둔 이름이 (지우는 규칙에 걸리는 모양으로) 남아 있는지. 문의 재검사에 쓴다."""
    text = normalize_text(text)
    return _scrub_known(text, frozenset(known_names), _keep_set(keep_words)) != text


def scrub_person_names_wide(
    text: str, known_names: Iterable[str] = (), keep_words: Iterable[str] = ()
) -> tuple[str, int]:
    """글 하나에서 사람 이름을 넉넉하게 "[이름]"으로 바꾸고 바꾼 개수를 돌려준다(#720).

    scrub_person_names가 잡는 것(이름 + 직함·호칭, 앞말 + 이름)에 더해 아래를 지운다.
      ① 알아 둔 이름(known_names — 같은 회사 글에서 직함·호칭과 함께 나온 이름과 성을 뗀 이름)
         - 세 글자 이상 전체 이름: 조사·직함이 없어도 어디서나 지운다("김철수 통화함")
         - 두 글자 이름(성을 뗀 "철수", 외자 "허준"): 뒤에 호칭·직함이 오거나 낱말이 이름 조사
           (NAME_PARTICLES)로 끝날 때만 지운다("철수가", "철수 씨"). "정수 처리"처럼 조사 없이
           쓰인 것은 남긴다. 그 두 글자가 흔한 낱말(NOT_NAME_WORDS_WIDE: "지원"·"정수")이면
           호칭·직함이 오거나 "지원이가"처럼 부르는 꼴일 때만 지운다("지원이 필요"는 남김)
      ② 두세 글자 + 호칭: 성이 없어도 "철수 씨", "길동님께"
      ③ 성씨 + 이름에 흔한 두 글자(GIVEN_NAME_SYLLABLES), 낱말이 거기서 끝나거나 이름 조사로
         끝날 때: "홍길동이 검토 중", "홍길동 부재". 두 글자 낱말 + 조사("조건이")는 지우지 않는다
      ④ 영어 이름 + 직함·호칭("Kim 과장", "James 님"), "Mr. Kim"
    keep_words(공정·산업·지역·회사 이름처럼 프로그램이 아는 이름)와 같거나 그 앞부분인 낱말은
    이름으로 보지 않는다. 직함 앞에서도 지키므로 "한일 대표"의 회사 이름이 남는다.

    한계(남는 것): 직함 없이 처음 나온 외자 이름("허준이 전화"), 성 없이 조사만 붙은 이름("철수가"
    — 같은 회사 글에 직함과 함께 나온 적이 없을 때), 흔한 글자가 아닌 이름, 직함 없는 영어 이름,
    "김 씨", 조사 없이 적힌 두 글자 이름, 목록에 없는 성씨. 잘못 지울 수 있는 것: 성씨 글자로
    시작하고 이름 글자로 된 세 글자 낱말("조건은"류는 예외 목록으로 막는다). 새 낱말이 걸리면
    NOT_NAME_WORDS_WIDE에 더한다.
    """
    keep = _keep_set(keep_words)
    known = frozenset(known_names)
    text = normalize_text(text)
    before = text.count(NAME_MARK)

    def before_title(match: re.Match[str]) -> str:
        name, title = match["name"], match["title"]
        bare = len(name) == 1
        if bare and (title in PERSON_HONORIFICS or (name, title) in _AMBIGUOUS_BARE):
            return match[0]
        if not _is_titled_name(name, keep):
            return match[0]
        return f"{NAME_MARK} {title}"

    def after_label(match: re.Match[str]) -> str:
        name = match["name"]
        if not _is_name_wide(name, keep, titled=False) or name[-1] in _PARTICLE_ENDINGS:
            return match[0]
        return f"{match['label']}{NAME_MARK}"

    def english(match: re.Match[str]) -> str:
        if _protected(match["name"].split()[-1], keep):
            return match[0]
        return f"{NAME_MARK} {match['title']}"

    def honorific(match: re.Match[str]) -> str:
        if not _is_name_wide(match["name"], keep, titled=True):
            return match[0]
        return f"{NAME_MARK} {match['title']}"

    def bare_full(match: re.Match[str]) -> str:
        return NAME_MARK if _is_bare_full_name(match["name"], keep) else match[0]

    text = _NAME_BEFORE_TITLE.sub(before_title, text)
    text = _NAME_AFTER_LABEL.sub(after_label, text)
    text = _ENGLISH_BEFORE_TITLE.sub(english, text)
    text = _ENGLISH_AFTER_MR.sub(
        lambda m: m[0] if _protected(m["name"], keep) else m[0].replace(m["name"], NAME_MARK), text
    )
    text = _scrub_known(text, known, keep)
    text = _ANY_BEFORE_HONORIFIC.sub(honorific, text)
    text = _BARE_FULL_NAME.sub(bare_full, text)
    return text, text.count(NAME_MARK) - before


def scrub_person_names_in_texts(texts: Sequence[str], keep_words: Iterable[str] = ()) -> list[str]:
    """한 회사의 글 묶음을 한꺼번에 받아 사람 이름을 지운 사본을 같은 순서로 돌려준다(#720).

    묶음 안에서 직함·호칭과 함께 한 번이라도 나온 이름을 모으고(collect_person_names), 그 이름과
    성을 뗀 이름을 묶음 전체에서 직함 없이 나와도 지운다. 규칙과 한계는 scrub_person_names_wide.
    """
    keep = list(keep_words)
    known = collect_person_names(texts, keep)
    return [scrub_person_names_wide(text, known, keep)[0] for text in texts]
