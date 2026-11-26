"""팩토리온 공장조회·수질 명단 보조 자료를 읽고 목록 회사에 붙인다(C5·C6·C8, #573).

후보 목록의 출발점이 아니다. AI·외부 전송은 하지 않는다. 전화번호·홈페이지·대표자 같은 칸은
읽는 즉시 버리고, 공개 칸에 연락처 형식이 있으면 그 값은 저장하지 않는다.
종업원 수는 공장 등록 때 적은 값이라 갱신되지 않을 수 있어 화면에서는 언제나 추정으로 보인다.
"""

from __future__ import annotations

import csv
import io
import re
import unicodedata
import warnings
import zipfile
from collections import defaultdict
from collections.abc import Iterable, Iterator, Sequence
from dataclasses import dataclass
from datetime import date
from pathlib import Path

from sqlalchemy import delete, func, insert, select
from sqlalchemy.orm import Session

from geosan.config.app_settings import AppSettings
from geosan.config.errors import InputError
from geosan.evidence.contacts import scrub_contacts
from geosan.opportunity.factory_csv import address_region, parent_regions
from geosan.opportunity.models import Customer
from geosan.opportunity.queries import normalize_address
from geosan.opportunity.source_models import FactoryProfile, SourceContract, WaterSite
from geosan.storage.base import new_id, utcnow

FACTORYON_SOURCE_ID = "factoryon-xlsx"
WATER_SOURCE_ID = "nier-water-csv"
SOURCE_IDS = (FACTORYON_SOURCE_ID, WATER_SOURCE_ID)

# 표면처리 표시의 출처 가운데 이 자료로 다시 계산하는 것(C6). AI·업종명 표시는 건드리지 않는다.
RULE_SOURCES = ("INDUSTRY_CODE", "WATER_LIST")
# 수질 명단은 공공누리 제1유형(출처표시)이라 근거 줄에 기관과 유형을 함께 보인다(#583).
WATER_BASIS = "특정수질유해물질 배출 사업장 명단에 있음(국립환경과학원, 공공누리 제1유형)"

_FACTORYON_NAME = "회사명"
_FACTORYON_ROAD = "공장주소(도로명)"
_FACTORYON_LOT = "공장주소(지번)"
_FACTORYON_REQUIRED = (
    _FACTORYON_NAME,
    _FACTORYON_ROAD,
    "원자재",
    "종업원수(총인원)",
    "업종번호",
    "공장규모",
)
_WATER_REQUIRED = ("사업장명", "사업장소재지(도로명주소)")
_COMPANY_MARKS = re.compile(r"\(주\)|\(유\)|\(합\)|\(재\)|\(사\)|\(복\)|\(농\)|주식회사|유한회사")
_INSERT_CHUNK = 2000
_FILE_DATE = re.compile(r"(?<![0-9])(20[0-9]{6})(?![0-9])")


@dataclass(frozen=True, slots=True)
class ProfileRow:
    company_name: str
    address: str
    region: str
    raw_materials: str | None
    employee_count: int | None
    industry_codes: tuple[str, ...]
    industry_name: str | None
    scale: str | None
    # 그 행이 나온 파일의 기준일. 지역마다 내려받은 날이 달라도 된다(#961).
    file_date: date


@dataclass(frozen=True, slots=True)
class WaterRow:
    site_name: str
    address: str
    region: str
    agency: str | None
    treatment_types: tuple[str, ...]


@dataclass(frozen=True, slots=True)
class ReadResult:
    rows: tuple
    raw_count: int
    skipped_count: int


@dataclass(frozen=True, slots=True)
class AttachResult:
    attached: int
    flagged: int
    unflagged: int


def company_key(name: str) -> str:
    """회사 맞추기용 이름 열쇠. (주)·주식회사 같은 법인 표시와 빈칸을 뺀다."""
    value = unicodedata.normalize("NFKC", name).casefold()
    return re.sub(r"\s+", "", _COMPANY_MARKS.sub("", value))


def city_key(address: str) -> str:
    """같은 시·군인지 볼 때 쓰는 주소 앞 두 칸. 예: "충남|천안시"."""
    parts = unicodedata.normalize("NFKC", address).split()
    second = re.sub(r"[,(].*$", "", parts[1]) if len(parts) > 1 else ""
    return f"{address_region(address)}|{second}"


