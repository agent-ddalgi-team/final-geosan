"""사례 파일·역량 파일 검사 (기능 명세 W1·W2 1~2단계; BR2.1~BR2.3, BR2.5, BR4.2, BR1.2, BR1.4).

`check-case`(저장 없음, DB 없음)와 `import-case`·`import-capability`(이강욱, Step 16·17)가 같은
검사기를 쓴다. 한 항목이라도 오류면 아무것도 저장하지 않는다(BR2.2). 오류는 첫 번째에서 멈추지
않고 전부 모은다.

순서: 파일 읽기(줄 번호) → 모양(pydantic, 모르는 키·허용 값) → 연락처 패턴 → 파일 안 참조·단계값 →
(역량 파일을 함께 주면) 공정 코드·거산 값 참조 존재 여부(경고).
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from datetime import date
from pathlib import Path

from pydantic import ValidationError

from geosan.config.app_settings import DEFAULT_APP_SETTINGS_PATH, load_app_settings
from geosan.config.errors import FieldError, InputError
from geosan.config.loader import LoadedDocument, load_document
from geosan.config.rule_config import (
    MatchRateError,
    load_rule_config,
    resolve_match_rate,
)
from geosan.config.schemas import (
    CapabilityFile,
    CapabilityQualification,
    CaseFile,
    CaseItemInput,
    CaseSignal,
)
from geosan.config.validators import (
    format_field_error,
    pydantic_errors_to_fields,
    scan_contacts,
)
from geosan.rules.codes import (
    CALL_SIGNAL_KINDS,
    CapKind,
    ItemCode,
    ItemState,
    ReqKind,
    ScopeKind,
    SignalKind,
    SignalRelation,
)
from geosan.rules.models import RuleConfig

REPO_ROOT = Path(__file__).resolve().parents[2]
DEFAULT_RULE_CONFIG_PATH = REPO_ROOT / "examples" / "rule-config.yaml"
"""check-case가 일치도 단계 이름을 숫자로 바꿀 때 쓰는 기본 규칙 설정(저장소 동봉 예시 파일)."""

JUDGED_STATES: frozenset[ItemState] = frozenset(
    {ItemState.CONFIRMED, ItemState.STRONG, ItemState.WEAK}
)
"""일치도·확실도가 꼭 있어야 하는 상태(점수가 0보다 클 수 있는 상태)."""

ITEM_SIGNAL_KIND: dict[ItemCode, SignalKind] = {
    ItemCode.SIG_EXPAND: SignalKind.EXPANSION,
    ItemCode.SIG_ORDER: SignalKind.NEW_ORDER,
    ItemCode.SIG_BID: SignalKind.BID,
    ItemCode.SIG_HIRE: SignalKind.HIRING,
}
"""시점 항목 ↔ 신호 종류 (entities.md ItemJudgmentInput 제약)."""

RELATION_RATE: dict[SignalRelation, float] = {
    SignalRelation.DIRECT: 1.0,
    SignalRelation.INDIRECT: 0.5,
}
"""직접 관련 1.0 / 간접 관련 0.5 (BR4.2 SIG_* 단계). 규칙 설정의 SIG_* 단계값과 같은 뜻이다."""


@dataclass
class CheckReport:
    """검사 결과. errors가 비어 있어야 통과. warnings는 통과를 막지 않는다."""

    path: Path
    errors: list[FieldError] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)
    notices: list[str] = field(default_factory=list)
    case: CaseFile | None = None
    capability: CapabilityFile | None = None
    match_rates: dict[str, float | None] = field(default_factory=dict)
    """itemCode → 숫자 일치도(단계 이름을 바꾼 값). 통과했을 때만 채운다."""

    @property
    def ok(self) -> bool:
        return not self.errors

    def error_lines(self) -> list[str]:
        return [format_field_error(e) for e in self.errors]


class _Collector:
    def __init__(self, document: LoadedDocument, report: CheckReport) -> None:
        self.document = document
        self.report = report

    def error(self, path: str, message: str) -> None:
        self.report.errors.append(
            FieldError(path=path, message=message, line=self.document.line_of(path))
        )

    def warn(self, path: str, message: str) -> None:
        line = self.document.line_of(path)
        head = f"{line}번째 줄 {path}" if line else path
        self.report.warnings.append(f"{head}: {message}")


# ---------------------------------------------------------------------------
# 역량 파일
# ---------------------------------------------------------------------------


def check_capability_file(path: Path | str) -> CheckReport:
    """거산 역량 파일 검사(W1 1~2단계). 통과하면 report.capability에 모델이 들어 있다."""
    file_path = Path(path)
    report = CheckReport(path=file_path)
    try:
        document = load_document(file_path)
    except InputError as exc:
        report.errors.extend(exc.fields or [FieldError(path="", message=exc.message)])
        return report
    try:
        model = CapabilityFile.model_validate(document.data)
    except ValidationError as exc:
        report.errors.extend(pydantic_errors_to_fields(exc, document.data, document))
        report.errors.extend(scan_contacts(document.data, "", document))
        return report
    report.errors.extend(scan_contacts(document.data, "", document))
    collector = _Collector(document, report)
    _capability_semantics(model, collector)
    if report.ok:
        report.capability = model
    return report


def _capability_semantics(model: CapabilityFile, c: _Collector) -> None:
    codes: dict[str, int] = {}
    for index, process in enumerate(model.processes):
        base = f"processes[{index}]"
        if process.code in codes:
            c.error(
                f"{base}.code",
                f"공정 코드 '{process.code}'가 {codes[process.code] + 1}번째 공정에도 있습니다 "
                "(묶음 안에서 공정은 하나씩)",
            )
        codes.setdefault(process.code, index)
        names: set[tuple[str, str]] = set()
        for cap_index, cap in enumerate(process.capabilities):
            cap_path = f"{base}.capabilities[{cap_index}]"
            key = (cap.cap_kind, cap.name)
            if key in names:
                c.error(
                    f"{cap_path}.name", f"같은 종류·이름의 역량 항목 '{cap.name}'이 두 번 나옵니다"
                )
            names.add(key)
            if cap.cap_kind == CapKind.EQUIPMENT and not cap.is_descriptive_only:
                c.error(
                    f"{cap_path}.isDescriptiveOnly",
                    "설비(EQUIPMENT) 항목은 설명용이라 true여야 합니다 (BR1.2)",
                )
            has_number = cap.numeric_min is not None or cap.numeric_max is not None
            if has_number and not cap.unit:
                c.error(f"{cap_path}.unit", "숫자 사양에는 단위가 꼭 있어야 합니다 (BR1.2)")
            if (
                cap.numeric_min is not None
                and cap.numeric_max is not None
                and cap.numeric_min > cap.numeric_max
            ):
                c.error(
                    f"{cap_path}.numericMax",
                    f"최대값({cap.numeric_max:g})이 최소값({cap.numeric_min:g})보다 "
                    "작습니다 (BR1.2)",
                )
    qual_keys: dict[tuple[str, str | None], int] = {}
    for index, qual in enumerate(model.qualifications):
        base = f"qualifications[{index}]"
        key = (qual.official_name, qual.number)
        if key in qual_keys:
            c.error(
                f"{base}.officialName",
                f"같은 자격(이름 '{qual.official_name}', 번호 '{qual.number}')이 두 번 나옵니다",
            )
        qual_keys.setdefault(key, index)
        if (
            qual.valid_from is not None
            and qual.valid_to is not None
            and qual.valid_from > qual.valid_to
        ):
            c.error(f"{base}.validTo", "유효기간 끝(validTo)이 시작(validFrom)보다 앞입니다")
        _check_status_dates_unique(qual, base, c)
        for scope_index, scope in enumerate(qual.scopes):
            scope_path = f"{base}.scopes[{scope_index}]"
            if scope.scope_kind == "PROCESS":
                if scope.process_code is None:
                    c.error(
                        f"{scope_path}.processCode",
                        "scopeKind가 PROCESS면 processCode를 꼭 적어야 합니다 "
                        "(비어 있다고 '모든 공정'으로 읽지 않습니다, BR1.4)",
                    )
                elif scope.process_code not in codes:
                    c.error(
                        f"{scope_path}.processCode",
                        f"이 파일의 공정 목록에 없는 공정 코드 '{scope.process_code}'입니다",
                    )
            elif scope.process_code is not None:
                c.error(
                    f"{scope_path}.processCode",
                    f"scopeKind가 {scope.scope_kind}면 processCode는 null이어야 합니다",
                )
            if scope.scope_kind == "OPPORTUNITY":
                c.error(
                    f"{scope_path}.scopeKind",
                    "역량 파일에서는 기회 범위(OPPORTUNITY) 자격을 받지 않습니다. 특정 기회에만 "
                    "쓰는 자격은 뒤 단계(U4 검수 명령)에서 등록합니다 "
                    "(PM 결정 2026-10-22, 이슈 #38). PROCESS 또는 CUSTOMER로 적어 주세요",
                )
            elif scope.scope_kind == "CUSTOMER" and not scope.customer_ref:
                c.error(
                    f"{scope_path}.customerRef",
                    "scopeKind가 CUSTOMER면 customerRef(고객 상호명)를 꼭 적어야 합니다",
                )


def _check_status_dates_unique(qual: CapabilityQualification, base: str, c: _Collector) -> None:
    """한 자격 안에서 발생일·확인일이 완전히 같은 상태 이력은 받지 않는다(이슈 #57).

    두 이력의 날짜가 모두 같으면 어느 쪽이 최신인지 가릴 수 없어 판정이 저장 순서·ID에 따라
    달라진다.
    날짜가 비어 있는(null) 쌍도 같은 쌍이면 똑같이 거부한다(PM 결정 2026-10-24). 서로 다른 자격의
    같은 날짜는 허용한다. 중복된 이력마다 "몇 번째 이력과 같은지"를 오류로 모은다.
    """
    seen: dict[tuple[date | None, date | None], int] = {}
    for index, status in enumerate(qual.statuses):
        key = (status.occurred_at, status.confirmed_at)
        first = seen.get(key)
        if first is None:
            seen[key] = index
            continue
        occurred = status.occurred_at.isoformat() if status.occurred_at else "비어 있음"
        confirmed = status.confirmed_at.isoformat() if status.confirmed_at else "비어 있음"
        c.error(
            f"{base}.statuses[{index}].occurredAt",
            f"같은 자격의 발생일({occurred})·확인일({confirmed})이 {first + 1}번째 상태 이력과 "
            "같습니다. 어느 이력이 최신인지 가릴 수 없어 저장하지 않습니다. 날짜와 상태를 확인해 "
            "주세요 (이슈 #57)",
        )


# ---------------------------------------------------------------------------
# 사례 파일
# ---------------------------------------------------------------------------


def check_case_file(
    path: Path | str,
    capability_path: Path | str | None = None,
    rule_config_path: Path | str | None = None,
    *,
    industries: list[str] | None = None,
) -> CheckReport:
    """사례 파일 검사(W2 1~2단계, BR2.9). 저장하지 않고 DB를 쓰지 않는다.

    - `capability_path`를 주면 공정 코드·거산 값 참조가 그 파일에 있는지도 본다(없으면 경고).
    - `rule_config_path`(기본 `examples/rule-config.yaml`)의 단계 이름 표로 일치도를 숫자로 바꾼다.
    """
    file_path = Path(path)
    report = CheckReport(path=file_path)
    try:
        document = load_document(file_path)
    except InputError as exc:
        report.errors.extend(exc.fields or [FieldError(path="", message=exc.message)])
        return report
    try:
        model = CaseFile.model_validate(document.data)
    except ValidationError as exc:
        report.errors.extend(pydantic_errors_to_fields(exc, document.data, document))
        report.errors.extend(scan_contacts(document.data, "", document))
        return report
    report.errors.extend(scan_contacts(document.data, "", document))
    collector = _Collector(document, report)

    if model.customer.industries:
        try:
            allowed = (
                industries
                if industries is not None
                else load_app_settings(DEFAULT_APP_SETTINGS_PATH).industries
            )
        except InputError as exc:
            report.errors.extend(exc.fields or [FieldError(path="", message=exc.message)])
        else:
            for index, industry in enumerate(model.customer.industries):
                if industry not in allowed:
                    report.errors.append(
                        FieldError(
                            path=f"customer.industries[{index}]",
                            message="앱 설정 industries 목록 안의 산업군을 적어 주세요.",
                            line=document.line_of(f"customer.industries[{index}]"),
                        )
                    )

    rule_config = _load_rule_config_for_check(rule_config_path, report)
    capability = _load_capability_for_check(capability_path, report)

    _case_semantics(model, rule_config, capability, collector)
    if report.ok:
        report.case = model
        report.capability = capability
    return report


def _load_rule_config_for_check(
    rule_config_path: Path | str | None, report: CheckReport
) -> RuleConfig | None:
    chosen = Path(rule_config_path) if rule_config_path else DEFAULT_RULE_CONFIG_PATH
    if not chosen.exists():
        report.notices.append(
            f"규칙 설정 파일이 없어 일치도 단계 이름을 숫자로 바꾸지 못합니다: {chosen}"
        )
        return None
    try:
        config = load_rule_config(chosen)
    except InputError as exc:
        report.errors.append(
            FieldError(path="", message=f"규칙 설정 파일 오류({chosen.name}): {exc.message}")
        )
        return None
    report.notices.append(
        f"일치도 단계는 규칙 설정 {chosen} (version {config.version}) 기준으로 검사함"
    )
    return config


def _load_capability_for_check(
    capability_path: Path | str | None, report: CheckReport
) -> CapabilityFile | None:
    if capability_path is None:
        report.notices.append("역량 파일 없이 검사함 (공정 코드·거산 값 참조 존재는 검사하지 않음)")
        return None
    cap_report = check_capability_file(capability_path)
    if not cap_report.ok:
        report.errors.append(
            FieldError(
                path="",
                message=(
                    f"함께 준 역량 파일({Path(capability_path).name})에 오류가 "
                    f"{len(cap_report.errors)}건 있습니다: "
                    + " / ".join(cap_report.error_lines()[:3])
                ),
            )
        )
        return None
    report.notices.append(
        f"역량 파일 {Path(capability_path).name} "
        f"(묶음 {cap_report.capability.dataset_kind})과 함께 검사함"
    )
    return cap_report.capability


def _case_semantics(
    model: CaseFile,
    rule_config: RuleConfig | None,
    capability: CapabilityFile | None,
    c: _Collector,
) -> None:
    link_codes = _check_process_links(model, capability, c)
    _check_requirements(model, link_codes, c)
    _check_signals(model, c)
    _check_item_inputs(model, rule_config, capability, c)
    _check_card_reason(model, c)
    _check_expected(model, c)


def _check_process_links(
    model: CaseFile, capability: CapabilityFile | None, c: _Collector
) -> set[str]:
    seen: dict[str, int] = {}
    cap_codes = {p.code for p in capability.processes} if capability else None
    for index, link in enumerate(model.process_links):
        path = f"processLinks[{index}].processCode"
        if link.process_code in seen:
            c.error(
                path,
                f"공정 '{link.process_code}' 연결이 {seen[link.process_code] + 1}번째에도 있습니다 "
                "((기회, 공정) 쌍당 하나, BR2.5)",
            )
        seen.setdefault(link.process_code, index)
        if cap_codes is not None and link.process_code not in cap_codes:
            c.warn(
                path,
                f"역량 파일에 없는 공정 '{link.process_code}'입니다 "
                "(평가에서 이 연결은 확인 대기로 처리됩니다)",
            )
    if not model.process_links:
        c.error("processLinks", "공정 연결이 하나 이상 있어야 합니다")
    return set(seen)


def _check_requirements(model: CaseFile, link_codes: set[str], c: _Collector) -> None:
    seen: dict[tuple[str, str], int] = {}
    for index, req in enumerate(model.requirements):
        base = f"requirements[{index}]"
        key = (req.req_kind, req.name.strip())
        if key in seen:
            c.error(
                f"{base}.name",
                f"같은 요구 '{req.name}'({req.req_kind})가 {seen[key] + 1}번째 요구에도 있습니다",
            )
        seen.setdefault(key, index)
        if req.scope_kind == ScopeKind.PROCESS_LINK:
            if req.link_process_code is None:
                c.error(
                    f"{base}.linkProcessCode",
                    "scopeKind가 PROCESS_LINK면 대조할 공정 linkProcessCode를 꼭 적어야 합니다",
                )
            elif req.link_process_code not in link_codes:
                c.error(
                    f"{base}.linkProcessCode",
                    f"processLinks에 없는 공정 '{req.link_process_code}'입니다",
                )
        elif req.link_process_code is not None:
            c.error(
                f"{base}.linkProcessCode",
                "scopeKind가 OPPORTUNITY면 linkProcessCode는 null이어야 합니다",
            )
        if req.req_kind == ReqKind.TECHNICAL:
            if req.required_value is not None and not req.unit:
                c.error(
                    f"{base}.unit", "기술 조건의 기준값(requiredValue)에는 단위가 꼭 있어야 합니다"
                )
        elif req.required_value is not None or req.unit is not None:
            c.warn(
                f"{base}.requiredValue",
                f"{req.req_kind} 요구의 requiredValue·unit은 판정에 쓰이지 않습니다 "
                "(TECHNICAL만 대조)",
            )


def _check_signals(model: CaseFile, c: _Collector) -> None:
    for index, signal in enumerate(model.signals):
        base = f"signals[{index}]"
        if signal.signal_kind in CALL_SIGNAL_KINDS:
            # #685: 통화 신호는 접촉 기록의 꼬리 질문 답에서 서버가 만든다(사례 파일로는 안 넣음).
            c.error(
                f"{base}.signalKind",
                f"통화 신호({signal.signal_kind})는 사례 파일에 적을 수 없습니다. "
                "접촉 기록의 꼬리 질문 답에서만 만들어집니다",
            )
        if signal.signal_kind == SignalKind.BID and signal.deadline_at is None:
            c.warn(
                f"{base}.deadlineAt",
                "공고(BID)는 마감일을 적어 주세요. 없으면 미확보로 처리됩니다 (BR4.4)",
            )
        if (
            signal.occurred_at is not None
            and model.base_date is not None
            and signal.occurred_at > model.base_date
        ):
            c.warn(
                f"{base}.occurredAt",
                f"발생일이 기준일({model.base_date})보다 뒤라 예정 사건(미확보)으로 "
                "처리됩니다 (BR4.4)",
            )


CARD_REASON_MAX = 80


def _check_card_reason(model: CaseFile, c: _Collector) -> None:
    """카드 추천 이유는 출처 제외 80자 안(PM 결정 2026-10-26).

    넘으면 경고만 하고 투입은 막지 않는다. 끝의 괄호(출처)는 글자 수에서 뺀다."""
    text = model.opportunity.card_reason
    if text is None:
        return
    body = re.sub(r"\s*\([^()]*\)\s*$", "", text.strip())
    if len(body) > CARD_REASON_MAX:
        c.warn(
            "opportunity.cardReason",
            f"카드 문장이 출처를 빼고 {len(body)}자입니다 "
            f"({CARD_REASON_MAX}자 안이면 카드에서 두 줄 안에 들어갑니다)",
        )


def _check_item_inputs(
    model: CaseFile,
    rule_config: RuleConfig | None,
    capability: CapabilityFile | None,
    c: _Collector,
) -> None:
    seen: dict[str, int] = {}
    evidence_count = len(model.evidence)
    signal_count = len(model.signals)
    for index, item in enumerate(model.item_inputs):
        base = f"itemInputs[{index}]"
        if item.item_code in seen:
            c.error(
                f"{base}.itemCode",
                f"항목 '{item.item_code}'가 {seen[item.item_code] + 1}번째 항목에도 "
                "있습니다 (항목당 한 줄)",
            )
        seen.setdefault(item.item_code, index)

        for ref_index, ref in enumerate(item.evidence_refs):
            if ref >= evidence_count:
                c.error(
                    f"{base}.evidenceRefs[{ref_index}]",
                    f"번호 {ref}은 evidence 배열 밖입니다 (0~{evidence_count - 1}만 가능)"
                    if evidence_count
                    else f"번호 {ref}을 적었지만 evidence 배열이 비어 있습니다",
                )
        for ref_index, ref in enumerate(item.signal_refs):
            if ref >= signal_count:
                c.error(
                    f"{base}.signalRefs[{ref_index}]",
                    f"번호 {ref}은 signals 배열 밖입니다 (0~{signal_count - 1}만 가능)"
                    if signal_count
                    else f"번호 {ref}을 적었지만 signals 배열이 비어 있습니다",
                )

        rate = _check_match_rate_and_certainty(item, base, rule_config, c)
        c.report.match_rates[item.item_code] = rate
        _check_item_signals(model, item, base, rate, c)
        _check_used_capability_refs(item, base, capability, c)


def _check_match_rate_and_certainty(
    item: CaseItemInput, base: str, rule_config: RuleConfig | None, c: _Collector
) -> float | None:
    judged = item.state in JUDGED_STATES
    if judged:
        if item.certainty != item.state:
            c.error(
                f"{base}.certainty",
                f"state가 {item.state}이면 certainty도 '{item.state}'이어야 하는데 "
                f"'{item.certainty}'이 적혀 있습니다",
            )
        if item.match_rate is None:
            c.error(
                f"{base}.matchRate",
                f"state가 {item.state}이면 일치도(matchRate)를 꼭 적어야 합니다",
            )
            return None
    else:
        if item.certainty is not None:
            c.error(
                f"{base}.certainty",
                f"state가 {item.state}이면 certainty는 null이어야 하는데 "
                f"'{item.certainty}'이 적혀 있습니다",
            )
        if item.match_rate is not None:
            c.error(
                f"{base}.matchRate",
                f"state가 {item.state}이면 matchRate는 null이어야 하는데 "
                f"'{item.match_rate}'이 적혀 있습니다",
            )
        return None
    if rule_config is None:
        if isinstance(item.match_rate, str):
            c.warn(f"{base}.matchRate", "규칙 설정이 없어 단계 이름을 숫자로 바꾸지 못했습니다")
            return None
        return float(item.match_rate)
    try:
        return resolve_match_rate(rule_config, item.item_code, item.match_rate)
    except MatchRateError as exc:
        c.error(f"{base}.matchRate", str(exc))
        return None


def _check_item_signals(
    model: CaseFile, item: CaseItemInput, base: str, rate: float | None, c: _Collector
) -> None:
    expected_kind = ITEM_SIGNAL_KIND.get(item.item_code)
    if expected_kind is None:
        if item.signal_refs:
            c.error(
                f"{base}.signalRefs",
                f"{item.item_code}는 시점 항목이 아니라 signalRefs를 비워야 합니다",
            )
        return
    judged = item.state in JUDGED_STATES
    valid_refs = [ref for ref in item.signal_refs if ref < len(model.signals)]
    if judged and not valid_refs:
        c.error(
            f"{base}.signalRefs",
            f"{item.item_code}의 state가 {item.state}이면 쓰인 신호 번호(signalRefs)가 "
            "1개 이상 있어야 합니다",
        )
        return
    for ref in valid_refs:
        signal = model.signals[ref]
        if signal.signal_kind != expected_kind:
            c.error(
                f"{base}.signalRefs",
                f"{item.item_code}는 {expected_kind} 신호를 써야 하는데 signals[{ref}]는 "
                f"{signal.signal_kind}입니다",
            )
    if not judged or rate is None or not valid_refs:
        return
    representative = _representative_signal(
        item.item_code, [model.signals[ref] for ref in valid_refs], model.base_date
    )
    if representative is None:
        relations = {model.signals[ref].relation for ref in valid_refs}
        if len(relations) == 1:
            representative = model.signals[valid_refs[0]]
        else:
            c.warn(
                f"{base}.matchRate",
                "baseDate가 없어 대표 신호를 고르지 못해 일치도와 relation 일치 여부를 "
                "검사하지 않았습니다",
            )
            return
    expected_rate = RELATION_RATE[representative.relation]
    if abs(expected_rate - rate) > 1e-9:
        c.error(
            f"{base}.matchRate",
            f"{item.item_code}의 matchRate {rate:g}이 대표 신호의 relation "
            f"{representative.relation}({expected_rate:g})와 다릅니다",
        )


def _representative_signal(
    item_code: ItemCode, signals: list[CaseSignal], base_date: date | None
) -> CaseSignal | None:
    """BR4.4 대표 신호 선택. 기준일이 없으면 None(호출자가 relation 일치 여부로 대신 본다)."""
    if base_date is None:
        return None
    if item_code == ItemCode.SIG_BID:
        with_deadline = [s for s in signals if s.deadline_at is not None]
        if not with_deadline:
            return signals[0] if len(signals) == 1 else None
        upcoming = [s for s in with_deadline if s.deadline_at >= base_date]  # type: ignore[operator]
        if upcoming:
            return min(upcoming, key=lambda s: s.deadline_at)  # type: ignore[arg-type,return-value]
        return max(with_deadline, key=lambda s: s.deadline_at)  # type: ignore[arg-type,return-value]
    past = [s for s in signals if s.occurred_at is not None and s.occurred_at <= base_date]
    if past:
        return max(past, key=lambda s: s.occurred_at)  # type: ignore[arg-type,return-value]
    return signals[0] if len(signals) == 1 else None


def _check_used_capability_refs(
    item: CaseItemInput, base: str, capability: CapabilityFile | None, c: _Collector
) -> None:
    processes = {p.code: p for p in capability.processes} if capability else None
    for ref_index, ref in enumerate(item.used_capability_refs):
        path = f"{base}.usedCapabilityRefs[{ref_index}]"
        if ref.kind == "CAPABILITY" and not ref.name:
            c.error(
                f"{path}.name", "kind가 CAPABILITY면 대조한 역량 항목 이름(name)을 꼭 적어야 합니다"
            )
        if ref.kind == "DELIVERY_RECORD" and not ref.industry:
            c.error(
                f"{path}.industry",
                "kind가 DELIVERY_RECORD면 대조한 실적 산업(industry)을 꼭 적어야 합니다",
            )
        if processes is None:
            continue
        process = processes.get(ref.process_code)
        if process is None:
            c.warn(f"{path}.processCode", f"역량 파일에 없는 공정 '{ref.process_code}'입니다")
            continue
        if (
            ref.kind == "CAPABILITY"
            and ref.name
            and ref.name not in {cap.name for cap in process.capabilities}
        ):
            c.warn(
                f"{path}.name",
                f"역량 파일의 {ref.process_code} 공정에 역량 항목 '{ref.name}'이 없습니다",
            )
        if (
            ref.kind == "DELIVERY_RECORD"
            and ref.industry
            and ref.industry not in {rec.industry for rec in process.delivery_records}
        ):
            c.warn(
                f"{path}.industry",
                f"역량 파일의 {ref.process_code} 공정에 산업 '{ref.industry}' 실적이 없습니다",
            )


def _check_expected(model: CaseFile, c: _Collector) -> None:
    if model.expected is None:
        return
    names = {req.name.strip() for req in model.requirements}
    for name in model.expected.requirement_results:
        if name.strip() not in names:
            c.error(
                f"expected.requirementResults.{name}",
                f"requirements에 없는 요구 이름 '{name}'입니다",
            )
    if model.expected.p == 0 and model.expected.s is not None:
        c.error("expected.S", "P가 0이면 S는 null(산정 전)이어야 합니다")


__all__ = [
    "CheckReport",
    "DEFAULT_RULE_CONFIG_PATH",
    "ITEM_SIGNAL_KIND",
    "JUDGED_STATES",
    "RELATION_RATE",
    "check_capability_file",
    "check_case_file",
]
