"""앱 설정 파일(app-settings.yaml) 읽기·검사·DB 사본 (계약 C7 AppSettings, BR11.3, FR14.1).

담당자 목록·활성 거산 값 묶음·수집 범위·LLM 모드·브랜드(demoLabel)·접속 보호. 비밀번호·API 키는
적지 않는다: `password`·`apiKey`·`token` 같은 키가 어느 깊이에든 있으면 오류다(보안 설계 3장).
DB 사본은 `cfg_app_setting`(키-값)이며 API·평가 흐름은 `registry.load_runtime_config`로 읽는다.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, Literal

from pydantic import Field, ValidationError, field_validator, model_validator
from sqlalchemy import select
from sqlalchemy.orm import Session

from geosan.config.errors import FieldError, InputError
from geosan.config.loader import LoadedDocument, join_path, load_document
from geosan.config.schemas import STAFF_KEY_PATTERN, FileModel
from geosan.config.validators import format_field_error, pydantic_errors_to_fields
from geosan.rules.codes import VIEWER_STAFF_KEY, DatasetKind

SECRET_KEY_NAMES: frozenset[str] = frozenset(
    {"password", "passwd", "apikey", "api_key", "token", "secret", "accesskey", "access_key"}
)
"""설정 파일에 있으면 안 되는 키 이름(대소문자·구분 기호 무시)."""


class StaffEntry(FileModel):
    key: str = Field(pattern=STAFF_KEY_PATTERN)
    display_name: str = Field(min_length=1)


class ComplexListSettings(FileModel):
    """C7: 단지 조회 설정. PM 승인 기본값(#393·#394), 실제 조회 연결은 U3에서 한다."""

    enabled: bool = Field(default=False, strict=True)
    cache_days: int = Field(default=15, ge=1, strict=True)
    extra_names: list[str] = Field(default_factory=list)


class AiPickSettings(FileModel):
    """C7: #425·#430 PM 승인. 100행 묶음은 pick-v1 표본 계획의 기본값이다."""

    enabled: bool = Field(default=False, strict=True)
    rows_per_call: int = Field(default=100, ge=1, strict=True)
    prompt_file: str = Field(default="examples/prompts/candidate-pick.md", min_length=1)
    surface_treatment_industry_names: list[str] = Field(default_factory=list)


class CandidateWebSearchSettings(FileModel):
    """C7·#314 11/9 PM 승인: 꺼짐, 하루 20회, 15일 보관. 도메인은 설정에서 읽는다."""

    enabled: bool = Field(default=False, strict=True)
    daily_search_limit: int = Field(default=20, ge=0, strict=True)
    cache_days: int = Field(default=15, ge=1, strict=True)
    blocked_domains: list[str] = Field(default_factory=list, max_length=100)

    @field_validator("blocked_domains")
    @classmethod
    def check_domains(cls, values: list[str]) -> list[str]:
        domains = []
        for value in values:
            if not re.fullmatch(
                r"(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]*[a-zA-Z0-9])?\.)+[a-zA-Z]{2,}", value
            ):
                raise ValueError("막는 사이트에는 주소 전체 대신 도메인 이름만 적어 주세요.")
            domains.append(value.lower())
        if len(set(domains)) != len(domains):
            raise ValueError("막는 사이트 목록에 같은 도메인이 두 번 있습니다.")
        return domains

    @model_validator(mode="after")
    def enabled_needs_domains(self):
        if self.enabled and not self.blocked_domains:
            raise ValueError("웹 후보 검색을 켜려면 막는 사이트 목록을 먼저 적어 주세요.")
        return self


class IngestionSettings(FileModel):
    regions: list[str] = Field(default_factory=list)
    product_keywords: list[str] = Field(default_factory=list)
    max_candidates: int = Field(ge=1)
    factory_csv_path: str = ""
    complex_list: ComplexListSettings = Field(default_factory=ComplexListSettings)
    ai_pick: AiPickSettings = Field(default_factory=AiPickSettings)


class LlmSettings(FileModel):
    mode: Literal["EXTERNAL", "NONE"]
    model: str | None = None
    monthly_call_limit: int = Field(ge=0, strict=True)
    cost_per_thousand_tokens: float = Field(ge=0)
    provider: Literal["OPENAI"] = "OPENAI"
    allowed_models: list[str] = Field(default_factory=list)
    input_cost_per_million_tokens: float = Field(default=0, ge=0, strict=True, allow_inf_nan=False)
    output_cost_per_million_tokens: float = Field(default=0, ge=0, strict=True, allow_inf_nan=False)
    web_search_cost_per_thousand_calls: float = Field(
        default=0, ge=0, strict=True, allow_inf_nan=False
    )
    monthly_cost_limit_usd: float = Field(default=0, ge=0, strict=True, allow_inf_nan=False)
    cost_alert_ratio: float = Field(default=0.5, ge=0, le=1, strict=True, allow_inf_nan=False)

    @model_validator(mode="after")
    def check_allowed_model(self) -> LlmSettings:
        if self.model is not None and self.allowed_models and self.model not in self.allowed_models:
            raise ValueError("model은 allowedModels 목록에 있는 이름이어야 합니다.")
        return self


class HomepageDiscoverySettings(FileModel):
    enabled: bool
    terms_confirmed: bool
    min_confidence: float = Field(default=0.7, ge=0, le=1, strict=True, allow_inf_nan=False)
    auto_research: bool = Field(default=False, strict=True)
    daily_call_limit: int = Field(default=200, ge=0, strict=True)


class BrandSettings(FileModel):
    logo_url: str | None = None
    brand_name: str = Field(min_length=1)
    color_primary: str = Field(pattern=r"^#[0-9A-Fa-f]{6}$")
    demo_label: str | None = None


class AccessProtectionSettings(FileModel):
    enabled: bool


class RecordsSettings(FileModel):
    """계약 C7, 2026-11-03 PM 기본값. 기존 설정 파일도 읽을 수 있다."""

    approval_enabled: bool = False
    note_max_length: int = Field(default=200, ge=1)


class ResearchSettings(FileModel):
    stale_after_days: int = Field(default=90, ge=1)


class MainPhoneSettings(FileModel):
    allowed_prefixes: list[str] = Field(default_factory=list)

    @model_validator(mode="after")
    def check_prefixes(self) -> MainPhoneSettings:
        if any(
            not item.isascii() or not item.isdigit() or not 2 <= len(item) <= 4
            for item in self.allowed_prefixes
        ):
            raise ValueError("대표번호 앞자리는 숫자 2~4자리여야 합니다.")
        return self


class RegionPreset(FileModel):
    label: str
    cities: list[str]


class ListFilterSettings(FileModel):
    region_presets: list[RegionPreset] = Field(default_factory=list)


class AppSettings(FileModel):
    """앱 설정 한 벌(C7 AppSettings). 더하는 변경(2026-10-21 PM 확인): brand.demoLabel."""

    staff: list[StaffEntry] = Field(min_length=1)
    active_dataset_kind: DatasetKind
    ingestion: IngestionSettings
    llm: LlmSettings
    homepage_discovery: HomepageDiscoverySettings
    candidate_web_search: CandidateWebSearchSettings = Field(
        default_factory=CandidateWebSearchSettings
    )
    brand: BrandSettings
    access_protection: AccessProtectionSettings
    records: RecordsSettings = Field(default_factory=RecordsSettings)
    research: ResearchSettings = Field(default_factory=ResearchSettings)
    main_phone: MainPhoneSettings = Field(default_factory=MainPhoneSettings)
    industries: list[str] = Field(default_factory=list)
    list_filters: ListFilterSettings = Field(default_factory=ListFilterSettings)

    def staff_keys(self) -> list[str]:
        return [entry.key for entry in self.staff]

    def is_recording_staff(self, key: str | None) -> bool:
        """기록 요청을 받을 수 있는 담당자 키인가(목록에 있고 viewer가 아님, BR9.3)."""
        return bool(key) and key in self.staff_keys() and key != VIEWER_STAFF_KEY


@dataclass
class AppSettingsCheck:
    document: LoadedDocument
    settings: AppSettings | None
    errors: list[FieldError]

    @property
    def ok(self) -> bool:
        return not self.errors and self.settings is not None


def _normalize_key(key: str) -> str:
    return key.lower().replace("_", "").replace("-", "")


def find_secret_keys(value: Any, path: str = "") -> list[str]:
    """비밀 값 키가 있는 경로 목록(어느 깊이든)."""
    found: list[str] = []
    if isinstance(value, dict):
        for key, child in value.items():
            child_path = join_path(path, str(key))
            if _normalize_key(str(key)) in {_normalize_key(k) for k in SECRET_KEY_NAMES}:
                found.append(child_path)
            found.extend(find_secret_keys(child, child_path))
    elif isinstance(value, list):
        for index, child in enumerate(value):
            found.extend(find_secret_keys(child, join_path(path, index)))
    return found


def check_app_settings_file(path: Path | str) -> AppSettingsCheck:
    """파일을 읽고 비밀 키 → 모양(pydantic) → 뜻(중복 담당자 키) 순으로 검사한다."""
    document = load_document(path)
    errors: list[FieldError] = [
        FieldError(
            path=secret_path,
            message="비밀 값 키입니다. 설정 파일에 적지 않고 환경 변수로 넘겨 주세요 (BR11.3)",
            line=document.line_of(secret_path),
        )
        for secret_path in find_secret_keys(document.data)
    ]
    if errors:
        return AppSettingsCheck(document=document, settings=None, errors=errors)
    try:
        settings = AppSettings.model_validate(document.data)
    except ValidationError as exc:
        return AppSettingsCheck(
            document=document,
            settings=None,
            errors=pydantic_errors_to_fields(exc, document.data, document),
        )
    seen: dict[str, int] = {}
    for index, entry in enumerate(settings.staff):
        if entry.key in seen:
            path_text = f"staff[{index}].key"
            errors.append(
                FieldError(
                    path=path_text,
                    message=(
                        f"담당자 키 '{entry.key}'가 {seen[entry.key] + 1}번째 항목에도 있습니다"
                    ),
                    line=document.line_of(path_text),
                )
            )
        seen.setdefault(entry.key, index)
    if errors:
        return AppSettingsCheck(document=document, settings=None, errors=errors)
    return AppSettingsCheck(document=document, settings=settings, errors=[])


def load_app_settings(path: Path | str) -> AppSettings:
    """검사를 통과한 AppSettings. 틀리면 InputError(칸별 오류 목록)."""
    result = check_app_settings_file(path)
    if result.settings is None:
        raise InputError(
            message=f"앱 설정 파일에 오류가 {len(result.errors)}건 있습니다: {Path(path).name}",
            next_action="\n".join(format_field_error(e) for e in result.errors),
            fields=result.errors,
        )
    return result.settings


# ---------------------------------------------------------------------------
# DB 사본 (cfg_app_setting)
# ---------------------------------------------------------------------------

SOURCE_FILE_KEY = "sourceFile"
"""설정을 어느 파일에서 읽었는지 적어 두는 행의 키."""


def _upsert(session: Session, key: str, value: Any, updated_by: str) -> None:
    from geosan.config.models import AppSetting

    row = session.get(AppSetting, key)
    now = datetime.now(UTC)
    if row is None:
        session.add(
            AppSetting(
                setting_key=key,
                value=value,
                updated_at=now,
                updated_by=updated_by,
                created_by=updated_by,
            )
        )
    else:
        row.value = value
        row.updated_at = now
        row.updated_by = updated_by


def sync_app_settings(
    session: Session,
    settings: AppSettings,
    *,
    source_path: Path | str | None = None,
    updated_by: str = "system",
) -> None:
    """파일 내용을 cfg_app_setting에 키-값(위쪽 키 하나 = 행 하나)으로 복사한다."""
    data = settings.model_dump(by_alias=True, mode="json")
    for key, value in data.items():
        _upsert(session, key, value, updated_by)
    if source_path is not None:
        _upsert(session, SOURCE_FILE_KEY, str(Path(source_path).resolve()), updated_by)
    session.flush()


def read_app_settings(session: Session) -> AppSettings | None:
    """cfg_app_setting 행을 AppSettings로 되읽는다. 행이 없으면 None."""
    from geosan.config.models import AppSetting

    rows = session.scalars(select(AppSetting)).all()
    data = {row.setting_key: row.value for row in rows if row.setting_key != SOURCE_FILE_KEY}
    if not data:
        return None
    return AppSettings.model_validate(data)


DEFAULT_APP_SETTINGS_PATH = Path(__file__).resolve().parents[2] / "examples" / "app-settings.yaml"
"""앱 설정 사본이 아직 없을 때 읽는 예시 파일(registry.py와 같은 값)."""


def ensure_app_settings_copy(session: Session, *, updated_by: str = "system") -> bool:
    """앱 설정 사본(cfg_app_setting)이 없거나 위쪽 키가 빠져 있으면 예시 파일로 채운다.

    `set_active_dataset_kind`처럼 키 하나만 바꾸는 함수가 먼저 불리면 사본이 한 줄뿐이라
    `read_app_settings`가 AppSettings를 만들지 못하던 문제를 막는다(이슈 #44). 채웠으면 True.
    """
    from geosan.config.models import AppSetting

    present = set(session.scalars(select(AppSetting.setting_key)).all())
    required = {f.alias or name for name, f in AppSettings.model_fields.items()}
    if required <= present:
        return False
    settings = load_app_settings(DEFAULT_APP_SETTINGS_PATH)
    data = settings.model_dump(by_alias=True, mode="json")
    for key, value in data.items():
        if key not in present:  # 이미 바꿔 둔 값(예: activeDatasetKind)은 덮어쓰지 않는다
            _upsert(session, key, value, updated_by)
    if SOURCE_FILE_KEY not in present:
        _upsert(session, SOURCE_FILE_KEY, str(DEFAULT_APP_SETTINGS_PATH.resolve()), updated_by)
    session.flush()
    return True


def set_active_dataset_kind(
    session: Session, kind: DatasetKind | str, *, updated_by: str = "system"
) -> DatasetKind:
    """활성 거산 값 묶음만 바꾼다(U4 dataset-set 명령과 테스트가 쓴다). 허용 값 밖은 오류.

    사본이 아직 없으면 예시 앱 설정으로 먼저 채운 뒤 바꾼다(이슈 #44).
    """
    try:
        value = DatasetKind(kind)
    except ValueError:
        allowed = ", ".join(f"'{k.value}'" for k in DatasetKind)
        raise InputError(
            message=f"거산 값 묶음은 {allowed} 중 하나여야 하는데 '{kind}'이 적혀 있습니다",
            next_action="허용 값 중 하나로 적어 주세요.",
        ) from None
    ensure_app_settings_copy(session, updated_by=updated_by)
    _upsert(session, "activeDatasetKind", value.value, updated_by)
    session.flush()
    return value
