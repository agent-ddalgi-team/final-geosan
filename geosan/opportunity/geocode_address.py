"""주소의 공개 구성 요소만 비교한다. 회사 이름·메모·연락처는 검색어에 넣지 않는다."""

import re
import unicodedata
from dataclasses import dataclass

from geosan.config.validators import find_contact

PROVINCES = {
    "충남": "충청남도",
    "대전": "대전광역시",
    "세종": "세종특별자치시",
    "서울": "서울특별시",
    "부산": "부산광역시",
    "대구": "대구광역시",
    "인천": "인천광역시",
    "광주": "광주광역시",
    "울산": "울산광역시",
    "경기": "경기도",
    "강원": "강원특별자치도",
    "강원도": "강원특별자치도",
    "충북": "충청북도",
    "전북": "전북특별자치도",
    "전라북도": "전북특별자치도",
    "전남": "전라남도",
    "경북": "경상북도",
    "경남": "경상남도",
    "제주": "제주특별자치도",
}
PROVINCES.update({v: v for v in tuple(PROVINCES.values())})
ROAD = re.compile(
    r"(?P<name>[가-힣A-Za-z0-9·.]+(?:대로|로|길))\s+"
    r"(?P<flag>지하\s*)?(?P<main>\d+)(?:\s*-\s*(?P<sub>\d+))?(?!\d)"
)
ROAD_JOINED = re.compile(ROAD.pattern.replace(r"\s+", r"\s*", 1))
LOT = re.compile(
    r"(?P<name>[가-힣0-9]+?(?:리|동))\s*(?P<flag>산\s*)?"
    r"(?P<main>\d+)(?:\s*-\s*(?P<sub>\d+))?(?!\d)"
)
PERSON = re.compile(r"담당|직통|팩스|휴대|이메일|메모|[가-힣]{2,4}\s*(?:님|과장|부장|대리)")


def compact(value: str) -> str:
    return re.sub(r"\s+", "", unicodedata.normalize("NFKC", value or "")).casefold()


@dataclass(frozen=True)
class Address:
    kind: str
    province: str
    city: str
    town: str
    name: str
    main: int
    sub: int
    flag: bool

    @property
    def key(self) -> tuple:
        return self.province, compact(self.city), compact(self.name), self.main, self.sub, self.flag

    @property
    def query(self) -> str:
        number = str(self.main) + (f"-{self.sub}" if self.sub else "")
        flag = ("지하 " if self.kind == "ROAD" else "산 ") if self.flag else ""
        return " ".join(
            v for v in [self.province, self.city, self.town, self.name, flag + number] if v
        )


def parse_address(value: str | None) -> Address | None:
    text = unicodedata.normalize("NFKC", value or "").strip()
    if find_contact(text) or PERSON.search(text):
        return None
    province = next(
        (p for p in sorted(PROVINCES, key=len, reverse=True) if text.startswith(p)), None
    )
    if province is None:
        return None
    rest = text[len(province) :].strip()
    province = PROVINCES[province]
    city = ""
    if province != "세종특별자치시":
        city_match = re.match(r"([가-힣]+?(?:시|군|구))\s*(동남구|서북구)?\s*", rest)
        if not city_match:
            return None
        city = " ".join(v for v in city_match.groups() if v)
        rest = rest[city_match.end() :]
    rest = re.sub(r"\([^)]*\)", "", rest)
    found = ROAD.search(rest) or ROAD_JOINED.search(rest)
    kind = "ROAD"
    if not found:
        found, kind = LOT.search(rest), "JIBUN"
    if not found:
        return None
    prefix = rest[: found.start()].strip(" ,")
    if prefix and not re.fullmatch(r"[가-힣]+(?:읍|면|동)", compact(prefix)):
        return None
    return Address(
        kind,
        province,
        city,
        compact(prefix),
        found["name"],
        int(found["main"]),
        int(found["sub"] or 0),
        bool(found["flag"]),
    )


def same_address(left: Address, right: Address) -> bool:
    # 시 이름만 있는 천안 주소는 두 구 가운데 도로명·번지가 같은 결과와 비교할 수 있다.
    city = compact(left.city)
    other = compact(right.city)
    city_equal = city == other or bool(
        city.endswith("시")
        and other.startswith(city)
        and re.fullmatch(r"[가-힣]+구", other[len(city) :])
    )
    return (
        left.kind == right.kind
        and left.province == right.province
        and city_equal
        and compact(left.name) == compact(right.name)
        and left.main == right.main
        and left.sub == right.sub
        and left.flag == right.flag
        and (not left.town or left.town == right.town)
    )


def matches_juso(address: Address, row: dict) -> bool:
    key = "roadAddrPart1" if address.kind == "ROAD" else "jibunAddr"
    other = parse_address(row.get(key))
    if other and same_address(address, other):
        return True
    # 공식 관련지번만 허용한다. 주지번이 다른 같은 사업장도 임의의 근처 번지로 바꾸지 않는다.
    if address.kind == "JIBUN" and row.get("relJibun"):
        prefix = " ".join(
            v
            for v in [
                row.get("siNm"),
                row.get("sggNm"),
                row.get("emdNm") if row.get("liNm") else "",
            ]
            if v
        )
        for token in row["relJibun"].split(","):
            other = parse_address(token.strip()) or parse_address(prefix + " " + token.strip())
            if other and same_address(address, other):
                return True
    return False
