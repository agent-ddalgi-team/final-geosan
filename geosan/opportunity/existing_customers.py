"""기존 고객 참고 자료(#932, PM 결정 2026-11-26). 계약 C4·C6·C7·C8.

거산의 지금 거래처 목록(검증된 파일)을 읽어 두고, 영업 코치·MCP 도구가 비교에, 신규 거래처 찾기가
"기존 고객과 닮은 조건" 제안에 쓴다. 확장 기능이라 설정 `existingCustomers.enabled`가 기본 꺼짐이다.

- 읽는 칸은 회사명·공정·소재·산업·지역·인증·거래 시작 7개뿐이다. 그 밖의 칸(단가·담당자·전화 등)은
  읽지 않고 버리며 이름만 요약에 알린다(CON-11·CON-23).
- 남기는 칸에 전화·이메일 모양이 있거나 공정·산업이 우리 목록에 없으면 파일 전체를 거부한다
  (몇째 줄이 왜 틀렸는지 함께). 넣을 때마다 통째로 바꾼다(이력 없음).
- 점수·순위에는 쓰지 않는다. AI·외부 전송은 여기서 하지 않는다(도구의 문은 mcp_tools).
"""

from __future__ import annotations

import csv
import io
import re
from collections import Counter
from collections.abc import Iterable, Mapping, Sequence
from dataclasses import dataclass, field
from datetime import date
from pathlib import Path

from sqlalchemy import delete, func, select
from sqlalchemy.orm import Session

from geosan.config.errors import FieldError, InputError
from geosan.evidence.contacts import scrub_contacts
from geosan.opportunity.source_models import ExistingCustomer
from geosan.storage.base import new_id, utcnow

COL_NAME = "회사명"
COL_PROCESS = "공정"
COL_MATERIAL = "소재"
COL_INDUSTRY = "산업"
COL_REGION = "지역"
COL_CERT = "인증"
COL_SINCE = "거래 시작"
COLUMNS = (COL_NAME, COL_PROCESS, COL_MATERIAL, COL_INDUSTRY, COL_REGION, COL_CERT, COL_SINCE)
REQUIRED = (COL_NAME, COL_PROCESS)
# 여러 값 구분: 쉼표·세미콜론·세로줄.
# 가운뎃점(·)은 산업 이름 안에 있어(밸브·유체기기) 구분자로 쓰지 않는다.
_SPLIT = re.compile(r"[,;|\n]")
_SINCE = re.compile(r"^(\d{4})(?:[-./](\d{1,2}))?$")
_FILE_DATE = re.compile(r"(?<![0-9])(20[0-9]{6})(?![0-9])")
_NAME_MAX = 200
_REGION_MAX = 80
_VALUE_MAX = 100


@dataclass(frozen=True, slots=True)
class CustomerRow:
    company_name: str
    process_codes: tuple[str, ...]
    materials: tuple[str, ...]
    industries: tuple[str, ...]
    region: str | None
    certifications: tuple[str, ...]
    since: str | None


@dataclass
class ReadResult:
    rows: list[CustomerRow] = field(default_factory=list)
    # 읽지 않고 버린 칸 이름(파일에 있던 순서).
    dropped_columns: list[str] = field(default_factory=list)


def normalize_name(name: str) -> str:
    return re.sub(r"\s+|\(주\)|주식회사|\(유\)|유한회사", "", name).casefold()


def _key(text: str) -> str:
    return re.sub(r"\s+", "", text).casefold()


def process_lookup(catalog: Mapping[str, str]) -> dict[str, str]:
    """파일의 공정 글 → 공정 코드. 코드, 화면 이름, 괄호 앞 이름("아연도금")을 받는다."""
    lookup: dict[str, str] = {}
    for code, label in catalog.items():
        for text in (code, label, label.split("(")[0]):
            if text.strip():
                lookup.setdefault(_key(text), code)
    return lookup


def file_date_of(path: Path, today: date) -> date:
    """파일 이름의 YYYYMMDD가 있으면 그 날, 없으면 오늘(넣은 날)."""
    found = _FILE_DATE.findall(path.stem)
    if len(set(found)) == 1:
        value = found[0]
        try:
            return date(int(value[:4]), int(value[4:6]), int(value[6:]))
        except ValueError:
            pass
    return today


def _decode(data: bytes, name: str) -> str:
    for encoding in ("utf-8-sig", "cp949"):
        try:
            return data.decode(encoding)
        except UnicodeDecodeError:
            continue
    raise InputError(
        f"기존 고객 파일의 글자 인코딩을 읽을 수 없습니다: {name}",
        "UTF-8 또는 CP949 CSV로 저장해 주세요.",
    )


