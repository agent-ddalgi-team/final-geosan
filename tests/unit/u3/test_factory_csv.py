"""#320: 가상 공장 CSV를 실제 파일로 읽는다. AI·DB·웹 연결 검사는 아니다."""

import csv
import hashlib
from dataclasses import asdict
from pathlib import Path

import pytest

from geosan.config.errors import InputError
from geosan.opportunity.factory_csv import read_factory_csv

FIXTURE = Path(__file__).resolve().parents[2] / "fixtures/kicox-factory-synthetic.csv"
HEADERS = ["순번", "회사명", "단지명", "생산품", "공장주소"]
ROW = ["1", "가상공장", "", "볼트", "충청남도 아산시 가상로 1"]


def write_csv(tmp_path, rows, *, headers=HEADERS, encoding="utf-8"):
    path = tmp_path / "factories.csv"
    with path.open("w", encoding=encoding, newline="") as stream:
        writer = csv.writer(stream)
        writer.writerow(headers)
        writer.writerows(rows)
    return path


@pytest.mark.parametrize("encoding", ["utf-8", "utf-8-sig", "cp949"])
def test_supported_encodings_and_region_filter(tmp_path, encoding):
    path = tmp_path / "factories.csv"
    path.write_bytes(FIXTURE.read_text(encoding="utf-8").encode(encoding))
    result = read_factory_csv(path, regions=["충남", "대전", "세종"])
    assert result.encoding == ("CP949" if encoding == "cp949" else "UTF-8")
    assert result.raw_count == 10
    assert result.filtered_count == 3
    assert len(result.rows) == 7
    assert result.skipped_rows == ()
    assert {row.region for row in result.rows} == {"충남", "대전", "세종"}
    assert result.rows[1].complex_name is None
    assert result.rows[-3].product == "알루미늄 아노다이징"
    assert result.rows[-2].product == "소프트웨어"  # 제조업 판단은 다음 AI 단계의 책임
    assert result.rows[-1].product == ""


@pytest.mark.parametrize("region", ["충남", "충청남도", " 충남 "])
def test_full_and_short_region_names_match(tmp_path, region):
    path = write_csv(tmp_path, [ROW])
    assert read_factory_csv(path, regions=[region]).rows[0].region == "충남"


def test_address_token_not_substring_or_complex_name(tmp_path):
    rows = [
        ["1", "가상전북", "고창아산농공단지", "너트", "전북 고창군 아산면 가상길 1"],
        ["2", "가상서울", "충남단지", "너트", "서울특별시 충남로 2"],
        ["3", "가상불명", "충남단지", "너트", "충남외지역 가상길 3"],
        ROW,
    ]
    result = read_factory_csv(write_csv(tmp_path, rows), regions=["충남"])
    assert [row.company_name for row in result.rows] == ["가상공장"]
    assert result.filtered_count == 3


def test_extra_columns_are_not_retained_or_logged(tmp_path, caplog):
    # 가상 표식이며 실제 연락처·사람 이름은 넣지 않는다.
    markers = ["PRIVATE_PERSON_MARKER", "PRIVATE_FAX_MARKER", "PRIVATE_PHONE_MARKER"]
    path = write_csv(
        tmp_path, [ROW + markers], headers=HEADERS + ["대표자명", "팩스번호", "전화번호"]
    )
    result = read_factory_csv(path, regions=["충남"])
    public_row = asdict(result.rows[0])
    assert set(public_row) == {
        "company_name",
        "complex_name",
        "product",
        "address",
        "region",
        "product_hash",
    }
    for marker in markers:
        assert marker not in repr(result)
        assert marker not in caplog.text


def test_region_followed_by_comma_in_actual_file_format(tmp_path):
    """2025-12-31 원본의 세종 주소 표기. 주소는 보존하고 지역만 올바르게 읽는다."""
    path = write_csv(tmp_path, [["1", "가상세종", "", "볼트", "세종특별자치시, 가상로 1"]])
    result = read_factory_csv(path, regions=["충남", "대전", "세종"])
    assert len(result.rows) == 1
    assert result.rows[0].region == "세종"
    assert result.rows[0].address == "세종특별자치시, 가상로 1"
    assert result.filtered_count == 0


def test_identity_uses_existing_name_and_address_normalization_not_sequence(tmp_path):
    rows = [
        ["1", "(주)가상 Ａ공장", "", "볼트", "충남 아산시 가상로 1"],
        ["900", "가상 a공장", "", "너트", "충남  아산시  가상로 1"],
        ["1", "가상 a공장", "", "볼트", "충남 아산시 가상로 2"],
        ["1", "다른가상공장", "", "볼트", "충남 아산시 가상로 1"],
    ]
    result = read_factory_csv(write_csv(tmp_path, rows), regions=["충남"])
    first, same, other_address, other_name = result.rows
    assert first.identity_key == same.identity_key
    assert first.identity_key != other_address.identity_key
    assert first.identity_key != other_name.identity_key
    assert len(result.rows) == 4  # 읽기 단계에서 함부로 합치거나 지우지 않는다.
    assert first.product_hash == hashlib.sha256("볼트".encode()).hexdigest()
    assert first.product_hash != same.product_hash
    assert first.product_hash == other_address.product_hash


