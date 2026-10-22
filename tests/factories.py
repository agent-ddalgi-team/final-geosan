"""테스트용 작은 생성 함수 (단위 테스트 지침 1장·6장).

원칙: 기준 데이터는 `examples/`의 예시 파일 그대로 쓰고, 변형이 필요할 때만 복사해 한 값만 바꾼다.
공유 가변 픽스처를 두지 않는다. 모든 데이터는 가상이며 연락처를 포함하지 않는다.
세 트랙은 여기에 함수를 "추가만" 할 수 있다(기존 함수의 뜻은 바꾸지 않는다).
"""

from __future__ import annotations

import copy
import json
from pathlib import Path
from typing import Any

EXAMPLES_DIR = Path(__file__).resolve().parent.parent / "examples"
DATA_DIR = Path(__file__).resolve().parent / "data"


def load_example_json(name: str) -> dict[str, Any]:
    """examples/<name>을 읽어 새 dict로 돌려준다(호출마다 새 객체)."""
    return json.loads((EXAMPLES_DIR / name).read_text(encoding="utf-8"))


def load_data_json(name: str) -> dict[str, Any]:
    """tests/data/<name>을 읽어 새 dict로 돌려준다."""
    return json.loads((DATA_DIR / name).read_text(encoding="utf-8"))


def apjeong_case(**overrides: Any) -> dict[str, Any]:
    """A정밀 사례 파일 사본. 예: apjeong_case(customer={"relationStatus": "UNCONFIRMED"}) 처럼
    위쪽 키만 바꾼다(중첩 값은 병합이 아니라 교체이므로 필요한 하위 키를 모두 적는다)."""
    data = load_example_json("case-apjeong.json")
    return _apply_overrides(data, overrides)


def capability_file(**overrides: Any) -> dict[str, Any]:
    """가상 검수 역량 파일 사본."""
    data = load_example_json("capability-geosan.json")
    return _apply_overrides(data, overrides)


def brochure_capability_file(**overrides: Any) -> dict[str, Any]:
    """소개서 묶음(BROCHURE) 역량 파일 사본(테스트용 가상 사본, tests/data)."""
    data = load_data_json("capability-brochure.json")
    return _apply_overrides(data, overrides)


def _apply_overrides(data: dict[str, Any], overrides: dict[str, Any]) -> dict[str, Any]:
    result = copy.deepcopy(data)
    for key, value in overrides.items():
        if key not in result:
            raise KeyError(f"예시 파일에 없는 키를 바꾸려 했습니다: {key}")
        result[key] = value
    return result


# ---------------------------------------------------------------------------
# A정밀 변형 (시나리오 S02·S04·S06·S07·S08·소개서 묶음)
# ---------------------------------------------------------------------------


def apjeong_with_relation(relation_status: str) -> dict[str, Any]:
    """고객 관계 상태만 바꾼 A정밀(S06). UNCONFIRMED면 확인일도 비운다."""
    data = apjeong_case()
    data["customer"]["relationStatus"] = relation_status
    if relation_status == "UNCONFIRMED":
        data["customer"]["relationConfirmedAt"] = None
    return data


def apjeong_without_interactions() -> dict[str, Any]:
    """2024년 견적 이력을 뺀 A정밀(S04)."""
    data = apjeong_case()
    data["interactions"] = []
    return data


def apjeong_with_extra_discovery_path() -> dict[str, Any]:
    """발견 경로를 하나 더 붙인 A정밀(S02)."""
    data = apjeong_case()
    data["discoveryPaths"].append(
        {
            "pathKind": "CERTIFICATION",
            "sourceId": "manual-case",
            "originKey": "apjeong-homepage-2026-10",
            "discoveredAt": "2026-10-19",
        }
    )
    return data


