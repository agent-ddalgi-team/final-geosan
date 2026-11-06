"""#328: 가상 AI 응답 검사 시나리오. 실제 AI 호출·DB 저장 검사가 아니다."""

import json

from pytest_bdd import given, scenarios, then, when

from geosan.config.errors import AppError
from geosan.opportunity.candidate_judgments import (
    candidate_criteria_version,
    parse_candidate_judgments,
    select_candidates,
)

scenarios("u3/candidate_judgments.feature")

PROCESSES = {"ZINC_PLATING": "아연도금", "ANODIZING": "아노다이징"}
INDUSTRIES = ["자동차 부품", "반도체"]


def proposal(row_id, manufacturer=True, process="ZINC_PLATING"):
    return {
        "rowId": row_id,
        "isManufacturer": manufacturer,
        "processCodes": [process],
        "industries": ["자동차 부품"],
        "reason": "가상 생산품 자료에 따른 공정 제안",
        "fitLevel": "MEDIUM",
        "ownPlatingLineSuspected": False,
        "ownPlatingLineBasis": None,
    }


@given("볼트 제조업과 물류 및 다른 공정의 가상 AI 판단이 있다", target_fixture="response")
def mixed_response():
    return [proposal("bolt"), proposal("logistics", False), proposal("other", process="ANODIZING")]


@when("아연도금과 자동차 부품 조건으로 판단을 검사하고 고른다", target_fixture="selection")
def choose(response):
    parsed = parse_candidate_judgments(
        json.dumps(response),
        approved_row_ids=["bolt", "logistics", "other"],
        process_catalog=PROCESSES,
        industry_catalog=INDUSTRIES,
    )
    return parsed, select_candidates(
        parsed, process_codes=["ZINC_PLATING"], industries=["자동차 부품"]
    )


@then("볼트 제조업만 후보로 남고 탈락 판단도 원래 결과에는 남는다")
def matched(selection):
    parsed, selected = selection
    assert [row.row_id for row in selected] == ["bolt"]
    assert [row.row_id for row in parsed] == ["bolt", "logistics", "other"]


@given("승인한 두 행 중 한 행의 판단이 빠진 가상 AI 결과가 있다", target_fixture="missing_response")
def missing():
    return json.dumps([proposal("row-1")])


@when("두 행의 AI 결과를 검사한다", target_fixture="error")
def inspect_missing(missing_response):
    try:
        parse_candidate_judgments(
            missing_response,
            approved_row_ids=["row-1", "row-2"],
            process_catalog=PROCESSES,
            industry_catalog=INDUSTRIES,
        )
    except AppError as error:
        return error
    raise AssertionError("누락된 AI 판단을 성공으로 처리했습니다.")


@then("빈 후보 성공 대신 판단 실패로 알린다")
def failed(error):
    assert error.kind == "LLM_FAILED"
    assert error.status == 503


@given("같은 공정과 산업 목록을 다른 순서로 준비한다", target_fixture="criteria")
def same_criteria():
    return {
        "process_catalog": PROCESSES,
        "industry_catalog": INDUSTRIES,
        "process_codes": list(PROCESSES),
        "industries": INDUSTRIES,
        "prompt": "생산품 글로 제조업과 공정을 판단한다.",
    }


@when("판단 기준 식별값을 계산하고 지시문도 바꿔 계산한다", target_fixture="versions")
def fingerprint(criteria):
    reversed_criteria = criteria | {
        "process_catalog": dict(reversed(list(PROCESSES.items()))),
        "industry_catalog": list(reversed(INDUSTRIES)),
        "process_codes": list(reversed(PROCESSES)),
        "industries": list(reversed(INDUSTRIES)),
    }
    return (
        candidate_criteria_version(**criteria),
        candidate_criteria_version(**reversed_criteria),
        candidate_criteria_version(**(criteria | {"prompt": "바뀐 지시문"})),
    )


@then("목록 순서만 다르면 같고 지시문이 다르면 식별값이 다르다")
def compare(versions):
    assert versions[0] == versions[1]
    assert versions[0] != versions[2]


@given(
    "표면처리를 직접 하는 회사로 의심되는 가상 AI 판단이 있다", target_fixture="surface_response"
)
def surface_response():
    return [
        proposal("surface", process="ANODIZING")
        | {
            "ownPlatingLineSuspected": True,
            "ownPlatingLineBasis": "생산품: 알루미늄 아노다이징",
        }
    ]


@when("표시가 있는 판단을 검사하고 공정 조건으로 고른다", target_fixture="surface_selection")
def choose_surface(surface_response):
    parsed = parse_candidate_judgments(
        json.dumps(surface_response),
        approved_row_ids=["surface"],
        process_catalog=PROCESSES,
        industry_catalog=INDUSTRIES,
    )
    return select_candidates(parsed, process_codes=["ANODIZING"])


@then("후보를 자동 제외하지 않고 표시와 근거 및 기존 적합도를 보존한다")
def surface_is_retained(surface_selection):
    assert len(surface_selection) == 1
    row = surface_selection[0]
    assert row.own_plating_line_suspected is True
    assert row.own_plating_line_basis == "생산품: 알루미늄 아노다이징"
    assert row.is_manufacturer is True
    assert row.process_codes == ["ANODIZING"]
    assert row.fit_level == "MEDIUM"


@given("표면처리 근거에 연락처가 들어 있는 가상 AI 판단이 있다", target_fixture="unsafe_surface")
def unsafe_surface():
    return [
        proposal("safe"),
        proposal("unsafe")
        | {
            "ownPlatingLineSuspected": True,
            "ownPlatingLineBasis": "test@example.invalid로 문의",
        },
    ]


@when("연락처가 있는 근거를 포함한 두 판단을 검사한다", target_fixture="unsafe_error")
def inspect_unsafe_surface(unsafe_surface):
    try:
        parse_candidate_judgments(
            json.dumps(unsafe_surface),
            approved_row_ids=["safe", "unsafe"],
            process_catalog=PROCESSES,
            industry_catalog=INDUSTRIES,
        )
    except AppError as error:
        return error
    raise AssertionError("연락처가 있는 판단을 성공으로 처리했습니다.")


@then("전체 판단을 거부하고 오류에 연락처를 노출하지 않는다")
def unsafe_surface_is_rejected(unsafe_error):
    assert unsafe_error.kind == "LLM_FAILED"
    assert "test@example.invalid" not in str(unsafe_error) + repr(unsafe_error.to_error_body())
