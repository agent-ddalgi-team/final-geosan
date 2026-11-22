"""AI 분석 피드백(#824, #802 2단계-가). 계약 C1 `/sales-analysis/feedback`.

영업 분석표(#801)와 패턴 펼쳐 보기(#820)가 센 **숫자 표**를 글로 만들어 외부 AI에 한 번 보내고,
실패를 먼저(어디서 → 왜 → 실패 전 신호 → 성공과 다른 점 → 다음엔), 성공, 다음 할 일을 근거 숫자와
함께 받는다. 회사 이름·주소·메모 글·답 글·사람 이름은 싣지 않는다(코드값·건수·비율·질문 파일의
문구만). 표본 기준(salesAnalysis.minSampleForRatio) 밑 칸에는 "표본 부족(결론 금지)"을 붙여 보낸다.

앞 기간 비교는 프로그램이 센 숫자다(AI가 만들지 않는다). 받은 글은 지우기를 한 번 더 거치고,
근거 숫자가 없는 주장은 버린 뒤 heldBack에 몇 개를 뺐는지 적는다(빈 결과로 넘기지 않는다).
"""

from __future__ import annotations

import hashlib
import re
from collections.abc import Sequence
from dataclasses import dataclass
from datetime import date, timedelta
from pathlib import Path

from geosan.config.errors import AppError
from geosan.config.schemas import FileModel
from geosan.evidence.sales_record_gate import (
    ScrubbedRecordText,
    scrub_sales_record,
    scrub_sales_records,
)

PROMPT_PATH = Path(__file__).resolve().parents[2] / "examples" / "prompts" / "sales-analysis.md"
SCHEMA_NAME = "sales_analysis_feedback"
HELD_MARK = "표본 부족(결론 금지)"
DROPPED_NOTE = "근거 숫자가 없어 뺀 주장 {count}개"
_DIGIT = re.compile(r"\d")
COMPARE_KEYS = ("CONTACTED", "WON", "LOST", "ON_HOLD", "IN_PROGRESS")
# #802(11/20): 숫자 표 뒤에 붙는 회사별 맥락 글의 머리. 회사 이름은 "회사 A1"처럼 바꿔 보낸다.
CONTEXT_HEAD = "회사별 기록 — 연락처를 뺀 사본, 회사 이름은 '회사 A1'처럼 바꿈, 끝난 회사가 먼저"
# #887(PM 결정 2026-11-22): 지난 분석의 제안을 이어 받아 "지켰나 → 결과"를 돌아본다.
LOOK_BACK_HEAD = "지난 분석 제안 — 이 제안을 받은 뒤 회사별 기록에서 지켰는지와 결과를 본다"
OUTSIDE_COMPANY = "이번 기간 밖 회사"
# 할 일 제안의 날짜는 받은 날부터 며칠 뒤로 받는다(입력 글에 오늘 날짜를 넣지 않아 저장본이 날마다
# 낡지 않게). 이 값은 규칙 숫자가 아니라 AI 답의 모양을 묶는 값이다(영업 코치 넣기와 같은 3개).
MAX_SUGGESTIONS = 3
MAX_SUGGESTION_DAYS = 30


# ---------------------------------------------------------------------------
# AI 응답 모양 (strict JSON 스키마로 보낸다)
# ---------------------------------------------------------------------------


class Claim(FileModel):
    text: str
    evidence: list[str]


class FailureReading(FileModel):
    where: list[Claim]
    why: list[Claim]
    signals: list[Claim]
    vs_success: list[Claim]
    next: list[Claim]


class SuccessReading(FileModel):
    where: list[Claim]
    why: list[Claim]
    signals: list[Claim]


class SuggestionReading(FileModel):
    """#887 다음 할 일 하나를 일정으로: 회사("회사 A3")·할 일 보기 id·며칠 뒤.

    값 검증은 창구가 한다.
    """

    company: str
    action_id: str
    in_days: int


class FeedbackReading(FileModel):
    failure: FailureReading
    success: SuccessReading
    next: list[Claim]
    held_back: list[str]
    # #887: 옛 답(가짜 응답·저장본)에는 없으므로 기본값은 빈 목록. 보내는 스키마에서는 필수다.
    look_back: list[Claim] = []
    suggestions: list[SuggestionReading] = []


