"""#573: 팩토리온 공장조회·수질 명단 보조 자료 읽기·저장·회사 붙이기를 임시 파일과 DB로 확인한다.

AI·외부 호출 없음. 엑셀은 openpyxl로 임시 파일을 실제로 만들어 읽는다.
"""

from __future__ import annotations

from datetime import date
from pathlib import Path

import pytest
from openpyxl import Workbook
from sqlalchemy import select
from typer.testing import CliRunner

from geosan.commands.app import app
from geosan.config.errors import InputError
from geosan.opportunity.factory_profile import (
    ProfileIndex,
    apply_to_customer,
    company_key,
    file_date_of,
    read_factoryon,
    read_water,
    road_key,
    store_profiles,
    store_water,
)
from geosan.opportunity.models import Customer
from geosan.opportunity.queries import normalize_address, normalize_name
from geosan.opportunity.source_models import FactoryProfile, SourceContract, WaterSite
from geosan.storage.base import new_id
from geosan.storage.session import session_scope

HEADERS = [
    "생산품",
    "지목",
    "전화번호",
    "업종번호",
    "업종명",
    "홈페이지",
    "공장주소(도로명)",
    "종업원수(총인원)",
    "원자재",
    "회사명",
    "산업단지명",
    "공장규모",
    "순번",
    "공장주소(지번)",
]
REGIONS = ["충남", "대전", "세종"]


def factoryon_file(tmp_path: Path, rows: list[dict], name="20261111_팩트리온_충남.xlsx") -> Path:
    book = Workbook()
    sheet = book.active
    sheet.append(HEADERS)
    for row in rows:
        sheet.append([row.get(header) for header in HEADERS])
    path = tmp_path / name
    book.save(path)
    return path


def water_file(tmp_path: Path, lines: list[str], name="20261111_수질명단.csv") -> Path:
    path = tmp_path / name
    path.write_text(
        "사업장명,관할기관,사업장소재지(도로명주소),폐수처리형태\n" + "\n".join(lines) + "\n",
        encoding="utf-8",
    )
    return path


def row(**values) -> dict:
    base = {
        "회사명": "(주)가상볼트",
        "공장주소(도로명)": "충청남도 천안시 서북구 가상로 1",
        "원자재": "강판, SUS",
        "종업원수(총인원)": "12",
        "업종번호": "25924, 25922",
        "업종명": "절삭가공 외 1 종",
        "공장규모": "소기업",
        "전화번호": "041-000-0000",
        "홈페이지": "https://private-marker.example",
    }
    base.update(values)
    return base


def confirm(*source_ids: str) -> None:
    with session_scope() as session:
        for source_id in source_ids:
            session.add(
                SourceContract(
                    source_id=source_id,
                    source_name="가상 확인",
                    allowed_use="검사",
                    allowed_storage="검사",
                    confirmed_at=date(2026, 11, 11),
                    is_virtual=True,
                )
            )


def add_customer(name: str, address: str, **values) -> str:
    customer_id = new_id("cust")
    with session_scope() as session:
        session.add(
            Customer(
                customer_id=customer_id,
                name=name,
                normalized_name=normalize_name(name),
                address=address,
                normalized_address=normalize_address(address),
                relation_status="UNCONFIRMED",
                security_grade="PUBLIC",
                is_virtual=False,
                **values,
            )
        )
    return customer_id


def customer(customer_id: str) -> Customer:
    with session_scope() as session:
        found = session.get(Customer, customer_id)
        session.expunge(found)
        return found


