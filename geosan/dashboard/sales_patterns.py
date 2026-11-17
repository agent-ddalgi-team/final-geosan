"""영업 분석 패턴 세기 (계약 C1 `GET /sales-analysis/patterns`, 이슈 #802 · #820).

"쓸수록 좋아지는 분석"에서 **보여 주기**를 맡는다(PM 결정 2026-11-17 "섞어 쓰기"). 담당자가 남긴
영업 기록·꼬리 질문 답·영업 코치 [넣기] 변경 기록만 센다. AI·외부 호출·저장 없음.
계산(`build_sales_patterns`)은 받은 값만 쓰는 순수 함수이고, DB 읽기는
창구(`api/routes/sales_analysis.py`)가 한다.

미리 정한 신호·기준 숫자는 두지 않는다. 방문 전 접촉 횟수별·접촉 간격별·꼬리 질문 답별·조합별로
성사·실패를 **펼쳐서** 보이고, 표본 기준은 이미 PM이 정한 `salesAnalysis.minSampleForRatio`
하나만 쓴다. 그 기준을 넘는 칸 가운데 전체 성사율과 차이가 큰 칸만 "눈에 띔"으로 표시한다 —
결론이 아니라 사람이 볼 곳이다. 패턴을 "확인할 패턴"으로 올리고 다음 기간에 검증하는 일(③·④)은
기록이 쌓인 뒤 따로 한다.

실패 = 거절(LOST) + 보류(ON_HOLD), 성공 = 성사(WON). 진행 중인 회사는 건수만 보이고 비율에는
넣지 않는다. 응답에 나갈 값은 코드·건수·비율뿐이다. 메모 글·답 글·회사 이름·주소는 싣지 않는다.
"""

from __future__ import annotations

from collections import Counter
from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass, field
from datetime import date
from decimal import ROUND_HALF_UP, Decimal
from itertools import product

STATUS_WON = "WON"
STATUS_LOST = "LOST"
STATUS_ON_HOLD = "ON_HOLD"
FAILED_STATUSES = frozenset({STATUS_LOST, STATUS_ON_HOLD})
CLOSED_STATUSES = FAILED_STATUSES | {STATUS_WON}
METHOD_VISIT = "VISIT"
CONTACT_METHODS = frozenset({"CALL", "EMAIL", "VISIT"})
RESULT_REACHED = "REACHED"
STEP_ALL = "ALL"
# 질문 파일에서 "모름" 보기의 id(질문 파일 약속 C7의 관례). 규칙 숫자가 아니라 코드값이다.
ANSWER_UNKNOWN = "UNKNOWN"
HINT_SAME_ANSWER = "SAME_ANSWER"
HINT_UNKNOWN_MANY = "UNKNOWN_MANY"
# 잘 되는 조합은 화면 한 칸에 보일 만큼만 싣는다(줄 수 상한, 계약 C1 "최대 20줄").
COMBO_LIMIT = 20
# "눈에 띔"은 화면에 보여 주는 개수다. 판단 기준이 아니다(기준은 minSampleForRatio 하나).
STANDOUT_LIMIT = 3

# 방문 전 접촉 횟수 칸(보기용 구간 — 판단 기준이 아니다). 4번 이상은 한 칸.
CONTACT_BUCKETS = ("ZERO", "ONE", "TWO", "THREE", "FOUR_PLUS")
# 접촉 사이 가장 긴 간격 칸(보기용 구간 — 판단 기준이 아니다): 1주 안 · 2주 안 · 한 달 안 · 그 이상.
GAP_BUCKET_DAYS = ((7, "WITHIN_WEEK"), (14, "WITHIN_TWO_WEEKS"), (30, "WITHIN_MONTH"))
GAP_OVER = "OVER_MONTH"
GAP_SINGLE = "SINGLE_CONTACT"
GAP_BUCKETS = (*(name for _, name in GAP_BUCKET_DAYS), GAP_OVER, GAP_SINGLE)

