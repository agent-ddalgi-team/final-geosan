"""#659 카드 검토사항: 목록 카드가 "무엇을 확인해야 하는지"를 평가 기록의 사실로 말한다.

앞쪽은 실제 SQLite·평가·API로 확인하고, 뒤쪽은 실제 자료로 만들기 번거로운 갈래를
평가 기록 모양의 입력으로 확인한다(규칙 계산은 다시 하지 않는 조립 함수라 가능하다).
"""

from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import event

from geosan.api.app import create_app
from geosan.api.check_points import _core_gaps, _required_points
from geosan.capability.importer import import_capability
from geosan.evaluation.models import EvaluationRun
from geosan.opportunity.importer import import_case
from geosan.storage.session import get_engine
from geosan.workflows.flow_evaluate import run_evaluation
from tests import factories
from tests.unit.u1.test_snapshot_ledger import _write

PRODUCT = "표면처리가 필요한 제품·부품 생산 근거"


def _case(case_id, *, applied_material="AL_CASTING", product_state=None, iso_stage=None):
    data = factories.apjeong_renamed_customer(case_id)
    data["processLinks"][0]["appliedMaterial"] = applied_material
    if product_state is not None:
        item = next(row for row in data["itemInputs"] if row["itemCode"] == "NEW_PRODUCT")
        item["state"] = item["certainty"] = product_state
    if iso_stage is not None:
        factories.find_requirement(data, "ISO 9001")["neededStage"] = iso_stage
    return data


@pytest.fixture
def check_env(tmp_db, tmp_path):
    """네 회사: 평소 / 적용 소재가 비어 필수조건 대기 / 핵심 항목이 약한 추정 / 요구 단계 미확인."""
    import_capability(_write(tmp_path, "cap.json", factories.capability_file()))
    cases = {
        "plain": _case("plain"),
        "no_material": _case("no-material", applied_material=None),
        "weak_product": _case("weak-product", product_state="WEAK"),
        "stage_unknown": _case("stage-unknown", iso_stage="UNKNOWN"),
    }
    ids = {
        name: import_case(_write(tmp_path, f"case-{name}.json", data)).opp_id
        for name, data in cases.items()
    }
    assert run_evaluation().ok
    with TestClient(create_app()) as client:
        yield client, ids


def _cards(client):
    body = client.get("/api/v1/opportunities").json()
    return {row["oppId"]: row for row in body["data"]}


def test_plain_company_has_no_extra_lines(check_env):
    """Given 필수조건을 통과하고 핵심 근거가 있는 회사 / When 목록 / Then 덧붙일 말이 없다."""
    client, ids = check_env
    card = _cards(client)[ids["plain"]]
    assert card["classificationCode"] != "FILTER_PENDING"
    assert card["coreEvidenceRecheck"] is False
    assert card["checkPoints"] == []
    assert card["coreEvidenceGaps"] == []


def test_pending_company_names_the_condition_that_is_not_confirmed(check_env):
    """Given 적용 소재가 비어 필수조건 대기 / When 목록 / Then 그 조건을 이름으로 말한다."""
    client, ids = check_env
    card = _cards(client)[ids["no_material"]]
    assert card["classificationCode"] == "FILTER_PENDING"
    # 서버 문장과 분류는 그대로다. 구체적인 말은 새 칸으로만 온다.
    assert card["blocker"]["text"] == "필수조건 확인 필요"
    # 공정 이름은 역량 파일에 적힌 그대로다(가상 묶음이라 "아노다이징 — 가상").
    name = next(
        row["name"]
        for row in factories.capability_file()["processes"]
        if row["code"] == "ANODIZING"
    )
    assert card["checkPoints"] == [f"{name} 적용 부품의 소재"]


def test_recheck_company_says_which_core_item_is_weak(check_env):
    """Given 핵심 항목이 약한 추정뿐인 회사 / When 목록 / Then 어느 항목이 왜 모자란지 말한다."""
    client, ids = check_env
    card = _cards(client)[ids["weak_product"]]
    assert card["coreEvidenceRecheck"] is True
    assert card["coreEvidenceGaps"] == [f"{PRODUCT}: 약한 추정뿐"]
    assert card["checkPoints"] == []


