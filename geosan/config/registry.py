"""실행 설정 한 곳 (ConfigRegistry): 평가 흐름·서버·API가 규칙 설정과 앱 설정을 여기서 읽는다.

규칙(BR7.6): 규칙 설정은 버전·해시를 `cfg_rule_config_version`에 기록하고, 고정(FIXED) 버전과
파일 해시가 다르면 평가를 거부한다(조용히 기본값으로 대체하지 않는다). 앱 설정은 `cfg_app_setting`
사본을 읽고, 사본이 없으면 저장소 동봉 예시 파일(`examples/app-settings.yaml`)을 읽어 사본을 만든다.

사용법(Step 18·19·20, 이강욱):
```python
with session_scope() as session:
    runtime = load_runtime_config(session)
    runtime.rule_config          # RuleConfig(해시 포함) — C3 EvaluationInput.ruleConfig에 그대로
    runtime.app_settings         # AppSettings — activeDatasetKind, staff, brand …
    runtime.rule_version.rule_version / .rule_hash
```
"""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path

from sqlalchemy import select
from sqlalchemy.orm import Session

from geosan.config.app_settings import DEFAULT_APP_SETTINGS_PATH as _DEFAULT_APP_SETTINGS_PATH
from geosan.config.app_settings import (
    AppSettings,
    load_app_settings,
    read_app_settings,
    set_active_dataset_kind,
    sync_app_settings,
)
from geosan.config.errors import InputError
from geosan.config.models import RuleConfigVersion
from geosan.config.rule_config import (
    compute_rule_hash,
    load_rule_config,
    register_rule_config_version,
)
from geosan.rules.codes import DatasetKind
from geosan.rules.models import RuleConfig

REPO_ROOT = Path(__file__).resolve().parents[2]
DEFAULT_RULE_CONFIG_PATH = REPO_ROOT / "examples" / "rule-config.yaml"
DEFAULT_APP_SETTINGS_PATH = _DEFAULT_APP_SETTINGS_PATH  # app_settings.py와 같은 값(한 곳에서 정의)

__all__ = [
    "DEFAULT_APP_SETTINGS_PATH",
    "DEFAULT_RULE_CONFIG_PATH",
    "RuntimeConfig",
    "active_dataset_kind",
    "load_runtime_config",
    "register_config_files",
    "set_active_dataset_kind",
]


@dataclass
class RuntimeConfig:
    rule_config: RuleConfig
    rule_version: RuleConfigVersion
    app_settings: AppSettings
    rule_config_path: Path
    notices: list[str] = field(default_factory=list)


def latest_rule_version(session: Session) -> RuleConfigVersion | None:
    return session.scalar(
        select(RuleConfigVersion).order_by(
            RuleConfigVersion.created_at.desc(), RuleConfigVersion.rule_version.desc()
        )
    )


def register_config_files(
    session: Session,
    rule_config_path: Path | str,
    app_settings_path: Path | str,
    *,
    updated_by: str = "system",
) -> RuntimeConfig:
    """check-config가 쓴다: 두 파일을 검사해 규칙 버전을 등록하고 앱 설정 사본을 만든다."""
    rule_config = load_rule_config(rule_config_path)
    row = register_rule_config_version(session, rule_config, rule_config_path)
    settings = load_app_settings(app_settings_path)
    sync_app_settings(session, settings, source_path=app_settings_path, updated_by=updated_by)
    return RuntimeConfig(
        rule_config=rule_config,
        rule_version=row,
        app_settings=settings,
        rule_config_path=Path(rule_config_path).resolve(),
    )


def load_runtime_config(session: Session) -> RuntimeConfig:
    """현재 실행 설정을 돌려준다. 등록된 규칙 버전이 없으면 예시 파일을 DRAFT로 등록한다."""
    notices: list[str] = []
    row = latest_rule_version(session)
    if row is None:
        rule_path = DEFAULT_RULE_CONFIG_PATH
        rule_config = load_rule_config(rule_path)
        row = register_rule_config_version(session, rule_config, rule_path)
        notices.append(
            f"등록된 규칙 설정이 없어 {rule_path}를 버전 {row.rule_version}(DRAFT)으로 등록함"
        )
    else:
        rule_path = Path(row.file_path)
        if not rule_path.exists():
            raise InputError(
                message=f"등록된 규칙 설정 파일이 없습니다: {rule_path} (버전 {row.rule_version})",
                next_action=(
                    "geosan check-config <rule-config.yaml> <app-settings.yaml>로 "
                    "다시 등록해 주세요."
                ),
            )
        file_hash = compute_rule_hash(rule_path)
        if file_hash != row.rule_hash:
            if row.status == "FIXED":
                raise InputError(
                    message=(
                        f"규칙 설정 파일({rule_path.name})이 고정 버전 {row.rule_version}과 "
                        "다릅니다."
                    ),
                    next_action=(
                        "version을 올려 새 버전으로 등록하세요(geosan check-config). "
                        "고정 버전은 덮어쓰지 않습니다 (BR7.6)."
                    ),
                )
            rule_config = load_rule_config(rule_path)
            row = register_rule_config_version(session, rule_config, rule_path)
            notices.append(f"규칙 설정 {row.rule_version}(DRAFT)의 해시를 파일 내용으로 갱신함")
        else:
            rule_config = load_rule_config(rule_path)
    settings = read_app_settings(session)
    if settings is None:
        settings = load_app_settings(DEFAULT_APP_SETTINGS_PATH)
        sync_app_settings(session, settings, source_path=DEFAULT_APP_SETTINGS_PATH)
        notices.append(f"앱 설정 사본이 없어 {DEFAULT_APP_SETTINGS_PATH}를 읽어 사본을 만듦")
    return RuntimeConfig(
        rule_config=rule_config,
        rule_version=row,
        app_settings=settings,
        rule_config_path=rule_path,
        notices=notices,
    )


def active_dataset_kind(session: Session) -> DatasetKind:
    return load_runtime_config(session).app_settings.active_dataset_kind