TABLE_CONTACTS = "CONTACTS_BEFORE_VISIT"
TABLE_GAP = "LONGEST_GAP"
TABLE_ANSWER = "ANSWER"
TABLE_COMBO = "COMBO"


# ---------------------------------------------------------------------------
# 계산에 넣는 값
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class PatternLine:
    """살아 있는 영업 기록 한 행(저장 순서). 접촉이 아니면 method·result가 None이다."""

    day: date
    method: str | None
    result: str | None
    status: str
    step_before: str | None
    step_after: str | None
    # 이 행과 함께 저장된 꼬리 질문 답 (질문 id, 답 id). 답 글은 없다.
    answers: tuple[tuple[str, str], ...] = ()


@dataclass(frozen=True)
class PatternCompany:
    opp_id: str
    # 영업 분석표와 같은 계산으로 정한 큰 단계(기간 모드면 끝일 기준)와 가장 먼 세부 단계.
    outcome_status: str
    furthest_step: str | None
    process_codes: tuple[str, ...]
    industries: tuple[str, ...]
    region: str | None
    lost_reason_code: str | None
    lines: tuple[PatternLine, ...]
    # 영업 코치 [넣기]로 일정을 잡은 날(변경 기록 "· 영업 코치 제안").
    coach_days: tuple[date, ...] = ()


@dataclass(frozen=True)
class QuestionInfo:
    """질문 파일의 한 질문에서 세기에 필요한 칸만."""

    question_id: str
    step: str
    # 보기를 회사 값에서 가져오는 질문(PROCESS·INDUSTRY)이면 True. 답별 표·몰림 표시는 내지 않는다.
    choices: bool = False
    # 앞 답이 이 중 하나일 때만 보이는 질문(showWhen). {질문 id: [답 id]}
    show_when: Mapping[str, Sequence[str]] = field(default_factory=dict)
    # 답이 영업을 끝내거나(closes: 성사·거절·보류) 거절 이유가 되는 질문(#820 후속, PM 2026-11-17).
    # 그 답이 결과 자체라 답별 표·'눈에 띔'에 넣으면 "거절로 답한 회사는 성사 0"처럼 순환한다.
    decides_outcome: bool = False


# ---------------------------------------------------------------------------
# 계산 결과
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class StepCount:
    step: str | None
    count: int


@dataclass(frozen=True)
class CodeCount:
    code: str
    count: int


@dataclass(frozen=True)
class AnswerCount:
    answer_id: str
    count: int


@dataclass(frozen=True)
class StepAnswers:
    step: str
    question_id: str
    answers: list[AnswerCount]


@dataclass(frozen=True)
class FailurePart:
    count: int
    on_hold_count: int
    by_step: list[StepCount]
    lost_reasons: list[CodeCount]
    step_answers: list[StepAnswers]


@dataclass(frozen=True)
class SuccessPart:
    count: int
    by_step: list[StepCount]
    avg_contacts_to_won: float | None
    avg_first_visit_index: float | None
    failed_avg_first_visit_index: float | None


@dataclass(frozen=True)
class ContactRow:
    """방문 전 접촉 횟수 칸 하나. 방문이 없는 회사는 모든 접촉 수로 칸을 정한다."""

    visited: bool
    bucket: str
    won: int
    failed: int
    in_progress: int
    # 끝난 회사(성사·실패)가 표본 기준 이상일 때만 성사 ÷ 끝난 회사.
    won_ratio: float | None
    judged: bool


@dataclass(frozen=True)
class GapRow:
    bucket: str
    won: int
    failed: int
    in_progress: int
    won_ratio: float | None
    judged: bool


@dataclass(frozen=True)
class AnswerRow:
    """꼬리 질문 하나의 답 하나(회사마다 그 질문의 마지막 답)."""

    question_id: str
    answer_id: str
    won: int
    failed: int
    in_progress: int
    won_ratio: float | None
    judged: bool


