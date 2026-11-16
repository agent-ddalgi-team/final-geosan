"""#802 1단계: 영업 분석 패턴 세기(순수 계산). AI·외부 호출·DB 없음. 가상 값만 쓴다."""

from datetime import date

from geosan.dashboard.sales_patterns import (
    AnswerSignal,
    PatternCompany,
    PatternLine,
    PatternSettings,
    QuestionInfo,
    build_sales_patterns,
)

STEPS = ["NOT_REACHED", "REACHED", "DEMAND_CONFIRMED", "MATERIAL_QUOTE", "VISIT_SAMPLE"]
LOST_ORDER = ["PRICE", "LEAD_TIME", "INCUMBENT_SUPPLIER", "NO_DEMAND", "QUALITY_CERT", "OTHER"]
QUESTIONS = [
    QuestionInfo("WHO_TALKED", "NOT_REACHED"),
    QuestionInfo("PLATING_NOW", "REACHED"),
    QuestionInfo("NEED_PROCESS", "REACHED", show_when={"PLATING_NOW": ["IN_HOUSE"]}),
    QuestionInfo("INTEREST", "REACHED"),
    QuestionInfo("WHO_INITIATED", "ALL"),
    QuestionInfo("CONFIRM_PROCESS", "REACHED", choices=True),
]


def settings(min_sample=10, **extra):
    values = dict(
        min_sample_for_ratio=min_sample,
        call_only_min_calls=3,
        gap_days=14,
        answer_signals=(AnswerSignal("INTEREST", ("LOW", "NONE")),),
        min_records_for_patterns=30,
        same_answer_ratio=0.8,
        unknown_ratio=0.5,
        split_diff=0.3,
        split_min_group=3,
    )
    values.update(extra)
    return PatternSettings(**values)


def contact(day, method="CALL", result="REACHED", before="REACHED", after="REACHED", answers=()):
    return PatternLine(
        day=day,
        method=method,
        result=result,
        status="IN_PROGRESS",
        step_before=before,
        step_after=after,
        answers=tuple(answers),
    )


def close(day, status, after=None):
    return PatternLine(day, None, None, status, after, after)


def company(
    opp_id,
    status,
    lines,
    furthest="REACHED",
    processes=("ZINC",),
    industries=("자동차 부품",),
    region="천안·아산",
    reason=None,
    coach=(),
):
    return PatternCompany(
        opp_id=opp_id,
        outcome_status=status,
        furthest_step=furthest,
        process_codes=tuple(processes),
        industries=tuple(industries),
        region=region,
        lost_reason_code=reason,
        lines=tuple(lines),
        coach_days=tuple(coach),
    )


def build(companies, **kwargs):
    return build_sales_patterns(
        companies,
        questions=QUESTIONS,
        step_order=STEPS,
        lost_reason_order=LOST_ORDER,
        settings=kwargs.pop("settings", settings()),
        **kwargs,
    )


D = date(2026, 11, 1)


def three_calls(opp_id, status="LOST", reason="PRICE"):
    return company(
        opp_id,
        status,
        [contact(D), contact(date(2026, 11, 3)), contact(date(2026, 11, 5)), close(D, status)],
        furthest="DEMAND_CONFIRMED",
        reason=reason,
    )


def visit_won(opp_id):
    return company(
        opp_id,
        "WON",
        [contact(D), contact(date(2026, 11, 4), method="VISIT"), close(D, "WON")],
        furthest="VISIT_SAMPLE",
    )


def test_failure_counts_lost_and_on_hold_and_where_they_dropped():
    """Given 거절 2곳(가격·납기)·보류 1곳·성사 1곳·진행 중 1곳 / When 센다
    / Then 실패 3곳(보류 1), 빠진 단계·거절 이유는 건수 순, 진행 중은 어디에도 안 든다."""
    result = build(
        [
            three_calls("a", reason="LEAD_TIME"),
            three_calls("b", reason="PRICE"),
            company("c", "ON_HOLD", [contact(D), close(D, "ON_HOLD")], furthest=None),
            visit_won("d"),
            company("e", "IN_PROGRESS", [contact(D)]),
        ]
    )
    assert (result.failure.count, result.failure.on_hold_count) == (3, 1)
    assert [(s.step, s.count) for s in result.failure.by_step] == [
        (None, 1),
        ("DEMAND_CONFIRMED", 2),
    ]
    assert [(r.code, r.count) for r in result.failure.lost_reasons] == [
        ("PRICE", 1),
        ("LEAD_TIME", 1),
    ]
    assert result.success.count == 1
    assert result.basis.usable_count == 4 and result.basis.enough is False