def _all_required(node):
    """strict JSON 스키마는 모든 칸이 required여야 한다. 기본값이 있는 칸도 required로 올린다."""
    if isinstance(node, dict):
        if node.get("type") == "object" and "properties" in node:
            node["required"] = list(node["properties"])
            for value in node["properties"].values():
                value.pop("default", None)
        for value in node.values():
            _all_required(value)
    elif isinstance(node, list):
        for value in node:
            _all_required(value)
    return node


def feedback_schema() -> dict:
    return _all_required(FeedbackReading.model_json_schema(by_alias=True))


def load_prompt(path: Path = PROMPT_PATH) -> tuple[str, str]:
    """지시문과 첫 줄(버전). 파일이 없으면 지어내지 않고 알린다."""
    try:
        text = path.read_text(encoding="utf-8").strip()
    except OSError:
        raise AppError(
            "영업 분석 지시문 파일을 읽지 못했습니다.",
            "examples/prompts/sales-analysis.md가 있는지 확인해 주세요.",
            status=500,
        ) from None
    version = text.splitlines()[0].strip()[:120] if text else ""
    if not version:
        raise AppError(
            "영업 분석 지시문 파일이 비어 있습니다.", "파일을 확인해 주세요.", status=500
        )
    return text, version


# ---------------------------------------------------------------------------
# 앞 기간 · 숫자 표 글
# ---------------------------------------------------------------------------


def previous_period(day_from: date | None, day_to: date | None) -> tuple[date, date] | None:
    """같은 길이의 바로 앞 기간. 양끝이 다 있을 때만(한쪽만 있거나 전체면 비교하지 않는다)."""
    if day_from is None or day_to is None:
        return None
    length = (day_to - day_from).days + 1
    end = day_from - timedelta(days=1)
    return end - timedelta(days=length - 1), end


def totals(result) -> dict[str, int]:
    """영업 분석표(build_sales_analysis) 전체 줄의 다섯 숫자."""
    stats = result.total
    return {
        "CONTACTED": stats.contacted_count,
        "WON": stats.won_count,
        "LOST": stats.lost_count,
        "ON_HOLD": stats.on_hold_count,
        "IN_PROGRESS": stats.in_progress_count,
    }


@dataclass(frozen=True)
class Labels:
    """코드값을 질문 파일의 쉬운 말로. 질문 파일 문구는 자료이고 개인 정보가 아니다."""

    steps: dict[str, str]
    questions: dict[str, str]
    answers: dict[tuple[str, str], str]

    @classmethod
    def from_questions(cls, questions) -> Labels:
        answers: dict[tuple[str, str], str] = {}
        for question in questions.questions:
            for option in question.answers or []:
                answers[(question.id, option.id)] = option.label
        return cls(
            steps={entry.code.value: entry.label for entry in questions.steps},
            questions={question.id: question.text for question in questions.questions},
            answers=answers,
        )

    def step(self, code: str | None) -> str:
        return self.steps.get(code or "", code or "기록 없음")

    def answer(self, question_id: str, answer_id: str) -> str:
        return self.answers.get((question_id, answer_id), answer_id)


def _totals_line(values: dict[str, int]) -> str:
    return (
        f"접촉 {values['CONTACTED']} · 성사 {values['WON']} · 거절 {values['LOST']} · "
        f"보류 {values['ON_HOLD']} · 진행 중 {values['IN_PROGRESS']}"
    )


def _row(won: int, failed: int, in_progress: int, judged: bool) -> str:
    mark = "" if judged else f" · {HELD_MARK}"
    return f"성사 {won} · 실패 {failed} · 진행 {in_progress}{mark}"


