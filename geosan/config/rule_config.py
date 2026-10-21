"""규칙 설정 파일(rule-config.yaml) 읽기·검사·단계 이름 변환 (C7 RuleConfig, BR2.2·BR4.2·BR7.6).

모든 수치(배점·단계값·확실도·감쇠·기준점)는 코드가 아니라 이 파일에서 읽는다(NFR11).
파일 내용의 SHA-256을 `ruleHash`로 붙여 돌려주고, DB 등록(`cfg_rule_config_version`)은
`register_rule_config_version`이 한다(FIXED 버전은 덮어쓰지 않는다).
"""

from __future__ import annotations

import hashlib
from collections.abc import Callable
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path

from pydantic import ValidationError
from sqlalchemy import select
from sqlalchemy.orm import Session

from geosan.config.errors import FieldError, InputError
from geosan.config.loader import LoadedDocument, load_document
from geosan.config.validators import format_field_error, pydantic_errors_to_fields
from geosan.rules.codes import ClassificationCode, ItemCode, Profile
from geosan.rules.models import ProfileItemConfig, RuleConfig

HYPOTHESIS_NOTE = "기업 승인 전 가설"
"""계약 C7이 정한 고정 문구. 모든 수치가 가설임을 파일이 스스로 밝힌다(BR7.6)."""


def compute_rule_hash(path: Path | str) -> str:
    """파일 바이트의 SHA-256(16진수). 같은 내용 → 같은 해시."""
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


@dataclass
class RuleConfigCheck:
    """규칙 설정 파일 검사 결과."""

    document: LoadedDocument
    config: RuleConfig | None
    errors: list[FieldError]

    @property
    def ok(self) -> bool:
        return not self.errors and self.config is not None


def check_rule_config_file(path: Path | str) -> RuleConfigCheck:
    """파일을 읽고 모양(pydantic)과 뜻(아래 규칙)을 검사한다. 오류는 줄 번호와 함께 모은다."""
    document = load_document(path)
    try:
        config = RuleConfig.model_validate(document.data)
    except ValidationError as exc:
        return RuleConfigCheck(
            document=document,
            config=None,
            errors=pydantic_errors_to_fields(exc, document.data, document),
        )
    errors = _semantic_errors(config, document)
    if errors:
        return RuleConfigCheck(document=document, config=None, errors=errors)
    config.rule_hash = compute_rule_hash(document.path)
    return RuleConfigCheck(document=document, config=config, errors=[])


def load_rule_config(path: Path | str) -> RuleConfig:
    """검사를 통과한 RuleConfig(해시 포함)를 돌려준다. 틀리면 InputError(칸별 오류 목록)."""
    result = check_rule_config_file(path)
    if result.config is None:
        raise InputError(
            message=f"규칙 설정 파일에 오류가 {len(result.errors)}건 있습니다: {Path(path).name}",
            next_action="\n".join(format_field_error(e) for e in result.errors),
            fields=result.errors,
        )
    return result.config