@dataclass(frozen=True)
class ComboRow:
    process_code: str | None
    industry: str | None
    region: str | None
    contacted: int
    won: int
    lost: int
    on_hold: int
    # 끝난 회사(성사·거절·보류)가 표본 기준 이상일 때만. 성사 ÷ 끝난 회사.
    won_ratio: float | None


@dataclass(frozen=True)
class Standout:
    """눈에 띔 · 결론 아님 · 사람 확인 전. 칸을 가리키는 열쇠 + 그 칸과 전체의 성사율."""

    table: str
    won: int
    failed: int
    won_ratio: float
    overall_won_ratio: float
    diff: float
    visited: bool | None = None
    bucket: str | None = None
    question_id: str | None = None
    answer_id: str | None = None
    process_code: str | None = None
    industry: str | None = None
    region: str | None = None


@dataclass(frozen=True)
class AnswerFill:
    question_id: str
    step: str
    eligible: int
    answered: int
    ratio: float | None
    # 기간 안 답의 분포(많은 순). 답 글은 없다.
    answers: list[AnswerCount] = field(default_factory=list)
    # (물을 자리인데 답 없음 + 답 "모름") ÷ 물을 자리. 물을 자리가 0이면 None.
    unknown_share: float | None = None
    # 가장 많은 답의 몫(보기를 회사 값에서 가져오는 질문은 None).
    top_share: float | None = None


@dataclass(frozen=True)
class QuestionnaireHint:
    question_id: str
    kind: str
    answer_id: str | None = None
    share: float | None = None


@dataclass(frozen=True)
class CoachEffect:
    applied: int
    progressed: int
    companies: int


@dataclass(frozen=True)
class PatternBasis:
    min_sample_for_ratio: int
    closed_count: int
    won_count: int
    # 끝난 회사가 표본 기준 이상일 때만 성사 ÷ 끝난 회사. "눈에 띔"이 견주는 값이다.
    overall_won_ratio: float | None


@dataclass(frozen=True)
class SalesPatterns:
    basis: PatternBasis
    failure: FailurePart
    success: SuccessPart
    contacts_before_visit: list[ContactRow]
    longest_gap: list[GapRow]
    answer_outcomes: list[AnswerRow]
    combos: list[ComboRow]
    standouts: list[Standout]
    answer_fill: list[AnswerFill]
    questionnaire_hints: list[QuestionnaireHint]
    coach_effect: CoachEffect


# ---------------------------------------------------------------------------
# 순수 계산
# ---------------------------------------------------------------------------


def ratio(count: int, total: int) -> float | None:
    """count ÷ total, 소수 2자리(0.5 올림). 영업 분석표와 같은 반올림. 나눌 수가 0이면 None."""
    if total == 0:
        return None
    return float((Decimal(count) / Decimal(total)).quantize(Decimal("0.01"), ROUND_HALF_UP))


def _average(values: Sequence[int]) -> float | None:
    if not values:
        return None
    mean = Decimal(sum(values)) / Decimal(len(values))
    return float(mean.quantize(Decimal("0.1"), ROUND_HALF_UP))


def _contacts(company: PatternCompany) -> list[PatternLine]:
    return [line for line in company.lines if line.method in CONTACT_METHODS]


def last_answers(company: PatternCompany) -> dict[str, str]:
    """질문마다 그 회사의 마지막 답(저장 순서로 뒤의 것)."""
    answers: dict[str, str] = {}
    for line in company.lines:
        for question_id, answer_id in line.answers:
            answers[question_id] = answer_id
    return answers


def _first_visit_index(company: PatternCompany) -> int | None:
    for index, line in enumerate(_contacts(company), start=1):
        if line.method == METHOD_VISIT:
            return index
    return None


