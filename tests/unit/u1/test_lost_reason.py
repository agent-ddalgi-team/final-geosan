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
        ({"status": "IN_PROGRESS", "lostReasonCode": None}, "lostReasonCode"),
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
    assert post(client, opp_id, "outcomes", {"status": "IN_PROGRESS"}).status_code == 200
    detail = client.get(f"/api/v1/opportunities/{opp_id}").json()["data"]
    assert detail["records"]["outcome"]["lostReasonCode"] is None
    with session_scope() as session:
        rows = list(session.scalars(select(Outcome).order_by(Outcome.version)))
        assert [(row.status, row.lost_reason_code) for row in rows] == [
            ("LOST", "PRICE"),
            ("IN_PROGRESS", None),
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
    assert post(client, opp_id, "outcomes", {"status": "IN_PROGRESS"}).status_code == 200
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
        assert len(rows) == 1 and rows[0].status == "IN_PROGRESS"


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
    assert upgrade_to_head(tmp_db) == ["src_004"]
    assert upgrade_to_head(tmp_db) == ["src_004"]
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


@pytest.mark.parametrize("code,label", REASONS)
def test_same_lost_code_inherits_previous_explanation(records_env, code, label):
    """PM #250 확정: 같은 거절 이유로 일정만 저장하면 이전 설명을 이어받는다."""
    client, opp_id = records_env
    assert (
        post(
            client,
            opp_id,
            "outcomes",
            {"status": "LOST", "lostReasonCode": code, "reason": "가상 조건"},
        ).status_code
        == 200
    )
    response = post(
        client,
        opp_id,
        "outcomes",
        {"status": "LOST", "lostReasonCode": code, "nextScheduleAt": "2026-11-12"},
    )
    assert response.status_code == 200, response.text
    with session_scope() as session:
        rows = list(session.scalars(select(Outcome).order_by(Outcome.version)))
        assert len(rows) == 2 and [row.reason for row in rows] == ["가상 조건", "가상 조건"]
        assert rows[1].next_schedule_at.isoformat() == "2026-11-12"
    activity = client.get(f"/api/v1/opportunities/{opp_id}/activity").json()["data"]
    assert all(
        f"거절 · {label}" in row["summary"] and "가상 조건" in row["summary"] for row in activity
    )


@pytest.mark.parametrize("empty", [None, "", "  "])
def test_explicit_empty_explanation_is_inherited(records_env, empty):
    client, opp_id = records_env
    assert (
        post(
            client,
            opp_id,
            "outcomes",
            {"status": "LOST", "lostReasonCode": "OTHER", "reason": "가상 이전 설명"},
        ).status_code
        == 200
    )
    assert (
        post(
            client,
            opp_id,
            "outcomes",
            {"status": "LOST", "lostReasonCode": "OTHER", "reason": empty},
        ).status_code
        == 200
    )
    with session_scope() as session:
        latest = session.scalar(select(Outcome).order_by(Outcome.version.desc()))
        assert latest.reason == "가상 이전 설명"


def test_inheritance_uses_latest_lost_row_and_keeps_explicit_new_text(records_env):
    client, opp_id = records_env
    for text in ("가상 첫 설명", "가상 고친 설명", None):
        assert (
            post(
                client,
                opp_id,
                "outcomes",
                {"status": "LOST", "lostReasonCode": "OTHER", "reason": text},
            ).status_code
            == 200
        )
    with session_scope() as session:
        rows = list(session.scalars(select(Outcome).order_by(Outcome.version)))
        assert [row.reason for row in rows] == ["가상 첫 설명", "가상 고친 설명", "가상 고친 설명"]


def test_changed_lost_code_does_not_inherit_an_older_matching_code(records_env):
    client, opp_id = records_env
    for code in ("OTHER", "PRICE"):
        assert (
            post(
                client,
                opp_id,
                "outcomes",
                {"status": "LOST", "lostReasonCode": code, "reason": "가상 기존 설명"},
            ).status_code
            == 200
        )
    rejected = post(client, opp_id, "outcomes", {"status": "LOST", "lostReasonCode": "OTHER"})
    assert rejected.status_code == 400
    assert "기타를 고르면 이유를 적어 주세요" in rejected.text
    with session_scope() as session:
        assert session.scalar(select(func.count()).select_from(Outcome)) == 2


def test_changed_optional_code_does_not_copy_previous_explanation(records_env):
    client, opp_id = records_env
    assert (
        post(
            client,
            opp_id,
            "outcomes",
            {"status": "LOST", "lostReasonCode": "OTHER", "reason": "가상 기타 설명"},
        ).status_code
        == 200
    )
    assert (
        post(client, opp_id, "outcomes", {"status": "LOST", "lostReasonCode": "PRICE"}).status_code
        == 200
    )
    with session_scope() as session:
        latest = session.scalar(select(Outcome).order_by(Outcome.version.desc()))
        assert latest.lost_reason_code == "PRICE" and latest.reason is None


def test_inherited_explanation_cannot_bypass_contact_validation(records_env):
    client, opp_id = records_env
    assert (
        post(
            client,
            opp_id,
            "outcomes",
            {"status": "LOST", "lostReasonCode": "OTHER", "reason": "가상 설명"},
        ).status_code
        == 200
    )
    with session_scope() as session:
        session.scalar(select(Outcome)).reason = "가상 이전 연락처 test@example.invalid"
    rejected = post(client, opp_id, "outcomes", {"status": "LOST", "lostReasonCode": "OTHER"})
    assert rejected.status_code == 400 and "test@example.invalid" not in rejected.text
    with session_scope() as session:
        assert session.scalar(select(func.count()).select_from(Outcome)) == 1


def test_concurrent_explanation_change_and_schedule_keep_latest_explanation(records_env):
    client, opp_id = records_env
    original = {"status": "LOST", "lostReasonCode": "OTHER", "reason": "가상 첫 설명"}
    assert post(client, opp_id, "outcomes", original).status_code == 200
    updates = [
        {**original, "reason": "가상 고친 설명"},
        {"status": "LOST", "lostReasonCode": "OTHER", "nextScheduleAt": "2026-11-12"},
    ]
    with ThreadPoolExecutor(max_workers=2) as pool:
        responses = list(pool.map(lambda body: post(client, opp_id, "outcomes", body), updates))
    assert all(response.status_code == 200 for response in responses)
    with session_scope() as session:
        rows = list(session.scalars(select(Outcome).order_by(Outcome.version)))
        assert [row.version for row in rows] == [1, 2, 3]
        assert rows[0].reason == "가상 첫 설명"
        assert rows[-1].reason == "가상 고친 설명"
        assert rows[-1].next_schedule_at.isoformat() == "2026-11-12"
