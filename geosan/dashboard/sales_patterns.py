"""영업 분석 패턴 세기 1단계 (계약 C1 `GET /sales-analysis/patterns`, 이슈 #802).

"쓸수록 좋아지는 분석"의 첫 단계다. 담당자가 남긴 영업 기록·꼬리 질문 답·영업 코치 [넣기] 변경
기록만 센다. AI·외부 호출·저장 없음. 계산(`build_sales_patterns`)은 받은 값만 쓰는 순수 함수이고,
DB 읽기는 창구(`api/routes/sales_analysis.py`)가 한다. 기준 숫자는 설정 `salesPatterns`에서 받는다
(규칙 ⑩). 응답에 나갈 값은 코드·건수·비율뿐이다. 메모 글·답 글·회사 이름·주소는 싣지 않는다.

실패 = 거절(LOST) + 보류(ON_HOLD), 성공 = 성사(WON). 진행 중인 회사는 신호 비교에 넣지 않는다.
표본이 기준(`salesAnalysis.minSampleForRatio`)보다 적으면 비율을 내지 않거나 "판단 보류"로 둔다.
"""

from __future__ import annotations

from collections import Counter
from collections.abc import Mapping, Sequence
from dataclasses import dataclass, field
from datetime import date
from decimal import ROUND_HALF_UP, Decimal
from itertools import product

STATUS_WON = "WON"
STATUS_LOST = "LOST"
STATUS_ON_HOLD = "ON_HOLD"
FAILED_STATUSES = frozenset({STATUS_LOST, STATUS_ON_HOLD})
CLOSED_STATUSES = FAILED_STATUSES | {STATUS_WON}
METHOD_CALL = "CALL"
METHOD_VISIT = "VISIT"
CONTACT_METHODS = frozenset({"CALL", "EMAIL", "VISIT"})
RESULT_REACHED = "REACHED"
STEP_ALL = "ALL"
# 질문 파일에서 "모름" 보기의 id(질문 파일 약속 C7의 관례). 규칙 숫자가 아니라 코드값이다.
ANSWER_UNKNOWN = "UNKNOWN"
SIGNAL_CALL_ONLY = "CALL_ONLY"
SIGNAL_LONG_GAP = "LONG_GAP"
SIGNAL_ANSWER = "ANSWER"
HINT_SAME_ANSWER = "SAME_ANSWER"
HINT_UNKNOWN_MANY = "UNKNOWN_MANY"
HINT_SPLITS_OUTCOME = "SPLITS_OUTCOME"
# 잘 되는 조합은 화면 한 칸에 보일 만큼만 싣는다(줄 수 상한, 계약 C1 "최대 20줄").
COMBO_LIMIT = 20


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
    # 보기를 회사 값에서 가져오는 질문(PROCESS·INDUSTRY)이면 True. 답 쏠림 신호는 내지 않는다.
    choices: bool = False
    # 앞 답이 이 중 하나일 때만 보이는 질문(showWhen). {질문 id: [답 id]}
    show_when: Mapping[str, Sequence[str]] = field(default_factory=dict)


@dataclass(frozen=True)
class AnswerSignal:
    question_id: str
    answer_ids: tuple[str, ...]


@dataclass(frozen=True)
class PatternSettings:
    min_sample_for_ratio: int
    call_only_min_calls: int
    gap_days: int
    answer_signals: tuple[AnswerSignal, ...]
    min_records_for_patterns: int
    same_answer_ratio: float
    unknown_ratio: float
    split_diff: float
    split_min_group: int


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
class SignalRow:
    code: str
    question_id: str | None
    answer_ids: list[str]
    with_signal: int
    failed: int
    won: int
    failed_share: float | None
    won_share: float | None
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
    won_ratio: float | None


@dataclass(frozen=True)
class AnswerFill:
    question_id: str
    step: str
    eligible: int
    answered: int
    ratio: float | None


@dataclass(frozen=True)
class QuestionnaireHint:
    question_id: str
    kind: str
    answer_id: str | None = None
    share: float | None = None
    won_ratio_high: float | None = None
    won_ratio_low: float | None = None


@dataclass(frozen=True)
class CoachEffect:
    applied: int
    progressed: int
    companies: int


