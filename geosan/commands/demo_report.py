"""`geosan demo-report --capability <file> --cases <dir> --out <dir> [--base-date]`.

Step 33, 계약 C8.

10/29 거산 방문(부분 시연) 자료를 **DB·API·화면 없이** 뽑는 예비 경로다.
역량 파일 + 사례 파일 폴더 → 변환기(`geosan.evaluation.file_input`) → 규칙 엔진 `evaluate`·`rank`
→ 출력.

출력(모두 `<out>` 아래, 머리에 "시연용 초안·거산 확인 전"):
- `ranking.csv`   순위표(엑셀용, UTF-8 BOM)
- `ranking.html`  같은 표, 인쇄용
- `companies/<순위>-<회사명>.md`  기업별 근거(분류·점수·요구 판정·질문·근거·시점 신호·8항목)
- `facts/<순위>-<회사명>.md`      기업별 사실표(메모 재료; 단가·견적·납기·경쟁사 항목은 틀에 없음,
  CON-23)

저장하지 않는다. 현재 시각을 쓰지 않아 같은 입력이면 같은 결과가 나온다(NFR1).
연락처 패턴이 입력 어디에든 있으면 아무것도 쓰지 않고 종료 코드 1.
종료 코드: 0 성공, 1 입력 오류, 2 실행 실패.
"""

from __future__ import annotations

import csv
import html
import io
import re
from collections import Counter
from collections.abc import Callable
from dataclasses import dataclass
from datetime import date
from pathlib import Path

import typer

from geosan.config.errors import AppError, InputError
from geosan.config.file_checks import RELATION_RATE
from geosan.config.paths import normalize_input_path
from geosan.config.validators import find_contact, format_field_error
from geosan.evaluation.file_input import FileCase, FileInputs, load_file_inputs
from geosan.rules.codes import DatasetKind, Profile, classification_entry
from geosan.rules.engine import evaluate, rank
from geosan.rules.models import EvaluationOutput, RankInput

EXIT_OK = 0
EXIT_INPUT_ERROR = 1
EXIT_RUN_FAILED = 2

HEADER_MARK = "시연용 초안·거산 확인 전"
VIRTUAL_MARK = "가상·거산 실제 사양 아님"
BROCHURE_MARK = "소개서 기준·거산 확인 전"

CHECK_DISPLAY_LABELS = {
    "PASS": "통과 (응모 가능)",
    "PENDING_BLOCKS": "확인 대기 (승인 막힘)",
    "QUESTION_NEEDED": "질문 필요 (승인은 막지 않음)",
    "LATER_STAGE": "나중 단계",
    "EXCLUDED": "제외",
}
ITEM_STATE_LABELS = {
    "CONFIRMED": "확인",
    "STRONG": "강한 추정",
    "WEAK": "약한 추정",
    "MISMATCH": "불일치",
    "NO_BONUS": "가점 없음",
    "NO_SIGNAL": "신호 없음",
    "UNAVAILABLE": "자료 미확보",
}
RELATION_STATUS_LABELS = {
    "NEW_CONFIRMED": "신규",
    "EXISTING_CONFIRMED": "기존",
    "UNCONFIRMED": "확인 전",
}
REQ_LEVEL_LABELS = {
    "REQUIRED": "필수",
    "PREFERRED": "우대",
    "NOT_REQUIRED": "비요구",
    "UNKNOWN": "수준 미확인",
}
NEEDED_STAGE_LABELS = {"NOW": "지금", "LATER": "나중 단계", "UNKNOWN": "단계 미확인"}
SUBJECT_LABELS = {
    "PRODUCT": "제품·부품",
    "MATERIAL": "소재",
    "PURPOSE": "처리 목적",
    "SIGNAL": "시점 신호",
    "REQUIREMENT": "요구",
    "OTHER": "기타",
}
SIGNAL_KIND_LABELS = {
    "EXPANSION": "증설",
    "NEW_ORDER": "신규 수주",
    "BID": "공고",
    "HIRING": "채용",
    "REORDER_CYCLE": "재주문 주기",
    "NEXT_CONTACT": "다음 연락",
}
RELATION_LABELS = {"DIRECT": "직접 관련", "INDIRECT": "간접 관련"}
CERTAINTY_LABELS = {
    "CONFIRMED": "사실(확인)",
    "STRONG": "추정(강한)",
    "WEAK": "추정(약한)",
    "UNKNOWN": "미확인",
}
REVIEW_STATUS_LABELS = {
    "REVIEWED": "확인됨",
    "PENDING": "확인 기다림",
    "UNAVAILABLE": "자료 없음",
    "RECHECK": "다시 확인",
}
QUAL_STATUS_LABELS = {
    "ACTIVE": "유효",
    "SUSPENDED": "정지",
    "CANCELLED": "취소",
    "EXPIRED": "만료",
    "UNCONFIRMED": "미확인",
}