def test_factoryon_reader_keeps_only_public_columns_and_marks_bad_values(tmp_path):
    """Given 전화·홈페이지가 든 엑셀 / When 읽음 / Then 필요한 칸만 남고 종업원 0은 빈 값이다."""
    path = factoryon_file(
        tmp_path,
        [
            row(),
            row(**{"회사명": "가상영인", "종업원수(총인원)": "0", "원자재": "문의 010-1234-5678"}),
            row(
                **{
                    "회사명": "가상지번",
                    "공장주소(도로명)": None,
                    "공장주소(지번)": "대전광역시 유성구 가상동 1",
                }
            ),
            row(**{"회사명": "가상경기", "공장주소(도로명)": "경기도 수원시 가상로 1"}),
            row(**{"회사명": "", "공장주소(도로명)": "충청남도 아산시 가상로 2"}),
        ],
    )
    result = read_factoryon([path], REGIONS)
    assert result.raw_count == 5 and result.skipped_count == 1
    first, zero, lot = result.rows
    assert first.raw_materials == "강판, SUS" and first.employee_count == 12
    assert first.industry_codes == ("25924", "25922") and first.scale == "소기업"
    assert first.region == "충남"
    assert zero.employee_count is None and zero.raw_materials is None
    assert lot.address == "대전광역시 유성구 가상동 1" and lot.region == "대전"
    assert "private-marker" not in repr(result) and "041-000-0000" not in repr(result)


def test_factoryon_reader_rejects_a_file_without_required_columns(tmp_path):
    """Given 원자재 제목이 없는 엑셀 / When 읽음 / Then 빈 성공이 아니라 어떤 열이 없는지 알린다."""
    book = Workbook()
    book.active.append(["회사명", "공장주소(도로명)"])
    path = tmp_path / "20261111_x.xlsx"
    book.save(path)
    with pytest.raises(InputError, match="원자재"):
        read_factoryon([path], REGIONS)


def test_broken_excel_is_an_input_error(tmp_path):
    path = tmp_path / "20261111_broken.xlsx"
    path.write_text("not excel", encoding="utf-8")
    with pytest.raises(InputError, match="엑셀"):
        read_factoryon([path], REGIONS)


@pytest.mark.parametrize(
    ("name", "expected"),
    [
        ("20261111_팩트리온_대전전체.xlsx", date(2026, 11, 11)),
        ("수질명단_20261110.csv", date(2026, 11, 10)),
    ],
)
def test_file_date_comes_from_the_file_name(name, expected):
    assert file_date_of(Path(name)) == expected


@pytest.mark.parametrize("name", ["공장조회.xlsx", "20261341_x.xlsx", "20261111_20261112.xlsx"])
def test_file_without_one_real_date_is_rejected(name):
    with pytest.raises(InputError, match="기준일"):
        file_date_of(Path(name))


def test_water_reader_merges_treatment_rows_and_keeps_selected_regions(tmp_path):
    """Given 같은 사업장이 처리형태별 두 줄 / When 읽음 / Then 한 행에 처리형태 둘이 남는다."""
    path = water_file(
        tmp_path,
        [
            "(주)가상도금 제2공장,금강유역환경청,충청남도 아산시 가상로 9,위탁처리",
            "(주)가상도금 제2공장,금강유역환경청,충청남도 아산시 가상로 9,개별처리 후 직접방류",
            "가상화학,낙동강유역환경청,경상남도 김해시 가상로 1,위탁처리",
        ],
    )
    result = read_water(path, REGIONS)
    assert result.raw_count == 3 and len(result.rows) == 1
    assert result.rows[0].treatment_types == ("위탁처리", "개별처리 후 직접방류")


def test_water_reader_only_takes_csv(tmp_path):
    path = tmp_path / "20261111_수질.numbers"
    path.write_bytes(b"x")
    with pytest.raises(InputError, match="CSV"):
        read_water(path, REGIONS)


def test_store_needs_source_confirmation_and_refuses_older_files(tmp_db, tmp_path):
    """Given 확인 기록 없음 / When 저장 / Then 거부. 확인 뒤 더 오래된 파일도 거부한다."""
    rows = read_factoryon([factoryon_file(tmp_path, [row()])], REGIONS).rows
    with session_scope() as session, pytest.raises(InputError, match="확인 기록"):
        store_profiles(session, rows, date(2026, 11, 11))
    confirm("factoryon-xlsx")
    with session_scope() as session:
        assert store_profiles(session, rows, date(2026, 11, 11)) == 1
    with session_scope() as session, pytest.raises(InputError, match="오래된"):
        store_profiles(session, rows, date(2026, 11, 1))
    with session_scope() as session:
        # 같은 날 파일을 다시 넣으면 통째로 바뀌어 한 벌만 남는다.
        store_profiles(session, rows, date(2026, 11, 11))
        assert len(list(session.scalars(select(FactoryProfile)))) == 1