def test_specific_server_sentence_is_kept_as_is(check_env):
    """Given 서버 문장이 이미 요구 이름을 말함 / When 목록 / Then 확인할 것을 겹쳐 만들지 않는다."""
    client, ids = check_env
    card = _cards(client)[ids["stage_unknown"]]
    assert card["classificationCode"] == "FILTER_PENDING"
    assert "ISO 9001" in card["blocker"]["text"]
    assert card["checkPoints"] == []


def test_judgment_tables_are_read_once_for_the_whole_list(check_env):
    """Given 회사 4곳 / When 목록 / Then 요구 판정·항목 판정 표는 회사 수와 무관하게 한 번씩만."""
    client, _ = check_env
    counts = {"eval_requirement_check": 0, "eval_item_judgment": 0}

    def record(conn, cursor, statement, parameters, context, executemany):
        for table in counts:
            if f"FROM {table}" in statement:
                counts[table] += 1

    engine = get_engine()
    event.listen(engine, "before_cursor_execute", record)
    try:
        assert client.get("/api/v1/opportunities").status_code == 200
    finally:
        event.remove(engine, "before_cursor_execute", record)
    assert counts == {"eval_requirement_check": 1, "eval_item_judgment": 1}


# ---- 평가 기록 모양의 입력으로 확인하는 갈래 ----

ZINC = {
    "processId": "p-zinc",
    "code": "ZINC_PLATING",
    "name": "전기아연도금",
    "materialCodes": ["FE"],
    "reviewStatus": "REVIEWED",
    "datasetKind": "COMPANY_CONFIRMED",
}
ANOD = {**ZINC, "processId": "p-anod", "code": "ANODIZING", "name": "아노다이징"}


def _run(**snapshot):
    document = {
        "profile": "NEW",
        "datasetKind": "COMPANY_CONFIRMED",
        "opportunity": {"relationStatus": "NEW_CONFIRMED", "companyFilterStatus": "PASS"},
        "processLinks": [],
        "requirements": [],
        "capability": {"processes": [ZINC, ANOD], "capabilities": []},
        "ruleConfig": {
            "relationCheck": "IGNORE",
            "coreEvidence": {
                "new": {
                    "items": ["NEW_PRODUCT", "NEW_MATERIAL"],
                    "allowedStates": ["CONFIRMED", "STRONG"],
                    "requireReviewedCapability": True,
                }
            },
            "newProfileItems": [
                {"itemCode": "NEW_PRODUCT", "label": PRODUCT},
                {"itemCode": "NEW_MATERIAL", "label": "소재와 보유 공정 일치"},
            ],
        },
    }
    for key, value in snapshot.items():
        if isinstance(value, dict) and isinstance(document.get(key), dict):
            document[key] = {**document[key], **value}
        else:
            document[key] = value
    return EvaluationRun(eval_id="eval-1", input_snapshot=document)


def _link(link_id, process, material):
    return {
        "linkId": link_id,
        "processId": process["processId"],
        "processCode": process["code"],
        "appliedMaterial": material,
    }


def _check(req_id, *, result="UNKNOWN", stage="NOW", scope="OPPORTUNITY", link_id=None):
    return SimpleNamespace(
        req_id=req_id, result=result, stage_judged=stage, scope_judged=scope, link_id=link_id
    )


def _judgment(state, used=()):
    return SimpleNamespace(state=state, used_capability_ids=list(used))