def _tables(patterns, result, labels: Labels) -> list[str]:
    basis = patterns.basis
    lines = [
        f"표본 기준: 양쪽 각 {basis.min_sample_for_ratio}곳 이상일 때만 비율·결론",
        f"끝난 회사 {basis.closed_count}곳 · 그중 성사 {basis.won_count}곳"
        + (
            f" · 전체 성사율 {basis.overall_won_ratio:.0%}"
            if basis.overall_won_ratio is not None
            else f" · 전체 성사율 {HELD_MARK}"
        ),
    ]
    total = totals(result)
    lines.append("전체: " + _totals_line(total))
    lines.append("깔때기(세부 단계에 이른 회사 수):")
    for row in result.by_sales_step:
        lines.append(f"- {labels.step(row.step)}: {row.reached_count}곳")
    failure = patterns.failure
    lines.append(f"실패(거절+보류) {failure.count}곳 · 그중 보류 {failure.on_hold_count}곳")
    lines.append("실패한 회사가 멈춘 세부 단계:")
    lines += [f"- {labels.step(item.step)}: {item.count}곳" for item in failure.by_step] or [
        "- 없음"
    ]
    lines.append("거절 이유 건수:")
    lines += [f"- {item.code}: {item.count}건" for item in failure.lost_reasons] or ["- 없음"]
    lines.append("실패한 회사가 멈춘 단계에서 들은 답:")
    step_answers = [
        f"- {labels.step(item.step)} · {labels.questions.get(item.question_id, item.question_id)} "
        + ", ".join(
            f"{labels.answer(item.question_id, answer.answer_id)} {answer.count}"
            for answer in item.answers
        )
        for item in failure.step_answers
    ]
    lines += step_answers or ["- 없음"]
    success = patterns.success
    lines.append(f"성사 {success.count}곳")
    lines.append("성사한 회사가 이른 세부 단계:")
    lines += [f"- {labels.step(item.step)}: {item.count}곳" for item in success.by_step] or [
        "- 없음"
    ]
    for name, value in (
        ("성사까지 평균 접촉", success.avg_contacts_to_won),
        ("성사 회사의 첫 방문 순번(평균)", success.avg_first_visit_index),
        ("실패 회사의 첫 방문 순번(평균)", success.failed_avg_first_visit_index),
    ):
        lines.append(f"{name}: {'없음' if value is None else f'{value:.1f}'}")
    lines.append("방문 전 접촉 횟수별(방문 없으면 전체 접촉 수):")
    for row in patterns.contacts_before_visit:
        visited = "방문함" if row.visited else "방문 없음"
        lines.append(
            f"- {visited} · {row.bucket}: " + _row(row.won, row.failed, row.in_progress, row.judged)
        )
    lines.append("접촉 사이 가장 긴 간격별:")
    for row in patterns.longest_gap:
        lines.append(f"- {row.bucket}: " + _row(row.won, row.failed, row.in_progress, row.judged))
    lines.append("꼬리 질문 답별(회사마다 그 질문의 마지막 답):")
    for row in patterns.answer_outcomes:
        question = labels.questions.get(row.question_id, row.question_id)
        lines.append(
            f"- {question} = {labels.answer(row.question_id, row.answer_id)}: "
            + _row(row.won, row.failed, row.in_progress, row.judged)
        )
    lines.append("공정 × 산업 × 권역 조합:")
    for row in patterns.combos:
        ratio = f" · 성사율 {row.won_ratio:.0%}" if row.won_ratio is not None else f" · {HELD_MARK}"
        lines.append(
            f"- {row.process_code or '공정 확인 전'} × {row.industry or '산업 확인 전'} × "
            f"{row.region or '지역 모름'}: 접촉 {row.contacted} · 성사 {row.won} · 거절 {row.lost}"
            f" · 보류 {row.on_hold}{ratio}"
        )
    lines.append("눈에 띔(결론 아님 · 사람 확인 전):")
    standouts = [
        f"- {item.table} {item.question_id or ''}{('=' + item.answer_id) if item.answer_id else ''}"
        f"{item.bucket or ''}{item.process_code or ''}: 성사 {item.won} · 실패 {item.failed} · "
        f"성사율 {item.won_ratio:.0%} (전체 {item.overall_won_ratio:.0%})"
        for item in patterns.standouts
    ]
    lines += standouts or ["- 없음"]
    lines.append("꼬리 질문 답 채움률:")
    for row in patterns.answer_fill:
        ratio = "물을 자리 없음" if row.ratio is None else f"{row.ratio:.0%}"
        lines.append(
            f"- {labels.questions.get(row.question_id, row.question_id)}: "
            f"{row.eligible}번 물을 자리 중 {row.answered}번 답함 ({ratio})"
        )
    effect = patterns.coach_effect
    lines.append(
        f"영업 코치 제안으로 넣은 일정 {effect.applied}건 → "
        f"그 뒤 앞으로 간 것 {effect.progressed}건 (회사 {effect.companies}곳)"
    )
    return lines


