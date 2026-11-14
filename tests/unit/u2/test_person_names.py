"""#680: 영업 기록 글에서 사람 이름을 지운다. 모양으로만 찾으므로 한계도 함께 검사한다."""

import pytest

from geosan.evidence.contacts import NAME_MARK, PERSON_TITLES, scrub_person_names

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