def _store(tmp_path, profiles: list[dict], water: list[str] = ()) -> None:
    confirm("factoryon-xlsx", "nier-water-csv")
    with session_scope() as session:
        store_profiles(
            session,
            read_factoryon([factoryon_file(tmp_path, profiles)], REGIONS).rows,
            date(2026, 11, 11),
        )
        store_water(
            session, read_water(water_file(tmp_path, list(water)), REGIONS).rows, date(2026, 11, 11)
        )


def test_profile_attaches_by_name_and_address_or_one_factory_in_the_same_city(tmp_db, tmp_path):
    """Given 주소 표기만 다른 회사와 같은 시에 공장이 둘인 회사 / When 붙임 / Then 앞만 붙는다."""
    _store(
        tmp_path,
        [
            row(),
            row(**{"회사명": "가상둘", "공장주소(도로명)": "충청남도 아산시 가상로 1"}),
            row(**{"회사명": "가상둘", "공장주소(도로명)": "충청남도 아산시 가상로 2"}),
        ],
    )
    with session_scope() as session:
        index = ProfileIndex(session)
        assert index.profile_for("가상볼트 주식회사", "충청남도 천안시 서북구 가상로 1") is not None
        assert index.profile_for("가상볼트", "충청남도 천안시 동남구 다른로 5 (가상동)") is not None
        assert index.profile_for("가상볼트", "충청남도 아산시 가상로 1") is None
        assert index.profile_for("가상둘", "충청남도 아산시 다른로 3") is None


def test_flags_come_from_industry_code_or_water_list_and_are_recalculated(tmp_db, tmp_path):
    """Given 도금업 번호 회사·수질 명단 회사·AI 표시 회사 / When 붙임 / Then 규칙 출처만 바뀐다."""
    _store(
        tmp_path,
        [
            row(),
            row(
                **{
                    "회사명": "가상선재",
                    "업종번호": "25929",
                    "공장주소(도로명)": "충청남도 당진시 가상로 7",
                }
            ),
        ],
        ["가상선재 당진공장,금강유역환경청,충청남도 당진시 가상로 7,위탁처리"],
    )
    code_id = add_customer("(주)가상볼트", "충청남도 천안시 서북구 가상로 1")
    water_id = add_customer("가상선재", "충청남도 당진시 가상로 7")
    ai_id = add_customer(
        "가상볼트",
        "충청남도 천안시 서북구 가상로 1",
        own_plating_line_suspected=True,
        own_plating_line_source="AI",
        own_plating_line_basis="생산품 아노다이징",
        biz_number="9999999999",
    )
    with session_scope() as session:
        index = ProfileIndex(session)
        for customer_id in (code_id, water_id, ai_id):
            apply_to_customer(session.get(Customer, customer_id), index, ["25922", "25923"])
    coded, watered, ai = customer(code_id), customer(water_id), customer(ai_id)
    assert (coded.own_plating_line_source, coded.own_plating_line_basis) == (
        "INDUSTRY_CODE",
        "공장등록 업종번호 25922",
    )
    assert coded.factory_employee_count == 12 and coded.factory_profile_date == date(2026, 11, 11)
    assert watered.own_plating_line_source == "WATER_LIST" and watered.own_plating_line_suspected
    assert (ai.own_plating_line_source, ai.own_plating_line_basis) == ("AI", "생산품 아노다이징")
    # 설정에서 업종번호를 빼면 규칙 표시는 풀리고 공장 정보는 그대로 붙어 있다.
    with session_scope() as session:
        apply_to_customer(session.get(Customer, code_id), ProfileIndex(session), [])
    released = customer(code_id)
    assert not released.own_plating_line_suspected and released.own_plating_line_source is None
    assert released.factory_raw_materials == "강판, SUS"


def test_water_list_needs_the_same_city(tmp_db, tmp_path):
    _store(tmp_path, [row()], ["가상선재 공장,원주지방환경청,충청남도 서산시 가상로 7,위탁처리"])
    with session_scope() as session:
        assert ProfileIndex(session).water_for("가상선재", "충청남도 당진시 가상로 7") is None
        assert company_key("(주) 가상 선재") == "가상선재"