def _values(cell: str) -> list[str]:
    return [value.strip() for value in _SPLIT.split(cell) if value.strip()]


def _since(cell: str) -> str | None:
    match = _SINCE.match(cell)
    if match is None:
        raise ValueError
    year, month = match.group(1), match.group(2)
    if month is None:
        return year
    if not 1 <= int(month) <= 12:
        raise ValueError
    return f"{year}-{int(month):02d}"


def read_customer_file(
    path: Path, processes: Mapping[str, str], industries: Sequence[str]
) -> ReadResult:
    """CSV를 읽어 검사한다. 틀린 줄이 하나라도 있으면 아무것도 돌려주지 않고 InputError(줄·칸·이유).

    processes는 {공정 코드: 화면 이름}(활성 역량 파일), industries는 설정 산업군 이름이다.
    """
    try:
        data = path.read_bytes()
    except OSError:
        raise InputError(f"파일을 읽을 수 없습니다: {path.name}") from None
    reader = csv.reader(io.StringIO(_decode(data, path.name)))
    header = next(reader, None)
    if header is None:
        raise InputError("기존 고객 파일이 비어 있습니다.", "첫 줄에 칸 이름을 적어 주세요.")
    names = [cell.strip() for cell in header]
    missing = [column for column in REQUIRED if column not in names]
    if missing:
        raise InputError(
            f"기존 고객 파일에 꼭 있어야 하는 칸이 없습니다: {', '.join(missing)}",
            "첫 줄 칸 이름: " + ", ".join(COLUMNS) + " (회사명·공정은 필수)",
        )
    at = {column: names.index(column) for column in COLUMNS if column in names}
    result = ReadResult(dropped_columns=[name for name in names if name and name not in COLUMNS])
    lookup = process_lookup(processes)
    industry_keys = {_key(name): name for name in industries}
    errors: list[FieldError] = []
    seen: dict[str, int] = {}

    def cell(values: list[str], column: str) -> str:
        index = at.get(column)
        return values[index].strip() if index is not None and index < len(values) else ""

    for line, values in enumerate(reader, start=2):
        if not any(value.strip() for value in values):
            continue
        before = len(errors)

        def fail(column: str, message: str, line: int = line) -> None:
            errors.append(FieldError(path=column, message=message, line=line))

        # 남기는 칸에 연락처 모양이 있으면 그 줄을 거부한다(값을 지우고 넣지 않는다).
        for column in at:
            if scrub_contacts(cell(values, column))[1]:
                fail(column, "전화·이메일 모양이 있습니다. 연락처는 넣지 않습니다.")
        name = cell(values, COL_NAME)
        if not name:
            fail(COL_NAME, "회사명이 비었습니다.")
        elif len(name) > _NAME_MAX:
            fail(COL_NAME, f"회사명은 {_NAME_MAX}자까지입니다.")
        elif normalize_name(name) in seen:
            fail(COL_NAME, f"{seen[normalize_name(name)]}째 줄과 같은 회사입니다.")
        codes: list[str] = []
        for value in _values(cell(values, COL_PROCESS)):
            code = lookup.get(_key(value))
            if code is None:
                fail(COL_PROCESS, f"거산 공정 목록에 없는 공정입니다: {value}")
            elif code not in codes:
                codes.append(code)
        if not _values(cell(values, COL_PROCESS)):
            fail(COL_PROCESS, "공정을 하나 이상 적어 주세요.")
        picked: list[str] = []
        for value in _values(cell(values, COL_INDUSTRY)):
            industry = industry_keys.get(_key(value))
            if industry is None:
                fail(COL_INDUSTRY, f"설정 산업군에 없는 산업입니다: {value}")
            elif industry not in picked:
                picked.append(industry)
        region = cell(values, COL_REGION) or None
        if region is not None and len(region) > _REGION_MAX:
            fail(COL_REGION, f"지역은 {_REGION_MAX}자까지입니다.")
        materials = _values(cell(values, COL_MATERIAL))
        certs = _values(cell(values, COL_CERT))
        for column, items in ((COL_MATERIAL, materials), (COL_CERT, certs)):
            if any(len(item) > _VALUE_MAX for item in items):
                fail(column, f"값 하나는 {_VALUE_MAX}자까지입니다.")
        since = None
        if cell(values, COL_SINCE):
            try:
                since = _since(cell(values, COL_SINCE))
            except ValueError:
                fail(COL_SINCE, "거래 시작은 2019-03 또는 2019처럼 적어 주세요.")
        if len(errors) > before:
            continue
        seen[normalize_name(name)] = line
        result.rows.append(
            CustomerRow(
                company_name=name,
                process_codes=tuple(codes),
                materials=tuple(dict.fromkeys(materials)),
                industries=tuple(picked),
                region=region,
                certifications=tuple(dict.fromkeys(certs)),
                since=since,
            )
        )
    if errors:
        raise InputError(
            f"기존 고객 파일에 고칠 곳이 {len(errors)}군데 있어 아무것도 넣지 않았습니다.",
            fields=errors,
        )
    if not result.rows:
        raise InputError("기존 고객 파일에 회사 줄이 없습니다.", "둘째 줄부터 회사를 적어 주세요.")
    return result


