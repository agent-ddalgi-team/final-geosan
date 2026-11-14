"""전국등록공장현황 CSV 읽기 구성요소(C5, #221·#320).

DB·AI·회사 병합은 하지 않는다. 전체 파일을 검증한 뒤 주소로 고른 행만 반환한다.
개인정보를 포함할 수 있는 추가 열은 반환하거나 오류에 넣지 않는다.
실행 흐름은 별도로 소스 이용 승인(C5 SourceContract)을 확인해야 한다.
"""

from __future__ import annotations

import csv
import hashlib
import io
import re
from collections.abc import Sequence
from dataclasses import dataclass
from pathlib import Path

from geosan.config.errors import InputError
from geosan.evidence.contacts import scrub_contacts
from geosan.opportunity.queries import normalize_address, normalize_name

SOURCE_ID = "kicox-factory-csv"
_HEADERS = ("순번", "회사명", "단지명", "생산품", "공장주소")
# 행정구역의 긴 이름과 약칭을 맞춘다. 찾을 지역 자체는 호출자가 설정에서 받는다.
_REGION_NAMES = {
    "서울특별시": "서울",
    "서울시": "서울",
    "부산광역시": "부산",
    "대구광역시": "대구",
    "인천광역시": "인천",
    "광주광역시": "광주",
    "대전광역시": "대전",
    "울산광역시": "울산",
    "세종특별자치시": "세종",
    "세종시": "세종",
    "경기도": "경기",
    "강원도": "강원",
    "강원특별자치도": "강원",
    "충청북도": "충북",
    "충청남도": "충남",
    "전라북도": "전북",
    "전북특별자치도": "전북",
    "전라남도": "전남",
    "경상북도": "경북",
    "경상남도": "경남",
    "제주도": "제주",
    "제주특별자치도": "제주",
}


@dataclass(frozen=True, slots=True)
class FactoryRow:
    """C6 원본 행 저장에 쓸 공개 자료만 담는다. 순번은 회사 식별자로 쓰지 않는다."""

    company_name: str
    complex_name: str | None
    product: str
    address: str
    region: str
    product_hash: str

    @property
    def identity_key(self) -> tuple[str, str | None]:
        """기존 사례 투입과 같은 이름·주소 정규화. 같은 주소만으로 합치지는 않는다."""
        return normalize_name(self.company_name), normalize_address(self.address)


@dataclass(frozen=True, slots=True)
class SkippedRow:
    """C5 skippedRows의 행 번호와 사유. 원본 값은 남기지 않는다."""

    row_no: int
    reason: str


@dataclass(frozen=True, slots=True)
class FactoryCsvResult:
    """읽기 단계 집계. 후보 선정·등록이 끝났다는 뜻은 아니다."""

    rows: tuple[FactoryRow, ...]
    encoding: str
    raw_count: int
    filtered_count: int
    skipped_rows: tuple[SkippedRow, ...]


def _region_name(value: str) -> str:
    value = value.strip()
    return _REGION_NAMES.get(value, value)


def address_region(address: str) -> str:
    """주소 첫 칸의 시·도 약칭. 예: "충청남도 천안시 ..." → "충남"."""
    parts = address.split()
    return _region_name(parts[0].rstrip(",")) if parts else ""


_POSTCODE = re.compile(r"^\(\d{5}\)\s*")


def without_postcode(address: str) -> str:
    """주소 앞에 붙은 "(31246)" 같은 우편번호를 뗀다. 웹 페이지의 주소에 자주 붙어 온다."""
    return _POSTCODE.sub("", address.strip())


_DISTRICT = re.compile(r"^([가-힣]{2,}?)[시군구]")


def address_district(address: str | None) -> tuple[str, str] | None:
    """주소의 (시·도 약칭, 시·군 이름 줄기). 견주는 데만 쓴다. 시·군을 모르면 None.

    예: "충남 천안시 동남구 …"·"(31246) 충청남도 천안시서북구 …" → ("충남", "천안").
    세종처럼 시·도 아래 시·군이 없는 곳은 ("세종", "").
    """
    parts = without_postcode(address or "").split()
    if not parts:
        return None
    region = _region_name(parts[0].rstrip(","))
    if region == "세종":
        return region, ""
    if len(parts) < 2:
        return None
    found = _DISTRICT.match(parts[1])
    return region, found.group(1) if found else parts[1]


# 후보 찾기에서 시·군으로도 고를 수 있는 시·도(PM 결정 2026-11-09, #521).
CITY_PARENTS = {
    city: "충남"
    for city in (
        "천안시",
        "아산시",
        "당진시",
        "서산시",
        "공주시",
        "보령시",
        "논산시",
        "계룡시",
        "금산군",
        "부여군",
        "서천군",
        "청양군",
        "홍성군",
        "예산군",
        "태안군",
    )
}


def parent_regions(regions: Sequence[str]) -> list[str]:
    """고른 지역을 저장 단위(시·도)로 푼다. 예: ["천안시", "서산시", "대전"] → ["충남", "대전"]."""
    return list(dict.fromkeys(CITY_PARENTS.get(region, region) for region in regions))


