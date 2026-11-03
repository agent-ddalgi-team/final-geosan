"""가상 입력·실제 임시 DB로 확인하는 접속 보호 사용자 시나리오."""

from fastapi.testclient import TestClient
from pytest_bdd import given, scenarios, then, when

from geosan.api.app import create_app
from geosan.config.models import AppSetting
from geosan.storage.session import session_scope

scenarios("u8/access.feature")


@given("접속 보호를 켠 가상 서버가 있다", target_fixture="access_context")
def protected_server(tmp_db, monkeypatch):
    monkeypatch.setenv("GEOSAN_PASSWORD", "scenario-only-passphrase")
    with session_scope() as session:
        session.get(AppSetting, "accessProtection").value = {"enabled": True}
    with TestClient(create_app(), base_url="https://testserver") as client:
        yield {"client": client}


@when("비밀번호 없이 업무 API를 읽는다")
def request_without_cookie(access_context):
    access_context["response"] = access_context["client"].get("/api/v1/config/ui")


@then("접속이 거부된다")
def rejected(access_context):
    assert access_context["response"].status_code == 401


@when("올바른 공용 비밀번호를 입력한다")
def correct_password(access_context):
    access_context["response"] = access_context["client"].post(
        "/api/v1/session", json={"password": "scenario-only-passphrase"}
    )


@then("접속 쿠키로 업무 API를 읽을 수 있다")
def authenticated(access_context):
    assert access_context["response"].status_code == 200
    assert access_context["client"].get("/api/v1/config/ui").status_code == 200


@when("비밀번호를 다섯 번 틀린다")
def incorrect_passwords(access_context):
    for attempt in range(5):
        response = access_context["client"].post("/api/v1/session", json={"password": "wrong"})
        assert response.status_code == (429 if attempt == 4 else 401)
    access_context["response"] = response


@then("서버가 30초 대기를 안내하고 쿠키를 주지 않는다")
def waiting(access_context):
    response = access_context["response"]
    assert response.status_code == 429
    assert response.json()["error"]["retryAfterSeconds"] == 30
    assert "set-cookie" not in response.headers
