"""AI 후보 판단의 검사·조건 선택·재사용 기준(C6·C9, #221·#328).

외부 호출·전송 승인·비용 기록·DB 저장을 하지 않는 내부 구성요소다.
전체 어댑터는 PM의 저장 모델을 연결한 뒤 승인 행 ID로만 본문을 조회해야 한다.
"""

from __future__ import annotations

import hashlib
import json
from collections.abc import Mapping, Sequence
from typing import Literal

from pydantic import ConfigDict, Field, TypeAdapter, field_validator, model_validator

from geosan.config.errors import AppError, InputError
from geosan.config.schemas import FileModel
from geosan.evidence.contacts import scrub_contacts

CANDIDATE_INPUT_FIELDS = (
    "rowId",
    "companyName",
    "complexName",
    "product",
    "industryName",
    "address",
)


def candidate_product_hash(product: str | None, industry_name: str | None) -> str:
    """판단 메모의 지문은 생산품과 업종명을 함께 묶는다(#425 PM 결정).

    원본 표의 생산품 무결성 해시와 구별한다. 원본·조회 캐시의 기존 행 번호는 바꾸지 않는다.
    """
    value = json.dumps([product, industry_name], ensure_ascii=False, separators=(",", ":"))
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


class CandidateJudgment(FileModel):
    """현재 병합된 C9의 결과. 제조업 여부는 문자열이나 숫자로 대신 받지 않는다."""

    model_config = ConfigDict(strict=True)

    row_id: str = Field(min_length=1)
    is_manufacturer: bool
    process_codes: list[str]
    industries: list[str]
    reason: str
    fit_level: Literal["HIGH", "MEDIUM", "LOW"]
    own_plating_line_suspected: bool
    own_plating_line_basis: str | None

    @field_validator("reason")
    @classmethod
    def reason_without_contacts(cls, value: str) -> str:
        if scrub_contacts(value)[1]:
            raise ValueError("고른 이유에 연락처가 있습니다.")
        return value

    @model_validator(mode="after")
    def manufacturer_needs_reason(self) -> CandidateJudgment:
        """제조업이면 이유가 있어야 한다. 아니면 빈 이유로 짧게 답해도 된다(pick-v2, #491)."""
        if self.is_manufacturer and not self.reason.strip():
            raise ValueError("제조업 판단에는 고른 이유가 있어야 합니다.")
        return self

    @field_validator("own_plating_line_basis")
    @classmethod
    def surface_basis_without_contacts(cls, value: str | None) -> str | None:
        """C9는 근거의 null을 허용한다. 글이 있으면 기존 연락처 검사를 적용한다."""
        if value is not None and (not value.strip() or scrub_contacts(value)[1]):
            raise ValueError("표면처리 판단 근거가 비어 있거나 연락처가 있습니다.")
        return value


_JUDGMENTS = TypeAdapter(list[CandidateJudgment])


def _labels(values: Sequence[str], *, required: bool = False) -> tuple[str, ...]:
    """호출 측 목록도 검사한다. 잘못된 설정이나 승인 목록의 값은 오류에 넣지 않는다."""
    if (
        isinstance(values, (str, bytes))
        or not isinstance(values, Sequence)
        or (required and not values)
        or any(not isinstance(value, str) or not value.strip() for value in values)
        or len(set(values)) != len(values)
    ):
        raise InputError("후보 판단에 사용할 행 번호나 조건 목록이 올바르지 않습니다.")
    return tuple(values)


def _catalogs(
    process_catalog: Mapping[str, str], industry_catalog: Sequence[str]
) -> tuple[set[str], set[str]]:
    if not isinstance(process_catalog, Mapping):
        raise InputError("후보 판단에 사용할 공정 목록이 올바르지 않습니다.")
    processes = _labels(list(process_catalog), required=True)
    if any(not isinstance(name, str) or not name.strip() for name in process_catalog.values()):
        raise InputError("후보 판단에 사용할 공정 이름이 올바르지 않습니다.")
    return set(processes), set(_labels(industry_catalog))


def _unique_keys(pairs: list[tuple[str, object]]) -> dict:
    """중복된 JSON 칸을 마지막 값으로 몰래 덮어쓰지 않는다."""
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError("AI 판단의 칸 이름이 중복됐습니다.")
        result[key] = value
    return result


