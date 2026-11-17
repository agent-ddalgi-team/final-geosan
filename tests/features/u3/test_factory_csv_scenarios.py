"""#320: 실제 임시 CSV 파일을 읽는 Given/When/Then. AI·DB 호출 없음."""

from pathlib import Path

from pytest_bdd import given, scenarios, then, when

from geosan.config.errors import InputError
from geosan.opportunity.factory_csv import read_factory_csv

scenarios("u3/factory_csv.feature")


@given(
    "충남 대전 세종과 다른 지역이 섞인 CP949 가상 공장현황 파일이 있다", target_fixture="csv_path"
)
def regional_file(tmp_path):
    fixture = Path(__file__).resolve().parents[2] / "fixtures/kicox-factory-synthetic.csv"
    path = tmp_path / "factories.csv"
    path.write_bytes(fixture.read_text(encoding="utf-8").encode("cp949"))
    return path


@given("회사명 제목이 빠진 가상 공장현황 파일이 있다", target_fixture="csv_path")
def missing_header_file(tmp_path):
    path = tmp_path / "factories.csv"
    path.write_text("순번,단지명,생산품,공장주소\n", encoding="utf-8")
    return path


@given("대표자와 팩스 열에 가상 표식이 든 공장현황 파일이 있다", target_fixture="csv_path")
def private_columns_file(tmp_path):
    path = tmp_path / "factories.csv"
    path.write_text(
        "순번,회사명,단지명,생산품,공장주소,대표자명,팩스번호\n"
        "1,가상정밀,,볼트,충남 아산시 가상길 1,PRIVATE_PERSON_MARKER,PRIVATE_FAX_MARKER\n",
        encoding="utf-8",
    )
    return path


@when("충남 대전 세종을 골라 파일을 읽는다", target_fixture="read_outcome")
def read_file(csv_path):
    try:
        return read_factory_csv(csv_path, regions=["충남", "대전", "세종"])
    except InputError as error:
        return error


@then("주소가 고른 지역인 회사 7곳만 읽힌다")
def selected_rows(read_outcome):
    assert len(read_outcome.rows) == 7
    assert all(row.region in {"충남", "대전", "세종"} for row in read_outcome.rows)
    assert "가상전북공장" not in {row.company_name for row in read_outcome.rows}


@then("산업단지 밖 회사와 표면처리 회사도 입력에 남는다")
def retained_rows(read_outcome):
    by_name = {row.company_name: row for row in read_outcome.rows}
    assert by_name["가상아산부품"].complex_name is None
    assert by_name["가상표면처리"].product == "알루미늄 아노다이징"


@then("원본 10행과 지역 제외 3행이 집계된다")
def counts(read_outcome):
    assert read_outcome.raw_count == 10
    assert read_outcome.filtered_count == 3
    assert read_outcome.skipped_rows == ()


@then("회사명 제목이 없다는 오류로 멈춘다")
def invalid_header(read_outcome):
    assert isinstance(read_outcome, InputError)
    assert "회사명" in read_outcome.message


@then("공개 회사 자료만 남고 가상 개인정보 표식은 결과에 없다")
def safe_rows(read_outcome):
    assert len(read_outcome.rows) == 1
    assert read_outcome.rows[0].company_name == "가상정밀"
    assert read_outcome.rows[0].product == "볼트"
    assert "PRIVATE_PERSON_MARKER" not in repr(read_outcome)
    assert "PRIVATE_FAX_MARKER" not in repr(read_outcome)