@dataclass
class ReportRow:
    """순위표 한 줄 = 기업 하나."""

    rank: int
    file_case: FileCase
    output: EvaluationOutput

    @property
    def company(self) -> str:
        return self.file_case.case.customer.name

    @property
    def classification_label(self) -> str:
        return self.file_case.evaluation_input.rule_config.classification_labels[
            self.output.classification_code
        ]

    @property
    def is_contact_candidate(self) -> bool:
        return classification_entry(self.output.classification_code).is_contact_candidate


@dataclass
class DemoReport:
    """`build_report`의 결과. 쓰기 전에 전부 메모리에서 만든다."""

    inputs: FileInputs
    base_date_arg: date | None
    rows: list[ReportRow]

    @property
    def dataset_kind(self) -> DatasetKind:
        return self.inputs.dataset_kind

    def counts_by_label(self) -> dict[str, int]:
        return dict(Counter(row.classification_label for row in self.rows))


# ---------------------------------------------------------------------------
# 계산
# ---------------------------------------------------------------------------


def build_report(
    capability_path: Path,
    cases_dir: Path,
    *,
    base_date: date | None = None,
    rule_config_path: Path | None = None,
) -> DemoReport:
    """파일을 읽고 평가·순위까지 계산한다. 파일을 쓰지 않는다."""
    inputs = load_file_inputs(
        capability_path, cases_dir, base_date=base_date, rule_config_path=rule_config_path
    )
    outputs = {fc.opp_id: evaluate(fc.evaluation_input) for fc in inputs.cases}
    ranks = rank(
        [
            RankInput(opp_id=fc.opp_id, profile=Profile.NEW, sort_key=outputs[fc.opp_id].sort_key)
            for fc in inputs.cases
        ],
        inputs.dataset_kind,
        inputs.rule_config,
    )
    by_opp = {fc.opp_id: fc for fc in inputs.cases}
    rows = [
        ReportRow(rank=r.original_rank, file_case=by_opp[r.opp_id], output=outputs[r.opp_id])
        for r in sorted(ranks, key=lambda r: r.original_rank)
    ]
    return DemoReport(inputs=inputs, base_date_arg=base_date, rows=rows)


# ---------------------------------------------------------------------------
# 출력 문서 만들기 (문자열) — 쓰기와 분리해 연락처 검사·결정성 검사를 쉽게 한다
# ---------------------------------------------------------------------------


def _lab(table: dict[str, str], key: object) -> str:
    """코드 → 쉬운 말. 표에 없으면 코드를 그대로 보인다(조용히 비우지 않음)."""
    return table.get(str(key), str(key))


def _safe_name(text: str) -> str:
    """파일 이름에 못 쓰는 글자를 바꾼다. 한글은 그대로 둔다."""
    cleaned = re.sub(r'[\\/:*?"<>|\s]+', "-", text.strip())
    return cleaned.strip("-") or "company"


def _d(value: date | None) -> str:
    return value.isoformat() if value else "-"


def _num(value: float | None) -> str:
    if value is None:
        return "-"
    return f"{value:g}"


def _head_lines(report: DemoReport, title: str) -> list[str]:
    lines = [f"# {title}", "", f"> **{HEADER_MARK}**"]
    if report.dataset_kind == DatasetKind.BROCHURE:
        lines.append(f"> 거산 역량 자료 구분: 회사소개서(BROCHURE) — {BROCHURE_MARK}")
    else:
        lines.append(f"> 거산 역량 자료 구분: {report.dataset_kind}")
    base = report.base_date_arg.isoformat() if report.base_date_arg else "사례 파일의 baseDate"
    lines.append(
        f"> 기준일: {base} · 규칙 설정 {report.inputs.rule_config.version} "
        f"({report.inputs.rule_config.hypothesis_note})"
    )
    lines.append("")
    return lines