def test_call_only_signal_needs_enough_calls_and_no_visit():
    """Given 전화만 3번 뒤 거절, 전화 뒤 방문해 성사 / When 신호
    / Then 전화만 신호는 거절 쪽 1곳."""
    result = build([three_calls("a"), visit_won("b")])
    row = next(s for s in result.signals if s.code == "CALL_ONLY")
    assert (row.with_signal, row.failed, row.won) == (1, 1, 0)
    assert (row.failed_share, row.won_share) == (1.0, 0.0)
    assert row.judged is False  # 표본 10곳 밑이면 판단 보류


def test_signal_is_judged_once_the_sample_is_enough():
    """Given 같은 신호의 거절 회사 2곳·표본 기준 2 / When 신호 / Then 판단함."""
    result = build([three_calls("a"), three_calls("b")], settings=settings(min_sample=2))
    row = next(s for s in result.signals if s.code == "CALL_ONLY")
    assert row.with_signal == 2 and row.judged is True


def test_long_gap_and_answer_signals_use_the_last_answer():
    """Given 접촉 사이 20일 공백 + 관심 '보통'에서 '낮음'으로 바꾼 회사 / When 신호
    / Then 공백 신호와 관심 낮음 신호가 모두 잡힌다(마지막 답 기준)."""
    lines = [
        contact(D, answers=[("INTEREST", "MEDIUM")]),
        contact(date(2026, 11, 21), answers=[("INTEREST", "LOW")]),
        close(D, "LOST"),
    ]
    result = build([company("a", "LOST", lines, reason="NO_DEMAND")])
    codes = {(s.code, s.question_id): s.with_signal for s in result.signals}
    assert codes[("LONG_GAP", None)] == 1
    assert codes[("ANSWER", "INTEREST")] == 1


def test_failed_step_answers_show_the_answers_of_the_step_where_they_stopped():
    """Given 연결됨 단계에서 멈춘 거절 2곳의 '지금 도금' 답 / When 센다 / Then 그 단계 답 분포."""
    a = company(
        "a",
        "LOST",
        [contact(D, answers=[("PLATING_NOW", "IN_HOUSE")]), close(D, "LOST")],
        reason="NO_DEMAND",
    )
    b = company(
        "b",
        "LOST",
        [contact(D, answers=[("PLATING_NOW", "IN_HOUSE")]), close(D, "LOST")],
        reason="NO_DEMAND",
    )
    result = build([a, b])
    rows = {(r.step, r.question_id): r.answers for r in result.failure.step_answers}
    assert [(x.answer_id, x.count) for x in rows[("REACHED", "PLATING_NOW")]] == [("IN_HOUSE", 2)]


def test_first_visit_index_compares_won_and_failed():
    """Given 2번째 접촉에서 방문해 성사, 방문 없이 거절 / When 센다
    / Then 성사 쪽 2.0, 실패 쪽 없음."""
    result = build([visit_won("a"), three_calls("b")])
    assert result.success.avg_first_visit_index == 2.0
    assert result.success.failed_avg_first_visit_index is None
    assert result.success.avg_contacts_to_won == 2.0


def test_answer_fill_counts_only_where_the_question_is_asked():
    """Given 연결 전 부재 1번·연결됨에서 연결 2번(한 번만 '지금 도금' 답) / When 채움률
    / Then '지금 도금'은 2번 중 1번, 접촉마다 묻는 질문은 3번 모두 대상,
    조건 질문은 조건이 찬 뒤만."""
    lines = [
        contact(D, result="ABSENT", before="NOT_REACHED", after="NOT_REACHED"),
        contact(date(2026, 11, 2), answers=[("PLATING_NOW", "OUTSOURCED")]),
        contact(date(2026, 11, 3)),
    ]
    result = build([company("a", "IN_PROGRESS", lines)])
    fill = {row.question_id: row for row in result.answer_fill}
    assert (fill["PLATING_NOW"].eligible, fill["PLATING_NOW"].answered) == (2, 1)
    assert fill["PLATING_NOW"].ratio == 0.5
    assert fill["WHO_INITIATED"].eligible == 3
    assert fill["NEED_PROCESS"].eligible == 0  # '직접 함'이 아니라 조건 질문은 안 물음
    assert fill["WHO_TALKED"].eligible == 0  # 부재라 연결 전 질문을 묻지 않았다


