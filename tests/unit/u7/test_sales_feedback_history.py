"""#918 영업 분석 "지난 분석": 받을 때마다 쌓인 AI 분석 저장본을 목록·한 건으로 다시 읽는다.

읽기 전용이다(AI·외부 호출·저장 없음). 외부 AI는 가짜 응답이고
모든 자료는 가상이다(거산 실제 사양 아님).
"""

from datetime import date

from sqlalchemy import select

from geosan.records.models import AnalysisFeedback
from geosan.storage.session import session_scope
from tests.unit.u7 import test_sales_feedback as support

dashboard_env = support.dashboard_env
env = support.env
URL = "/api/v1/sales-analysis/feedback/history"
STAFF = support.STAFF
VIEWER = {"X-Staff-Key": "viewer"}


def test_every_received_analysis_is_listed_newest_first(env):
    """Given 3일 전 분석 1건 + 오늘 두 번 받은 분석 / When 목록 / Then 3건, 최근 것부터, AI 0번."""
    client, _ids, ai = env
    support._saved_old_feedback(
        support._old_response("견적 전에 물량을 먼저 묻는다."),
        period_from=date(2026, 11, 1),
        period_to=date(2026, 11, 20),
    )
    first = client.post(support.URL, json={}, headers=STAFF).json()["data"]["feedback"]
    second = client.post(support.URL, json={"refresh": True}, headers=STAFF).json()["data"]
    calls = len(ai.payloads)

    response = client.get(URL, headers=VIEWER)

    assert response.status_code == 200, response.text
    items = response.json()["data"]["items"]
    assert [item["feedbackId"] for item in items][:2] == [
        second["feedback"]["feedbackId"],
        first["feedbackId"],
    ]
    old = items[2]
    assert (old["periodFrom"], old["periodTo"]) == ("2026-11-01", "2026-11-20")
    assert old["headline"] == "견적 전에 물량을 먼저 묻는다."
    assert old["nextCount"] == 1 and old["generatedBy"] == "park-lee"
    assert items[0]["headline"] == "다음 통화 전에 담당 부서를 확인한다."
    assert len(ai.payloads) == calls


def test_one_past_analysis_opens_as_it_was_received(env):
    """Given 저장된 지난 분석 / When 한 건 읽기 / Then 받았던 주장·근거 그대로, 보기 전용도 본다."""
    client, _ids, _ai = env
    # 실제 저장본처럼 앞 기간 비교 칸까지 둔다(받을 때 항상 함께 저장된다).
    support._saved_old_feedback(
        {**support._old_response("방문을 먼저 잡는다."), "comparedToPrevious": None}
    )
    with session_scope() as session:
        feedback_id = session.scalars(select(AnalysisFeedback.feedback_id)).one()

    data = client.get(f"{URL}/{feedback_id}", headers=VIEWER).json()["data"]

    assert data["feedbackId"] == feedback_id
    assert data["next"] == [{"text": "방문을 먼저 잡는다.", "evidence": ["1곳"]}]
    assert data["failure"]["where"][0]["text"] == "연결 전에 멈춘 곳이 있다."
    assert data["aiGenerated"] is True


def test_unknown_or_other_dataset_analysis_is_not_found(env):
    """Given 없는 번호·다른 자료 묶음의 저장본 / When 읽기 / Then 404, 목록에도 없다."""
    client, _ids, _ai = env
    support._saved_old_feedback(support._old_response("다른 묶음 분석"))
    with session_scope() as session:
        row = session.scalars(select(AnalysisFeedback)).one()
        row.dataset_kind = "BROCHURE"
        other_id = row.feedback_id

    assert client.get(f"{URL}/feedback-none", headers=STAFF).status_code == 404
    assert client.get(f"{URL}/{other_id}", headers=STAFF).status_code == 404
    assert client.get(URL, headers=STAFF).json()["data"]["items"] == []


def test_headline_falls_back_to_failure_reason_then_empty():
    """다음엔이 비면 실패 '왜' 첫 줄, 둘 다 비면 빈 글."""
    from geosan.api.routes.sales_analysis import _headline

    why = {"failure": {"why": [{"text": "가격 때문이다.", "evidence": ["2건"]}]}, "next": []}
    assert _headline(why) == "가격 때문이다."
    assert _headline({"failure": {"why": []}, "next": []}) == ""
