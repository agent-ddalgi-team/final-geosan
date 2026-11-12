"""#570: 팩토리온 원자재·업종명을 AI 후보 판단 입력에 더한다. 가상 응답 + 실제 임시 SQLite."""

import json
from datetime import date

import pytest
from sqlalchemy import select

from geosan.opportunity import candidate_pick as pick
from geosan.opportunity.candidate_judgments import (
    CANDIDATE_INPUT_FIELDS,
    candidate_criteria_version,
    candidate_product_hash,
)
from geosan.opportunity.factory_profile import company_key
from geosan.opportunity.queries import normalize_address
from geosan.opportunity.source_models import CandidateJudgment, FactoryProfile, SourceFactoryRow
from geosan.storage.base import new_id, utcnow
from geosan.storage.session import session_scope
from tests.unit.u3.test_candidate_pick import fake, run
from tests.unit.u3.test_candidate_pick import pick_context as pick_context
from tests.unit.u3.test_ingest_preview import counts
from tests.unit.u3.test_ingest_preview import judged as judged
from tests.unit.u3.test_judgment_store import public_rows as public_rows

BOLT_ADDRESS = "충남 아산시 가상길 1"


def add_profile(name, address, *, materials="철강재, 스테인레스", industry="볼트 제조업"):
    with session_scope() as session:
        session.add(
            FactoryProfile(
                profile_id=new_id("fprof"),
                source_id="factoryon-xlsx",
                file_date=date(2026, 11, 11),
                company_name=name,
                normalized_name=company_key(name),
                address=address,
                normalized_address=normalize_address(address) or "",
                region="충남",
                raw_materials=materials,
                employee_count=12,
                industry_codes=["25941"],
                industry_name=industry,
                scale="소기업",
                loaded_at=utcnow(),
                created_by="system",
                is_virtual=False,
            )
        )


def sent_rows(context):
    return {
        row["companyName"]: row for call in context["calls"] for row in json.loads(call["input"])
    }


def test_matched_factory_sends_raw_materials_and_fills_missing_industry(pick_context, monkeypatch):
    """Given 볼트 공장과 이름·주소가 같은 팩토리온 행 / When 후보 판단
    / Then 그 행만 원자재·팩토리온 업종명이 함께 가고, 안 맞은 행은 null이다."""
    add_profile("(주)가상볼트", BOLT_ADDRESS)
    fake(pick_context, monkeypatch)
    run(pick_context)
    rows = sent_rows(pick_context)
    assert rows["가상볼트"]["rawMaterials"] == "철강재, 스테인레스"
    assert rows["가상볼트"]["industryName"] == "볼트 제조업"
    assert rows["가상물류"]["rawMaterials"] is None and rows["가상물류"]["industryName"] is None
    for row in rows.values():
        assert set(row) == set(CANDIDATE_INPUT_FIELDS)


def test_example_prompt_explains_raw_materials():
    """실제 예시 지시문(pick-v3)을 채우면 입력 칸 설명에 원자재가 있고 자리표시가 남지 않는다."""
    prompt = (pick.REPO_ROOT / "examples/prompts/candidate-pick.md").read_text(encoding="utf-8")
    context = pick.PickContext(
        None, "VIRTUAL_REVIEWED", (("ZINC_PLATING", "아연도금"),), ("기타",), prompt
    )
    instructions = pick._payload(context, [], "test-model")["instructions"]
    assert "pick-v3" in instructions and "rawMaterials(공장 등록 때 적은 원자재" in instructions
    assert "{입력 칸 목록" not in instructions and "원자재만으로 fitLevel을 HIGH로" in instructions


def test_registered_industry_name_wins_over_factoryon(pick_context, monkeypatch):
    """Given 공장등록 조회 업종명이 이미 있는 행 / Then 그 업종명을 그대로 보낸다."""
    add_profile("가상볼트", BOLT_ADDRESS, industry="다른 업종")
    with session_scope() as session:
        session.get(SourceFactoryRow, pick_context["ids"][0]).industry_name = "금속가공업"
    fake(pick_context, monkeypatch)
    run(pick_context)
    assert sent_rows(pick_context)["가상볼트"]["industryName"] == "금속가공업"


def test_same_name_in_other_city_is_not_attached(pick_context, monkeypatch):
    """Given 이름만 같고 다른 시·군 주소의 팩토리온 행 / Then 원자재를 붙이지 않는다."""
    add_profile("가상볼트", "충남 천안시 다른길 9")
    fake(pick_context, monkeypatch)
    run(pick_context)
    assert sent_rows(pick_context)["가상볼트"]["rawMaterials"] is None


@pytest.mark.parametrize("change", ["materials", "none"])
def test_changed_materials_rejudge_only_that_row(pick_context, monkeypatch, change):
    """Given 원자재를 넣고 판단한 두 행 / When 그 원자재만 바뀜 / Then 그 행만 다시 판단한다."""
    add_profile("가상볼트", BOLT_ADDRESS)
    fake(pick_context, monkeypatch)
    run(pick_context)
    if change == "materials":
        with session_scope() as session:
            session.scalar(select(FactoryProfile)).raw_materials = "알루미늄"
    run(pick_context)
    assert len(pick_context["calls"]) == (3 if change == "materials" else 2)
    with session_scope() as session:
        bolt = session.get(SourceFactoryRow, pick_context["ids"][0])
        latest = session.scalars(
            select(CandidateJudgment)
            .where(CandidateJudgment.row_id == bolt.row_id)
            .order_by(CandidateJudgment.created_at.desc())
        ).first()
    materials = "알루미늄" if change == "materials" else "철강재, 스테인레스"
    assert latest.product_hash == candidate_product_hash("볼트", "볼트 제조업", materials)


def test_preview_counts_use_the_same_fingerprint(judged):
    """Given 판단이 저장된 뒤 볼트 공장에 원자재가 새로 붙음 / When 맞는 공장 수 줄
    / Then 그 공장은 판단 전으로 센다(실행 흐름의 재사용 기준과 같음)."""
    assert counts().unjudged_count == 0
    add_profile("가상볼트", BOLT_ADDRESS)
    result = counts()
    assert (result.matched_count, result.unjudged_count) == (0, 1)


def test_fingerprint_without_materials_keeps_the_old_value():
    """원자재가 없는 행은 예전 두 값 지문 그대로다. 원자재가 있으면 다르다."""
    assert candidate_product_hash("볼트", None) == candidate_product_hash("볼트", None, None)
    assert candidate_product_hash("볼트", None) != candidate_product_hash("볼트", None, "철")


def test_input_field_list_change_moves_criteria_version():
    """원자재 칸이 더해져 판단 기준 버전이 바뀐다 → 저장된 판단은 다음 찾기에서 다시 판단."""
    args = {"process_catalog": {"A": "가상공정"}, "industry_catalog": ["가상산업"], "prompt": "p"}
    old_fields = [field for field in CANDIDATE_INPUT_FIELDS if field != "rawMaterials"]
    assert "rawMaterials" in CANDIDATE_INPUT_FIELDS
    assert candidate_criteria_version(**args) != candidate_criteria_version(
        **args, input_fields=old_fields
    )