def contact_bucket(company: PatternCompany) -> tuple[bool, str]:
    """(방문했나, 방문 전 접촉 횟수 칸). 방문이 없으면 모든 접촉 수로 칸을 정한다."""
    first_visit = _first_visit_index(company)
    count = len(_contacts(company)) if first_visit is None else first_visit - 1
    return first_visit is not None, CONTACT_BUCKETS[min(count, len(CONTACT_BUCKETS) - 1)]


def gap_bucket(company: PatternCompany) -> str:
    """이어진 두 접촉 사이 가장 긴 간격의 칸(보기용 구간). 접촉이 한 번뿐이면 SINGLE_CONTACT."""
    days = sorted(line.day for line in _contacts(company))
    if len(days) < 2:
        return GAP_SINGLE
    longest = max((later - earlier).days for earlier, later in zip(days, days[1:], strict=False))
    for limit, name in GAP_BUCKET_DAYS:
        if longest <= limit:
            return name
    return GAP_OVER


def _outcome_counts(companies: Sequence[PatternCompany], min_sample: int) -> dict:
    won = sum(c.outcome_status == STATUS_WON for c in companies)
    failed = sum(c.outcome_status in FAILED_STATUSES for c in companies)
    closed = won + failed
    return {
        "won": won,
        "failed": failed,
        "in_progress": len(companies) - closed,
        "won_ratio": ratio(won, closed) if closed >= min_sample else None,
        "judged": closed >= min_sample,
    }


def _step_counts(companies: Sequence[PatternCompany], step_order: Sequence[str]) -> list[StepCount]:
    counts = Counter(company.furthest_step for company in companies)
    ordered: list[str | None] = [None, *step_order]
    return [StepCount(step=step, count=counts[step]) for step in ordered if counts[step]]


def _in_period(day: date, period: tuple[date | None, date | None] | None) -> bool:
    if period is None:
        return True
    start, end = period
    return (start is None or day >= start) and (end is None or day <= end)


def _shown(question: QuestionInfo, answers_so_far: Mapping[str, str]) -> bool:
    if not question.show_when:
        return True
    return any(answers_so_far.get(qid) in set(ids) for qid, ids in question.show_when.items())


def answer_fill(
    companies: Sequence[PatternCompany],
    questions: Sequence[QuestionInfo],
    step_order: Sequence[str],
    period: tuple[date | None, date | None] | None,
) -> list[AnswerFill]:
    """질문별 답 채움률·답 분포·모름 몫·한 답 몰림(기준 숫자 없이 값 그대로).

    물을 자리(eligible): 단계가 ALL인 질문은 모든 접촉, 나머지는 그 단계에 있을 때 연결된 접촉.
    PROCESS·INDUSTRY 질문은 그 단계부터 답이 생길 때까지 뒤 단계에서도 묻는다(질문 파일 규칙).
    앞 답 조건(showWhen)이 있는 질문은 조건이 채워진 뒤에만 센다.
    """
    rank = {step: index for index, step in enumerate(step_order)}
    eligible: Counter = Counter()
    answered: Counter = Counter()
    answer_counts: dict[str, Counter] = {q.question_id: Counter() for q in questions}
    for company in companies:
        so_far: dict[str, str] = {}
        for line in company.lines:
            line_answers = dict(line.answers)
            if line.method in CONTACT_METHODS and _in_period(line.day, period):
                visible = {**so_far, **line_answers}
                for question in questions:
                    if question.step == STEP_ALL:
                        asked = True
                    elif line.result != RESULT_REACHED:
                        asked = False
                    elif question.choices:
                        asked = (
                            question.question_id not in so_far
                            and line.step_before in rank
                            and question.step in rank
                            and rank[line.step_before] >= rank[question.step]
                        )
                    else:
                        asked = line.step_before == question.step
                    if not asked or not _shown(question, visible):
                        continue
                    eligible[question.question_id] += 1
                    if question.question_id in line_answers:
                        answered[question.question_id] += 1
                        answer_counts[question.question_id][line_answers[question.question_id]] += 1
            so_far.update(line_answers)
    rows: list[AnswerFill] = []
    for question in questions:
        qid = question.question_id
        counts = answer_counts[qid]
        top = counts.most_common(1)[0][1] if counts else 0
        rows.append(
            AnswerFill(
                question_id=qid,
                step=question.step,
                eligible=eligible[qid],
                answered=answered[qid],
                ratio=ratio(answered[qid], eligible[qid]),
                answers=[
                    AnswerCount(answer_id=a, count=n)
                    for a, n in sorted(counts.items(), key=lambda item: (-item[1], item[0]))
                ],
                unknown_share=ratio(
                    eligible[qid] - answered[qid] + counts[ANSWER_UNKNOWN], eligible[qid]
                ),
                top_share=None if question.choices else ratio(top, sum(counts.values())),
            )
        )
    return rows