def test_answer_fill_keeps_only_contacts_in_the_period():
    """Given 기간 밖 접촉 1번과 안 1번 / When 기간을 주고 센다 / Then 기간 안 접촉만 대상."""
    lines = [contact(date(2026, 10, 1)), contact(date(2026, 11, 2))]
    result = build(
        [company("a", "IN_PROGRESS", lines)], period=(date(2026, 11, 1), date(2026, 11, 30))
    )
    fill = {row.question_id: row for row in result.answer_fill}
    assert fill["PLATING_NOW"].eligible == 1


def test_questionnaire_hints_same_answer_and_unknown_many():
    """Given 연결 10번 모두 관심 '보통', 지금 도금은 10번 중 6번 '모름'·4번 빈칸 / When 신호
    / Then 관심은 늘 같은 답, 지금 도금은 모름이 많음."""
    lines = [
        contact(
            date(2026, 11, day),
            answers=[("INTEREST", "MEDIUM")] + ([("PLATING_NOW", "UNKNOWN")] if day <= 6 else []),
        )
        for day in range(1, 11)
    ]
    result = build([company("a", "IN_PROGRESS", lines)])
    hints = {(h.question_id, h.kind): h for h in result.questionnaire_hints}
    same = hints[("INTEREST", "SAME_ANSWER")]
    assert (same.answer_id, same.share) == ("MEDIUM", 1.0)
    assert hints[("PLATING_NOW", "UNKNOWN_MANY")].share == 1.0


def test_split_outcome_hint_needs_groups_big_enough():
    """Given 관심 '높음' 5곳 중 성사 4, '낮음' 5곳 중 성사 1 / When 신호 / Then 결과를 가르는 질문.
    묶음이 기준(3곳)보다 작으면 비교하지 않는다."""

    def one(opp_id, interest, status):
        return company(
            opp_id,
            status,
            [contact(D, answers=[("INTEREST", interest)]), close(D, status)],
            reason="PRICE" if status == "LOST" else None,
        )

    companies = [one(f"h{i}", "HIGH", "WON" if i < 4 else "LOST") for i in range(5)] + [
        one(f"l{i}", "LOW", "WON" if i < 1 else "LOST") for i in range(5)
    ]
    hint = next(
        h
        for h in build(companies).questionnaire_hints
        if h.kind == "SPLITS_OUTCOME" and h.question_id == "INTEREST"
    )
    assert (hint.answer_id, hint.won_ratio_high, hint.won_ratio_low) == ("HIGH", 0.8, 0.2)
    small = build(companies, settings=settings(split_min_group=6)).questionnaire_hints
    assert not [h for h in small if h.kind == "SPLITS_OUTCOME"]


def test_combos_hide_ratio_below_sample_and_sort_by_wins():
    """Given 성사 1곳·거절 1곳이 같은 조합 / When 조합
    / Then 한 줄로 모이고, 표본 밑이면 비율 없음."""
    result = build([visit_won("a"), three_calls("b", status="LOST")])
    assert len(result.combos) == 1  # 두 곳이 같은 조합
    row = result.combos[0]
    assert (row.process_code, row.industry, row.region) == ("ZINC", "자동차 부품", "천안·아산")
    assert (row.contacted, row.won, row.lost) == (2, 1, 1)
    assert row.won_ratio is None
    enough = build([visit_won("a"), three_calls("b")], settings=settings(min_sample=2))
    assert enough.combos[0].won_ratio == 0.5


def test_coach_effect_counts_progress_after_the_suggested_day():
    """Given 코치 제안 일정 뒤 세부 단계가 앞으로 간 회사와 그대로인 회사 / When 센다
    / Then 제안 2건 중 진전 1건, 회사 2곳."""
    moved = company(
        "a",
        "IN_PROGRESS",
        [
            contact(D, after="REACHED"),
            contact(date(2026, 11, 5), before="REACHED", after="DEMAND_CONFIRMED"),
        ],
        coach=(date(2026, 11, 3),),
    )
    stayed = company("b", "IN_PROGRESS", [contact(D)], coach=(date(2026, 11, 3),))
    effect = build([moved, stayed]).coach_effect
    assert (effect.applied, effect.progressed, effect.companies) == (2, 1, 2)


def test_empty_input_gives_zero_counts_not_errors():
    """Given 기록 없음 / When 센다 / Then 모두 0이고 비율은 없다(지어내지 않음)."""
    result = build([])
    assert result.failure.count == 0 and result.success.count == 0
    assert all(s.failed_share is None and s.won_share is None for s in result.signals)
    assert result.combos == [] and result.questionnaire_hints == []