def build_input_text(
    *,
    period: tuple[date | None, date | None] | None,
    patterns,
    result,
    labels: Labels,
    previous: tuple[tuple[date, date], dict[str, int]] | None,
) -> str:
    """보낼 숫자 표 글 하나. 회사 이름·메모·답 글·주소·사람 이름은 넣지 않는다."""
    if period is None:
        head = "기간: 전체"
    else:
        head = f"기간: {period[0] or '처음'} ~ {period[1] or '오늘'}"
    lines = ["숫자 표", head, *_tables(patterns, result, labels)]
    if previous is not None:
        (prev_from, prev_to), prev_totals = previous
        lines.append(f"앞 기간({prev_from} ~ {prev_to}) 전체:")
        lines.append(_totals_line(prev_totals))
    return "\n".join(lines)


def input_hash(text: str, prompt_version: str) -> str:
    return hashlib.sha256(f"{prompt_version}\n{text}".encode()).hexdigest()


def compared(
    current: dict[str, int], previous: tuple[tuple[date, date], dict[str, int]] | None
) -> dict | None:
    """프로그램이 센 앞 기간 비교(AI가 만들지 않는다). 앞 기간이 없으면 None."""
    if previous is None:
        return None
    (prev_from, prev_to), prev_totals = previous
    return {
        "previousFrom": prev_from.isoformat(),
        "previousTo": prev_to.isoformat(),
        "rows": [
            {"key": key, "current": current[key], "previous": prev_totals[key]}
            for key in COMPARE_KEYS
        ],
    }


# ---------------------------------------------------------------------------
# 받은 글 다듬기
# ---------------------------------------------------------------------------


def _clean_claims(claims: Sequence[Claim]) -> tuple[list[dict], int]:
    kept: list[dict] = []
    dropped = 0
    for claim in claims:
        text = scrub_sales_record(claim.text).text.strip()
        evidence = [
            scrub_sales_record(item).text.strip()
            for item in claim.evidence
            if _DIGIT.search(item or "")
        ]
        evidence = [item for item in evidence if item]
        if not text or not evidence:
            dropped += 1
            continue
        kept.append({"text": text, "evidence": evidence})
    return kept, dropped


def clean_reading(reading: FeedbackReading) -> dict:
    """근거 숫자가 없는 주장은 버리고 몇 개를 뺐는지 heldBack에 적는다.

    모든 글은 지우기를 한 번 더 거친다.
    """
    dropped = 0
    failure: dict[str, list[dict]] = {}
    for name in ("where", "why", "signals", "vs_success", "next"):
        failure[name], count = _clean_claims(getattr(reading.failure, name))
        dropped += count
    success: dict[str, list[dict]] = {}
    for name in ("where", "why", "signals"):
        success[name], count = _clean_claims(getattr(reading.success, name))
        dropped += count
    next_steps, count = _clean_claims(reading.next)
    dropped += count
    look_back, count = _clean_claims(reading.look_back)
    dropped += count
    held = [scrub_sales_record(item).text.strip() for item in reading.held_back]
    held = [item for item in held if item]
    if dropped:
        held.append(DROPPED_NOTE.format(count=dropped))
    return {
        "failure": {
            "where": failure["where"],
            "why": failure["why"],
            "signals": failure["signals"],
            "vsSuccess": failure["vs_success"],
            "next": failure["next"],
        },
        "success": success,
        "next": next_steps,
        "heldBack": held,
        "lookBack": look_back,
    }