def apjeong_renamed_customer(case_id: str, name: str = "(주)A정밀") -> dict[str, Any]:
    """상호 표기만 다른(정규화하면 같은) 고객의 새 기회(S02 식별 키)."""
    data = apjeong_case()
    data["caseId"] = case_id
    data["customer"]["name"] = name
    data["discoveryPaths"][0]["originKey"] = f"{case_id}-origin"
    return data


def find_requirement(data: dict[str, Any], name: str) -> dict[str, Any]:
    for req in data["requirements"]:
        if req["name"] == name:
            return req
    raise KeyError(f"요구 '{name}'이 사례 파일에 없습니다")


def apjeong_with_requirement_stage(name: str, needed_stage: str) -> dict[str, Any]:
    """요구 하나의 필요 단계를 바꾼 A정밀(S08 단계 미확인)."""
    data = apjeong_case()
    find_requirement(data, name)["neededStage"] = needed_stage
    return data


def apjeong_with_requirement_level(name: str, req_level: str, needed_stage: str) -> dict[str, Any]:
    data = apjeong_case()
    req = find_requirement(data, name)
    req["reqLevel"] = req_level
    req["neededStage"] = needed_stage
    return data


def apjeong_with_process_link(process_code: str, applied_material: str | None) -> dict[str, Any]:
    """유일한 공정 연결과 ISO 9001 요구의 대조 공정을 바꾼 A정밀(S08 범위 불일치)."""
    data = apjeong_case()
    data["processLinks"] = [{"processCode": process_code, "appliedMaterial": applied_material}]
    find_requirement(data, "ISO 9001")["linkProcessCode"] = process_code
    for item in data["itemInputs"]:
        for ref in item["usedCapabilityRefs"]:
            ref["processCode"] = process_code
    return data


def apjeong_with_material_mismatch() -> dict[str, Any]:
    """ANODIZING 연결의 소재를 SUS(불일치)로 바꾸고 CHROMATE 연결을 더한 A정밀(S09 일부, AC5.2.4).
    ISO 9001 요구는 CHROMATE 연결에 대조한다."""
    data = apjeong_case()
    data["processLinks"] = [
        {"processCode": "ANODIZING", "appliedMaterial": "SUS"},
        {"processCode": "CHROMATE", "appliedMaterial": "AL"},
    ]
    find_requirement(data, "ISO 9001")["linkProcessCode"] = "CHROMATE"
    return data


def apjeong_with_quantity_requirement(name: str = "월 5,000개 납품") -> dict[str, Any]:
    """수량·납기 요구를 더한 A정밀(AC5.2.6)."""
    data = apjeong_case()
    data["requirements"].append(
        {
            "reqKind": "QUANTITY_DELIVERY",
            "name": name,
            "content": "월 5,000개 납품 요구 (가상)",
            "reqLevel": "REQUIRED",
            "scopeKind": "OPPORTUNITY",
            "linkProcessCode": None,
            "neededStage": "NOW",
            "dueAt": None,
            "certainty": "CONFIRMED",
            "basis": "공고 본문 (가상)",
            "question": None,
            "requiredValue": None,
            "unit": None,
            "edition": None,
        }
    )
    return data


def find_qualification(data: dict[str, Any], official_name: str) -> dict[str, Any]:
    for qual in data["qualifications"]:
        if qual["officialName"] == official_name:
            return qual
    raise KeyError(f"자격 '{official_name}'이 역량 파일에 없습니다")


def capability_with_pending_status() -> dict[str, Any]:
    """모든 검수 상태를 PENDING으로 바꾼 가상 검수 역량 파일(BR1.7 재투입 검사)."""
    data = capability_file()
    for process in data["processes"]:
        process["reviewStatus"] = "PENDING"
        for cap in process["capabilities"]:
            cap["reviewStatus"] = "PENDING"
        for rec in process["deliveryRecords"]:
            rec["reviewStatus"] = "PENDING"
    for qual in data["qualifications"]:
        qual["reviewStatus"] = "PENDING"
        for scope in qual["scopes"]:
            scope["reviewStatus"] = "PENDING"
    return data


