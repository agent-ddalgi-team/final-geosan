"""#802·#820: 영업 분석 패턴 펼쳐 보기(순수 계산). AI·외부 호출·DB 없음. 가상 값만 쓴다.

기준 숫자 없이 펼친 표와, 표본 기준(minSampleForRatio) 하나로 고르는 "눈에 띔"을 본다.
"""

from datetime import date, timedelta

from geosan.dashboard.sales_patterns import (
    PatternCompany,
    PatternLine,
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
        min_sample_for_ratio=kwargs.pop("min_sample", 10),
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
    assert (result.basis.closed_count, result.basis.won_count) == (4, 1)
    assert result.basis.overall_won_ratio is None  # 끝난 회사 4곳 < 표본 기준 10


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
    """Given 연결 10번 모두 관심 '보통', 지금 도금은 10번 중 6번 '모름'·4번 빈칸 / When 센다
    / Then 비율 기준 없이 몰림이 가장 큰 질문(관심)과 모름이 가장 많은 질문(지금 도금) 하나씩,
    답 분포·몫은 값 그대로."""
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
    assert len(result.questionnaire_hints) == 2
    fill = {row.question_id: row for row in result.answer_fill}
    assert [(a.answer_id, a.count) for a in fill["PLATING_NOW"].answers] == [("UNKNOWN", 6)]
    assert (fill["PLATING_NOW"].unknown_share, fill["PLATING_NOW"].top_share) == (1.0, 1.0)
    assert fill["CONFIRM_PROCESS"].top_share is None  # 보기를 회사 값에서 가져오는 질문


def test_questionnaire_hints_need_the_sample_but_no_ratio_threshold():
    """Given 관심을 9번만 물음(표본 기준 10 밑) / When 센다 / Then 손볼 만함 표시 없음."""
    lines = [contact(date(2026, 11, d), answers=[("INTEREST", "MEDIUM")]) for d in range(1, 10)]
    result = build([company("a", "IN_PROGRESS", lines)])
    assert [h for h in result.questionnaire_hints if h.kind == "SAME_ANSWER"] == []


def test_combos_hide_ratio_below_sample_and_sort_by_wins():
    """Given 성사 1곳·거절 1곳이 같은 조합 / When 조합
    / Then 한 줄로 모이고, 표본 밑이면 비율 없음."""
    result = build([visit_won("a"), three_calls("b", status="LOST")])
    assert len(result.combos) == 1  # 두 곳이 같은 조합
    row = result.combos[0]
    assert (row.process_code, row.industry, row.region) == ("ZINC", "자동차 부품", "천안·아산")
    assert (row.contacted, row.won, row.lost) == (2, 1, 1)
    assert row.won_ratio is None
    enough = build([visit_won("a"), three_calls("b")], min_sample=2)
    assert enough.combos[0].won_ratio == 0.5  # 성사 ÷ 끝난 회사


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
    assert result.basis.overall_won_ratio is None
    assert result.contacts_before_visit == [] and result.longest_gap == []
    assert result.answer_outcomes == [] and result.standouts == []
    assert result.combos == [] and result.questionnaire_hints == []


def test_contacts_before_visit_spread_without_a_threshold():
    """Given 바로 방문해 성사, 2번째 접촉에서 방문해 성사, 전화만 3번 거절, 전화만 5번 보류
    / When 센다 / Then 방문한 회사는 방문 전 접촉 0·1번 칸,
    방문 없는 회사는 모든 접촉 3·4번 이상 칸."""
    first_visit = company(
        "a", "WON", [contact(D, method="VISIT"), close(D, "WON")], furthest="VISIT_SAMPLE"
    )
    five = company(
        "d",
        "ON_HOLD",
        [contact(date(2026, 11, d)) for d in range(1, 6)] + [close(D, "ON_HOLD")],
    )
    result = build([first_visit, visit_won("b"), three_calls("c"), five])
    rows = {
        (r.visited, r.bucket): (r.won, r.failed, r.in_progress)
        for r in result.contacts_before_visit
    }
    assert rows == {
        (True, "ZERO"): (1, 0, 0),
        (True, "ONE"): (1, 0, 0),
        (False, "THREE"): (0, 1, 0),
        (False, "FOUR_PLUS"): (0, 1, 0),
    }
    assert all(r.won_ratio is None and r.judged is False for r in result.contacts_before_visit)


def test_longest_gap_buckets_are_for_display_only():
    """Given 접촉 한 번, 사이 3일, 사이 10일, 사이 20일, 사이 40일 / When 센다
    / Then 가장 긴 간격으로 칸을 나눈다(보기용 구간)."""

    def gap(opp_id, days):
        return company(
            opp_id, "IN_PROGRESS", [contact(date(2026, 10, 1) + timedelta(d)) for d in days]
        )

    result = build(
        [gap("a", [0]), gap("b", [0, 3]), gap("c", [0, 10]), gap("d", [0, 20]), gap("e", [0, 40])]
    )
    assert [r.bucket for r in result.longest_gap] == [
        "WITHIN_WEEK",
        "WITHIN_TWO_WEEKS",
        "WITHIN_MONTH",
        "OVER_MONTH",
        "SINGLE_CONTACT",
    ]
    assert all(r.in_progress == 1 for r in result.longest_gap)


def test_answer_outcomes_use_every_question_and_the_last_answer():
    """Given 관심 '보통'→'낮음'으로 바꾼 뒤 거절한 회사와 관심 '높음'에서 성사한 회사 / When 센다
    / Then 미리 정한 답 목록 없이 모든 질문의 답별 성사·실패(회사마다 마지막 답)."""
    lowered = company(
        "a",
        "LOST",
        [
            contact(D, answers=[("INTEREST", "MEDIUM")]),
            contact(date(2026, 11, 2), answers=[("INTEREST", "LOW"), ("PLATING_NOW", "IN_HOUSE")]),
            close(D, "LOST"),
        ],
        reason="NO_DEMAND",
    )
    high = company("b", "WON", [contact(D, answers=[("INTEREST", "HIGH")]), close(D, "WON")])
    rows = {
        (r.question_id, r.answer_id): (r.won, r.failed)
        for r in build([lowered, high]).answer_outcomes
    }
    assert rows == {
        ("PLATING_NOW", "IN_HOUSE"): (0, 1),
        ("INTEREST", "HIGH"): (1, 0),
        ("INTEREST", "LOW"): (0, 1),
    }


def _closed(opp_id, status, visit_first):
    lines = (
        [contact(D, method="VISIT")] if visit_first else [contact(D), contact(date(2026, 11, 9))]
    )
    return company(
        opp_id, status, lines + [close(D, status)], reason="PRICE" if status == "LOST" else None
    )


def test_standouts_need_the_sample_on_both_sides_and_show_the_biggest_gaps():
    """Given 표본 기준 2, 바로 방문한 회사 3곳 모두 성사·전화만 2번 한 회사 3곳 모두 거절
    / When 센다 / Then 전체 성사율 0.5와 차이가 큰 두 칸이 눈에 띔(±0.5), 결론이 아니라 표시만."""
    companies = [_closed(f"v{i}", "WON", True) for i in range(3)] + [
        _closed(f"c{i}", "LOST", False) for i in range(3)
    ]
    result = build(companies, min_sample=2)
    assert result.basis.overall_won_ratio == 0.5
    contact_standouts = [s for s in result.standouts if s.table == "CONTACTS_BEFORE_VISIT"]
    assert {(s.visited, s.bucket, s.diff) for s in contact_standouts} == {
        (True, "ZERO", 0.5),
        (False, "TWO", -0.5),
    }
    assert len(result.standouts) <= 3
    assert all(abs(s.diff) == 0.5 for s in result.standouts)


def test_no_standout_when_one_side_is_below_the_sample():
    """Given 표본 기준 10, 끝난 회사 6곳 / When 센다
    / Then 칸과 나머지가 둘 다 기준을 넘는 칸이 없어 눈에 띔이 없고, 표는 회색(판단 보류)."""
    companies = [_closed(f"v{i}", "WON", True) for i in range(3)] + [
        _closed(f"c{i}", "LOST", False) for i in range(3)
    ]
    result = build(companies)
    assert result.standouts == []
    assert all(not r.judged for r in result.contacts_before_visit)


def test_outcome_questions_are_left_out_of_answer_tables_and_standouts():
    """Given 결과를 묻는 질문(CLOSE_RESULT: 성사·거절)에 답한 끝난 회사 24곳 / When 센다
    / Then 그 질문은 답별 표와 '눈에 띔'에 없다 — 결과 자체라 "거절로 답한 회사는 성사 0"처럼
    순환한다(#820 후속, PM 2026-11-17). 다른 질문(관심)은 그대로 센다."""
    questions = [*QUESTIONS, QuestionInfo("CLOSE_RESULT", "ALL", decides_outcome=True)]
    companies = []
    for i in range(12):
        companies.append(
            company(
                f"w{i}",
                "WON",
                [
                    contact(D, answers=[("CLOSE_RESULT", "WON"), ("INTEREST", "HIGH")]),
                    close(D, "WON"),
                ],
            )
        )
        companies.append(
            company(
                f"l{i}",
                "LOST",
                [
                    contact(D, answers=[("CLOSE_RESULT", "LOST"), ("INTEREST", "LOW")]),
                    close(D, "LOST"),
                ],
                reason="PRICE",
            )
        )
    result = build_sales_patterns(
        companies,
        questions=questions,
        step_order=STEPS,
        lost_reason_order=LOST_ORDER,
        min_sample_for_ratio=10,
    )
    assert all(r.question_id != "CLOSE_RESULT" for r in result.answer_outcomes)
    assert all(getattr(s, "question_id", None) != "CLOSE_RESULT" for s in result.standouts)
    assert any(r.question_id == "INTEREST" for r in result.answer_outcomes)
