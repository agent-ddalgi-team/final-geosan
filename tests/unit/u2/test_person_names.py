"""#680: 영업 기록 글에서 사람 이름을 지운다. 모양으로만 찾으므로 한계도 함께 검사한다."""

import pytest

from geosan.evidence.contacts import (
    NAME_MARK,
    PERSON_TITLES,
    collect_person_names,
    has_known_person_name,
    scrub_person_names,
    scrub_person_names_in_texts,
    scrub_person_names_wide,
)

REMOVED = [
    ("김철수 과장과 통화", "[이름] 과장과 통화"),
    ("김철수과장님께 자료 보냄", "[이름] 과장님께 자료 보냄"),
    ("박 대리님이 다음 주 회신", "[이름] 대리님이 다음 주 회신"),
    ("김 과장", "[이름] 과장"),
    ("정 부장이 결재", "[이름] 부장이 결재"),
    ("이대리가 견적 요청", "[이름] 대리가 견적 요청"),
    ("이영희 님 부재", "[이름] 님 부재"),
    ("이영희씨가 받음", "[이름] 씨가 받음"),
    ("담당 홍길동", "담당 [이름]"),
    ("담당자: 홍길동", "담당자: [이름]"),
    ("성함은 최민수", "성함은 [이름]"),
    ("구매팀 과장 김영호", "구매팀 과장 [이름]"),
    ("남궁민수 팀장", "[이름] 팀장"),
    ("김○○ 과장", "[이름] 과장"),
    ("박** 대리", "[이름] 대리"),
    ("한지민 대표이사 면담", "[이름] 대표이사 면담"),
    ("최 이사는 긍정적", "[이름] 이사는 긍정적"),
    ("윤서연 매니저에게 전달", "[이름] 매니저에게 전달"),
    ("오 공장장 방문", "[이름] 공장장 방문"),
]

KEPT = [
    "한 번 더 연락",
    "이 회사는 외주 중",
    "정말 급하다고 함",
    "구매 과장이 받음",
    "구매팀 팀장 부재",
    "대리점 통해 납품",
    "대표번호로 전화",
    "대표이사 면담 예정",
    "이사회 승인 필요",
    "현장 소장과 통화",
    "공장장님 부재",
    "고객님 요청",
    "담당 공정은 아연도금",
    "담당자 부재",
    "담당 변경됨",
    "이 책임을 거산이 지기로",
    "사장님이 직접 받음",
    "손님 응대 중",
    "대표 제품은 볼트",
    "대표 전화는 없음",
    "우리 대표가 전달",
    "천안 공장 방문",
    "정밀 가공 문의",
    "도금 팀장이 회신",
    "선임 연구원과 통화",
    "책임자 확인 필요",
    "과장급 미팅",
    "아연도금 물량은 월 2톤",
]

# 한계: 직함·호칭·앞말이 없으면 이름인지 알 수 없다. 고쳐지면 이 표를 REMOVED로 옮긴다.
MISSED = [
    "홍길동이 전화함",
    "철수 씨가 받음",
    "Kim 과장과 통화",
    "김 씨가 받음",
]


@pytest.mark.parametrize(("text", "expected"), REMOVED)
def test_names_with_title_or_label_are_replaced(text, expected):
    assert scrub_person_names(text) == (expected, 1)


@pytest.mark.parametrize("text", KEPT)
def test_ordinary_words_are_not_removed(text):
    assert scrub_person_names(text) == (text, 0)


@pytest.mark.parametrize("text", MISSED)
def test_known_limits_names_without_title_are_not_found(text):
    assert scrub_person_names(text) == (text, 0)


def test_several_names_in_one_text_are_counted():
    text, count = scrub_person_names("강민호 책임, 조현우 선임 동석. 다음은 박 대리.")
    assert text == "[이름] 책임, [이름] 선임 동석. 다음은 [이름] 대리."
    assert count == 3


def test_every_title_keeps_the_title_and_drops_the_name():
    for title in PERSON_TITLES:
        text, count = scrub_person_names(f"김철수 {title}")
        assert (text, count) == (f"{NAME_MARK} {title}", 1), title


def test_existing_mark_is_not_counted_again():
    assert scrub_person_names("[이름] 과장과 통화") == ("[이름] 과장과 통화", 0)


# ---------------------------------------------------------------------------
# #720: 넉넉하게 지우기 + 회사 단위로 알아 둔 이름 지우기
# ---------------------------------------------------------------------------

WIDE_REMOVED = [
    ("홍길동이 전화함", "[이름]이 전화함"),
    ("홍길동 부재", "[이름] 부재"),
    ("강민호라는 분이 새로 옴", "[이름]라는 분이 새로 옴"),
    ("철수 씨가 받음", "[이름] 씨가 받음"),
    ("길동님께 자료 보냄", "[이름] 님께 자료 보냄"),
    ("Kim 과장과 통화", "[이름] 과장과 통화"),
    ("James 님이 승인", "[이름] 님이 승인"),
    ("Mr. Park에게 보냄", "Mr. [이름]에게 보냄"),
    ("이상민 과장이 품질 담당", "[이름] 과장이 품질 담당"),
    ("조성민이 연락 주기로", "[이름]이 연락 주기로"),
]