def _virtual_line(row: ReportRow) -> list[str]:
    if row.file_case.case.is_virtual:
        return [f"> **{VIRTUAL_MARK}** (가상 사례)", ""]
    return []


def csv_rows(report: DemoReport) -> list[list[str]]:
    header = [
        "순위",
        "회사명",
        "기회(품목)",
        "분류",
        "점수 표시",
        "접촉 후보",
        "추천 근거",
        "검토사항",
        "후속 조치",
        "근거 수",
        "질문 수",
        "가상 여부",
        "사례 ID",
    ]
    rows = [header]
    for row in report.rows:
        case = row.file_case.case
        rows.append(
            [
                str(row.rank),
                case.customer.name,
                case.opportunity.item,
                row.classification_label,
                row.output.display.score_display,
                "예" if row.is_contact_candidate else "아니오",
                row.output.display.reason,
                row.output.display.blocker_text,
                row.output.display.next_action,
                str(len(row.file_case.evaluation_input.evidence)),
                str(len(row.output.question_candidates)),
                "가상" if case.is_virtual else "실제",
                case.case_id,
            ]
        )
    return rows


def render_csv(report: DemoReport) -> str:
    buffer = io.StringIO()
    writer = csv.writer(buffer, lineterminator="\n")
    writer.writerow([f"# {HEADER_MARK}"])
    writer.writerows(csv_rows(report))
    return buffer.getvalue()


def render_html(report: DemoReport) -> str:
    rows = csv_rows(report)
    head, body = rows[0], rows[1:]
    base = report.base_date_arg.isoformat() if report.base_date_arg else "사례 파일의 baseDate"
    bundle = (
        f"회사소개서(BROCHURE) — {BROCHURE_MARK}"
        if report.dataset_kind == DatasetKind.BROCHURE
        else str(report.dataset_kind)
    )
    parts = [
        "<!doctype html>",
        '<html lang="ko"><head><meta charset="utf-8">',
        f"<title>추천 기업 순위표 — {html.escape(HEADER_MARK)}</title>",
        "<style>",
        "body{font-family:-apple-system,'Malgun Gothic','Apple SD Gothic Neo',sans-serif;"
        "margin:24px;color:#222}",
        ".band{border:2px solid #b45309;background:#fff7ed;padding:8px 12px;font-weight:bold;"
        "margin-bottom:16px}",
        "table{border-collapse:collapse;width:100%;font-size:12px}",
        "th,td{border:1px solid #999;padding:4px 6px;vertical-align:top;text-align:left}",
        "th{background:#f3f4f6}",
        "@media print{.band{-webkit-print-color-adjust:exact;print-color-adjust:exact}}",
        "</style></head><body>",
        f'<div class="band">{html.escape(HEADER_MARK)}</div>',
        "<h1>추천 기업 순위표</h1>",
        f"<p>거산 역량 자료 구분: {html.escape(bundle)} · 기준일: {html.escape(base)} · "
        f"규칙 설정 {html.escape(report.inputs.rule_config.version)} "
        f"({html.escape(report.inputs.rule_config.hypothesis_note)})</p>",
        "<table><thead><tr>"
        + "".join(f"<th>{html.escape(h)}</th>" for h in head)
        + "</tr></thead><tbody>",
    ]
    for row in body:
        parts.append("<tr>" + "".join(f"<td>{html.escape(cell)}</td>" for cell in row) + "</tr>")
    parts.append("</tbody></table>")
    parts.append(
        "<p>분류별 건수: "
        + html.escape(", ".join(f"{k} {v}건" for k, v in report.counts_by_label().items()))
        + "</p>"
    )
    parts.append("</body></html>")
    return "\n".join(parts) + "\n"


def _item_label(row: ReportRow, item_code: str) -> str:
    for item in row.file_case.evaluation_input.rule_config.new_profile_items:
        if item.item_code == item_code:
            return item.label or item_code
    return item_code