def test_points_follow_the_order_relation_process_material_requirement():
    """Given 거래 관계·거산 공정·소재·요구가 모두 확인 전 / Then 그 순서로, 사실만 적는다."""
    run = _run(
        opportunity={"relationStatus": "UNCONFIRMED"},
        ruleConfig={"relationCheck": "BLOCK"},
        capability={"processes": [{**ZINC, "reviewStatus": "PENDING"}, ANOD], "capabilities": []},
        processLinks=[_link("l1", ZINC, None), _link("l2", ANOD, None)],
        requirements=[
            {"reqId": "r1", "name": "방산 납품 자격", "reqLevel": "REQUIRED", "neededStage": "NOW"},
            {"reqId": "r2", "name": "샘플 승인", "reqLevel": "REQUIRED", "neededStage": "LATER"},
            {"reqId": "r3", "name": "월 5,000개", "reqLevel": "REQUIRED", "neededStage": "NOW",
             "reqKind": "QUANTITY_DELIVERY"},
            {"reqId": "r4", "name": "RoHS", "reqLevel": "REQUIRED", "neededStage": "UNKNOWN"},
        ],
    )  # fmt: skip
    checks = [_check("r1"), _check("r2"), _check("r3"), _check("r4", stage="UNKNOWN")]
    assert _required_points(run, checks) == [
        "거래 관계",
        "거산 전기아연도금 공정(거산 확인 전)",
        "공정 2개 적용 부품의 소재",
        "방산 납품 자격",
        "RoHS(필요 시점 미확인)",
    ]


def test_relation_is_not_listed_when_the_setting_ignores_it():
    """Given 거래 관계 확인 전이지만 설정이 막지 않음 / Then 확인할 것에 넣지 않는다."""
    run = _run(opportunity={"relationStatus": "UNCONFIRMED"})
    assert _required_points(run, []) == []


def test_excluded_or_mismatched_links_are_not_listed():
    """Given 이미 제외로 정해진 공정 연결 / Then 확인 전이라고 말하지 않는다."""
    run = _run(
        processLinks=[_link("l1", ZINC, "AL"), _link("l2", ANOD, None)],
        requirements=[
            {"reqId": "r1", "name": "Nadcap", "reqLevel": "REQUIRED", "neededStage": "NOW"}
        ],
    )
    checks = [_check("r1", result="EXCLUDED", scope="PROCESS_LINK", link_id="l2")]
    assert _required_points(run, checks) == []


def test_unknown_process_and_missing_material_codes_are_named():
    """Given 역량 자료에 없는 공정과 처리 소재가 빈 공정 / Then 각각 그대로 말한다."""
    run = _run(
        capability={"processes": [{**ZINC, "materialCodes": []}], "capabilities": []},
        processLinks=[_link("l1", ZINC, "FE"), _link("l2", ANOD, "AL")],
    )
    assert _required_points(run, []) == [
        "거산 전기아연도금의 처리 소재",
        "거산 역량 자료에 없는 공정(ANODIZING)",
    ]


def test_core_gaps_say_no_evidence_without_doubling_the_word():
    """Given 핵심 항목 둘 다 근거 없음 / Then "근거 근거 없음"이 아니라 한 번만 쓴다."""
    run = _run()
    judgments = {"NEW_PRODUCT": _judgment("UNAVAILABLE"), "NEW_MATERIAL": _judgment("NO_SIGNAL")}
    assert _core_gaps(run, judgments) == [f"{PRODUCT} 없음", "소재와 보유 공정 일치 근거 없음"]


def test_core_gaps_name_the_unreviewed_capability_value():
    """Given 항목 상태는 좋은데 대조한 거산 값이 확인 전 / Then 그 값을 이름으로 말한다."""
    run = _run(
        capability={"processes": [{**ZINC, "reviewStatus": "PENDING"}, ANOD], "capabilities": []}
    )
    judgments = {
        "NEW_PRODUCT": _judgment("CONFIRMED"),
        "NEW_MATERIAL": _judgment("STRONG", used=["p-zinc"]),
    }
    assert _core_gaps(run, judgments) == ["대조한 거산 전기아연도금 값이 거산 확인 전"]


def test_core_gaps_say_when_no_capability_value_was_used():
    """Given 항목 상태는 좋은데 소재 대조에 쓴 거산 값이 없음 / Then 그 사실을 말한다."""
    run = _run()
    judgments = {"NEW_PRODUCT": _judgment("CONFIRMED"), "NEW_MATERIAL": _judgment("CONFIRMED")}
    assert _core_gaps(run, judgments) == ["대조에 쓴 거산 공정·역량 값이 없음"]


def test_core_gaps_are_empty_without_judgments():
    """Given 항목 판정이 없는 평가 기록 / Then 이유를 지어내지 않는다."""
    assert _core_gaps(_run(), {}) == []