_ROAD = re.compile(r"(?:로|길)$")
_BUILDING = re.compile(r"^\d+(?:-\d+)?")


def road_key(address: str | None) -> str | None:
    """도로명과 건물번호까지의 주소 열쇠(#613). 예: "충남|천안시|번영로|467".

    괄호 안 동 이름·"외 19필지" 같은 표기 차이는 뺀다. 도로명이 없는 지번 주소는 None이다.
    """
    if not address:
        return None
    value = re.sub(r"\(.*?\)", " ", unicodedata.normalize("NFKC", address))
    words = re.split(r"\s외\s?\d", value)[0].split()
    for word, after in zip(words, words[1:], strict=False):
        number = _BUILDING.match(after)
        if _ROAD.search(word) and number:
            return f"{city_key(address)}|{word}|{number.group()}"
    return None


def file_date_of(path: Path) -> date:
    """파일 이름 앞이나 끝의 YYYYMMDD. 없거나 실제 날짜가 아니면 거부한다."""
    found = _FILE_DATE.findall(path.stem)
    try:
        if len(set(found)) != 1:
            raise ValueError
        value = found[0]
        return date(int(value[:4]), int(value[4:6]), int(value[6:]))
    except ValueError:
        raise InputError(
            f"파일 이름에서 기준일(YYYYMMDD)을 찾지 못했습니다: {path.name}",
            "예: 20261111_팩트리온_공장조회_대전전체.xlsx",
        ) from None


def _text(value) -> str:
    return "" if value is None else str(value).strip()


def _cell(values, at: dict[str, int], name: str) -> str:
    """제목 이름으로 칸 값을 꺼낸다. 칸이 모자란 줄은 빈 글자로 본다."""
    index = at.get(name)
    return _text(values[index]) if index is not None and index < len(values) else ""


def _public(value: str) -> str | None:
    """빈 값과 연락처 형식이 섞인 값은 저장하지 않는다."""
    if not value or scrub_contacts(value)[1]:
        return None
    return value


def _employees(value) -> int | None:
    try:
        count = int(float(_text(value).replace(",", "")))
    except ValueError:
        return None
    return count if count > 0 else None


def _codes(value) -> tuple[str, ...]:
    codes = (code.strip() for code in _text(value).split(","))
    return tuple(dict.fromkeys(code for code in codes if re.fullmatch(r"[0-9]{5}", code)))


def _xlsx_rows(path: Path) -> tuple[list[str], Iterator[tuple]]:
    """제목 줄과 나머지 줄. 줄은 한 줄씩 읽는다(#961: 경기 9.7만 행도 메모리 약 30MB).

    팩토리온 파일은 시트 크기 표시가 A1뿐이라 읽기 전용으로 열면 첫 줄만 보인다.
    크기 표시를 지우고(reset_dimensions) 실제 줄을 끝까지 읽는다.
    """
    from openpyxl import load_workbook  # 엑셀을 읽을 때만 불러온다

    try:
        with warnings.catch_warnings():
            # 팩토리온 파일에는 기본 서식이 없어 경고가 나지만 값 읽기와는 관계없다.
            warnings.simplefilter("ignore")
            book = load_workbook(path, read_only=True, data_only=True)
            sheet = book.worksheets[0]
            sheet.reset_dimensions()
            rows = sheet.iter_rows(values_only=True)
            headers = [_text(value) for value in next(rows, ())]
    except (OSError, zipfile.BadZipFile, KeyError, ValueError, IndexError):
        raise InputError(
            f"엑셀 파일을 읽을 수 없습니다: {path.name}",
            "팩토리온에서 내려받은 .xlsx 원본을 그대로 넣어 주세요.",
        ) from None

    def rest() -> Iterator[tuple]:
        try:
            yield from rows
        finally:
            book.close()

    return headers, rest()