def test_reordered_headers_quotes_multiline_and_whitespace(tmp_path):
    path = write_csv(
        tmp_path,
        [[" 충남 아산시 가상로 1 ", " 볼트,너트\n철물 ", " ", " 가상공장 ", "1"]],
        headers=[" 공장주소 ", "생산품", "단지명", "회사명", "순번"],
    )
    row = read_factory_csv(path, regions=["충남"]).rows[0]
    assert row.company_name == "가상공장"
    assert row.product == "볼트,너트\n철물"
    assert row.complex_name is None


@pytest.mark.parametrize("missing", HEADERS)
def test_missing_header_reports_exact_required_column(tmp_path, missing):
    path = write_csv(tmp_path, [], headers=[value for value in HEADERS if value != missing])
    with pytest.raises(InputError, match=missing):
        read_factory_csv(path, regions=["충남"])


def test_duplicate_header_is_rejected(tmp_path):
    path = write_csv(tmp_path, [], headers=HEADERS + ["회사명"])
    with pytest.raises(InputError, match="같은 이름의 열"):
        read_factory_csv(path, regions=["충남"])


def test_invalid_rows_report_line_and_reason_without_values(tmp_path, caplog):
    rows = [
        ROW,
        ["2", "", "", "볼트", "충남 가상로 2"],
        ["3", "PRIVATE_MARKER", "", "볼트", ""],
        ROW[:-1],
        ROW + ["PRIVATE_MARKER"],
        [],
        ["", "", "", "", ""],
    ]
    result = read_factory_csv(write_csv(tmp_path, rows), regions=["충남"])
    assert len(result.rows) == 1
    assert result.raw_count == 7
    assert result.filtered_count == 0
    assert [item.row_no for item in result.skipped_rows] == [3, 4, 5, 6, 7, 8]
    assert [item.reason for item in result.skipped_rows] == [
        "회사명 또는 공장주소가 비어 있음",
        "회사명 또는 공장주소가 비어 있음",
        "제목과 값의 열 수가 다름",
        "제목과 값의 열 수가 다름",
        "빈 행",
        "빈 행",
    ]
    assert "PRIVATE_MARKER" not in repr(result) + caplog.text


def test_skipped_line_after_multiline_record(tmp_path):
    path = write_csv(tmp_path, [["1", "가상", "", "볼트\n너트", "충남 가상로 1"], []])
    result = read_factory_csv(path, regions=["충남"])
    assert result.skipped_rows[0].row_no == 4


def test_broken_csv_after_valid_row_rejects_entire_read(tmp_path):
    path = write_csv(tmp_path, [ROW])
    with path.open("a", encoding="utf-8") as stream:
        stream.write('2,"PRIVATE_MARKER,끝나지 않은 따옴표')
    with pytest.raises(InputError, match="CSV 형식") as error:
        read_factory_csv(path, regions=["충남"])
    assert "PRIVATE_MARKER" not in str(error.value)


def test_invalid_encoding_is_error_not_replacement_or_empty_success(tmp_path):
    path = tmp_path / "broken.csv"
    path.write_bytes(b"\xff\xfe\x00")
    with pytest.raises(InputError, match="인코딩"):
        read_factory_csv(path, regions=["충남"])


@pytest.mark.parametrize("kind", ["missing", "directory", "empty"])
def test_unreadable_or_empty_file_is_rejected(tmp_path, kind):
    path = tmp_path / "factories.csv"
    if kind == "directory":
        path.mkdir()
    elif kind == "empty":
        path.touch()
    with pytest.raises(InputError):
        read_factory_csv(path, regions=["충남"])


@pytest.mark.parametrize("regions", [[], [""], ["충남", " "], "충남"])
def test_empty_or_wrong_region_input_cannot_read_all_regions(tmp_path, regions):
    path = write_csv(tmp_path, [ROW])
    with pytest.raises(InputError, match="지역"):
        read_factory_csv(path, regions=regions)


def test_valid_empty_result_and_header_only_file_are_distinct_from_read_failure(tmp_path):
    result = read_factory_csv(write_csv(tmp_path, [ROW]), regions=["세종"])
    assert result.rows == ()
    assert result.raw_count == result.filtered_count == 1
    assert result.skipped_rows == ()
    empty = read_factory_csv(write_csv(tmp_path, []), regions=["세종"])
    assert empty.rows == ()
    assert empty.raw_count == empty.filtered_count == 0


def test_reads_every_row_without_premature_candidate_limit(tmp_path):
    path = write_csv(tmp_path, [ROW] * 75)
    result = read_factory_csv(path, regions=["충남"])
    assert len(result.rows) == result.raw_count == 75