def address_city(address: str) -> str | None:
    """주소 둘째 칸의 시·군 이름. "천안시서북구"도 천안시로 본다. 목록에 없으면 None."""
    parts = address.split()
    token = parts[1].rstrip(",") if len(parts) > 1 else ""
    return next((city for city in CITY_PARENTS if token.startswith(city)), None)


def row_in_selected_regions(region: str, address: str, selected: Sequence[str]) -> bool:
    """시·도를 통째로 골랐으면 그 시·도 전부, 시·군을 골랐으면 그 시·군 행만 맞다."""
    return region in selected or address_city(address) in selected


def _decode(path: Path) -> tuple[str, str]:
    try:
        data = path.read_bytes()
    except OSError:
        raise InputError(
            "공장현황 파일을 읽을 수 없습니다.", "설정한 파일의 위치와 읽기 권한을 확인해 주세요."
        ) from None
    try:
        return data.decode("utf-8-sig"), "UTF-8"
    except UnicodeDecodeError:
        try:
            return data.decode("cp949"), "CP949"
        except UnicodeDecodeError:
            raise InputError(
                "공장현황 파일의 글자 인코딩을 읽을 수 없습니다.",
                "UTF-8 또는 CP949로 저장한 원본 CSV 파일을 사용해 주세요.",
            ) from None


def read_factory_csv(path: Path, *, regions: Sequence[str]) -> FactoryCsvResult:
    """설정에서 받은 광역 지역의 행을 읽는다(C5). 파일 읽기 실패를 빈 결과로 숨기지 않는다.

    호출자는 선택 지역이 앱 설정 안에 있는지 먼저 검사한다. 빈 지역 목록은 거부한다.
    읽는 중에는 DB 저장·외부 전송을 하지 않으며, CSV 문법 오류가 있으면 전부 거부한다.
    열 수가 틀리거나 이름·주소가 없는 행은 값 없이 행 번호와 사유만 돌려준다.
    공개 칸에 연락처 형식이 섞인 행도 확인 필요로 건너뛴다. 추가 개인정보 열은 버린다.
    생산품이 비어 있거나 자체 표면처리로 보여도 여기서는 임의로 제외하지 않는다.
    """
    if isinstance(regions, str) or not regions or any(not region.strip() for region in regions):
        raise InputError("찾을 지역을 하나 이상 골라 주세요.")
    selected_regions = {_region_name(region) for region in regions}
    content, encoding = _decode(path)
    reader = csv.reader(io.StringIO(content, newline=""), strict=True)
    try:
        return _read_rows(reader, encoding, selected_regions)
    except csv.Error:
        raise InputError(
            "공장현황 파일의 CSV 형식이 올바르지 않습니다.",
            "쉼표와 따옴표가 손상되지 않은 원본 파일을 사용해 주세요.",
        ) from None


def _read_rows(reader, encoding: str, regions: set[str]) -> FactoryCsvResult:
    headers = [value.strip() for value in next(reader, [])]
    missing = [name for name in _HEADERS if name not in headers]
    if missing:
        raise InputError(
            f"공장현황 파일에 필수 열이 없습니다: {', '.join(missing)}.",
            "순번·회사명·단지명·생산품·공장주소 열이 있는 파일을 사용해 주세요.",
        )
    if len(set(headers)) != len(headers):
        raise InputError("공장현황 파일에 같은 이름의 열이 두 번 있습니다.")
    positions = {name: headers.index(name) for name in _HEADERS}
    rows: list[FactoryRow] = []
    skipped: list[SkippedRow] = []
    raw_count = filtered_count = 0
    while True:
        row_no = reader.line_num + 1
        values = next(reader, None)
        if values is None:
            break
        raw_count += 1
        if not values or not any(value.strip() for value in values):
            skipped.append(SkippedRow(row_no, "빈 행"))
            continue
        if len(values) != len(headers):
            skipped.append(SkippedRow(row_no, "제목과 값의 열 수가 다름"))
            continue
        # 원본 행 전체를 다음 단계로 넘기지 않는다. 순번과 추가 열은 여기서 버린다.
        company = values[positions["회사명"]].strip()
        address = values[positions["공장주소"]].strip()
        if not company or not address:
            skipped.append(SkippedRow(row_no, "회사명 또는 공장주소가 비어 있음"))
            continue
        # 실제 원본에 "세종특별자치시, (...)"처럼 쉼표로 끝나는 지역명이 있다.
        region = _region_name(address.split()[0].rstrip(","))
        if region not in regions:
            filtered_count += 1
            continue
        product = values[positions["생산품"]].strip()
        complex_name = values[positions["단지명"]].strip() or None
        if any(
            scrub_contacts(value)[1] for value in (company, address, product, complex_name or "")
        ):
            skipped.append(SkippedRow(row_no, "공개 본문에 연락처 형식이 있어 확인 필요"))
            continue
        rows.append(
            FactoryRow(
                company_name=company,
                complex_name=complex_name,
                product=product,
                address=address,
                region=region,
                product_hash=hashlib.sha256(product.encode("utf-8")).hexdigest(),
            )
        )
    return FactoryCsvResult(tuple(rows), encoding, raw_count, filtered_count, tuple(skipped))
