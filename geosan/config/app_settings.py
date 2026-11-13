"""앱 설정 파일(app-settings.yaml) 읽기·검사·DB 사본 (계약 C7 AppSettings, BR11.3, FR14.1).

담당자 목록·활성 거산 값 묶음·수집 범위·LLM 모드·브랜드(demoLabel)·접속 보호. 비밀번호·API 키는
적지 않는다: `password`·`apiKey`·`token` 같은 키가 어느 깊이에든 있으면 오류다(보안 설계 3장).
DB 사본은 `cfg_app_setting`(키-값)이며 API·평가 흐름은 `registry.load_runtime_config`로 읽는다.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from datetime import UTC, date, datetime
from pathlib import Path
from typing import Any, Literal

from pydantic import Field, ValidationError, field_validator, model_validator
from sqlalchemy import select
from sqlalchemy.orm import Session

from geosan.config.errors import FieldError, InputError
from geosan.config.loader import LoadedDocument, join_path, load_document
from geosan.config.schemas import STAFF_KEY_PATTERN, FileModel
from geosan.config.validators import format_field_error, pydantic_errors_to_fields
from geosan.rules.codes import (
    VIEWER_STAFF_KEY,
    ClassificationCode,
    DatasetKind,
    FitLevel,
    LostReasonCode,
)

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


DEFAULT_PICK_EXCLUDE_KEYWORDS = (
    "운송",
    "물류",
    "택배",
    "창고업",
    "도매",
    "소매",
    "무역",
    "소프트웨어",
    "정보서비스",
    "통신서비스",
    "식품",
    "음료",
    "제과",
    "제빵",
    "섬유",
    "의류",
    "봉제",
    "출판",
    "광고",
    "교육",
    "컨설팅",
    "부동산",
    "건설업",
    "토목",
    "시공",
    "음식점",
    "숙박",
)


class AiPickSettings(FileModel):
    """C7: #425·#430 PM 승인. 묶음 기본값은 20행(#491, 100행은 60초 한도를 넘김).

    model: 후보 고르기에만 쓸 모델(llm.allowedModels 안). 비우면 llm.model.
    excludeKeywords: 생산품·업종명에 이 말이 있고 제조 낌새(제조·생산·가공·부품·제작)가 없으면
    AI에 보내지 않고 코드가 '제조업 아님'으로 기록한다(#491 비용 절감). 기준 버전에 포함된다.
    """

    enabled: bool = Field(default=False, strict=True)
    rows_per_call: int = Field(default=20, ge=1, strict=True)
    prompt_file: str = Field(default="examples/prompts/candidate-pick.md", min_length=1)
    surface_treatment_industry_names: list[str] = Field(default_factory=list)
    # 팩토리온 업종번호(표준산업분류 5자리)가 여기 있으면 표면처리 표시(#573). 값은 PM이 정한다.
    surface_treatment_industry_codes: list[str] = Field(default_factory=list)
    model: str | None = Field(default=None, min_length=1)
    exclude_keywords: list[str] = Field(default_factory=lambda: list(DEFAULT_PICK_EXCLUDE_KEYWORDS))

    @field_validator("surface_treatment_industry_codes")
    @classmethod
    def _industry_codes(cls, value: list[str]) -> list[str]:
        if any(not re.fullmatch(r"[0-9]{5}", code) for code in value):
            raise ValueError("업종번호는 숫자 5자리로 적어 주세요. 예: 25922")
        return value


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


class CostEstimateSettings(FileModel):
    """C7 #549: 누르기 전 예상 금액·잠금 계산에만 쓰는 단가. 실제 한도 검사는 전송 기록으로 한다.

    값은 PM이 실측을 보고 고친다. 네 칸 모두 0보다 커야 한다.
    """

    judge_usd_per_row: float = Field(gt=0, strict=True, allow_inf_nan=False)
    research_usd_per_company: float = Field(gt=0, strict=True, allow_inf_nan=False)
    research_calls_per_company: int = Field(gt=0, strict=True)
    web_search_usd_per_batch: float = Field(gt=0, strict=True, allow_inf_nan=False)


class IngestionSettings(FileModel):
    regions: list[str] = Field(default_factory=list)
    product_keywords: list[str] = Field(default_factory=list)
    max_candidates: int = Field(ge=1)
    cost_estimate: CostEstimateSettings
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
    unconfirmed_call_cost_usd: float = Field(gt=0, strict=True, allow_inf_nan=False)
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
    # 계약 C7 #557: 첫 화면 말고 더 읽는 같은 사이트 페이지. 기본값은 PM 승인값(2026-11-11)이며
    # 이 키가 없는 예전 설정 파일도 읽히게 둔다. 0이면 첫 화면만 읽는다.
    extra_pages: int = Field(default=3, ge=0, le=10, strict=True)
    extra_page_hints: list[str] = Field(
        default_factory=lambda: [
            "회사소개",
            "회사 소개",
            "인사말",
            "연혁",
            "제품",
            "사업",
            "설비",
            "인증",
            "실적",
            "납품",
            "about",
            "company",
            "product",
            "business",
            "history",
            "facility",
        ]
    )
    extra_page_max_chars: int = Field(default=6000, ge=500, strict=True)

    @field_validator("extra_page_hints")
    @classmethod
    def _hints_are_words(cls, value: list[str]) -> list[str]:
        cleaned = [hint.strip() for hint in value]
        if any(not hint for hint in cleaned):
            raise ValueError("빈 말은 넣을 수 없습니다.")
        return cleaned


class BrandSettings(FileModel):
    logo_url: str | None = None
    brand_name: str = Field(min_length=1)
    color_primary: str = Field(pattern=r"^#[0-9A-Fa-f]{6}$")
    demo_label: str | None = None
    # #274: 시연용 DB 표시. 시연용 설정 파일에만 true로 적는다(배포 설정에서는 서버 시작 거부).
    demo: bool = Field(default=False, strict=True)


class AccessProtectionSettings(FileModel):
    enabled: bool


class RecordsSettings(FileModel):
    """계약 C7, 2026-11-03 PM 기본값. 기존 설정 파일도 읽을 수 있다."""

    approval_enabled: bool = False
    note_max_length: int = Field(default=200, ge=1)
    # #253: false면 본인이 저장한 기록만 잘못 입력으로 표시할 수 있다.
    cancel_by_any_staff: bool = False
    # #607: 꼬리 질문 파일 위치(저장소 기준 상대 경로)와 접촉 기록 한 줄 메모 상한.
    sales_questions_file: str = Field(default="examples/sales-questions.yaml", min_length=1)
    memo_line_max_length: int = Field(default=100, ge=1, le=200)


class ResearchSettings(FileModel):
    stale_after_days: int = Field(default=90, ge=1)


XLSX_DOWNLOAD_LOG_READY = False
"""엑셀을 내려받을 때 "누가 언제 몇 건"을 남기는 기록 1행(C4 TransferLog)이 만들어졌는가.

아직 없다(#217, PM 결정 2026-11-13). 그 기록을 만드는 PR에서만 True로 바꾼다.
False인 동안에는 `export.xlsxEnabled: true`인 설정을 받아들이지 않는다.
"""

XLSX_ENABLE_BLOCKED_MESSAGE = (
    "엑셀 내려받기는 아직 켤 수 없습니다. 누가 언제 내려받았는지 남기는 기록을 "
    "만들기 전에는 켤 수 없으니 false로 두어 주세요."
)


def xlsx_download_log_ready() -> bool:
    """내려받은 기록이 준비됐는지 묻는 한 곳. 설정 검사가 이 함수만 본다."""
    return XLSX_DOWNLOAD_LOG_READY


class ExportSettings(FileModel):
    """계약 C7 `export`(#217, PM 결정 2026-11-13). 엑셀 내려받기는 만들어 두고 꺼 둔다."""

    # false면 내려받기 창구(GET /export/xlsx)가 막히고 화면 단추도 보이지 않는다.
    xlsx_enabled: bool = Field(default=False, strict=True)

    @field_validator("xlsx_enabled")
    @classmethod
    def enabling_needs_download_log(cls, value: bool) -> bool:
        """설정 파일 읽기·check-config 등록·DB 사본 읽기가 모두 이 검사를 거친다."""
        if value and not xlsx_download_log_ready():
            raise ValueError(XLSX_ENABLE_BLOCKED_MESSAGE)
        return value


class SalesAnalysisSettings(FileModel):
    """계약 C7 `salesAnalysis`(#608). 기준 숫자는 코드에 두지 않아 기본값이 없다(규칙 ⑩)."""

    # 표본(접촉한 곳 수)이 이 값보다 적으면 비율을 내지 않는다.
    min_sample_for_ratio: int = Field(ge=1, strict=True)
    # 성사·거절은 결과 기록이 이 일수 안인 것만 센다.
    closed_window_days: int = Field(ge=1, strict=True)


class ContactAdjustSettings(FileModel):
    """계약 C7 `contactList.adjust`(#610). 같은 공정·산업군의 성사·거절로 순서를 조정하는 기준."""

    window_days: int = Field(ge=1, strict=True)
    # 표본(성사 + 센 거절)이 이 값보다 적으면 조정하지 않는다.
    min_closed_count: int = Field(ge=1, strict=True)
    won_per_step: int = Field(ge=1, strict=True)
    max_up: int = Field(ge=0, strict=True)
    lost_per_step: int = Field(ge=1, strict=True)
    max_down: int = Field(ge=0, strict=True)
    lost_reasons_counted: list[LostReasonCode]


class ContactListSettings(FileModel):
    """계약 C7 `contactList`(#610). 기준은 코드에 두지 않아 기본값이 없다(규칙 ⑩)."""

    # 막는 조건이 없을 때 "지금 연락할 곳"에 드는 분류.
    now_classifications: list[ClassificationCode]
    # true면 평가 전 + 적합도 상 회사를 "지금 연락할 곳"에 넣는다.
    unscored_high_fit_to_now: bool = Field(strict=True)
    # 적합도가 없는 회사를 묶음 안 순서에서 어느 적합도로 볼지.
    null_fit_level_as: FitLevel
    adjust: ContactAdjustSettings


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


class DashboardSettings(FileModel):
    """계약 C7 `dashboard`(2026-11-03 PM 결정). 이 칸이 없는 옛 설정 파일·DB 사본도 읽는다."""

    # 산업군 막대에 AI 제안을 포함해 센다(막대 옆 "AI 제안 포함"). 끄면 사람이 확인한 값만.
    count_proposed_industries: bool = True


class GeosanLocationSettings(FileModel):
    """거리의 기준점(C7 #222). 좌표가 준비되기 전에는 거리 값을 내지 않는다."""

    address: str = "충청남도 천안시 서북구 성거읍 봉주로 303-1"
    lat: float | None = Field(default=None, ge=-90, le=90, allow_inf_nan=False)
    lng: float | None = Field(default=None, ge=-180, le=180, allow_inf_nan=False)

    @model_validator(mode="after")
    def coordinate_pair(self):
        if (self.lat is None) != (self.lng is None):
            raise ValueError("거산의 위도·경도는 함께 넣거나 함께 비워 주세요.")
        return self


class GeocodingSettings(FileModel):
    """2026-11-13 확인: CSV 우선, 외부 조회 1만 회, 네이버는 실시간 전용."""

    provider: Literal["JUSO"] = "JUSO"
    enabled: bool = Field(default=False, strict=True)
    daily_call_limit: int = Field(default=10000, ge=1, strict=True)
    location_csv_files: list[str] = Field(default_factory=list)
    location_csv_base_date: date | None = None
    naver_fallback_enabled: bool = Field(default=False, strict=True)

    @model_validator(mode="after")
    def source_settings(self):
        if any(not name.strip() for name in self.location_csv_files):
            raise ValueError("위치 CSV 경로는 빈칸으로 넣을 수 없습니다.")
        if self.location_csv_files and self.location_csv_base_date is None:
            raise ValueError("위치 CSV를 쓰려면 자료 기준일을 넣어 주세요.")
        if self.naver_fallback_enabled and not self.enabled:
            raise ValueError("네이버 실시간 보완은 좌표 조회를 켠 뒤 사용해 주세요.")
        return self


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
    # #608: 이 칸이 없는 옛 설정 파일도 읽는다. DB 사본에서 읽을 때 예시 파일 값으로 채운다.
    sales_analysis: SalesAnalysisSettings | None = None
    # #610: 위와 같은 방식. 옛 설정에는 없어서 DB 사본에서 읽을 때 예시 파일 값으로 채운다.
    contact_list: ContactListSettings | None = None
    # #217: 이 칸이 없는 옛 설정 파일은 꺼짐으로 읽는다. DB 사본에 없으면 예시 파일 값으로 채운다.
    export: ExportSettings = Field(default_factory=ExportSettings)
    main_phone: MainPhoneSettings = Field(default_factory=MainPhoneSettings)
    industries: list[str] = Field(default_factory=list)
    list_filters: ListFilterSettings = Field(default_factory=ListFilterSettings)
    dashboard: DashboardSettings = Field(default_factory=DashboardSettings)
    geosan: GeosanLocationSettings = Field(default_factory=GeosanLocationSettings)
    geocoding: GeocodingSettings = Field(default_factory=GeocodingSettings)
    distance_filter_presets_km: list[float] = Field(default_factory=lambda: [30, 50, 100])

    def staff_keys(self) -> list[str]:
        return [entry.key for entry in self.staff]

    def is_recording_staff(self, key: str | None) -> bool:
        """기록 요청을 받을 수 있는 담당자 키인가(목록에 있고 viewer가 아님, BR9.3)."""
        return bool(key) and key in self.staff_keys() and key != VIEWER_STAFF_KEY

    @model_validator(mode="after")
    def check_pick_model(self) -> AppSettings:
        pick_model = self.ingestion.ai_pick.model
        if (
            pick_model is not None
            and self.llm.allowed_models
            and pick_model not in self.llm.allowed_models
        ):
            raise ValueError(
                "ingestion.aiPick.model은 llm.allowedModels 목록에 있는 이름이어야 합니다."
            )
        return self


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
    return AppSettings.model_validate(
        _fill_added_sections(_fill_added_ingestion_keys(_fill_added_llm_keys(data)))
    )


ADDED_LLM_KEYS = ("unconfirmedCallCostUsd",)
"""#538 뒤에 생긴 필수 llm 칸. 그 전에 만든 DB 사본에는 없어서 예시 파일 값으로 채운다(#591)."""


def _fill_added_llm_keys(data: dict[str, Any]) -> dict[str, Any]:
    """옛 DB 사본에 빠진 llm 칸만 예시 파일 값으로 채운 새 dict. 다른 칸은 그대로 둔다."""
    llm = data.get("llm")
    if not isinstance(llm, dict):
        return data
    missing = [key for key in ADDED_LLM_KEYS if key not in llm]
    if not missing:
        return data
    defaults = load_app_settings(DEFAULT_APP_SETTINGS_PATH).llm.model_dump(by_alias=True)
    filled = {**llm, **{key: defaults[key] for key in missing}}
    return {**data, "llm": filled}


ADDED_SECTIONS = ("salesAnalysis", "contactList", "export")
"""#608·#610·#217 뒤에 생긴 묶음. 그 전에 만든 DB 사본에는 없어서 예시 파일 값으로 채운다."""


def _fill_added_sections(data: dict[str, Any]) -> dict[str, Any]:
    """옛 DB 사본에 없거나 비어 있는 묶음만 예시 파일 값으로 채운 새 dict(#591과 같은 방식)."""
    missing = [key for key in ADDED_SECTIONS if data.get(key) is None]
    if not missing:
        return data
    defaults = load_app_settings(DEFAULT_APP_SETTINGS_PATH).model_dump(by_alias=True, mode="json")
    return {**data, **{key: defaults[key] for key in missing}}


ADDED_INGESTION_KEYS = ("costEstimate",)
"""#549 뒤에 생긴 필수 ingestion 칸. 그 전에 만든 DB 사본에는 없어서 예시 파일 값으로 채운다."""


def _fill_added_ingestion_keys(data: dict[str, Any]) -> dict[str, Any]:
    """옛 DB 사본에 빠진 ingestion 칸만 예시 파일 값으로 채운 새 dict(#591과 같은 방식)."""
    ingestion = data.get("ingestion")
    if not isinstance(ingestion, dict):
        return data
    missing = [key for key in ADDED_INGESTION_KEYS if key not in ingestion]
    if not missing:
        return data
    defaults = load_app_settings(DEFAULT_APP_SETTINGS_PATH).ingestion.model_dump(by_alias=True)
    filled = {**ingestion, **{key: defaults[key] for key in missing}}
    return {**data, "ingestion": filled}


def is_demo_database(session: Session) -> bool:
    """이 DB의 앱 설정 사본에 시연 표시(brand.demo)가 있는가(#274). 사본이 없으면 False.

    다른 설정 칸이 옛 모양이어도 판단이 흔들리지 않게 brand 행 하나만 읽는다.
    """
    from geosan.config.models import AppSetting

    row = session.get(AppSetting, "brand")
    return isinstance(row.value if row else None, dict) and row.value.get("demo") is True


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