def read_factoryon(paths: Sequence[Path], regions: Iterable[str]) -> ReadResult:
    """지역별 엑셀 여러 개를 읽는다. 고른 시·도 행만 남기고 필요한 칸만 꺼낸다.

    파일마다 기준일이 달라도 된다(#961). 다만 같은 시·도 행이 기준일이 다른 두 파일에서
    나오면 어느 쪽이 맞는지 알 수 없어 거부한다.
    """
    wanted = set(regions)
    rows: list[ProfileRow] = []
    region_dates: dict[str, date] = {}
    raw = skipped = 0
    for path in paths:
        file_date = file_date_of(path)
        headers, values = _xlsx_rows(path)
        missing = [name for name in _FACTORYON_REQUIRED if name not in headers]
        if missing:
            values.close()
            raise InputError(
                f"{path.name}에 필수 열이 없습니다: {', '.join(missing)}.",
                "팩토리온 공장조회에서 내려받은 엑셀인지 확인해 주세요.",
            )
        at = {name: headers.index(name) for name in headers if name}
        for value in values:
            if not any(cell not in (None, "") for cell in value):
                continue
            raw += 1

            def cell(name, value=value, at=at):
                return _cell(value, at, name)

            name = cell(_FACTORYON_NAME)
            address = cell(_FACTORYON_ROAD) or cell(_FACTORYON_LOT)
            if not name or not address or _public(name) is None or _public(address) is None:
                skipped += 1
                continue
            region = address_region(address)
            if region not in wanted:
                continue
            if region_dates.setdefault(region, file_date) != file_date:
                values.close()
                raise InputError(
                    f"{region} 행이 기준일이 다른 파일 두 개에 있습니다.",
                    "한 지역은 같은 날 내려받은 파일만 넣어 주세요.",
                )
            rows.append(
                ProfileRow(
                    company_name=name,
                    address=address,
                    region=region,
                    raw_materials=_public(cell("원자재")),
                    employee_count=_employees(cell("종업원수(총인원)")),
                    industry_codes=_codes(cell("업종번호")),
                    industry_name=_public(cell("업종명")),
                    scale=_public(cell("공장규모")),
                    file_date=file_date,
                )
            )
    return ReadResult(tuple(rows), raw, skipped)


def _decode(path: Path) -> str:
    try:
        data = path.read_bytes()
    except OSError:
        raise InputError(f"파일을 읽을 수 없습니다: {path.name}") from None
    for encoding in ("utf-8-sig", "cp949"):
        try:
            return data.decode(encoding)
        except UnicodeDecodeError:
            continue
    raise InputError(
        "수질 명단 파일의 글자 인코딩을 읽을 수 없습니다.", "UTF-8 또는 CP949 CSV로 저장해 주세요."
    )


def read_water(path: Path, regions: Iterable[str]) -> ReadResult:
    """수질 명단 CSV를 읽는다. 처리형태마다 나뉜 줄을 사업장명+주소로 하나로 합친다."""
    if path.suffix.lower() != ".csv":
        raise InputError(
            "수질 명단은 CSV로 넣어 주세요.", "Numbers·엑셀 파일은 CSV로 내보낸 뒤 넣어 주세요."
        )
    wanted = set(regions)
    try:
        reader = csv.reader(io.StringIO(_decode(path), newline=""), strict=True)
        headers = [_text(value) for value in next(reader, [])]
        missing = [name for name in _WATER_REQUIRED if name not in headers]
        if missing:
            raise InputError(f"수질 명단에 필수 열이 없습니다: {', '.join(missing)}.")
        at = {name: index for index, name in enumerate(headers)}
        merged: dict[tuple[str, str], dict] = {}
        raw = skipped = 0
        for values in reader:
            if not any(value.strip() for value in values):
                continue
            raw += 1

            def cell(name, values=values):
                return _cell(values, at, name)

            name, address = cell("사업장명"), cell("사업장소재지(도로명주소)")
            if not name or not address or _public(name) is None or _public(address) is None:
                skipped += 1
                continue
            region = address_region(address)
            if region not in wanted:
                continue
            item = merged.setdefault(
                (company_key(name), normalize_address(address)),
                {
                    "site_name": name,
                    "address": address,
                    "region": region,
                    "agency": _public(cell("관할기관")),
                    "types": [],
                },
            )
            kind = _public(cell("폐수처리형태"))
            if kind and kind not in item["types"]:
                item["types"].append(kind)
    except csv.Error:
        raise InputError("수질 명단 CSV 형식이 올바르지 않습니다.") from None
    rows = tuple(
        WaterRow(i["site_name"], i["address"], i["region"], i["agency"], tuple(i["types"]))
        for i in merged.values()
    )
    return ReadResult(rows, raw, skipped)