def render_company(report: DemoReport, row: ReportRow) -> str:
    """기업별 근거 문서(markdown)."""
    case = row.file_case.case
    out = row.output
    ei = row.file_case.evaluation_input
    totals = out.totals
    lines = _head_lines(report, f"{row.rank}위 {case.customer.name} — 근거")
    lines += _virtual_line(row)
    lines += [
        f"- 기회: {case.opportunity.item}"
        + (f" ({case.opportunity.project})" if case.opportunity.project else ""),
        f"- 사례 ID: `{case.case_id}` · 파일: `{row.file_case.path.name}`",
        f"- 관계 상태: {_lab(RELATION_STATUS_LABELS, case.customer.relation_status)}",
        "",
        "## 분류·점수",
        "",
        f"- 분류: **{row.classification_label}** (`{out.classification_code}`)"
        + (" · 접촉 후보" if row.is_contact_candidate else " · 접촉 후보 아님"),
        f"- 추천 근거: {out.display.reason}",
        f"- 검토사항: {out.display.blocker_text}",
        f"- 후속 조치: {out.display.next_action}",
        f"- 점수 표시: {out.display.score_display}",
        "",
        "| E | P | S | R | C | F | T |",
        "|---:|---:|---:|---:|---:|---:|---:|",
        f"| {totals.E} | {totals.P} | {_num(totals.S)} | {totals.R} | {_num(totals.C)} | "
        f"{totals.F} | {totals.T} |",
        "",
        "E 현재 평가점수 · P 조사 항목 배점 합계 · S 확인 비율(E÷P×100) · "
        "R 조사 시 상한 · C 평가 항목 조사율",
        "",
        "## 필수 요구 판정",
        "",
    ]
    if out.requirement_checks:
        lines += ["| 요구 | 수준 | 언제 | 판정 | 이유 |", "|---|---|---|---|---|"]
        req_by_id = {r.req_id: r for r in ei.requirements}
        for check in out.requirement_checks:
            req = req_by_id[check.req_id]
            lines.append(
                f"| {req.name} | {REQ_LEVEL_LABELS.get(req.req_level, req.req_level)} | "
                f"{NEEDED_STAGE_LABELS.get(req.needed_stage, req.needed_stage)} | "
                f"{_lab(CHECK_DISPLAY_LABELS, check.display_result)} | {check.reason} |"
            )
    else:
        lines.append("요구가 적혀 있지 않습니다.")
    lines += ["", "## 확인할 질문", ""]
    questions = [q.text for q in out.question_candidates]
    questions += [r.question for r in case.requirements if r.question]
    questions = list(dict.fromkeys(questions))
    lines += [f"- {q}" for q in questions] or ["- (없음)"]
    lines += ["", "## 근거 (공개 자료)", ""]
    if case.evidence:
        lines += [
            "| 종류 | 인용 | 출처 | 날짜 | 등급 | 근거 확인 수준 |",
            "|---|---|---|---|---|---|",
        ]
        blocked_ids = {ev_id for ev_id, _ in row.file_case.blocked_evidence}
        for index, ev in enumerate(case.evidence, start=1):
            ev_id = f"ev-{case.case_id}-{index:04d}"
            if ev_id in blocked_ids:
                lines.append(
                    f"| {_lab(SUBJECT_LABELS, ev.subject)} | (처리 금지 자료 — 내용 생략) "
                    "| - | - | - | - |"
                )
                continue
            lines.append(
                f"| {SUBJECT_LABELS.get(ev.subject, ev.subject)} | {ev.quote} | {ev.source_ref} | "
                f"{_d(ev.occurred_at)} | {ev.source_grade} | "
                f"{_lab(CERTAINTY_LABELS, ev.certainty)} |"
            )
    else:
        lines.append("근거가 적혀 있지 않습니다.")
    lines += ["", "## 시점 신호", ""]
    if case.signals:
        lines += [
            "| 종류 | 관련 | 발생일 | 마감일 | 진행 | 근거 확인 수준 |",
            "|---|---|---|---|---|---|",
        ]
        for sig in case.signals:
            lines.append(
                f"| {SIGNAL_KIND_LABELS.get(sig.signal_kind, sig.signal_kind)} | "
                f"{_lab(RELATION_LABELS, sig.relation)} ({RELATION_RATE.get(sig.relation, '-')}) | "
                f"{_d(sig.occurred_at)} | {_d(sig.deadline_at or sig.scheduled_at)} | "
                f"{sig.progress_status or '-'} | {_lab(CERTAINTY_LABELS, sig.certainty)} |"
            )
    else:
        lines.append("- (없음)")
    lines += [
        "",
        "## 8항목 판정",
        "",
        "| 항목 | 상태 | 평가 기준 적합도 | 배점 | 점수 | 판정한 사실 |",
        "|---|---|---:|---:|---:|---|",
    ]
    for item in out.items:
        lines.append(
            f"| {_item_label(row, item.item_code)} | {_lab(ITEM_STATE_LABELS, item.state)} | "
            f"{_num(item.match_rate)} | {item.weight} | "
            f"{'-' if item.score is None else item.score} | "
            f"{item.fact_judged or ''} |"
        )
    lines.append("")
    return "\n".join(lines)


