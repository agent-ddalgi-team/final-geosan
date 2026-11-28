"""영업 분석 "상대 반응 — 거산의 강점·약점" 세기 (이슈 #985).

계약 C1 `GET /sales-analysis/reactions`.

담당자가 접촉을 저장하며 고른 상대 반응 답(꼬리 질문 REACTION · REACTION_GOOD · REACTION_BAD)만
센다. AI·외부 호출·저장 없음. 계산(`build_sales_reactions`)은 받은 값만 쓰는 순수 함수이고,
DB 읽기는 창구(`api/routes/sales_reactions.py`)가 한다.

세는 단위는 회사가 아니라 **접촉 건**이다. 기간 안의 살아 있는 통화·메일·대면 접촉 가운데
상대 반응 답이 있는 접촉 한 건을 그 답(긍정적·보통·부정적)으로 한 번 센다. 좋게 본 부분은
긍정적인 접촉의 답으로만, 걸린 부분은 부정적인 접촉의 답으로만 센다. 좋게 본 부분은 거산의
강점, 걸린 부분은 약점으로 읽는다.

공정이 여럿인 회사의 접촉은 공정 줄마다, 산업이 여럿이면 산업 줄마다 한 번씩 센다(전체에는
한 번). 기준 숫자는 이미 PM이 정한 `salesAnalysis.minSampleForRatio` 하나를 그대로 싣기만 한다.
응답에 나갈 값은 회사 이름·코드·건수·날짜뿐이다. 메모 글·답 글·사람 이름·연락처는 싣지 않는다.
"""

from __future__ import annotations

from collections import Counter
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from datetime import date

# 꼬리 질문 파일 약속(C7)의 질문 id와 보기 id. 규칙 숫자가 아니라 코드값이다.
# id는 한 번 쓰면 바꾸지 않는다는 질문 파일 약속에 기대어 여기 상수로 둔다
# (지난 답이 이 id로 저장된다).
QUESTION_REACTION = "REACTION"
QUESTION_GOOD = "REACTION_GOOD"
QUESTION_BAD = "REACTION_BAD"
REACTION_QUESTION_IDS = (QUESTION_REACTION, QUESTION_GOOD, QUESTION_BAD)
ANSWER_POSITIVE = "POSITIVE"
ANSWER_NEUTRAL = "NEUTRAL"
ANSWER_NEGATIVE = "NEGATIVE"
REACTION_ANSWER_IDS = (ANSWER_POSITIVE, ANSWER_NEUTRAL, ANSWER_NEGATIVE)

CONTACT_METHODS = frozenset({"CALL", "EMAIL", "VISIT"})
# 맨 끝 줄 이름은 이 경로의 약속 글 그대로다(`/sales-analysis`의 "확인 전" 줄과 이름이 다르다).
NO_PROCESS_NAME = "공정 미확정"
NO_INDUSTRY_NAME = "미확정"


# ---------------------------------------------------------------------------
# 계산에 넣는 값
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class ReactionLine:
    """살아 있는 영업 기록 한 행(저장 순서). 접촉이 아니면 method가 None이다."""

    day: date
    method: str | None
    # 이 행과 함께 저장된 꼬리 질문 답 (질문 id, 답 id). 답 글은 없다.
    answers: tuple[tuple[str, str], ...] = ()


@dataclass(frozen=True)
class ReactionCompany:
    """영업 분석표에 든 회사 한 곳. 공정·산업은 분석표와 같은 확정 값만 넘긴다."""

    opp_id: str
    name: str
    process_codes: tuple[str, ...]
    industries: tuple[str, ...]
    lines: tuple[ReactionLine, ...]


# ---------------------------------------------------------------------------
# 계산 결과
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class AnswerCount:
    answer_id: str
    count: int


@dataclass(frozen=True)
class ReactionGroup:
    """반응 묶음 하나(전체 · 산업 한 줄 · 공정 한 줄이 같은 모양).

    answered_count = positive + neutral + negative. good·bad는 많은 순, 같으면 질문 파일 보기 순서.
    """

    answered_count: int
    positive: int
    neutral: int
    negative: int
    good: list[AnswerCount]
    bad: list[AnswerCount]


@dataclass(frozen=True)
class IndustryRow(ReactionGroup):
    industry: str


@dataclass(frozen=True)
class ProcessRow(ReactionGroup):
    process_code: str | None
    process_name: str


@dataclass(frozen=True)
class ReactionContact:
    """반응을 남긴 접촉 한 건. good은 긍정적일 때만, bad는 부정적일 때만 값이 있다."""

    opp_id: str
    name: str
    day: date
    method: str
    reaction: str
    good: str | None
    bad: str | None
    industries: list[str]
    process_codes: list[str]


@dataclass(frozen=True)
class ReactionBasis:
    min_sample_for_ratio: int
    # 기간 안 통화·메일·대면 접촉 건수(반응 답이 없는 접촉·부재 접촉도 든다).
    contact_count: int
    # 그 가운데 상대 반응 답이 있는 건수.
    answered_count: int


@dataclass(frozen=True)
class SalesReactions:
    basis: ReactionBasis
    total: ReactionGroup
    by_industry: list[IndustryRow]
    by_process: list[ProcessRow]
    contacts: list[ReactionContact]


# ---------------------------------------------------------------------------
# 계산
# ---------------------------------------------------------------------------


def _in_period(day: date, period: tuple[date | None, date | None] | None) -> bool:
    if period is None:
        return True
    start, end = period
    return (start is None or day >= start) and (end is None or day <= end)