def store_customers(
    session: Session, rows: Sequence[CustomerRow], file_date: date, *, virtual: bool
) -> int:
    """기존 고객을 통째로 바꿔 넣는다. 넣은 수를 돌려준다."""
    session.execute(delete(ExistingCustomer))
    now = utcnow()
    for row in rows:
        session.add(
            ExistingCustomer(
                existing_customer_id=new_id("excust"),
                file_date=file_date,
                company_name=row.company_name,
                normalized_name=normalize_name(row.company_name),
                process_codes=list(row.process_codes),
                materials=list(row.materials),
                industries=list(row.industries),
                region=row.region,
                certifications=list(row.certifications),
                since=row.since,
                loaded_at=now,
                is_virtual=virtual,
            )
        )
    session.flush()
    return len(rows)


def clear_customers(session: Session) -> int:
    """기존 고객을 모두 지운다. 지운 수를 돌려준다."""
    count = customer_count(session)
    session.execute(delete(ExistingCustomer))
    return count


def customer_count(session: Session) -> int:
    return int(session.scalar(select(func.count()).select_from(ExistingCustomer)) or 0)


def all_customers(session: Session) -> list[ExistingCustomer]:
    return list(session.scalars(select(ExistingCustomer).order_by(ExistingCustomer.company_name)))


@dataclass(frozen=True)
class SimilarCustomer:
    customer: ExistingCustomer
    shared_processes: tuple[str, ...]
    shared_industries: tuple[str, ...]


def pick_similar_customers(
    session: Session, processes: Iterable[str], industries: Iterable[str], limit: int
) -> list[SimilarCustomer]:
    """공정·산업이 겹치는 기존 고객. 겹치는 공정 수 → 산업 수 → 최근 거래 → 이름 순."""
    want_p = set(processes)
    want_i = set(industries)
    found: list[SimilarCustomer] = []
    for row in all_customers(session):
        shared_p = tuple(code for code in row.process_codes if code in want_p)
        shared_i = tuple(name for name in row.industries if name in want_i)
        if shared_p or shared_i:
            found.append(SimilarCustomer(row, shared_p, shared_i))
    # 안정 정렬을 뒤 기준부터 쌓는다: 이름 → 최근 거래(모르면 뒤) → 겹치는 산업 수 → 겹치는 공정 수.
    found.sort(key=lambda item: item.customer.company_name)
    found.sort(key=lambda item: item.customer.since or "", reverse=True)
    found.sort(key=lambda item: item.customer.since is None)
    found.sort(key=lambda item: (-len(item.shared_processes), -len(item.shared_industries)))
    return found[:limit]


@dataclass(frozen=True)
class Overview:
    total: int
    processes: list[tuple[str, int]]
    industries: list[tuple[str, int]]
    regions: list[tuple[str, int]]
    certifications: list[tuple[str, int]]
    has_virtual: bool


def _ranked(counter: Counter[str]) -> list[tuple[str, int]]:
    return sorted(counter.items(), key=lambda item: (-item[1], item[0]))


def overview(session: Session) -> Overview:
    """기존 고객 전체 모습: 공정·산업·지역·인증별 고객 수(많은 순)."""
    rows = all_customers(session)
    return Overview(
        total=len(rows),
        processes=_ranked(Counter(code for row in rows for code in row.process_codes)),
        industries=_ranked(Counter(name for row in rows for name in row.industries)),
        regions=_ranked(Counter(row.region for row in rows if row.region)),
        certifications=_ranked(Counter(cert for row in rows for cert in row.certifications)),
        has_virtual=any(row.is_virtual for row in rows),
    )


def region_matches(region: str, allowed: Iterable[str]) -> list[str]:
    """기존 고객 지역 글에 든 찾기 지역 값(ingestion.regions). 예: "충남 천안시" → 천안시."""
    text = _key(region)
    return [value for value in allowed if _key(value) and _key(value) in text]
