"""#328: 가상 AI 결과의 전체 행 검증·조건 선택·기준 변경 검사. 외부 호출 없음."""

import copy
import json

import pytest

from geosan.config.errors import AppError, InputError
from geosan.opportunity.candidate_judgments import (
    candidate_criteria_version,
    parse_candidate_judgments,
    select_candidates,
)

PROCESSES = {"ZINC_PLATING": "아연도금", "ANODIZING": "아노다이징"}
INDUSTRIES = ["자동차 부품", "반도체"]


def judgment(row_id="row-1", **changes):
    value = {
        "rowId": row_id,
        "isManufacturer": True,
        "processCodes": ["ZINC_PLATING"],
        "industries": ["자동차 부품"],
        "reason": "볼트를 만드는 회사로 아연도금 수요를 확인할 수 있음",
        "fitLevel": "HIGH",
    }
    return value | changes


def parse(rows, ids=("row-1",)):
    return parse_candidate_judgments(
        json.dumps(rows, ensure_ascii=False),
        approved_row_ids=ids,
        process_catalog=PROCESSES,
        industry_catalog=INDUSTRIES,
    )


def criteria(**changes):
    return {
        "process_catalog": dict(PROCESSES),
        "industry_catalog": list(INDUSTRIES),
        "process_codes": ["ZINC_PLATING", "ANODIZING"],
        "industries": list(INDUSTRIES),
        "prompt": "제조업 여부와 필요한 공정을 공개 생산품 글에서 판단한다.",
    } | changes


def test_valid_judgments_return_in_approved_order_without_changing_proposals():
    rows = [judgment("row-2", fitLevel="LOW"), judgment()]
    result = parse(rows, ["row-1", "row-2"])
    assert [item.row_id for item in result] == ["row-1", "row-2"]
    assert [item.fit_level for item in result] == ["HIGH", "LOW"]
    assert result[0].model_dump(by_alias=True) == rows[1]
    assert result[1].model_dump(by_alias=True) == rows[0]


@pytest.mark.parametrize(
    "rows",
    [[], [judgment("row-2")], [judgment(), judgment()], [judgment(), judgment("row-extra")]],
)
def test_missing_duplicate_extra_or_unknown_rows_reject_whole_result(rows):
    with pytest.raises(AppError) as error:
        parse(rows)
    assert error.value.status == 503
    assert error.value.kind == "LLM_FAILED"


def test_one_missing_judgment_does_not_turn_into_nonmanufacturer():
    with pytest.raises(AppError):
        parse([judgment()], ["row-1", "row-2"])


@pytest.mark.parametrize(
    "changes",
    [
        {"isManufacturer": 1},
        {"isManufacturer": "true"},
        {"isManufacturer": None},
        {"rowId": 1},
        {"processCodes": "ZINC_PLATING"},
        {"processCodes": [1]},
        {"processCodes": ["UNKNOWN"]},
        {"processCodes": ["ZINC_PLATING", "ZINC_PLATING"]},
        {"industries": ["설정 밖 산업"]},
        {"industries": ["반도체", "반도체"]},
        {"industries": None},
        {"fitLevel": "VERY_HIGH"},
        {"fitLevel": None},
        {"reason": " "},
        {"reason": ""},
        {"extra": "PRIVATE_MARKER"},
    ],
)
def test_invalid_types_or_values_are_not_coerced_or_silently_removed(changes):
    with pytest.raises(AppError):
        parse([judgment(**changes)])


@pytest.mark.parametrize(
    "field", ["rowId", "isManufacturer", "processCodes", "industries", "reason", "fitLevel"]
)
def test_every_contract_field_is_required(field):
    value = judgment()
    del value[field]
    with pytest.raises(AppError):
        parse([value])


@pytest.mark.parametrize(
    "raw",
    [
        "not json PRIVATE_MARKER",
        "{}",
        "null",
        "[",
        '{"rows":[]}',
        None,
        '[{"rowId":"row-1","rowId":"row-2"}]',
    ],
)
def test_bad_json_is_not_empty_success_and_does_not_expose_response(raw, caplog):
    with pytest.raises(AppError) as error:
        parse_candidate_judgments(
            raw, approved_row_ids=["row-1"], process_catalog=PROCESSES, industry_catalog=INDUSTRIES
        )
    assert (
        "PRIVATE_MARKER" not in str(error.value) + repr(error.value.to_error_body()) + caplog.text
    )
    assert error.value.__suppress_context__ is True


