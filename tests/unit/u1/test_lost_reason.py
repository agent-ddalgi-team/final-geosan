"""#250: 가상 거절 이유를 실제 임시 SQLite·API에 저장한다."""

import sqlite3
from concurrent.futures import ThreadPoolExecutor

import pytest
from sqlalchemy import event, func, select

from geosan.records.models import Outcome
from geosan.storage.migrate import downgrade, upgrade_to_head
from geosan.storage.session import session_scope
from tests.unit.u1 import test_sales_records as support
from tests.unit.u1.test_sales_records import post

records_env = support.records_env

REASONS = [
    ("PRICE", "가격"),
    ("LEAD_TIME", "납기"),
    ("INCUMBENT_SUPPLIER", "기존 거래처 유지"),
    ("NO_DEMAND", "수요 없음"),
    ("QUALITY_CERT", "품질·인증 요건"),
    ("OTHER", "기타"),
]


@pytest.mark.parametrize("code,label", REASONS)
def test_lost_reason_is_saved_and_visible_without_changing_scores(records_env, code, label):
    client, opp_id = records_env
    url = f"/api/v1/opportunities/{opp_id}"
    before = client.get(url).json()["data"]
    body = {"status": "LOST", "lostReasonCode": code}
    if code == "OTHER":
        body["reason"] = "가상 조건 불일치"
    response = post(client, opp_id, "outcomes", body)
    assert response.status_code == 200, response.text
    after = client.get(url).json()["data"]
    assert after["records"]["outcome"]["lostReasonCode"] == code
    assert after["scores"] == before["scores"]
    assert after["evalId"] == before["evalId"]
    summary = client.get(url + "/activity").json()["data"][0]["summary"]
    assert summary.startswith(f"거절 · {label}")
    with session_scope() as session:
        row = session.scalar(select(Outcome))
        assert row.lost_reason_code == code
        assert row.reason == body.get("reason")


@pytest.mark.parametrize(
    "body,field",
    [
        ({"status": "LOST"}, "lostReasonCode"),
        ({"status": "LOST", "lostReasonCode": None}, "lostReasonCode"),
        ({"status": "LOST", "lostReasonCode": "UNKNOWN"}, "lostReasonCode"),
        ({"status": "LOST", "lostReasonCode": 1}, "lostReasonCode"),
        ({"status": "LOST", "lostReasonCode": "OTHER"}, "reason"),
        ({"status": "LOST", "lostReasonCode": "OTHER", "reason": "  "}, "reason"),
        ({"status": "WON", "lostReasonCode": "PRICE"}, "lostReasonCode"),
        ({"status": "INTERESTED", "lostReasonCode": None}, "lostReasonCode"),
        (
            {
                "status": "LOST",
                "lostReasonCode": "OTHER",
                "reason": "가상 연락처 test@example.invalid",
            },
            "reason",
        ),
    ],
)
def test_invalid_lost_reason_does_not_write(records_env, body, field):
    client, opp_id = records_env
    response = post(client, opp_id, "outcomes", body)
    assert response.status_code == 400
    assert field in str(response.json()["error"]["fields"])
    with session_scope() as session:
        assert session.scalar(select(func.count()).select_from(Outcome)) == 0


def test_leaving_lost_clears_current_code_and_preserves_history(records_env):
    client, opp_id = records_env
    assert (
        post(client, opp_id, "outcomes", {"status": "LOST", "lostReasonCode": "PRICE"}).status_code
        == 200
    )
    assert post(client, opp_id, "outcomes", {"status": "INTERESTED"}).status_code == 200
    detail = client.get(f"/api/v1/opportunities/{opp_id}").json()["data"]
    assert detail["records"]["outcome"]["lostReasonCode"] is None
    with session_scope() as session:
        rows = list(session.scalars(select(Outcome).order_by(Outcome.version)))
        assert [(row.status, row.lost_reason_code) for row in rows] == [
            ("LOST", "PRICE"),
            ("INTERESTED", None),
        ]


@pytest.mark.parametrize("staff", ["viewer", "unknown", ""])
def test_forbidden_staff_cannot_save_lost_reason(records_env, staff):
    client, opp_id = records_env
    assert (
        post(
            client, opp_id, "outcomes", {"status": "LOST", "lostReasonCode": "PRICE"}, staff=staff
        ).status_code
        == 403
    )
    with session_scope() as session:
        assert session.scalar(select(func.count()).select_from(Outcome)) == 0