WIDE_KEPT = [
    "조건은 그대로, 장비는 신규로",
    "이상은 없다고 함",
    "성수기라 물량이 많음",
    "정수기 부품용 니켈도금 문의",
    "안정성 자료도 같이",
    "최우선으로 처리",
    "유효기간이 지나서 갱신 중",
    "지원 사업 신청 중",
    "설계실 팀장과 통화",
    "QC 팀장이 SUS304 소재 문의",
    "Excel로 보냄",
    "주임은 휴가",
    "관계자님 사모님 고객님",
    "요즘 날씨가 추움",
]

# 넉넉하게 지워도 남는 것. 고쳐지면 이 표를 WIDE_REMOVED로 옮긴다.
WIDE_MISSED = [
    "김 씨가 받음",
    "허준이 전화함",
    "철수가 받음",
    "David가 구매 담당",
    "탁재훈이 도면 보냄",
    "kim 과장과 통화",
]


@pytest.mark.parametrize(("text", "expected"), REMOVED + WIDE_REMOVED)
def test_wide_removes_what_the_narrow_one_does_and_more(text, expected):
    assert scrub_person_names_wide(text) == (expected, 1)


@pytest.mark.parametrize("text", KEPT + WIDE_KEPT)
def test_wide_keeps_ordinary_words(text):
    assert scrub_person_names_wide(text) == (text, 0)


@pytest.mark.parametrize("text", WIDE_MISSED)
def test_wide_known_limits(text):
    assert scrub_person_names_wide(text) == (text, 0)


def test_narrow_function_is_unchanged_by_the_wide_word_list():
    # 넓힌 예외 목록("이동")이 예전 함수에 섞이면 "이동욱 과장"을 덜 지우게 된다.
    assert scrub_person_names("이동욱 과장") == ("[이름] 과장", 1)
    assert scrub_person_names_wide("이동욱 과장") == ("[이름] 과장", 1)
    assert scrub_person_names_wide("이동중 연락") == ("이동중 연락", 0)


def test_name_seen_with_a_title_is_removed_everywhere_in_the_company_texts():
    texts = [
        "김철수 과장과 통화",
        "김철수 통화함. 김철수가 도면 보냄",
        "철수 씨가 실무. 철수한테 양식 받음. 철수가 회신",
        "철수 통화함",
    ]
    assert scrub_person_names_in_texts(texts) == [
        "[이름] 과장과 통화",
        "[이름] 통화함. [이름]가 도면 보냄",
        "[이름] 씨가 실무. [이름]한테 양식 받음. [이름]가 회신",
        "철수 통화함",  # 한계: 두 글자 이름은 조사·호칭이 붙었을 때만 지운다
    ]


def test_given_name_that_is_a_common_word_needs_a_title_or_calling_form():
    texts = [
        "김정수 차장 면담. 정수 처리 설비 도입",
        "정수가 폐수보다 비쌈. 정수 씨와 통화",
        "박지원 대리가 실무. 기술 지원이 필요. 지원이가 회신. 지원 대리 부재",
    ]
    assert scrub_person_names_in_texts(texts) == [
        "[이름] 차장 면담. 정수 처리 설비 도입",
        "정수가 폐수보다 비쌈. [이름] 씨와 통화",
        "[이름] 대리가 실무. 기술 지원이 필요. [이름]이가 회신. [이름] 대리 부재",
    ]


def test_name_found_without_a_title_also_teaches_the_given_name():
    assert scrub_person_names_in_texts(["홍길동 부재", "길동이가 품질 담당"]) == [
        "[이름] 부재",
        "[이름]이가 품질 담당",
    ]


def test_english_name_seen_with_a_title_is_removed_everywhere():
    assert scrub_person_names_in_texts(["James 님이 승인", "James가 사본 요청"]) == [
        "[이름] 님이 승인",
        "[이름]가 사본 요청",
    ]


def test_keep_words_protect_company_region_and_process_names():
    keep = ["한일정공", "경기 양평군", "전기아연도금"]
    text = "한일 대표와 미팅. 양평 공장장 면담. 전기아연도금 문의"
    assert scrub_person_names_wide(text)[1] == 2
    assert scrub_person_names_wide(text, (), keep) == (text, 0)
    assert scrub_person_names_in_texts([text, "한일이 먼저 연락"], keep) == [
        text,
        "한일이 먼저 연락",
    ]
    assert collect_person_names([text], keep) == frozenset()


def test_names_are_collected_only_from_real_name_shapes():
    texts = ["김철수 과장, 남궁민수 팀장, 박 대리, 김○○ 주임", "구매 과장이 받음"]
    assert collect_person_names(texts) == {"김철수", "철수", "남궁민수", "민수"}


def test_wide_scrub_is_stable_when_run_again():
    texts = [
        "김철수 과장과 홍길동 동석",
        "철수가 영희님께 전달. Kim 과장 부재",
        "홍길동, 김영희 과장",
    ]
    known = collect_person_names(texts)
    for text in scrub_person_names_in_texts(texts):
        assert scrub_person_names_wide(text, known) == (text, 0)
        assert not has_known_person_name(text, known)


def test_known_name_left_in_a_text_is_detected():
    assert has_known_person_name("철수가 회신", {"철수"})
    assert has_known_person_name("김철수 통화함", {"김철수"})
    assert not has_known_person_name("정수 처리 설비", {"정수"})