def _semantic_errors(config: RuleConfig, document: LoadedDocument) -> list[FieldError]:
    errors: list[FieldError] = []

    def add(path: str, message: str) -> None:
        errors.append(FieldError(path=path, message=message, line=document.line_of(path)))

    if config.hypothesis_note != HYPOTHESIS_NOTE:
        add(
            "hypothesisNote",
            f"'{HYPOTHESIS_NOTE}'이어야 하는데 '{config.hypothesis_note}'이 적혀 있습니다",
        )

    expected_new = [code.value for code in ItemCode]
    actual_new = [item.item_code for item in config.new_profile_items]
    if sorted(actual_new) != sorted(expected_new):
        add(
            "newProfileItems",
            "신규 프로필 8항목 코드는 "
            + ", ".join(f"'{c}'" for c in expected_new)
            + f"이어야 하는데 {actual_new}이 적혀 있습니다",
        )
    _check_items("newProfileItems", config.new_profile_items, add)
    _check_items("recontactProfileItems", config.recontact_profile_items, add)

    if not config.general_decay or config.general_decay[-1].max_days is not None:
        add("generalDecay", "마지막 단계의 maxDays는 null('그 이상 전부')이어야 합니다")
    previous = -1
    for index, step in enumerate(config.general_decay[:-1]):
        if step.max_days is None:
            add(f"generalDecay[{index}]", "마지막 단계만 maxDays를 null로 둘 수 있습니다")
        elif step.max_days <= previous:
            add(f"generalDecay[{index}].maxDays", "maxDays는 앞 단계보다 커야 합니다")
        else:
            previous = step.max_days

    expected_labels = {code.value for code in ClassificationCode}
    label_keys = set(config.classification_labels)
    missing = sorted(expected_labels - label_keys)
    unknown = sorted(label_keys - expected_labels)
    if missing:
        add("classificationLabels", f"분류 코드 {missing}의 쉬운 말이 없습니다")
    for key in unknown:
        add(f"classificationLabels.{key}", f"모르는 분류 코드 '{key}'입니다")
    for key, label in config.classification_labels.items():
        if not str(label).strip():
            add(f"classificationLabels.{key}", "비워 둘 수 없습니다")

    core_items = {item.item_code for item in config.new_profile_items}
    for code in config.core_evidence.new.items:
        if code not in core_items:
            add("coreEvidence.new.items", f"신규 프로필 8항목에 없는 코드 '{code}'입니다")

    if len(config.dataset_kinds) != len(set(config.dataset_kinds)):
        add("datasetKinds", "같은 묶음 종류가 두 번 적혀 있습니다")
    return errors


def _check_items(
    prefix: str, items: list[ProfileItemConfig], add: Callable[[str, str], None]
) -> None:
    seen: set[str] = set()
    for index, item in enumerate(items):
        if item.item_code in seen:
            add(f"{prefix}[{index}].itemCode", f"항목 코드 '{item.item_code}'가 두 번 나옵니다")
        seen.add(item.item_code)
        if not item.match_rate_steps:
            add(f"{prefix}[{index}].matchRateSteps", "단계가 하나 이상 있어야 합니다")
        for name, rate in item.match_rate_steps.items():
            if not 0 <= float(rate) <= 1:
                add(
                    f"{prefix}[{index}].matchRateSteps.{name}",
                    f"일치도 단계값은 0~1 사이여야 하는데 '{rate}'이 적혀 있습니다",
                )


# ---------------------------------------------------------------------------
# 단계 이름 → 숫자 변환표 (BR2.2, BR4.2)
# ---------------------------------------------------------------------------


def profile_items(
    config: RuleConfig, profile: Profile | str = Profile.NEW
) -> list[ProfileItemConfig]:
    return (
        config.new_profile_items
        if Profile(profile) == Profile.NEW
        else config.recontact_profile_items
    )


def match_rate_steps(
    config: RuleConfig, profile: Profile | str = Profile.NEW
) -> dict[str, dict[str, float]]:
    """항목 코드 → {단계 이름: 일치도}. 검사기와 엔진이 같은 표를 쓴다."""
    return {
        item.item_code: {name: float(rate) for name, rate in item.match_rate_steps.items()}
        for item in profile_items(config, profile)
    }


def allowed_steps_text(steps: dict[str, float]) -> str:
    """오류 문구용: '정확히 일치'(1.0), '일부 가능'(0.5)"""
    return ", ".join(f"'{name}'({rate:g})" for name, rate in steps.items())


class MatchRateError(ValueError):
    """단계 밖 일치도. message는 계약 문구('… 중 하나여야 하는데 … 적혀 있습니다')다."""