def test_failed_lost_save_preserves_previous_outcome(records_env):
    client, opp_id = records_env
    assert post(client, opp_id, "outcomes", {"status": "INTERESTED"}).status_code == 200
    attempts = []

    def fail_insert(*_):
        attempts.append(1)
        raise RuntimeError("가상 저장 실패")

    event.listen(Outcome, "before_insert", fail_insert)
    try:
        response = post(client, opp_id, "outcomes", {"status": "LOST", "lostReasonCode": "PRICE"})
    finally:
        event.remove(Outcome, "before_insert", fail_insert)
    assert response.status_code == 500 and attempts == [1]
    with session_scope() as session:
        rows = list(session.scalars(select(Outcome)))
        assert len(rows) == 1 and rows[0].status == "INTERESTED"


def test_legacy_outcomes_survive_upgrade_and_remain_readable(records_env, tmp_db):
    client, opp_id = records_env
    assert (
        post(
            client,
            opp_id,
            "outcomes",
            {"status": "LOST", "lostReasonCode": "PRICE", "reason": "이전 가상 사유"},
        ).status_code
        == 200
    )
    assert post(client, opp_id, "outcomes", {"status": "WON"}).status_code == 200
    assert downgrade(tmp_db, "tg_001") == ["tg_001"]
    query = (
        "SELECT outcome_id, status, reason, version, created_by, created_at "
        "FROM rec_outcome ORDER BY version"
    )
    with sqlite3.connect(tmp_db) as connection:
        original = connection.execute(query).fetchall()
        assert "lost_reason_code" not in [
            row[1] for row in connection.execute("PRAGMA table_info(rec_outcome)")
        ]
    assert upgrade_to_head(tmp_db) == ["rec_007"]
    assert upgrade_to_head(tmp_db) == ["rec_007"]
    with sqlite3.connect(tmp_db) as connection:
        assert connection.execute(query).fetchall() == original
        assert connection.execute("SELECT lost_reason_code FROM rec_outcome").fetchall() == [
            (None,),
            (None,),
        ]
        assert connection.execute("PRAGMA foreign_key_check").fetchall() == []
    activity = client.get(f"/api/v1/opportunities/{opp_id}/activity").json()["data"]
    assert any(item["summary"] == "거절 · 이전 가상 사유" for item in activity)


def test_lost_reason_updates_keep_versions_and_report_previous_value(records_env):
    client, opp_id = records_env
    assert (
        post(client, opp_id, "outcomes", {"status": "LOST", "lostReasonCode": "PRICE"}).status_code
        == 200
    )
    response = post(
        client,
        opp_id,
        "outcomes",
        {"status": "LOST", "lostReasonCode": "LEAD_TIME", "expectedVersion": 0},
    )
    assert response.status_code == 200
    assert response.json()["meta"]["previousValue"]["lostReasonCode"] == "PRICE"
    with session_scope() as session:
        rows = list(session.scalars(select(Outcome).order_by(Outcome.version)))
        assert [(row.version, row.lost_reason_code) for row in rows] == [
            (1, "PRICE"),
            (2, "LEAD_TIME"),
        ]


def test_concurrent_lost_reasons_keep_both_rows(records_env):
    client, opp_id = records_env
    with ThreadPoolExecutor(max_workers=2) as pool:
        responses = list(
            pool.map(
                lambda code: post(
                    client, opp_id, "outcomes", {"status": "LOST", "lostReasonCode": code}
                ),
                ["PRICE", "NO_DEMAND"],
            )
        )
    assert all(response.status_code == 200 for response in responses)
    with session_scope() as session:
        rows = list(session.scalars(select(Outcome).order_by(Outcome.version)))
        assert [row.version for row in rows] == [1, 2]
        assert {row.lost_reason_code for row in rows} == {"PRICE", "NO_DEMAND"}


def test_other_requires_explanation_on_every_save_until_contract_changes(records_env):
    """PM 제안의 이전 설명 이어받기는 아직 약속에 없으므로 임의로 넣지 않는다."""
    client, opp_id = records_env
    assert (
        post(
            client,
            opp_id,
            "outcomes",
            {"status": "LOST", "lostReasonCode": "OTHER", "reason": "가상 조건"},
        ).status_code
        == 200
    )
    response = post(
        client,
        opp_id,
        "outcomes",
        {"status": "LOST", "lostReasonCode": "OTHER", "nextScheduleAt": "2026-11-12"},
    )
    assert response.status_code == 400
    with session_scope() as session:
        assert session.scalar(select(func.count()).select_from(Outcome)) == 1