def render_facts(report: DemoReport, row: ReportRow) -> str:
    """기업별 사실표(메모 재료). 단가·견적·납기·경쟁사 칸은 두지 않는다(CON-23)."""
    case = row.file_case.case
    out = row.output
    capability = report.inputs.capability
    snapshot = report.inputs.snapshot
    brochure = report.dataset_kind == DatasetKind.BROCHURE
    lines = _head_lines(report, f"{row.rank}위 {case.customer.name} — 사실표 (메모 재료)")
    lines += _virtual_line(row)
    lines += [
        "이 표는 맞춤 메모 초안을 쓸 때 AI 채팅에 넣는 재료입니다(`docs/demo-memo-guide.md`). "
        "연락처·단가·견적·납기 약속·경쟁사 비교는 적지 않습니다.",
        "",
        "## 1. 상대 회사 요약",
        "",
        f"- 회사: {case.customer.name}"
        + (f" ({case.customer.address})" if case.customer.address else ""),
        f"- 무엇을 만드는가: {case.description}",
        f"- 이번 기회: {case.opportunity.item}"
        + (f" — {case.opportunity.project}" if case.opportunity.project else ""),
        f"- 관계 상태: {_lab(RELATION_STATUS_LABELS, case.customer.relation_status)}",
        f"- 시스템 분류: {row.classification_label}"
        + (" (접촉 후보)" if row.is_contact_candidate else " (접촉 후보 아님 — 확인 뒤 재평가)"),
    ]
    product = [
        ev.quote
        for ev in case.evidence
        if ev.subject == "PRODUCT" and ev.security_grade != "FORBIDDEN"
    ]
    material = [
        ev.quote
        for ev in case.evidence
        if ev.subject == "MATERIAL" and ev.security_grade != "FORBIDDEN"
    ]
    purpose = [
        ev.quote
        for ev in case.evidence
        if ev.subject == "PURPOSE" and ev.security_grade != "FORBIDDEN"
    ]
    lines += ["", "## 2. 필요한 처리 (공개 자료에서 확인한 것)", ""]
    for label, quotes in (("제품·부품", product), ("소재", material), ("처리 목적", purpose)):
        lines.append(f"- {label}: " + ("; ".join(quotes) if quotes else "(근거 없음)"))
    linked_codes = [link.process_code for link in case.process_links]
    process_by_code = {p.code: p for p in capability.processes}
    lines += [
        "- 필요한 공정: "
        + ", ".join(
            f"{process_by_code[c].name} (`{c}`" + (f", 소재 {m}" if m else "") + ")"
            if c in process_by_code
            else f"`{c}` (역량 파일에 없음)"
            for c, m in ((link.process_code, link.applied_material) for link in case.process_links)
        )
    ]
    lines += ["", "## 3. 맞는 거산 공정·소재·인증", ""]
    if brochure:
        lines.append(
            f"> 아래 거산 값은 **{BROCHURE_MARK}**입니다. 메모에는 '소개서 기준'으로 적습니다."
        )
        lines.append("")
    for code in linked_codes:
        process = process_by_code.get(code)
        if process is None:
            continue
        lines.append(
            f"### {process.name} (`{code}`) — "
            f"검수 {_lab(REVIEW_STATUS_LABELS, process.review_status)}"
        )
        lines.append("")
        lines.append(f"- 처리 소재: {', '.join(process.material_codes) or '-'}")
        lines.append(f"- 성능 태그: {', '.join(process.performance_tags) or '-'}")
        for item in process.capabilities:
            value = item.display_value or (
                f"{_num(item.numeric_min)}~{_num(item.numeric_max)} {item.unit or ''}".strip()
                if item.numeric_min is not None or item.numeric_max is not None
                else "-"
            )
            lines.append(
                f"- {item.name}: {value} (검수 {_lab(REVIEW_STATUS_LABELS, item.review_status)})"
            )
        for rec in process.delivery_records:
            lines.append(
                f"- 납품 실적: {rec.industry}"
                + (f" / {rec.part_type}" if rec.part_type else "")
                + (f" / {rec.period}" if rec.period else "")
                + f" (검수 {REVIEW_STATUS_LABELS.get(rec.review_status, rec.review_status)})"
            )
        lines.append("")
    linked_pids = {f"proc-{c.lower().replace('_', '-')}" for c in linked_codes}
    qual_by_id = {q.qual_id: q for q in snapshot.qualifications}
    applicable = sorted(
        {
            s.qual_id
            for s in snapshot.qualification_scopes
            if s.scope_kind == "PROCESS"
            and s.process_id in linked_pids
            and s.applicability == "APPLIES"
        }
    )
    lines += ["### 인증·승인 (이 공정에 적용되는 것)", ""]
    if applicable:
        lines += [
            "| 종류 | 이름 | 번호 | 유효기간 | 현재 상태 | 검수 |",
            "|---|---|---|---|---|---|",
        ]
        for qual_id in applicable:
            q = qual_by_id[qual_id]
            kind = "인증" if q.kind == "CERTIFICATION" else "승인"
            period = f"{_d(q.valid_from)} ~ {_d(q.valid_to)}" if q.valid_from or q.valid_to else "-"
            lines.append(
                f"| {kind} | {q.official_name}"
                + (
                    f" ({q.edition})"
                    if q.edition and not q.official_name.endswith(q.edition)
                    else ""
                )
                + f" | {q.number or '-'} | {period} | "
                + f"{_lab(QUAL_STATUS_LABELS, q.current_status)} | "
                f"{REVIEW_STATUS_LABELS.get(q.review_status, q.review_status)} |"
            )
    else:
        lines.append("- (이 공정에 적용된다고 적힌 인증·승인이 역량 파일에 없음)")
    lines += ["", "## 4. 상대에게 확인할 질문", ""]
    questions = [q.text for q in out.question_candidates] + [
        r.question for r in case.requirements if r.question
    ]
    lines += [f"- {q}" for q in dict.fromkeys(questions)] or ["- (없음)"]
    lines += ["", "## 5. 후속 조치", "", f"- {out.display.next_action}"]
    if out.display.blocks_approval:
        lines.append(f"- 승인 전 확인: {out.display.blocker_text}")
    lines.append("")
    return "\n".join(lines)


