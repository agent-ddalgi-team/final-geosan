"""#213 실제 임시 SQLite·HTTPS TestClient로 접속 보호를 검증한다."""

from concurrent.futures import ThreadPoolExecutor
from contextlib import contextmanager
from datetime import UTC, datetime, timedelta

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import event, func, select

from geosan.api import access_session, deps
from geosan.api.app import create_app
from geosan.api.models import AccessSession
from geosan.api.routes import session as session_route
from geosan.capability.importer import import_capability
from geosan.config.models import AppSetting
from geosan.opportunity.importer import import_case
from geosan.records.models import ReviewOpinion
from geosan.storage.session import session_scope
from geosan.workflows.flow_evaluate import run_evaluation
from tests import factories
from tests.unit.u1.test_snapshot_ledger import _write

PASSWORD = "가상-test-passphrase"
NOW = datetime(2026, 11, 3, 0, 0, tzinfo=UTC)


@pytest.fixture
def protected(tmp_db, monkeypatch):
    monkeypatch.setenv("GEOSAN_PASSWORD", PASSWORD)
    monkeypatch.setattr(access_session, "utcnow", lambda: NOW)
    monkeypatch.setattr(deps, "utcnow", lambda: NOW)
    with session_scope() as session:
        session.get(AppSetting, "accessProtection").value = {"enabled": True}
    with TestClient(create_app(), base_url="https://testserver") as client:
        yield client


def login(client, password=PASSWORD):
    return client.post("/api/v1/session", json={"password": password})


def test_session_cookie_database_and_restart(protected):
    """Given 보호 켜짐 / When 로그인·새 앱에서 조회 / Then 쿠키·DB 지문으로 인증한다."""
    assert protected.get("/api/v1/config/ui").status_code == 401
    response = login(protected)
    assert response.status_code == 200
    cookie = response.headers["set-cookie"]
    assert all(part in cookie for part in ("HttpOnly", "Secure", "SameSite=lax", "Max-Age=43200"))
    assert "Domain=" not in cookie
    token = protected.cookies.get("geosan_session")
    assert token and token not in response.text and PASSWORD not in response.text
    with session_scope() as session:
        stored = session.get(AccessSession, access_session.token_fingerprint(token))
        assert stored and stored.expires_at == NOW + timedelta(hours=12)
        assert stored.session_id != token
        assert stored.dataset_kind == "VIRTUAL_REVIEWED" and stored.is_virtual
    with TestClient(
        create_app(), base_url="https://testserver", cookies=protected.cookies
    ) as fresh:
        assert fresh.get("/api/v1/config/ui").status_code == 200
    assert protected.get("/api/v1/config/ui").headers["cache-control"] == "no-store"


@pytest.mark.parametrize("token", ["", "login-failures", "x" * 43, "가상 위조"])
def test_missing_or_forged_session_is_rejected(protected, token):
    """Given 없거나 위조된 쿠키 / When 업무 API 조회 / Then 401이다."""
    # HTTP 헤더는 ASCII여야 하므로 비ASCII 쿠키는 입력 검증 함수에서 직접 확인한다.
    if not token.isascii():
        assert access_session.token_fingerprint(token) is None
        return
    protected.cookies.set("geosan_session", token)
    assert protected.get("/api/v1/opportunities").status_code == 401


def test_cookie_is_not_sent_over_http(protected):
    """Given Secure 쿠키 / When HTTP로 조회 / Then 쿠키가 전송되지 않아 거부된다."""
    assert login(protected).status_code == 200
    with TestClient(create_app(), base_url="http://testserver", cookies=protected.cookies) as plain:
        assert plain.get("/api/v1/config/ui").status_code == 401


def test_session_expires_at_exact_boundary_without_sliding(protected, monkeypatch):
    """Given 발급 세션 / When 12시간 직전·정각 / Then 정각부터 거부하며 연장하지 않는다."""
    assert login(protected).status_code == 200
    monkeypatch.setattr(deps, "utcnow", lambda: NOW + timedelta(hours=12, microseconds=-1))
    assert protected.get("/api/v1/config/ui").status_code == 200
    monkeypatch.setattr(deps, "utcnow", lambda: NOW + timedelta(hours=12))
    assert protected.get("/api/v1/config/ui").status_code == 401