@dataclass(frozen=True)
class PatternBasis:
    min_sample_for_ratio: int
    usable_count: int
    needed_count: int
    enough: bool


@dataclass(frozen=True)
class SalesPatterns:
    basis: PatternBasis
    failure: FailurePart
    success: SuccessPart
    signals: list[SignalRow]
    combos: list[ComboRow]
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


def company_signals(company: PatternCompany, settings: PatternSettings) -> set[tuple]:
    """회사에 있던 신호 열쇠들. (코드, 질문 id 또는 None, 답 id 묶음)."""
    found: set[tuple] = set()
    contacts = _contacts(company)
    methods = Counter(line.method for line in contacts)
    if methods[METHOD_CALL] >= settings.call_only_min_calls and methods[METHOD_VISIT] == 0:
        found.add((SIGNAL_CALL_ONLY, None, ()))
    days = sorted(line.day for line in contacts)
    if any(
        (later - earlier).days > settings.gap_days
        for earlier, later in zip(days, days[1:], strict=False)
    ):
        found.add((SIGNAL_LONG_GAP, None, ()))
    answers = last_answers(company)
    for signal in settings.answer_signals:
        if answers.get(signal.question_id) in signal.answer_ids:
            found.add((SIGNAL_ANSWER, signal.question_id, signal.answer_ids))
    return found