def questionnaire_hints(
    questions: Sequence[QuestionInfo], fill: Sequence[AnswerFill], min_sample: int
) -> list[QuestionnaireHint]:
    """손볼 만한 질문 표시(제안 · 승인 전). 비율 기준 없이,
    표본 기준을 넘는 질문 가운데 가장 큰 것 하나씩.

    - 한 답 몰림이 가장 큰 질문(답한 수 ≥ 표본 기준, 보기를 회사 값에서 가져오는 질문 제외)
    - 답 없음·모름 몫이 가장 큰 질문(물을 자리 ≥ 표본 기준, 몫이 0보다 클 때)
    """
    order = {q.question_id: i for i, q in enumerate(questions)}
    choices = {q.question_id for q in questions if q.choices}
    hints: list[QuestionnaireHint] = []
    same = [
        row
        for row in fill
        if row.question_id not in choices
        and row.answered >= min_sample
        and row.top_share is not None
    ]
    if same:
        row = max(same, key=lambda r: (r.top_share, -order[r.question_id]))
        hints.append(
            QuestionnaireHint(
                row.question_id, HINT_SAME_ANSWER, row.answers[0].answer_id, row.top_share
            )
        )
    unknown = [
        row
        for row in fill
        if row.eligible >= min_sample and row.unknown_share is not None and row.unknown_share > 0
    ]
    if unknown:
        row = max(unknown, key=lambda r: (r.unknown_share, -order[r.question_id]))
        hints.append(QuestionnaireHint(row.question_id, HINT_UNKNOWN_MANY, None, row.unknown_share))
    return hints


def coach_effect(companies: Sequence[PatternCompany], step_order: Sequence[str]) -> CoachEffect:
    """영업 코치 [넣기]로 잡은 일정 뒤에 세부 단계가 앞으로 갔거나 성사했나."""
    rank = {step: index for index, step in enumerate(step_order)}
    applied = progressed = with_coach = 0
    for company in companies:
        if not company.coach_days:
            continue
        with_coach += 1
        for day in company.coach_days:
            applied += 1
            before = [line for line in company.lines if line.day < day]
            after = [line for line in company.lines if line.day >= day]
            start = max((rank.get(line.step_after, -1) for line in before), default=-1)
            moved = any(rank.get(line.step_after, -1) > start for line in after)
            won = any(line.status == STATUS_WON for line in after)
            if moved or won:
                progressed += 1
    return CoachEffect(applied=applied, progressed=progressed, companies=with_coach)


def _group(
    companies: Sequence[PatternCompany], key: Callable[[PatternCompany], object]
) -> dict[object, list[PatternCompany]]:
    groups: dict[object, list[PatternCompany]] = {}
    for company in companies:
        groups.setdefault(key(company), []).append(company)
    return groups