@dataclass
class RenderedFiles:
    files: dict[str, str]
    """상대 경로 → 내용. CSV는 BOM 없이 두고 쓸 때 붙인다."""


def render_all(report: DemoReport) -> RenderedFiles:
    files: dict[str, str] = {"ranking.csv": render_csv(report), "ranking.html": render_html(report)}
    used: set[str] = set()
    for row in report.rows:
        base = f"{row.rank:02d}-{_safe_name(row.company)}"
        while base in used:
            base += "-"
        used.add(base)
        files[f"companies/{base}.md"] = render_company(report, row)
        files[f"facts/{base}.md"] = render_facts(report, row)
    return RenderedFiles(files=files)


def find_contacts_in_output(files: dict[str, str]) -> list[str]:
    """출력물 마지막 방어선: 어느 파일에든 연락처 패턴이 보이면 그 파일 이름과 종류를 돌려준다."""
    found = []
    for name, text in files.items():
        kind = find_contact(text)
        if kind:
            found.append(f"{name} ({kind} 패턴)")
    return found


def write_files(out_dir: Path, rendered: RenderedFiles) -> list[Path]:
    written = []
    for rel, text in rendered.files.items():
        path = out_dir / rel
        path.parent.mkdir(parents=True, exist_ok=True)
        encoding = "utf-8-sig" if rel.endswith(".csv") else "utf-8"
        path.write_text(text, encoding=encoding, newline="\n")
        written.append(path)
    return written


# ---------------------------------------------------------------------------
# 명령 본문
# ---------------------------------------------------------------------------