def parse_candidate_judgments(
    text: str,
    *,
    approved_row_ids: Sequence[str],
    process_catalog: Mapping[str, str],
    industry_catalog: Sequence[str],
) -> tuple[CandidateJudgment, ...]:
    """승인한 각 행의 판단을 하나씩 검사하고 승인 목록 순서로 반환한다(C9).

    호출자가 준 행 번호 목록 자체가 전송 승인을 대신하지는 않는다. 승인/본문 조회는
    후속 어댑터의 책임이다. 응답에서 빠진 행을 비제조업이나 빈 판단으로 채우지 않는다.
    모르는 칸·행·공정·산업·등급 또는 연락처가 하나라도 있으면 전체 결과를 거부한다.
    오류와 로그에는 AI 원문이나 잘못된 값을 남기지 않는다.
    """
    row_ids = _labels(approved_row_ids, required=True)
    allowed_processes, allowed_industries = _catalogs(process_catalog, industry_catalog)
    try:
        if not isinstance(text, str):
            raise ValueError("AI 판단이 JSON 문자열이 아닙니다.")
        judgments = _JUDGMENTS.validate_python(json.loads(text, object_pairs_hook=_unique_keys))
        by_id = {judgment.row_id: judgment for judgment in judgments}
        if len(by_id) != len(judgments) or set(by_id) != set(row_ids):
            raise ValueError("승인한 행과 판단한 행이 다릅니다.")
        for judgment in judgments:
            if (
                len(set(judgment.process_codes)) != len(judgment.process_codes)
                or len(set(judgment.industries)) != len(judgment.industries)
                or not set(judgment.process_codes) <= allowed_processes
                or not set(judgment.industries) <= allowed_industries
                or len(judgment.industries) > 3
            ):
                raise ValueError("AI 판단이 허용 목록과 맞지 않습니다.")
        return tuple(by_id[row_id] for row_id in row_ids)
    except (ValueError, TypeError, RecursionError):
        raise AppError(
            "AI 후보 판단이 요청한 행이나 허용 목록과 맞지 않습니다.",
            "자료와 찾기 조건을 확인한 뒤 다시 시도해 주세요.",
            status=503,
            kind="LLM_FAILED",
        ) from None


def select_candidates(
    judgments: Sequence[CandidateJudgment],
    *,
    process_codes: Sequence[str],
    industries: Sequence[str] = (),
) -> tuple[CandidateJudgment, ...]:
    """검사한 판단 중 제조업이면서 선택 공정·산업이 맞는 행만 남긴다(C1·C9).

    선택 조건은 호출자가 설정의 허용 목록 검사를 마친 값이다(#317).
    각 조건 안에서는 하나 이상 맞으면 된다. 산업을 고르지 않았으면 산업으로 거르지
    않는다. 적합도가 LOW여도 임의로 빼지 않으며 점수·회사 순위를 계산하지 않는다.
    """
    processes = set(_labels(process_codes, required=True))
    selected_industries = set(_labels(industries))
    return tuple(
        judgment
        for judgment in judgments
        if judgment.is_manufacturer
        and processes.intersection(judgment.process_codes)
        and (not selected_industries or selected_industries.intersection(judgment.industries))
    )


def candidate_criteria_version(
    *,
    process_catalog: Mapping[str, str],
    industry_catalog: Sequence[str],
    prompt: str,
    input_fields: Sequence[str] = CANDIDATE_INPUT_FIELDS,
) -> str:
    """판단 재사용용 기준 지문(C6). 생산품·업종명의 판단 지문은 별도로 비교한다.

    목록 순서만 바뀐 것은 같은 기준이다. 전체 공정 코드·이름, 전체 산업 목록 또는
    실제 사용하는 지시문·입력 칸 목록이 바뀌면 다른 기준이다. 선택 공정·산업은 판단 뒤 거르기에만
    쓰므로 기준에 넣지 않는다(#221 PM 결정). 지역은 AI 판단 전 주소 필터로 처리한다.
    이 값만으로 DB의 저장된 판단이 최신이라고 확정하거나 다시 판단 요청을 생략하지 않는다.
    """
    _, allowed_industries = _catalogs(process_catalog, industry_catalog)
    if not isinstance(prompt, str) or not prompt.strip():
        raise InputError("후보 판단의 지시문이 올바르지 않습니다.")
    canonical = json.dumps(
        {
            "processCatalog": dict(process_catalog),
            "industryCatalog": sorted(allowed_industries),
            "prompt": prompt,
            "inputFields": list(_labels(input_fields, required=True)),
        },
        sort_keys=True,
        ensure_ascii=False,
        separators=(",", ":"),
    )
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()