def map_texts(cleaned: dict, convert) -> dict:
    """다듬은 답의 모든 글(주장·근거·판단 보류)에 convert를 적용한 사본(#802 회사 이름 되돌리기)."""

    def claims(items):
        return [
            {"text": convert(item["text"]), "evidence": [convert(e) for e in item["evidence"]]}
            for item in items
        ]

    return {
        "failure": {key: claims(value) for key, value in cleaned["failure"].items()},
        "success": {key: claims(value) for key, value in cleaned["success"].items()},
        "next": claims(cleaned["next"]),
        "heldBack": [convert(item) for item in cleaned["heldBack"]],
        "lookBack": claims(cleaned.get("lookBack", [])),
    }


# ---------------------------------------------------------------------------
# #887 지난 분석 제안 · 할 일 제안
# ---------------------------------------------------------------------------


def look_back_text(
    response: dict,
    *,
    received_on: date,
    period: tuple[date | None, date | None],
    aliases: dict[str, str],
    other_names: Sequence[str],
    action_labels: dict[str, str],
    suggestion_names: dict[str, str],
    keep_words: Sequence[str] = (),
) -> ScrubbedRecordText | None:
    """저장한 지난 분석(response)의 다음 할 일·[넣기] 제안을 보낼 글로 만든다. 없으면 None.

    저장본은 회사 이름을 되돌려 둔 글이라, 이번 회사별 기록에 있는 회사는 그 "회사 A3"으로,
    이번 기간 밖 회사는 "이번 기간 밖 회사"로 바꾼다(회사 이름은 밖으로 보내지 않는다).
    aliases = {이름: 회사 A3},
    suggestion_names = {oppId: 이름}. 긴 이름부터 바꿔 한 이름이 다른 이름 안에 든 경우를 막는다.
    """
    names = sorted({*aliases, *other_names}, key=len, reverse=True)

    def hide(text: str) -> str:
        for name in names:
            if name:
                text = text.replace(name, aliases.get(name, OUTSIDE_COMPANY))
        return text

    lines: list[str] = []
    for item in [*response.get("next", []), *response.get("failure", {}).get("next", [])]:
        text = (item.get("text") or "").strip()
        if text:
            lines.append(f"- {hide(text)}")
    for item in response.get("suggestions", []):
        name = suggestion_names.get(item.get("oppId", ""))
        label = action_labels.get(item.get("actionId", ""), item.get("actionId", ""))
        if name and item.get("date"):
            lines.append(f"- 일정 제안: {hide(name)} · {item['date']} {label}")
    if not lines:
        return None
    start, end = period
    span = "전체 기간" if start is None and end is None else f"{start or ''}~{end or ''}"
    head = f"받은 날 {received_on.isoformat()} · 그때 본 기간 {span}"
    # 회사별 기록과 같은 넉넉한 규칙으로 지운다(되돌린 글이라 한 번 더).
    (scrubbed,) = scrub_sales_records(
        ["\n".join([LOOK_BACK_HEAD, head, *lines])],
        [*keep_words, *aliases.values(), OUTSIDE_COMPANY],
    )
    return scrubbed


def checked_suggestions(
    reading: FeedbackReading,
    *,
    alias_opp_ids: dict[str, str],
    actions: dict[str, str],
    today: date,
) -> list[dict]:
    """AI 일정 제안 검증: 회사가 이번 회사별 기록의 "회사 A3"이고, 할 일 보기가 목록에 있고,
    며칠 뒤가 0~MAX_SUGGESTION_DAYS인 것만. 같은 회사는 앞의 하나만, 최대 MAX_SUGGESTIONS개."""
    kept: list[dict] = []
    for item in reading.suggestions:
        opp_id = alias_opp_ids.get(item.company.strip())
        if opp_id is None or item.action_id not in actions:
            continue
        if not 0 <= item.in_days <= MAX_SUGGESTION_DAYS:
            continue
        if any(row["oppId"] == opp_id for row in kept):
            continue
        day = today + timedelta(days=item.in_days)
        kept.append({"oppId": opp_id, "actionId": item.action_id, "date": day.isoformat()})
        if len(kept) == MAX_SUGGESTIONS:
            break
    return kept