def capability_with_scope_not_applies(official_name: str, process_code: str) -> dict[str, Any]:
    """자격 적용 범위에 NOT_APPLIES(검수 완료) 행을 더한 역량 파일(BR3.2 확인된 불일치)."""
    data = capability_file()
    find_qualification(data, official_name)["scopes"].append(
        {
            "scopeKind": "PROCESS",
            "processCode": process_code,
            "customerRef": None,
            "applicability": "NOT_APPLIES",
            "basis": "가상 검수 — 범위 밖 확인",
            "reviewStatus": "REVIEWED",
        }
    )
    return data


def capability_with_valid_to(official_name: str, valid_to: str) -> dict[str, Any]:
    data = capability_file()
    find_qualification(data, official_name)["validTo"] = valid_to
    return data


def capability_with_status(official_name: str, status: str, occurred_at: str) -> dict[str, Any]:
    """자격 상태 이력에 새 행을 더한 역량 파일(BR1.5 정지·취소)."""
    data = capability_file()
    find_qualification(data, official_name)["statuses"].append(
        {
            "status": status,
            "occurredAt": occurred_at,
            "confirmedAt": occurred_at,
            "confirmedBy": "PM(가상 검수)",
            "reason": f"가상 {status} 확인",
        }
    )
    return data


# ---------------------------------------------------------------------------
# 소개서 묶음용 실제 기업 형식 사례 (가상 회사, 연락처 없음)
# ---------------------------------------------------------------------------


def brochure_case(case_id: str, *, with_required_now: bool = True) -> dict[str, Any]:
    """실제 기업 형식(isVirtual false, datasetKind BROCHURE)의 가상 사례. A정밀 구조를 빌려 쓴다."""
    data = apjeong_case()
    data["caseId"] = case_id
    data["isVirtual"] = False
    data["datasetKind"] = "BROCHURE"
    data["description"] = f"{case_id} — 소개서 묶음 시나리오용 가상 기업"
    data["notes"] = ["소개서 묶음 시나리오용 가상 기업 — 실제 회사 아님"]
    data["customer"]["name"] = f"{case_id} 가상회사"
    data["customer"]["address"] = f"충남 (가상) {case_id}"
    data["customer"]["identityBasis"] = "가상"
    data["customer"]["relationStatus"] = "NEW_CONFIRMED"
    data["customer"]["relationConfirmedAt"] = "2026-10-20"
    data["interactions"] = []
    data["discoveryPaths"][0]["originKey"] = f"{case_id}-origin"
    data["readinessCheck"] = None
    data["expected"] = None
    for signal in data["signals"]:
        signal["agreedWindow"] = None
    if not with_required_now:
        data["requirements"] = [
            req for req in data["requirements"] if req["reqLevel"] != "REQUIRED"
        ]
    return data


def brochure_case_with_lower_material(case_id: str) -> dict[str, Any]:
    """소재 일치를 '일부 가능'(0.5)으로 낮춘 소개서 사례(E가 낮아짐, 정렬 검사용)."""
    data = brochure_case(case_id, with_required_now=False)
    for item in data["itemInputs"]:
        if item["itemCode"] == "NEW_MATERIAL":
            item["matchRate"] = "일부 가능"
    return data


def rule_engine_input(filename: str = "apjeong-input.json"):
    """기존 가상 사례를 경계 모델로 검사한 새 엔진 입력을 만든다."""
    from geosan.config.loader import load_document
    from geosan.rules.models import EvaluationInput

    return EvaluationInput.model_validate(load_document(DATA_DIR / filename).data)


def replace_contract(model: Any, **changes: Any) -> Any:
    """테스트 변형도 원래 경계 모델로 다시 검사한다(문자열 enum 포함)."""
    return type(model).model_validate(model.model_dump() | changes)