def _check_confirmed(session: Session, source_id: str) -> None:
    contract = session.get(SourceContract, source_id)
    if contract is None or contract.confirmed_at is None:
        raise InputError(
            "이 소스의 이용·저장 확인 기록이 없습니다.",
            f"먼저 geosan source-confirm {source_id} --by <담당자 키> --terms <약관 주소>를 "
            "실행해 주세요.",
        )


def _check_source(session: Session, source_id: str, file_date: date, model) -> None:
    _check_confirmed(session, source_id)
    stored = session.scalar(select(func.max(model.file_date)).where(model.source_id == source_id))
    if stored is not None and stored > file_date:
        raise InputError(
            f"저장된 자료({stored.isoformat()})보다 오래된 파일입니다.",
            "더 새 기준일의 파일을 넣어 주세요.",
        )


def store_profiles(session: Session, rows: Sequence[ProfileRow]) -> int:
    """넣은 시·도의 팩토리온 행만 바꾼다. 다른 시·도 행은 그대로 둔다(#961).

    원본 파일로 다시 만들 수 있는 보조 자료다. 시·도마다 저장된 자료보다 오래된 파일은 거부한다.
    """
    _check_confirmed(session, FACTORYON_SOURCE_ID)
    region_dates = {row.region: row.file_date for row in rows}
    for region, file_date in sorted(region_dates.items()):
        stored = session.scalar(
            select(func.max(FactoryProfile.file_date)).where(
                FactoryProfile.source_id == FACTORYON_SOURCE_ID, FactoryProfile.region == region
            )
        )
        if stored is not None and stored > file_date:
            raise InputError(
                f"저장된 {region} 자료({stored.isoformat()})보다 오래된 파일입니다.",
                "더 새 기준일의 파일을 넣어 주세요.",
            )
    session.execute(
        delete(FactoryProfile).where(
            FactoryProfile.source_id == FACTORYON_SOURCE_ID,
            FactoryProfile.region.in_(list(region_dates)),
        )
    )
    now = utcnow()
    # #961: 경기 9.7만 행. ORM 객체를 하나씩 쌓지 않고 묶음으로 바로 넣어 메모리를 줄인다.
    for at in range(0, len(rows), _INSERT_CHUNK):
        session.execute(
            insert(FactoryProfile),
            [
                {
                    "profile_id": new_id("fprof"),
                    "source_id": FACTORYON_SOURCE_ID,
                    "file_date": row.file_date,
                    "company_name": row.company_name,
                    "normalized_name": company_key(row.company_name),
                    "address": row.address,
                    "normalized_address": normalize_address(row.address) or "",
                    "region": row.region,
                    "raw_materials": row.raw_materials,
                    "employee_count": row.employee_count,
                    "industry_codes": list(row.industry_codes),
                    "industry_name": row.industry_name,
                    "scale": row.scale,
                    "loaded_at": now,
                    "created_at": now,
                    "created_by": "system",
                    "is_virtual": False,
                }
                for row in rows[at : at + _INSERT_CHUNK]
            ],
        )
    session.flush()
    return len(rows)


def store_water(session: Session, rows: Sequence[WaterRow], file_date: date) -> int:
    """수질 명단 행을 통째로 바꾼다."""
    _check_source(session, WATER_SOURCE_ID, file_date, WaterSite)
    session.execute(delete(WaterSite).where(WaterSite.source_id == WATER_SOURCE_ID))
    now = utcnow()
    for row in rows:
        session.add(
            WaterSite(
                site_id=new_id("water"),
                source_id=WATER_SOURCE_ID,
                file_date=file_date,
                site_name=row.site_name,
                normalized_name=company_key(row.site_name),
                address=row.address,
                normalized_address=normalize_address(row.address) or "",
                region=row.region,
                agency=row.agency,
                treatment_types=list(row.treatment_types),
                loaded_at=now,
                created_by="system",
                is_virtual=False,
            )
        )
    session.flush()
    return len(rows)