def test_water_list_needs_the_same_road_and_building_number(tmp_db, tmp_path):
    """#613 Given 같은 시에 이름이 같은 사업장 / When 붙임 / Then 도로명·건물번호가 같을 때만.

    "외 19필지"·괄호 안 동 이름은 표기 차이로 본다. 지번 주소는 견줄 수 없어 붙이지 않는다.
    """
    _store(
        tmp_path,
        [row()],
        [
            "가상선재 당진공장,금강유역환경청,충청남도 당진시 가상로 7,위탁처리",
            "가상콜마 관정공장,금강유역환경청,충청남도 당진시 산단길 22-17,위탁처리",
        ],
    )
    with session_scope() as session:
        index = ProfileIndex(session)
        assert (
            index.water_for("가상선재", "충청남도 당진시 가상로 7 (가상동) 외 19필지") is not None
        )
        assert index.water_for("가상선재", "충청남도 당진시 가상로 8") is None
        assert index.water_for("가상콜마", "충청남도 당진시 덕고개길 12-11 외 3필지") is None
        assert index.water_for("가상콜마", "충청남도 당진시 산단길 22-17") is not None
        assert index.water_for("가상선재", "충청남도 당진시 가상리 349번지") is None


@pytest.mark.parametrize(
    ("address", "key"),
    [
        ("충청남도 천안시 서북구 번영로 467 (성성동, 가상(주))", "충남|천안시|번영로|467"),
        ("세종특별자치시 조치원읍 번암공단1길 16 외 19필지", "세종|조치원읍|번암공단1길|16"),
        ("충청남도 천안시 서북구 성거읍 망향로 854 외1필지 외 1필지", "충남|천안시|망향로|854"),
        ("충청남도 천안시 동남구 성남면 대화리 349번지", None),
        (None, None),
    ],
)
def test_road_key_ignores_lot_counts_and_parentheses(address, key):
    assert road_key(address) == key


def test_source_load_command_stores_and_attaches(tmp_db, tmp_path):
    """Given 확인된 소스와 목록 회사 / When source-load / Then 행 수와 붙은 회사 수를 알린다."""
    confirm("factoryon-xlsx")
    customer_id = add_customer("(주)가상볼트", "충청남도 천안시 서북구 가상로 1")
    path = factoryon_file(
        tmp_path, [row(), row(**{"회사명": "가상경기", "공장주소(도로명)": "경기도 수원시 1"})]
    )
    result = CliRunner().invoke(app, ["source-load", "factoryon-xlsx", str(path)])
    assert result.exit_code == 0, result.output
    assert "2행을 읽어 1행을 저장" in result.output and "붙은 회사 1곳" in result.output
    assert customer(customer_id).factory_scale == "소기업"


def test_source_load_rejects_mixed_dates_and_unknown_sources(tmp_db, tmp_path):
    first = factoryon_file(tmp_path, [row()], name="20261111_a.xlsx")
    second = factoryon_file(tmp_path, [row()], name="20261110_b.xlsx")
    mixed = CliRunner().invoke(app, ["source-load", "factoryon-xlsx", str(first), str(second)])
    assert mixed.exit_code == 1 and "기준일이 서로 다릅니다" in mixed.output
    unknown = CliRunner().invoke(app, ["source-load", "kicox-factory-csv", str(first)])
    assert unknown.exit_code == 1 and "factoryon-xlsx" in unknown.output
    with session_scope() as session:
        assert list(session.scalars(select(FactoryProfile))) == []
        assert list(session.scalars(select(WaterSite))) == []


def test_source_confirm_requires_terms_for_new_sources(tmp_db):
    result = CliRunner().invoke(app, ["source-confirm", "nier-water-csv", "--by", "choi-pm"])
    assert result.exit_code == 1 and "--terms" in result.output
    ok = CliRunner().invoke(
        app,
        ["source-confirm", "nier-water-csv", "--by", "choi-pm", "--terms", "https://example.org/t"],
    )
    assert ok.exit_code == 0, ok.output
