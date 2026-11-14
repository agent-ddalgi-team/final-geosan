"""#317·#427: API와 명령·실행 흐름이 함께 쓰는 찾기 조건 검사."""

from collections.abc import Collection

from pydantic import Field

from geosan.config.app_settings import AppSettings
from geosan.config.errors import FieldError, InputError
from geosan.config.schemas import FileModel
from geosan.rules.codes import ProcessCode


class IngestRequest(FileModel):
    """계약 C1 POST /ingest의 조건. 공정은 필수, 지역 생략은 설정 전체다."""

    source_id: str = Field(default="kicox-factory-csv", min_length=1, strict=True)
    process_codes: list[ProcessCode] = Field(min_length=1)
    regions: list[str] = Field(default_factory=list)
    industries: list[str] = Field(default_factory=list)
    max_candidates: int | None = Field(default=None, alias="max", ge=1, strict=True)


def validate_ingest_conditions(
    body: IngestRequest,
    *,
    settings: AppSettings,
    available_process_codes: Collection[str],
) -> IngestRequest:
    """현재 묶음의 역량 공정과 설정으로만 검사하고, 생략한 범위를 채운 새 요청을 돌려준다."""
    fields = []
    for index, code in enumerate(body.process_codes):
        if code not in available_process_codes:
            fields.append(
                FieldError(
                    path=f"processCodes[{index}]",
                    message="현재 역량 파일에 있는 공정을 골라 주세요.",
                )
            )
    for index, region in enumerate(body.regions):
        if region not in settings.ingestion.regions:
            fields.append(
                FieldError(path=f"regions[{index}]", message="설정 목록에 있는 지역을 골라 주세요.")
            )
    for index, industry in enumerate(body.industries):
        if industry not in settings.industries:
            fields.append(
                FieldError(
                    path=f"industries[{index}]", message="설정 목록에 있는 산업군을 골라 주세요."
                )
            )
    limit = settings.ingestion.max_candidates
    if body.max_candidates is not None and body.max_candidates > limit:
        fields.append(
            FieldError(path="max", message=f"설정한 최대 건수 {limit} 이하로 넣어 주세요.")
        )
    if fields:
        raise InputError("찾기 조건을 확인해 주세요.", fields=fields)
    return body.model_copy(
        update={
            "regions": list(body.regions or settings.ingestion.regions),
            "process_codes": list(body.process_codes),
            "industries": list(body.industries),
            "max_candidates": body.max_candidates if body.max_candidates is not None else limit,
        }
    )