class ProfileIndex:
    """저장된 보조 자료를 한 번 읽어 회사마다 붙일 행을 찾는다(C5 "회사 붙이기")."""

    def __init__(
        self, session: Session, names: Iterable[str] | None = None, *, water: bool | None = None
    ) -> None:
        """names를 주면 그 회사들의 팩토리온 행만 읽는다(후보 판단, #570).

        수질 명단은 water가 참일 때 읽는다. 따로 정하지 않으면 names가 없을 때만 읽는다.
        """
        self.by_name: dict[str, list[FactoryProfile]] = defaultdict(list)
        query = select(FactoryProfile)
        if names is not None:
            keys = sorted({company_key(name) for name in names})
            query = query.where(FactoryProfile.normalized_name.in_(keys))
        for row in session.scalars(query):
            self.by_name[row.normalized_name].append(row)
        read_water = names is None if water is None else water
        self.water: list[WaterSite] = list(session.scalars(select(WaterSite))) if read_water else []

    def profile_for(self, name: str, address: str | None) -> FactoryProfile | None:
        if not address:
            return None
        candidates = self.by_name.get(company_key(name), [])
        exact = normalize_address(address)
        for row in candidates:
            if row.normalized_address == exact:
                return row
        # 주소 표기만 다를 때: 같은 시·군에 이 이름의 공장 주소가 꼭 하나일 때만 붙인다.
        city = city_key(address)
        nearby = [row for row in candidates if city_key(row.address) == city]
        if len({row.normalized_address for row in nearby}) == 1:
            return nearby[0]
        return None

    def water_for(self, name: str, address: str | None) -> WaterSite | None:
        """사업장명이 회사명과 같거나 회사명으로 시작하고 도로명·건물번호가 같은 행(#613)."""
        key = company_key(name)
        road = road_key(address)
        if road is None or len(key) < 2:
            return None
        for row in self.water:
            if (row.normalized_name == key or row.normalized_name.startswith(key)) and road_key(
                row.address
            ) == road:
                return row
        return None


def apply_to_customer(
    customer: Customer, index: ProfileIndex, surface_codes: Sequence[str]
) -> tuple[bool, int]:
    """공장 정보 5열(#573의 4열 + 업종명 #617)을 옮기고 규칙 출처의 표면처리 표시를 다시 계산한다.

    돌려주는 값: (붙었는지, 표시 변화 +1 새로 붙음 / -1 풀림 / 0 그대로).
    """
    profile = index.profile_for(customer.name, customer.address)
    customer.factory_raw_materials = profile.raw_materials if profile else None
    customer.factory_employee_count = profile.employee_count if profile else None
    customer.factory_scale = profile.scale if profile else None
    customer.factory_industry_name = profile.industry_name if profile else None
    customer.factory_profile_date = profile.file_date if profile else None
    if customer.own_plating_line_source not in (None, *RULE_SOURCES):
        return profile is not None, 0
    before = customer.own_plating_line_suspected
    code = next(
        (c for c in (profile.industry_codes if profile else []) if c in surface_codes), None
    )
    water = index.water_for(customer.name, customer.address)
    if code is not None:
        source, basis = "INDUSTRY_CODE", f"공장등록 업종번호 {code}"
    elif water is not None:
        source, basis = "WATER_LIST", WATER_BASIS
    else:
        source = basis = None
    customer.own_plating_line_suspected = source is not None
    customer.own_plating_line_source = source
    customer.own_plating_line_basis = basis
    # 막 만든 회사(#948)는 저장 전이라 표시가 비어 있다. 빈 값은 표시 없음으로 센다(#966).
    return profile is not None, int(customer.own_plating_line_suspected) - int(bool(before))


def attach_all(session: Session, settings: AppSettings) -> AttachResult:
    """실제 목록 회사 전부에 다시 붙인다. 불러오기 명령이 저장 뒤 같은 묶음 안에서 부른다."""
    customers = list(session.scalars(select(Customer).where(Customer.is_virtual.is_(False))))
    # #961: 공장 행 전부(경기 포함 11만 행)가 아니라 목록 회사 이름에 맞는 행만 읽는다.
    index = ProfileIndex(session, [customer.name for customer in customers], water=True)
    codes = settings.ingestion.ai_pick.surface_treatment_industry_codes
    attached = flagged = unflagged = 0
    for customer in customers:
        hit, change = apply_to_customer(customer, index, codes)
        attached += hit
        flagged += change > 0
        unflagged += change < 0
    session.flush()
    return AttachResult(attached, flagged, unflagged)


def stored_regions(settings: AppSettings) -> list[str]:
    """저장할 시·도. 설정의 찾기 지역(시·군 포함)을 시·도로 푼다."""
    return parent_regions(settings.ingestion.regions)