def _first_visit_index(company: PatternCompany) -> int | None:
    for index, line in enumerate(_contacts(company), start=1):
        if line.method == METHOD_VISIT:
            return index
    return None


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
) -> tuple[list[AnswerFill], dict[str, Counter]]:
    """질문별 답 채움률과, 기간 안 답의 답별 건수.

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
    rows = [
        AnswerFill(
            question_id=question.question_id,
            step=question.step,
            eligible=eligible[question.question_id],
            answered=answered[question.question_id],
            ratio=ratio(answered[question.question_id], eligible[question.question_id]),
        )
        for question in questions
    ]
    return rows, answer_counts


def questionnaire_hints(
    questions: Sequence[QuestionInfo],
    fill: Sequence[AnswerFill],
    answer_counts: Mapping[str, Counter],
    closed: Sequence[PatternCompany],
    settings: PatternSettings,
) -> list[QuestionnaireHint]:
    """질문지 다듬기 신호(제안 목록). 반영은 사람이 질문 파일에서 한다."""
    by_id = {row.question_id: row for row in fill}
    hints: list[QuestionnaireHint] = []
    last = {company.opp_id: last_answers(company) for company in closed}
    for question in questions:
        row = by_id[question.question_id]
        counts = answer_counts.get(question.question_id, Counter())
        total = sum(counts.values())
        if not question.choices and total >= settings.min_sample_for_ratio:
            top, top_count = counts.most_common(1)[0]
            share = ratio(top_count, total)
            if share is not None and share >= settings.same_answer_ratio:
                hints.append(QuestionnaireHint(question.question_id, HINT_SAME_ANSWER, top, share))
        if row.eligible >= settings.min_sample_for_ratio:
            missing = row.eligible - row.answered + counts[ANSWER_UNKNOWN]
            share = ratio(missing, row.eligible)
            if share is not None and share >= settings.unknown_ratio:
                hints.append(
                    QuestionnaireHint(question.question_id, HINT_UNKNOWN_MANY, None, share)
                )
        if question.choices:
            continue
        groups: dict[str, list[bool]] = {}
        for company in closed:
            answer = last[company.opp_id].get(question.question_id)
            if answer is not None:
                groups.setdefault(answer, []).append(company.outcome_status == STATUS_WON)
        if sum(len(values) for values in groups.values()) < settings.min_sample_for_ratio:
            continue
        rates = {
            answer: ratio(sum(values), len(values))
            for answer, values in groups.items()
            if len(values) >= settings.split_min_group
        }
        if len(rates) < 2:
            continue
        high = max(rates, key=lambda key: (rates[key], key))
        low = min(rates, key=lambda key: (rates[key], key))
        if rates[high] - rates[low] >= settings.split_diff:
            hints.append(
                QuestionnaireHint(
                    question.question_id,
                    HINT_SPLITS_OUTCOME,
                    high,
                    None,
                    won_ratio_high=rates[high],
                    won_ratio_low=rates[low],
                )
            )
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


def build_sales_patterns(
    companies: Sequence[PatternCompany],
    *,
    questions: Sequence[QuestionInfo],
    step_order: Sequence[str],
    lost_reason_order: Sequence[str],
    settings: PatternSettings,
    period: tuple[date | None, date | None] | None = None,
) -> SalesPatterns:
    """실패·성공 패턴을 센다. `companies`는 영업 분석표에 든 회사(같은 대상·기간 규칙)다."""
    failed = [c for c in companies if c.outcome_status in FAILED_STATUSES]
    won = [c for c in companies if c.outcome_status == STATUS_WON]
    closed = failed + won
    question_steps = {q.question_id: q.step for q in questions if not q.choices}

    reason_rank = {code: index for index, code in enumerate(lost_reason_order)}
    reasons = Counter(
        c.lost_reason_code for c in failed if c.outcome_status == STATUS_LOST and c.lost_reason_code
    )
    step_answers: list[StepAnswers] = []
    for step in step_order:
        here = [c for c in failed if c.furthest_step == step]
        if not here:
            continue
        for question_id, question_step in question_steps.items():
            if question_step != step:
                continue
            counts = Counter(
                answer for c in here if (answer := last_answers(c).get(question_id)) is not None
            )
            if counts:
                step_answers.append(
                    StepAnswers(
                        step=step,
                        question_id=question_id,
                        answers=[
                            AnswerCount(answer_id=a, count=n)
                            for a, n in sorted(counts.items(), key=lambda item: (-item[1], item[0]))
                        ],
                    )
                )
    failure = FailurePart(
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

    keys: list[tuple] = [(SIGNAL_CALL_ONLY, None, ()), (SIGNAL_LONG_GAP, None, ())] + [
        (SIGNAL_ANSWER, s.question_id, s.answer_ids) for s in settings.answer_signals
    ]
    found = {c.opp_id: company_signals(c, settings) for c in closed}
    signals: list[SignalRow] = []
    for key in keys:
        holders = [c for c in closed if key in found[c.opp_id]]
        failed_n = sum(c.outcome_status in FAILED_STATUSES for c in holders)
        won_n = sum(c.outcome_status == STATUS_WON for c in holders)
        signals.append(
            SignalRow(
                code=key[0],
                question_id=key[1],
                answer_ids=list(key[2]),
                with_signal=len(holders),
                failed=failed_n,
                won=won_n,
                failed_share=ratio(failed_n, len(failed)),
                won_share=ratio(won_n, len(won)),
                judged=len(holders) >= settings.min_sample_for_ratio,
            )
        )

    combo_counts: dict[tuple, Counter] = {}
    for company in companies:
        for key in product(
            company.process_codes or (None,), company.industries or (None,), (company.region,)
        ):
            bucket = combo_counts.setdefault(key, Counter())
            bucket["contacted"] += 1
            bucket[company.outcome_status] += 1
    combos = [
        ComboRow(
            process_code=key[0],
            industry=key[1],
            region=key[2],
            contacted=bucket["contacted"],
            won=bucket[STATUS_WON],
            lost=bucket[STATUS_LOST],
            on_hold=bucket[STATUS_ON_HOLD],
            won_ratio=(
                ratio(bucket[STATUS_WON], bucket["contacted"])
                if bucket["contacted"] >= settings.min_sample_for_ratio
                else None
            ),
        )
        for key, bucket in combo_counts.items()
    ]
    combos.sort(
        key=lambda row: (
            -row.won,
            -row.contacted,
            row.process_code or "~",
            row.industry or "~",
            row.region or "~",
        )
    )

    fill, answer_counts = answer_fill(companies, questions, step_order, period)
    hints = questionnaire_hints(questions, fill, answer_counts, closed, settings)
    return SalesPatterns(
        basis=PatternBasis(
            min_sample_for_ratio=settings.min_sample_for_ratio,
            usable_count=len(closed),
            needed_count=settings.min_records_for_patterns,
            enough=len(closed) >= settings.min_records_for_patterns,
        ),
        failure=failure,
        success=success,
        signals=signals,
        combos=combos[:COMBO_LIMIT],
        answer_fill=fill,
        questionnaire_hints=hints,
        coach_effect=coach_effect(companies, step_order),
    )