def resolve_match_rate(
    config: RuleConfig,
    item_code: str,
    value: float | str | None,
    profile: Profile | str = Profile.NEW,
) -> float | None:
    """단계 이름 또는 숫자를 고정 단계값(숫자)으로 바꾼다. 단계 밖이면 MatchRateError."""
    if value is None:
        return None
    steps = match_rate_steps(config, profile).get(str(item_code))
    if steps is None:
        raise MatchRateError(f"규칙 설정에 없는 항목 코드 '{item_code}'입니다")
    if isinstance(value, str):
        text = value.strip()
        if text in steps:
            return steps[text]
        try:
            number = float(text)
        except ValueError:
            raise MatchRateError(
                f"{item_code}의 일치도 단계 {allowed_steps_text(steps)} 중 하나여야 하는데 "
                f"'{value}'이 적혀 있습니다"
            ) from None
    else:
        number = float(value)
    for rate in steps.values():
        if abs(rate - number) < 1e-9:
            return rate
    raise MatchRateError(
        f"{item_code}의 일치도 단계 {allowed_steps_text(steps)} 중 하나여야 하는데 "
        f"'{value}'이 적혀 있습니다"
    )


def step_name_for(config: RuleConfig, item_code: str, rate: float) -> str | None:
    """숫자 일치도에 해당하는 단계 이름(표시용). 없으면 None."""
    for name, value in match_rate_steps(config).get(str(item_code), {}).items():
        if abs(value - rate) < 1e-9:
            return name
    return None


# ---------------------------------------------------------------------------
# DB 등록 (cfg_rule_config_version, BR7.6)
# ---------------------------------------------------------------------------


def register_rule_config_version(session: Session, config: RuleConfig, file_path: Path | str):
    """규칙 설정 버전을 등록하거나 기존 행을 돌려준다.

    - 같은 version·같은 hash → 기존 행.
    - 같은 version·다른 hash: DRAFT면 해시를 갱신, FIXED면 거부(새 version으로만).
    - 다른 version·같은 hash → 거부(같은 내용으로 두 버전을 만들지 않는다).
    """
    from geosan.config.models import RuleConfigVersion

    if not config.rule_hash:
        raise InputError(
            message="규칙 설정 해시가 없습니다. load_rule_config로 읽은 설정을 넘겨 주세요.",
            next_action="geosan check-config를 먼저 실행해 주세요.",
        )
    same_hash = session.scalar(
        select(RuleConfigVersion).where(RuleConfigVersion.rule_hash == config.rule_hash)
    )
    if same_hash is not None:
        if same_hash.rule_version == config.version:
            return same_hash
        raise InputError(
            message=(
                f"같은 내용(해시)의 규칙 설정이 이미 버전 '{same_hash.rule_version}'으로 "
                f"등록되어 있습니다. 파일의 version은 '{config.version}'입니다."
            ),
            next_action="내용을 바꿨으면 version을 올리고, 아니면 등록된 version을 그대로 쓰세요.",
        )
    existing = session.scalar(
        select(RuleConfigVersion).where(RuleConfigVersion.rule_version == config.version)
    )
    if existing is None:
        row = RuleConfigVersion(
            rule_version=config.version,
            rule_hash=config.rule_hash,
            status="DRAFT",
            company_approval_status="HYPOTHESIS",
            file_path=str(Path(file_path).resolve()),
            created_by="system",
            dataset_kind=None,
            is_virtual=False,
        )
        session.add(row)
        session.flush()
        return row
    if existing.status == "FIXED":
        raise InputError(
            message=(
                f"규칙 설정 version '{config.version}'은 고정(FIXED)되어 있는데 "
                "파일 내용이 달라졌습니다."
            ),
            next_action=(
                "version을 올려(예: v0.17-b) 새 버전으로 등록해 주세요. "
                "고정 버전은 덮어쓰지 않습니다."
            ),
        )
    existing.rule_hash = config.rule_hash
    existing.file_path = str(Path(file_path).resolve())
    existing.change_reason = f"DRAFT 해시 갱신 {datetime.now(UTC).isoformat(timespec='seconds')}"
    session.flush()
    return existing
