"""#242: 카드가 실제 SQLite의 최신 영업 단계만 회사별로 돌려준다."""

from datetime import UTC, datetime

import pytest
from sqlalchemy import select

from geosan.records.models import Outcome
from geosan.rules.codes import OutcomeStatus
from geosan.storage.session import session_scope
from tests.unit.u1.test_industry_filter import industry_env  # noqa: F401
from tests.unit.u1.test_sales_records import (
    post,
    records_env,  # noqa: F401
)


def test_card_without_outcome_returns_null(records_env):  # noqa: F811
    """Given 기록 없는 기회 / When 목록 조회 / Then 영업 단계는 명시적인 null이다."""
    client, opp_id = records_env
    response = client.get("/api/v1/opportunities")
    assert response.status_code == 200
    card = response.json()["data"][0]
    assert card["oppId"] == opp_id
    assert "outcome" in card["records"]
    assert card["records"]["outcome"] is None


@pytest.mark.parametrize("status", list(OutcomeStatus))
def test_card_returns_latest_version_of_each_stage(records_env, status):  # noqa: F811
    """Given 이전 기록의 시각이 더 늦음 / When 단계 추가 / Then 최신 버전을 상세와 같이 표시한다."""
    client, opp_id = records_env
    before = client.get("/api/v1/opportunities").json()["data"][0]
    assert post(client, opp_id, "outcomes", {"status": "IN_PROGRESS"}).status_code == 200
    with session_scope() as session:
        previous = session.scalar(select(Outcome).where(Outcome.opp_id == opp_id))
        previous.created_at = datetime(2099, 1, 1, tzinfo=UTC)
    saved = post(
        client,
        opp_id,
        "outcomes",
        {
            "status": status,
            "reason": "가상 시험 사유",
            "nextScheduleNote": "가상 일정",
            **({"lostReasonCode": "OTHER"} if status == "LOST" else {}),
        },
    )
    assert saved.status_code == 200
    response = client.get("/api/v1/opportunities", params={"stage": status})
    assert response.status_code == 200
    card = response.json()["data"][0]
    assert card["records"]["outcome"] == {"status": status}
    detail = client.get(f"/api/v1/opportunities/{opp_id}").json()["data"]
    assert detail["records"]["outcome"]["status"] == status
    for key in ("oppId", "rank", "scoreDisplay", "scoreS", "classificationCode", "evalId"):
        assert card[key] == before[key]
    assert card["records"]["opinion"] == before["records"]["opinion"]
    # 기록을 남기면 같은 저장 안에서 관심이 켜진다(#356 자동 관심). 그 밖의 카드 값은 그대로다.
    assert before["records"]["bookmark"] is None
    assert card["records"]["bookmark"]["active"] is True


def test_card_outcomes_do_not_leak_between_companies_or_pages(industry_env):  # noqa: F811
    """Given 단계가 서로 다른 세 회사 / When 목록·다음 쪽 조회 / Then 각 기회의 단계만 보인다."""
    client, ids = industry_env
    assert post(client, ids[0], "outcomes", {"status": "IN_PROGRESS"}).status_code == 200
    second = {"status": "SAMPLE_OR_REGISTRATION_APPROVED"}
    assert post(client, ids[1], "outcomes", second).status_code == 200
    expected = {ids[0]: {"status": "IN_PROGRESS"}, ids[1]: second, ids[2]: None}
    whole = client.get("/api/v1/opportunities").json()
    assert len(whole["data"]) == whole["meta"]["total"] == 3
    for page, card in enumerate(whole["data"], start=1):
        assert card["records"]["outcome"] == expected[card["oppId"]]
        paged = client.get("/api/v1/opportunities", params={"pageSize": 1, "page": page}).json()
        assert paged["data"] == [card]