def standouts(
    cells: Sequence[tuple[dict, int, int]],
    closed_total: int,
    overall: float | None,
    min_sample: int,
) -> list[Standout]:
    """눈에 띔: 그 칸의 끝난 회사와 나머지 끝난 회사가 둘 다 표본 기준 이상인 칸 가운데
    전체 성사율과의 차이가 0이 아닌 칸을 차이 큰 순으로 STANDOUT_LIMIT개까지.

    `cells`는 (칸 열쇠, 성사 수, 실패 수). 결론이 아니다 — 사람이 볼 곳을 가리킬 뿐이다.
    """
    if overall is None:
        return []
    found: list[tuple[float, int, Standout]] = []
    for index, (key, won, failed) in enumerate(cells):
        closed = won + failed
        if closed < min_sample or closed_total - closed < min_sample:
            continue
        cell_ratio = ratio(won, closed)
        diff = round(cell_ratio - overall, 2)
        if diff == 0:
            continue
        found.append(
            (
                -abs(diff),
                index,
                Standout(
                    won=won,
                    failed=failed,
                    won_ratio=cell_ratio,
                    overall_won_ratio=overall,
                    diff=diff,
                    **key,
                ),
            )
        )
    found.sort(key=lambda item: (item[0], item[1]))
    return [item[2] for item in found[:STANDOUT_LIMIT]]


def _failure_part(
    failed: Sequence[PatternCompany],
    answer_questions: Sequence[QuestionInfo],
    step_order: Sequence[str],
    lost_reason_order: Sequence[str],
) -> FailurePart:
    reason_rank = {code: index for index, code in enumerate(lost_reason_order)}
    reasons = Counter(
        c.lost_reason_code for c in failed if c.outcome_status == STATUS_LOST and c.lost_reason_code
    )
    step_answers: list[StepAnswers] = []
    for step in step_order:
        here = [c for c in failed if c.furthest_step == step]
        if not here:
            continue
        for question in answer_questions:
            if question.step != step:
                continue
            counts = Counter(
                answer
                for c in here
                if (answer := last_answers(c).get(question.question_id)) is not None
            )
            if counts:
                step_answers.append(
                    StepAnswers(
                        step=step,
                        question_id=question.question_id,
                        answers=[
                            AnswerCount(answer_id=a, count=n)
                            for a, n in sorted(counts.items(), key=lambda item: (-item[1], item[0]))
                        ],
                    )
                )
    return FailurePart(
        count=len(failed),
        on_hold_count=sum(c.outcome_status == STATUS_ON_HOLD for c in failed),
        by_step=_step_counts(failed, step_order),
        lost_reasons=[
            CodeCount(code=code, count=count)
            for code, count in sorted(
                reasons.items(), key=lambda item: (-item[1], reason_rank.get(item[0], 99))
            )
        ],
        step_answers=step_answers,
    )