def _answer_counts(answer_ids: Sequence[str], order: Sequence[str]) -> list[AnswerCount]:
    """많은 순, 같으면 질문 파일 보기 순서. 0건인 보기는 싣지 않는다."""
    counts = Counter(answer_ids)
    return [
        AnswerCount(answer_id=answer_id, count=counts[answer_id])
        for answer_id in sorted(
            (answer_id for answer_id in order if counts[answer_id]),
            key=lambda answer_id: -counts[answer_id],
        )
    ]


def _group_values(
    contacts: Sequence[ReactionContact], good_order: Sequence[str], bad_order: Sequence[str]
) -> dict:
    reactions = Counter(contact.reaction for contact in contacts)
    return {
        "answered_count": len(contacts),
        "positive": reactions[ANSWER_POSITIVE],
        "neutral": reactions[ANSWER_NEUTRAL],
        "negative": reactions[ANSWER_NEGATIVE],
        "good": _answer_counts(
            [contact.good for contact in contacts if contact.good is not None], good_order
        ),
        "bad": _answer_counts(
            [contact.bad for contact in contacts if contact.bad is not None], bad_order
        ),
    }


def build_sales_reactions(
    companies: Sequence[ReactionCompany],
    *,
    processes: Sequence[tuple[str, str]],
    industries: Sequence[str],
    answer_order: Mapping[str, Sequence[str]],
    min_sample_for_ratio: int,
    period: tuple[date | None, date | None] | None = None,
) -> SalesReactions:
    """상대 반응 답을 접촉 건수로 세어 전체·산업별·공정별 묶음과 접촉 줄을 만든다.

    `companies`는 영업 분석표에 든 회사(같은 대상 규칙)와 그 살아 있는 기록 행이다.
    `processes`는 역량 파일 순서의 (코드, 이름), `industries`는 설정 순서다. 여기 없는 공정 코드·
    산업 이름은 줄을 만들지 않고 접촉 줄에도 싣지 않는다(분석표와 같다). 그래서 설정 안 산업이
    하나도 없는 회사의 접촉은 맨 끝 "미확정" 줄에, 공정이 없는 회사의 접촉은 "공정 미확정"
    줄에 든다.

    `answer_order`는 {질문 id: 질문 파일의 보기 id 순서}로 창구가 질문 파일에서 넘긴다. 질문 파일이
    기준이다: 파일에 상대 반응 질문이 없으면 반응 건수는 모두 0이고(오류 아님), 파일에 없는 보기로
    남아 있는 지난 답은 세지 않는다. 좋게 본 부분은 반응이 긍정적인 접촉에서만, 걸린 부분은
    부정적인 접촉에서만 센다(답이 없으면 어느 부분에도 넣지 않는다).

    `period`(시작일, 끝일 — 한국 날짜, 양끝 포함, 어느 한쪽은 None 가능)를 주면 그 안의 접촉만 센다.
    """
    reaction_ids = set(answer_order.get(QUESTION_REACTION, ())) & set(REACTION_ANSWER_IDS)
    good_order = list(answer_order.get(QUESTION_GOOD, ()))
    bad_order = list(answer_order.get(QUESTION_BAD, ()))

    contact_count = 0
    found: list[tuple[int, ReactionContact]] = []
    for company in companies:
        process_codes = [code for code, _ in processes if code in company.process_codes]
        named = [name for name in industries if name in company.industries]
        for saved_order, line in enumerate(company.lines):
            if line.method not in CONTACT_METHODS or not _in_period(line.day, period):
                continue
            contact_count += 1
            # 한 접촉에 같은 질문의 답은 하나다(저장할 때 막는다). 겹쳐 있으면 나중 답을 쓴다.
            answers = dict(line.answers)
            reaction = answers.get(QUESTION_REACTION)
            if reaction not in reaction_ids:
                continue
            good = answers.get(QUESTION_GOOD) if reaction == ANSWER_POSITIVE else None
            bad = answers.get(QUESTION_BAD) if reaction == ANSWER_NEGATIVE else None
            found.append(
                (
                    saved_order,
                    ReactionContact(
                        opp_id=company.opp_id,
                        name=company.name,
                        day=line.day,
                        method=line.method,
                        reaction=reaction,
                        good=good if good in good_order else None,
                        bad=bad if bad in bad_order else None,
                        industries=list(named),
                        process_codes=list(process_codes),
                    ),
                )
            )
    # 최근 날짜 순. 같은 날이면 회사 이름순(분석표 회사 줄과 같다),
    # 같은 회사면 나중에 저장한 접촉 먼저.
    found.sort(key=lambda item: (-item[1].day.toordinal(), item[1].name, item[1].opp_id, -item[0]))
    contacts = [contact for _, contact in found]

    def values(members: Sequence[ReactionContact]) -> dict:
        return _group_values(members, good_order, bad_order)

    by_industry: list[IndustryRow] = []
    for name in industries:
        members = [contact for contact in contacts if name in contact.industries]
        if members:
            by_industry.append(IndustryRow(industry=name, **values(members)))
    no_industry = [contact for contact in contacts if not contact.industries]
    if no_industry:
        by_industry.append(IndustryRow(industry=NO_INDUSTRY_NAME, **values(no_industry)))

    by_process: list[ProcessRow] = []
    for code, name in processes:
        members = [contact for contact in contacts if code in contact.process_codes]
        if members:
            by_process.append(ProcessRow(process_code=code, process_name=name, **values(members)))
    no_process = [contact for contact in contacts if not contact.process_codes]
    if no_process:
        by_process.append(
            ProcessRow(process_code=None, process_name=NO_PROCESS_NAME, **values(no_process))
        )

    return SalesReactions(
        basis=ReactionBasis(
            min_sample_for_ratio=min_sample_for_ratio,
            contact_count=contact_count,
            answered_count=len(contacts),
        ),
        total=ReactionGroup(**values(contacts)),
        by_industry=by_industry,
        by_process=by_process,
        contacts=contacts,
    )