@pytest.mark.parametrize(
    "reason",
    ["test@example.invalid로 문의", "가상번호 010-0000-0000", "가상 ＴＥＳＴ＠example.invalid"],
)
def test_contact_in_reason_rejects_all_rows_without_echo(reason, caplog):
    with pytest.raises(AppError) as error:
        parse([judgment(), judgment("row-2", reason=reason)], ["row-1", "row-2"])
    assert reason not in str(error.value) + repr(error.value.to_error_body()) + caplog.text


@pytest.mark.parametrize("ids", [[], ["row-1", "row-1"], [""], [None], "row-1"])
def test_invalid_approved_context_is_input_error(ids):
    with pytest.raises(InputError):
        parse([judgment()], ids)


@pytest.mark.parametrize(
    "processes,industries",
    [
        ({}, INDUSTRIES),
        ({"": "공정"}, INDUSTRIES),
        ({"P": ""}, INDUSTRIES),
        ({"P": 1}, INDUSTRIES),
        ([], INDUSTRIES),
        (PROCESSES, ["반도체", "반도체"]),
    ],
)
def test_invalid_catalog_is_not_treated_as_ai_failure(processes, industries):
    with pytest.raises(InputError):
        parse_candidate_judgments(
            "[]", approved_row_ids=["row-1"], process_catalog=processes, industry_catalog=industries
        )


def test_filter_requires_manufacturer_and_process_and_optional_industry():
    rows = [
        judgment("match"),
        judgment("logistics", isManufacturer=False),
        judgment("other-process", processCodes=["ANODIZING"]),
        judgment("other-industry", industries=["반도체"]),
        judgment("unknown-process", processCodes=[]),
        judgment("unknown-industry", industries=[]),
        judgment("low-fit", fitLevel="LOW", reason="표면처리 직접 수행 여부 확인 필요"),
    ]
    parsed = parse(rows, [row["rowId"] for row in rows])
    selected = select_candidates(parsed, process_codes=["ZINC_PLATING"], industries=["자동차 부품"])
    assert [item.row_id for item in selected] == ["match", "low-fit"]
    all_industries = select_candidates(parsed, process_codes=["ZINC_PLATING"])
    assert [item.row_id for item in all_industries] == [
        "match",
        "other-industry",
        "unknown-industry",
        "low-fit",
    ]
    assert len(parsed) == 7  # 탈락 판단도 후속 저장·재사용을 위해 원래 결과에 남는다.


def test_no_matching_process_is_valid_empty_selection():
    parsed = parse([judgment(isManufacturer=False, processCodes=[], industries=[])])
    assert select_candidates(parsed, process_codes=["ZINC_PLATING"]) == ()


def test_multiple_selections_match_any_within_each_condition():
    parsed = parse([judgment(processCodes=["ANODIZING"], industries=["반도체"])])
    assert select_candidates(parsed, process_codes=list(PROCESSES), industries=INDUSTRIES) == parsed


def test_selection_does_not_accept_empty_process_condition():
    with pytest.raises(InputError):
        select_candidates((), process_codes=[])


def test_criteria_fingerprint_ignores_order_and_does_not_mutate_inputs():
    original = criteria()
    before = copy.deepcopy(original)
    version = candidate_criteria_version(**original)
    reordered = criteria(
        process_catalog=dict(reversed(list(PROCESSES.items()))),
        industry_catalog=list(reversed(INDUSTRIES)),
        process_codes=list(reversed(list(PROCESSES))),
        industries=list(reversed(INDUSTRIES)),
    )
    assert version == candidate_criteria_version(**reordered)
    assert len(version) == 64
    assert original == before


@pytest.mark.parametrize(
    "change",
    [
        {"process_catalog": PROCESSES | {"ZINC_PLATING": "전기아연도금"}},
        {"process_catalog": PROCESSES | {"NEW_PROCESS": "새 공정"}},
        {"industry_catalog": INDUSTRIES + ["새 산업"]},
        {"process_codes": ["ZINC_PLATING"]},
        {"industries": []},
        {"prompt": "변경된 판단 지시문"},
    ],
)
def test_changed_criteria_cannot_reuse_old_fingerprint(change):
    assert candidate_criteria_version(**criteria()) != candidate_criteria_version(
        **criteria(**change)
    )


@pytest.mark.parametrize(
    "change",
    [
        {"process_codes": ["UNKNOWN"]},
        {"industries": ["UNKNOWN"]},
        {"prompt": " "},
        {"prompt": None},
    ],
)
def test_invalid_criteria_is_not_fingerprinted(change):
    with pytest.raises(InputError):
        candidate_criteria_version(**criteria(**change))