def _normalize_dir(raw: Path, *, must_exist: bool) -> Path:
    """폴더 인자 정규화(`..`·심볼릭 링크 거부). 출력 폴더는 없어도 된다."""
    given = Path(raw)
    if ".." in given.parts:
        raise InputError(
            message=f"경로에 '..'(상위 폴더)가 들어 있어 받지 않습니다: {given}",
            next_action="저장소 안의 폴더를 전체 경로나 저장소 기준 경로로 적어 주세요.",
        )
    absolute = given if given.is_absolute() else Path.cwd() / given
    if absolute.exists() and absolute.is_symlink():
        raise InputError(
            message=f"심볼릭 링크 폴더는 받지 않습니다: {absolute}",
            next_action="실제 폴더 경로를 적어 주세요.",
        )
    if must_exist:
        if not absolute.exists():
            raise InputError(
                message=f"폴더를 찾을 수 없습니다: {absolute}", next_action="경로를 확인해 주세요."
            )
        if not absolute.is_dir():
            raise InputError(
                message=f"파일이 아니라 폴더를 적어 주세요: {absolute}",
                next_action="사례 파일이 든 폴더 경로를 적어 주세요.",
            )
    elif absolute.exists() and not absolute.is_dir():
        raise InputError(
            message=f"출력 위치가 폴더가 아닙니다: {absolute}",
            next_action="비어 있거나 새로 만들 폴더 경로를 적어 주세요.",
        )
    return absolute


def _parse_base_date(raw: str | None) -> date | None:
    if raw is None:
        return None
    try:
        return date.fromisoformat(raw)
    except ValueError:
        raise InputError(
            message=f"--base-date는 YYYY-MM-DD 형식이어야 하는데 '{raw}'이 적혀 있습니다",
            next_action="예: --base-date 2026-10-27",
        ) from None


def run_demo_report(
    capability: Path,
    cases: Path,
    out: Path,
    base_date: str | None = None,
    echo: Callable[[str], None] = typer.echo,
) -> int:
    """명령 본문. 출력하고 종료 코드를 돌려준다(typer.Exit은 app.py가 던진다)."""
    try:
        capability_path = normalize_input_path(capability)
        cases_dir = _normalize_dir(cases, must_exist=True)
        out_dir = _normalize_dir(out, must_exist=False)
        base = _parse_base_date(base_date)
    except AppError as exc:
        echo(f"오류: {exc.message}")
        echo(exc.next_action)
        return EXIT_INPUT_ERROR

    try:
        report = build_report(capability_path, cases_dir, base_date=base)
    except InputError as exc:
        for line in (format_field_error(f) for f in exc.fields):
            echo(f"오류: {line}")
        echo(f"오류: {exc.message}")
        echo(exc.next_action)
        return EXIT_INPUT_ERROR
    except AppError as exc:
        echo(f"오류: {exc.message}")
        echo(f"자료를 만들지 못했습니다. {exc.next_action}")
        return EXIT_RUN_FAILED
    except Exception as exc:  # 엔진·변환기의 예상 못 한 실패도 숨기지 않는다
        echo(f"오류: 평가 중 실행 실패 ({type(exc).__name__}: {exc})")
        echo("자료를 만들지 못했습니다. 계속되면 PM에게 이 메시지를 알려 주세요.")
        return EXIT_RUN_FAILED

    for warning in report.inputs.warnings:
        echo(f"경고: {warning}")

    rendered = render_all(report)
    contacts = find_contacts_in_output(rendered.files)
    if contacts:
        echo("오류: 출력물에 연락처 패턴이 있어 아무것도 쓰지 않았습니다: " + ", ".join(contacts))
        echo("사례 파일·역량 파일에서 이메일·전화번호를 지운 뒤 다시 실행해 주세요.")
        return EXIT_INPUT_ERROR

    try:
        written = write_files(out_dir, rendered)
    except OSError as exc:
        echo(f"오류: 출력 폴더에 쓰지 못했습니다 ({exc})")
        echo("폴더 권한과 경로를 확인한 뒤 다시 실행해 주세요.")
        return EXIT_RUN_FAILED

    counts = ", ".join(f"{label} {n}건" for label, n in report.counts_by_label().items())
    contact_count = sum(1 for row in report.rows if row.is_contact_candidate)
    echo(f"순위표: {out_dir / 'ranking.csv'} (인쇄용 {out_dir / 'ranking.html'})")
    echo(
        f"기업별 근거 {len(report.rows)}개: {out_dir / 'companies'} · "
        f"사실표 {len(report.rows)}개: {out_dir / 'facts'}"
    )
    echo(
        f"시연 자료 완료: 기업 {len(report.rows)}곳 평가, 접촉 후보 {contact_count}곳 ({counts}). "
        f"파일 {len(written)}개를 썼고 저장(DB)은 하지 않았습니다. "
        f"모든 파일 머리에 '{HEADER_MARK}'."
    )
    return EXIT_OK
