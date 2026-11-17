"""#847: 상세 "한눈에 › 공정" [고치기]의 저장 창구 `POST /opportunities/{oppId}/processes`.

PM 결정(2026-11-17): 거산 쪽 확인 질문을 통화에서 묻는 대신 왼쪽 공정 줄에서 나중에 고친다.
실제 임시 DB·실제 API로 본다. 외부 호출 없음. 가상 사례만 쓴다(거산 실제 사양 아님).
"""

from sqlalchemy import select

from geosan.records.models import Bookmark
from geosan.storage.session import session_scope
from tests.unit.u1 import test_sales_confirm as support

confirm_env = support.confirm_env


def save(client, opp_id, codes, staff="park-lee", **extra):
    headers = {"X-Staff-Key": staff} if staff else {}
    return client.post(
        f"/api/v1/opportunities/{opp_id}/processes",
        json={"processCodes": codes, **extra},
        headers=headers,
    )


def test_replacing_a_confirmed_process_keeps_history_and_reevaluates(confirm_env):
    """Given 사례 파일 확정 공정(아노다이징) + AI 제안 2개 / When 아연도금만 고름
    Then 아연도금만 확정으로 남고, 아노다이징은 이력, 다시 평가, 활동 이력 "공정 변경" 한 줄."""
    client, _, mixed = confirm_env
    rows, evaluations = support.all_link_rows(mixed), support.evaluation_count(mixed)
    response = save(client, mixed, ["ZINC_PLATING"])
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["data"]["processCodes"] == ["ZINC_PLATING"]
    assert body["meta"]["reevaluated"] is True
    assert body["meta"]["hasVirtualData"] is True
    assert support.links(mixed) == {"ZINC_PLATING": ("STAFF", "CONFIRMED", "park-lee")}
    assert ("ANODIZING", "CASE_FILE") in support.superseded_codes(mixed)
    assert support.all_link_rows(mixed) == rows + 1
    assert support.evaluation_count(mixed) == evaluations + 1
    assert support._notes(mixed) == [
        "공정 변경 · 아노다이징 → 아연도금(전기아연도금) · AI 제안 1개 뺌"
    ]
    # 공정 고치기는 관심(찜)을 자동으로 켜지 않는다.
    with session_scope() as session:
        assert not list(session.scalars(select(Bookmark).where(Bookmark.opp_id == mixed)))


def test_first_confirmation_uses_the_detail_sentence(confirm_env):
    """Given 확정 공정이 없는 회사(AI 제안뿐) / When 고름 / Then "상세에서 공정 확정 · …"."""
    client, ai_only, _ = confirm_env
    response = save(client, ai_only, ["CHROMATE", "ZINC_PLATING"])
    assert response.status_code == 200, response.text
    # 저장은 고른 순서가 아니라 거산 공정 목록 순서.
    assert response.json()["data"]["processCodes"] == ["ZINC_PLATING", "CHROMATE"]
    notes = support._notes(ai_only)
    assert len(notes) == 1 and notes[0].startswith("상세에서 공정 확정 · 아연도금")


def test_same_list_changes_nothing(confirm_env):
    """Given 이미 담당자 확정 / When 같은 목록 / Then 다시 평가·이력 없이 200."""
    client, _, mixed = confirm_env
    assert save(client, mixed, ["ZINC_PLATING"]).status_code == 200
    evaluations, notes = support.evaluation_count(mixed), support._notes(mixed)
    response = save(client, mixed, ["ZINC_PLATING"])
    assert response.status_code == 200, response.text
    assert response.json()["meta"]["reevaluated"] is False
    assert support.evaluation_count(mixed) == evaluations
    assert support._notes(mixed) == notes


def test_wrong_requests_are_refused_and_nothing_changes(confirm_env):
    """빈 목록·목록 밖 코드·같은 코드 두 번은 400(칸 이름과 함께), 없는 회사는 404,
    담당자가 없으면 거부한다."""
    client, _, mixed = confirm_env
    before = support.links(mixed)
    empty = save(client, mixed, [])
    assert empty.status_code == 400
    assert [row["path"] for row in empty.json()["error"]["fields"]] == ["processCodes"]
    unknown = save(client, mixed, ["ZINC_PLATING", "NOT_A_PROCESS"])
    assert unknown.status_code == 400
    assert [row["path"] for row in unknown.json()["error"]["fields"]] == ["processCodes[1]"]
    twice = save(client, mixed, ["ZINC_PLATING", "ZINC_PLATING"])
    assert twice.status_code == 400
    assert [row["path"] for row in twice.json()["error"]["fields"]] == ["processCodes[1]"]
    assert save(client, "opp-없음", ["ZINC_PLATING"]).status_code == 404
    assert save(client, mixed, ["ZINC_PLATING"], staff=None).status_code >= 400
    assert save(client, mixed, ["ZINC_PLATING"], extra="x").status_code == 400
    assert support.links(mixed) == before
    assert support._notes(mixed) == []


def test_failed_reevaluation_cancels_the_whole_save(confirm_env, monkeypatch):
    """Given 다시 평가가 실패 / When 공정을 고침 / Then 연결·이력 모두 그대로(저장 취소)."""
    client, _, mixed = confirm_env
    before = support.links(mixed)
    support.failing_evaluation(monkeypatch)
    response = save(client, mixed, ["ZINC_PLATING"])
    assert response.status_code >= 500
    assert support.links(mixed) == before
    assert support._notes(mixed) == []
