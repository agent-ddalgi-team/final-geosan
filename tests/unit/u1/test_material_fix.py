"""#958: 상세 "한눈에 › 소재" [고치기]와 꼬리 질문 소재 답 저장(PM 결정 2026-11-26).

소재는 회사당 하나이고 확정 공정 모두에 같은 소재를 적용한다.
바뀐 행은 이력으로 남기고 다시 평가한다.
실제 임시 DB·실제 API로 본다. 외부 호출 없음. 가상 사례만 쓴다(거산 실제 사양 아님).
"""

import json
from pathlib import Path

from sqlalchemy import select

from geosan.api.process_catalog import MATERIAL_NAMES
from geosan.opportunity.models import OppProcessLink
from geosan.records.models import Bookmark
from geosan.storage.session import session_scope
from tests.unit.u1 import test_sales_confirm as support
from tests.unit.u1 import test_sales_questions as questions
from tests.unit.u1 import test_sales_records as records

confirm_env = support.confirm_env
MATERIAL = "CONFIRM_MATERIAL"


def save(client, opp_id, material, staff="park-lee", **extra):
    headers = {"X-Staff-Key": staff} if staff else {}
    return client.post(
        f"/api/v1/opportunities/{opp_id}/material",
        json={"material": material, **extra},
        headers=headers,
    )


def materials(opp_id):
    """살아 있는 확정 연결을 {공정 코드: (소재, 출처)}로."""
    with session_scope() as session:
        return {
            row.process_code: (row.applied_material, row.source)
            for row in session.scalars(
                select(OppProcessLink).where(
                    OppProcessLink.opp_id == opp_id,
                    OppProcessLink.superseded_at.is_(None),
                    OppProcessLink.state == "CONFIRMED",
                )
            )
        }


def link_results(client, opp_id):
    return {
        row["processCode"]: row["result"] for row in support.detail(client, opp_id)["processLinks"]
    }


def test_config_lists_geosan_materials_in_process_order(confirm_env):
    """Given 가상 역량 파일 / When 화면 설정 조회
    Then 처리 소재를 공정 순서로 한 번씩, 쉬운 말과 함께."""
    client, _, _ = confirm_env
    options = client.get("/api/v1/config/ui").json()["data"]["materialOptions"]
    assert options == [
        {"code": "FE", "name": "철"},
        {"code": "AL", "name": "알루미늄"},
        {"code": "CU", "name": "구리"},
        {"code": "AL_CASTING", "name": "알루미늄 주물"},
        {"code": "ZN", "name": "아연"},
        {"code": "SUS", "name": "스테인리스"},
    ]


def test_changing_the_material_keeps_history_reevaluates_and_follows_the_rule(confirm_env):
    """Given 사례 파일 확정 아노다이징(알루미늄 주물) / When 소재를 철로 고침
    Then 담당자 행(철)이 살고 옛 행은 이력, 다시 평가, 활동 이력 "소재 변경" 한 줄,
    거산이 철을 아노다이징하지 않으므로 그 연결은 제외로 판정된다(부록 F 규칙 그대로)."""
    client, _, mixed = confirm_env
    assert materials(mixed) == {"ANODIZING": ("AL_CASTING", "CASE_FILE")}
    rows, evaluations = support.all_link_rows(mixed), support.evaluation_count(mixed)
    response = save(client, mixed, "FE")
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["data"] == {"material": "FE", "processCodes": ["ANODIZING"]}
    assert body["meta"]["reevaluated"] is True
    assert materials(mixed) == {"ANODIZING": ("FE", "STAFF")}
    assert ("ANODIZING", "CASE_FILE") in support.superseded_codes(mixed)
    assert support.all_link_rows(mixed) == rows + 1
    assert support.evaluation_count(mixed) == evaluations + 1
    assert support._notes(mixed) == ["소재 변경 · 알루미늄 주물 → 철"]
    assert link_results(client, mixed)["ANODIZING"] == "EXCLUDED"
    # 소재 고치기는 관심(찜)을 자동으로 켜지 않는다.
    with session_scope() as session:
        assert not list(session.scalars(select(Bookmark).where(Bookmark.opp_id == mixed)))


def test_same_material_changes_nothing(confirm_env):
    """Given 이미 알루미늄 주물 / When 같은 소재 / Then 다시 평가·이력 없이 200."""
    client, _, mixed = confirm_env
    evaluations = support.evaluation_count(mixed)
    response = save(client, mixed, "AL_CASTING")
    assert response.status_code == 200, response.text
    assert response.json()["meta"]["reevaluated"] is False
    assert support.evaluation_count(mixed) == evaluations
    assert support._notes(mixed) == []


def test_wrong_requests_are_refused_and_nothing_changes(confirm_env):
    """목록 밖 코드·확정 공정이 없는 회사는 400(칸 material), 없는 회사는 404,
    담당자가 없거나 모르는 칸이 있으면 거부한다."""
    client, ai_only, mixed = confirm_env
    before = materials(mixed)
    unknown = save(client, mixed, "WOOD")
    assert unknown.status_code == 400
    assert [row["path"] for row in unknown.json()["error"]["fields"]] == ["material"]
    no_process = save(client, ai_only, "AL")
    assert no_process.status_code == 400
    assert no_process.json()["error"]["message"] == "공정을 먼저 골라 주세요."
    assert [row["path"] for row in no_process.json()["error"]["fields"]] == ["material"]
    assert save(client, "opp-없음", "AL").status_code == 404
    assert save(client, mixed, "AL", staff=None).status_code >= 400
    assert save(client, mixed, "AL", extra="x").status_code == 400
    assert materials(mixed) == before
    assert materials(ai_only) == {}
    assert support._notes(mixed) == [] and support._notes(ai_only) == []