def test_fifth_failure_wait_survives_restart_and_does_not_extend(protected, monkeypatch):
    """Given 5회 실패 / When 새 앱·대기 중 성공 비밀번호 / Then 30초 차단을 유지한다."""
    assert [login(protected, "wrong").status_code for _ in range(4)] == [401] * 4
    blocked = login(protected, "wrong")
    assert blocked.status_code == 429
    assert blocked.json()["error"]["retryAfterSeconds"] == 30
    assert "set-cookie" not in blocked.headers
    monkeypatch.setattr(access_session, "utcnow", lambda: NOW + timedelta(seconds=10))
    with TestClient(create_app(), base_url="https://testserver") as fresh:
        response = login(fresh)
        assert response.status_code == 429
        assert response.json()["error"]["retryAfterSeconds"] == 20
    with session_scope() as session:
        assert session.get(AccessSession, access_session.FAILURE_ROW_ID).blocked_until == (
            NOW + timedelta(seconds=30)
        )
    monkeypatch.setattr(access_session, "utcnow", lambda: NOW + timedelta(seconds=30))
    assert login(protected).status_code == 200
    assert login(protected, "wrong").status_code == 401
    with session_scope() as session:
        assert session.get(AccessSession, access_session.FAILURE_ROW_ID).failure_count == 1


def test_concurrent_failures_are_counted_once(protected):
    """Given 동시에 5회 실패 / When 같은 DB 갱신 / Then 네 번401·한 번429·횟수5."""
    with ThreadPoolExecutor(max_workers=5) as pool:
        statuses = list(pool.map(lambda _: login(protected, "wrong").status_code, range(5)))
    assert sorted(statuses) == [401, 401, 401, 401, 429]
    with session_scope() as session:
        assert session.get(AccessSession, access_session.FAILURE_ROW_ID).failure_count == 5


def test_disabled_protection_needs_neither_cookie_nor_password(protected, monkeypatch):
    """Given 보호 끄기 / When 접속 / Then 비밀번호 환경 변수 없이 업무 API를 쓴다."""
    with session_scope() as session:
        session.get(AppSetting, "accessProtection").value = {"enabled": False}
    monkeypatch.delenv("GEOSAN_PASSWORD")
    assert protected.get("/api/v1/config/ui").status_code == 200
    response = login(protected, "")
    assert response.status_code == 200 and "set-cookie" not in response.headers


def test_missing_password_fails_closed(protected, monkeypatch):
    """Given 비밀번호 미설정 / When 빈 비밀번호 로그인 / Then 500이며 쿠키 없음."""
    monkeypatch.delenv("GEOSAN_PASSWORD")
    response = login(protected, "")
    assert response.status_code == 500 and "set-cookie" not in response.headers
    assert protected.get("/api/v1/config/ui").status_code == 401


def test_failed_commit_issues_no_cookie_and_rolls_back(protected, monkeypatch):
    """Given DB 최종 저장 실패 / When 로그인 / Then 쿠키·부분 행 없이 500, 재시도 없음."""
    attempts = []

    def fail_commit(session):
        session.flush()
        assert session.scalar(select(func.count()).select_from(AccessSession)) == 2
        attempts.append(1)
        raise RuntimeError(PASSWORD)

    @contextmanager
    def failing_scope():
        with session_scope() as session:
            event.listen(session, "before_commit", fail_commit)
            yield session

    monkeypatch.setattr(session_route, "session_scope", failing_scope)
    response = login(protected)
    assert response.status_code == 500
    assert "set-cookie" not in response.headers and PASSWORD not in response.text
    assert attempts == [1]
    with session_scope() as session:
        assert session.scalar(select(func.count()).select_from(AccessSession)) == 0


def test_authenticated_record_has_session_reference(protected, tmp_path):
    """Given 인증된 담당자 / When 의견 저장 / Then DB 기록에 접속 식별자가 남는다."""
    import_capability(_write(tmp_path, "cap.json", factories.capability_file()))
    opp = import_case(_write(tmp_path, "case.json", factories.apjeong_case()))
    evaluation = run_evaluation()
    assert evaluation.ok
    assert login(protected).status_code == 200
    body = {"opinion": "WORTH_REVIEW", "evalId": evaluation.new_eval_ids[0]}
    url = f"/api/v1/opportunities/{opp.opp_id}/opinions"
    assert protected.post(url, json=body).status_code == 403
    response = protected.post(url, json=body, headers={"X-Staff-Key": "park-lee"})
    assert response.status_code == 200
    with session_scope() as session:
        row = session.scalar(select(ReviewOpinion))
        assert row.session_ref == access_session.token_fingerprint(
            protected.cookies.get("geosan_session")
        )
