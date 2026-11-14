"""#720: 가짜 메모로 이름 지우기가 얼마나 남기고 얼마나 잘못 지우는지 재고, 그 수준을 못 박는다.

자료(`data/memo_name_samples.yaml`)는 전부 지어낸 것이다. 숫자를 좋게 보이려고 쉬운 문장만 넣지
않았다 — 남는 것은 KNOWN_LEFT에 적어 두고, 새로 남는 이름이나 잘못 지우는 낱말이 생기면 실패한다.
실제 AI 호출·DB는 쓰지 않는다.
"""

from pathlib import Path

import pytest
import yaml

from geosan.evidence.contacts import (
    collect_person_names,
    has_known_person_name,
    scrub_contacts,
    scrub_person_names,
    scrub_person_names_in_texts,
    scrub_person_names_wide,
)

SAMPLES = yaml.safe_load(
    (Path(__file__).parent / "data" / "memo_name_samples.yaml").read_text(encoding="utf-8")
)

# 2026-11-14 측정값. 더 좋아지면 숫자를 내리고, 나빠지면 테스트가 실패한다.
MEMO_COUNT = 64
NAME_COUNT = 59
OLD_LEFT = 38  # 예전 방식(글 하나씩 scrub_person_names)으로 남은 이름
NEW_LEFT_MAX = 6  # 새 방식(회사 묶음 scrub_person_names_in_texts)으로 남은 이름
NEW_WRONG_MAX = 0  # 새 방식이 지운 핵심 낱말
PLAIN_CHANGED_MAX = 0  # 이름 없는 문장 가운데 한 글자라도 바뀐 문장

# 새 방식으로도 남는 이름(알려진 한계). (모양, 남은 글자)
KNOWN_LEFT = {
    ("영어 이름(직함 없는 첫 등장)", "David"),
    ("외자 이름(직함 없는 첫 등장)", "김구"),
    ("성 뗀 이름+조사", "선영"),  # "성민과 선영 둘 다" — 뒤 이름에 조사가 없다
    ("성 뗀 이름(조사 없음)", "민호"),
    ("앞말+이름(목록에 없는 성씨)", "표예린"),
    ("직함 없음(목록에 없는 성씨)", "탁재훈"),
}


def _keep_words(company):
    return SAMPLES["known_words"] + company["keep_words"]


def _measure():
    """(메모 수, 이름 수, 예전 방식 남은 것, 새 방식 남은 것, 예전 잘못 지움, 새 잘못 지움)."""
    memos = names = 0
    old_left, new_left, old_wrong, new_wrong = [], [], [], []
    for company in SAMPLES["companies"]:
        texts = [scrub_contacts(memo["text"])[0] for memo in company["memos"]]
        new_texts = scrub_person_names_in_texts(texts, _keep_words(company))
        for memo, text, new in zip(company["memos"], texts, new_texts, strict=True):
            memos += 1
            old = scrub_person_names(text)[0]
            for name in memo["names"]:
                names += 1
                assert name in text, f"자료 오류: {name!r}가 글에 없다"
                if name in old:
                    old_left.append((memo["kind"], name))
                if name in new:
                    new_left.append((memo["kind"], name))
            for word in memo["keep"]:
                assert word in text, f"자료 오류: {word!r}가 글에 없다"
                if word not in old:
                    old_wrong.append((word, old))
                if word not in new:
                    new_wrong.append((word, new))
    return memos, names, old_left, new_left, old_wrong, new_wrong


def test_sample_size_is_what_the_report_says():
    memos, names, *_ = _measure()
    assert (memos, names) == (MEMO_COUNT, NAME_COUNT)
    assert 8 <= len(SAMPLES["companies"]) <= 10


def test_old_way_leaves_most_untitled_names():
    old_left = _measure()[2]
    assert len(old_left) == OLD_LEFT


def test_new_way_leaves_no_more_names_than_measured():
    new_left = _measure()[3]
    assert len(new_left) <= NEW_LEFT_MAX, new_left
    assert set(new_left) <= KNOWN_LEFT, set(new_left) - KNOWN_LEFT


def test_new_way_does_not_remove_key_words():
    new_wrong = _measure()[5]
    assert len(new_wrong) <= NEW_WRONG_MAX, new_wrong


def test_sentences_without_names_are_left_alone():
    changed = [
        (sentence, out)
        for sentence in SAMPLES["plain_sentences"]
        if (out := scrub_person_names_wide(sentence, (), SAMPLES["known_words"])[0]) != sentence
    ]
    assert len(SAMPLES["plain_sentences"]) == 40
    assert len(changed) <= PLAIN_CHANGED_MAX, changed


@pytest.mark.parametrize("company", SAMPLES["companies"], ids=lambda c: c["company"])
def test_scrubbed_company_texts_pass_the_same_check_again(company):
    keep = _keep_words(company)
    texts = [scrub_contacts(memo["text"])[0] for memo in company["memos"]]
    known = collect_person_names(texts, keep)
    for out in scrub_person_names_in_texts(texts, keep):
        assert scrub_person_names_wide(out, known, keep) == (out, 0)
        assert not has_known_person_name(out, known, keep)


def test_samples_hold_no_real_looking_contacts():
    raw = (Path(__file__).parent / "data" / "memo_name_samples.yaml").read_text(encoding="utf-8")
    assert scrub_contacts(raw.replace("010-0000-0000", ""))[1] == 0