def test_failed_reevaluation_cancels_the_whole_save(confirm_env, monkeypatch):
    """Given 다시 평가가 실패 / When 소재를 고침 / Then 연결·이력 모두 그대로(저장 취소)."""
    client, _, mixed = confirm_env
    before = materials(mixed)
    support.failing_evaluation(monkeypatch)
    response = save(client, mixed, "AL")
    assert response.status_code >= 500
    assert materials(mixed) == before
    assert support._notes(mixed) == []


def test_first_material_on_a_new_process_uses_the_detail_sentence(confirm_env):
    """Given AI 제안뿐인 회사에서 공정을 먼저 확정(소재 없음) / When 소재를 고름
    Then "상세에서 소재 확정 · 알루미늄"으로 남는다."""
    client, ai_only, _ = confirm_env
    assert (
        client.post(
            f"/api/v1/opportunities/{ai_only}/processes",
            json={"processCodes": ["ZINC_PLATING"]},
            headers={"X-Staff-Key": "park-lee"},
        ).status_code
        == 200
    )
    response = save(client, ai_only, "AL")
    assert response.status_code == 200, response.text
    assert materials(ai_only) == {"ZINC_PLATING": ("AL", "STAFF")}
    assert support._notes(ai_only)[-1] == "상세에서 소재 확정 · 알루미늄"


def test_a_new_process_takes_the_company_material(confirm_env):
    """Given 소재가 정해진 회사(알루미늄 주물) / When 공정 [고치기]로 크로메이트를 더함
    Then 새 확정 행도 같은 소재다(회사당 소재 하나)."""
    client, _, mixed = confirm_env
    response = client.post(
        f"/api/v1/opportunities/{mixed}/processes",
        json={"processCodes": ["ANODIZING", "CHROMATE"]},
        headers={"X-Staff-Key": "park-lee"},
    )
    assert response.status_code == 200, response.text
    assert materials(mixed)["CHROMATE"] == ("AL_CASTING", "STAFF")


def _contact(client, opp_id, *answers):
    return records.post(client, opp_id, "outcomes", questions.contact(answers=answers))


def test_material_answer_in_a_contact_saves_the_material(confirm_env):
    """Given 확정 공정이 있는 회사 / When 통화 기록에서 "부품 소재 = 알루미늄"
    Then 접촉과 함께 소재가 저장되고 다시 평가되며, 질문은 더 열려 있지 않다."""
    client, _, mixed = confirm_env
    evaluations = support.evaluation_count(mixed)
    response = _contact(client, mixed, (MATERIAL, "AL"))
    assert response.status_code == 200, response.text
    assert materials(mixed) == {"ANODIZING": ("AL", "STAFF")}
    assert support.evaluation_count(mixed) == evaluations + 1
    assert support._notes(mixed)[-1] == "소재 변경 · 알루미늄 주물 → 알루미늄"
    assert MATERIAL not in questions.step_of(client, mixed)["openQuestions"]


def test_process_and_material_in_one_contact_apply_in_order(confirm_env):
    """Given 확정 공정이 없는 회사 / When 한 통화에서 공정(아연도금)과 소재(철)를 함께 답함
    Then 공정을 먼저 확정한 뒤 그 공정에 소재가 들어간다."""
    client, ai_only, _ = confirm_env
    response = _contact(client, ai_only, ("CONFIRM_PROCESS", "ZINC_PLATING"), (MATERIAL, "FE"))
    assert response.status_code == 200, response.text
    assert materials(ai_only) == {"ZINC_PLATING": ("FE", "STAFF")}


def test_material_answer_without_a_process_is_kept_only_as_an_answer(confirm_env):
    """Given 확정 공정이 없는 회사 / When 소재만 답함
    Then 접촉은 저장되고 소재 칸은 그대로(거부 안 함)."""
    client, ai_only, _ = confirm_env
    before = support.outcome_count(ai_only)
    response = _contact(client, ai_only, (MATERIAL, "AL"))
    assert response.status_code == 200, response.text
    assert support.outcome_count(ai_only) == before + 1
    assert materials(ai_only) == {}


def test_two_materials_are_refused(confirm_env):
    """Given 소재 질문 / When 두 개를 고름
    Then 400(answers[1] "소재는 하나만"), 아무것도 안 바뀜."""
    client, _, mixed = confirm_env
    before = (support.outcome_count(mixed), materials(mixed))
    response = _contact(client, mixed, (MATERIAL, "AL"), (MATERIAL, "FE"))
    assert response.status_code == 400
    fields = response.json()["error"]["fields"]
    assert [row["path"] for row in fields] == ["answers[1]"]
    assert fields[0]["message"] == "소재는 하나만 고를 수 있습니다."
    assert (support.outcome_count(mixed), materials(mixed)) == before


def test_every_material_in_the_capability_files_has_a_plain_name():
    """#964 Given 예시 역량 파일들(가상·회사소개서) / When 처리 소재 코드를 모음
    Then 모두 쉬운 이름이 있다(브로슈어의 MG·TI·HF·NB가 코드 그대로 보이던 문제)."""
    root = Path(__file__).resolve().parents[3] / "examples"
    codes = {
        code
        for path in sorted(root.glob("capability*.json"))
        for process in json.loads(path.read_text(encoding="utf-8")).get("processes", [])
        for code in process.get("materialCodes") or []
    }
    assert {"MG", "TI", "HF", "NB"} <= codes
    assert sorted(codes - MATERIAL_NAMES.keys()) == []