def build_sales_patterns(
    companies: Sequence[PatternCompany],
    *,
    questions: Sequence[QuestionInfo],
    step_order: Sequence[str],
    lost_reason_order: Sequence[str],
    min_sample_for_ratio: int,
    period: tuple[date | None, date | None] | None = None,
) -> SalesPatterns:
    """기록을 펼쳐 센다. `companies`는 영업 분석표에 든 회사(같은 대상·기간 규칙)다."""
    min_sample = min_sample_for_ratio
    failed = [c for c in companies if c.outcome_status in FAILED_STATUSES]
    won = [c for c in companies if c.outcome_status == STATUS_WON]
    closed_total = len(failed) + len(won)
    overall = ratio(len(won), closed_total) if closed_total >= min_sample else None
    answer_questions = [q for q in questions if not q.choices]

    success = SuccessPart(
        count=len(won),
        by_step=_step_counts(won, step_order),
        avg_contacts_to_won=_average([len(_contacts(c)) for c in won]),
        avg_first_visit_index=_average(
            [i for c in won if (i := _first_visit_index(c)) is not None]
        ),
        failed_avg_first_visit_index=_average(
            [i for c in failed if (i := _first_visit_index(c)) is not None]
        ),
    )

    cells: list[tuple[dict, int, int]] = []

    by_contacts = _group(companies, contact_bucket)
    contact_rows: list[ContactRow] = []
    for visited in (True, False):
        for bucket in CONTACT_BUCKETS:
            group = by_contacts.get((visited, bucket), [])
            if not group:
                continue
            row = ContactRow(visited=visited, bucket=bucket, **_outcome_counts(group, min_sample))
            contact_rows.append(row)
            key = {"table": TABLE_CONTACTS, "visited": visited, "bucket": bucket}
            cells.append((key, row.won, row.failed))

    by_gap = _group(companies, gap_bucket)
    gap_rows: list[GapRow] = []
    for bucket in GAP_BUCKETS:
        group = by_gap.get(bucket, [])
        if not group:
            continue
        row = GapRow(bucket=bucket, **_outcome_counts(group, min_sample))
        gap_rows.append(row)
        cells.append(({"table": TABLE_GAP, "bucket": bucket}, row.won, row.failed))

    answers_by_company = {c.opp_id: last_answers(c) for c in companies}
    answer_rows: list[AnswerRow] = []
    for question in answer_questions:
        if question.decides_outcome:
            continue  # 결과 자체인 질문은 결과를 설명하는 칸이 될 수 없다(순환)
        qid = question.question_id
        groups = _group(
            [c for c in companies if qid in answers_by_company[c.opp_id]],
            lambda c, qid=qid: answers_by_company[c.opp_id][qid],
        )
        for answer_id in sorted(groups, key=lambda a: (-len(groups[a]), str(a))):
            row = AnswerRow(
                question_id=qid,
                answer_id=str(answer_id),
                **_outcome_counts(groups[answer_id], min_sample),
            )
            answer_rows.append(row)
            key = {"table": TABLE_ANSWER, "question_id": qid, "answer_id": row.answer_id}
            cells.append((key, row.won, row.failed))

    combo_counts: dict[tuple, Counter] = {}
    for company in companies:
        for key in product(
            company.process_codes or (None,), company.industries or (None,), (company.region,)
        ):
            bucket = combo_counts.setdefault(key, Counter())
            bucket["contacted"] += 1
            bucket[company.outcome_status] += 1
    combos: list[ComboRow] = []
    for key, bucket in combo_counts.items():
        failed_n = bucket[STATUS_LOST] + bucket[STATUS_ON_HOLD]
        closed_n = bucket[STATUS_WON] + failed_n
        combos.append(
            ComboRow(
                process_code=key[0],
                industry=key[1],
                region=key[2],
                contacted=bucket["contacted"],
                won=bucket[STATUS_WON],
                lost=bucket[STATUS_LOST],
                on_hold=bucket[STATUS_ON_HOLD],
                won_ratio=ratio(bucket[STATUS_WON], closed_n) if closed_n >= min_sample else None,
            )
        )
        combo_key = {
            "table": TABLE_COMBO,
            "process_code": key[0],
            "industry": key[1],
            "region": key[2],
        }
        cells.append((combo_key, bucket[STATUS_WON], failed_n))
    combos.sort(
        key=lambda row: (
            -row.won,
            -row.contacted,
            row.process_code or "~",
            row.industry or "~",
            row.region or "~",
        )
    )

    fill = answer_fill(companies, questions, step_order, period)
    return SalesPatterns(
        basis=PatternBasis(
            min_sample_for_ratio=min_sample,
            closed_count=closed_total,
            won_count=len(won),
            overall_won_ratio=overall,
        ),
        failure=_failure_part(failed, answer_questions, step_order, lost_reason_order),
        success=success,
        contacts_before_visit=contact_rows,
        longest_gap=gap_rows,
        answer_outcomes=answer_rows,
        combos=combos[:COMBO_LIMIT],
        standouts=standouts(cells, closed_total, overall, min_sample),
        answer_fill=fill,
        questionnaire_hints=questionnaire_hints(questions, fill, min_sample),
        coach_effect=coach_effect(companies, step_order),
    )
