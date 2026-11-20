"""#754 사람마다 아이디·비밀번호로 로그인하고 기록에 로그인한 사람이 남는다 (PM 결정 2026-11-15).

실제 임시 SQLite·HTTPS TestClient·실제 명령으로 본다. 가상 사례만 쓴다(거산 실제 사양 아님).
계정이 없을 때의 공용 비밀번호 방식은 tests/unit/u1/test_access_session.py가 그대로 본다.
"""

import re
from datetime import UTC, datetime

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import func, select
from typer.testing import CliRunner

from geosan.api import access_session, deps
from geosan.api.app import create_app
from geosan.api.models import AccessSession, StaffAccount
from geosan.api.staff_accounts import add_account, hash_password, password_ok
from geosan.capability.importer import import_capability
from geosan.commands import serve
from geosan.commands.app import app
from geosan.config.models import AppSetting
from geosan.opportunity.importer import import_case
from geosan.records.models import ReviewOpinion
from geosan.storage.engine import database_path
from geosan.storage.session import session_scope
from geosan.workflows.flow_evaluate import run_evaluation
from tests import factories
from tests.unit.u1.test_snapshot_ledger import _write

SHARED = "가상-공용-passphrase"
NOW = datetime(2026, 11, 15, 0, 0, tzinfo=UTC)
NEW_PASSWORD = "가상-새-비밀번호-1"
runner = CliRunner()


@pytest.fixture
def env(tmp_db, tmp_path, monkeypatch):
    """보호 켜짐 + 공용 비밀번호 + 가상 A정밀 평가. 계정은 시험마다 만든다."""
    monkeypatch.setenv("GEOSAN_PASSWORD", SHARED)
    monkeypatch.setattr(access_session, "utcnow", lambda: NOW)
    monkeypatch.setattr(deps, "utcnow", lambda: NOW)
    with session_scope() as session:
        session.get(AppSetting, "accessProtection").value = {"enabled": True}
    import_capability(_write(tmp_path, "cap.json", factories.capability_file()))
    opp = import_case(_write(tmp_path, "case.json", factories.apjeong_case()))
    evaluation = run_evaluation()
    assert evaluation.ok
    with TestClient(create_app(), base_url="https://testserver") as client:
        yield {"client": client, "opp": opp.opp_id, "eval": evaluation.new_eval_ids[0]}


def add(key, viewer=False):
    with session_scope() as session:
        return add_account(session, key, viewer=viewer)


def login(client, key, password):
    return client.post("/api/v1/session", json={"staffKey": key, "password": password})


def setup(client, password, name="영업 김", new=NEW_PASSWORD):
    return client.post(
        "/api/v1/session/profile",
        json={"displayName": name, "currentPassword": password, "newPassword": new},
    )


def save_opinion(env, headers=None):
    return env["client"].post(
        f"/api/v1/opportunities/{env['opp']}/opinions",
        json={"opinion": "WORTH_REVIEW", "evalId": env["eval"]},
        headers=headers or {},
    )


def me(client):
    return client.get("/api/v1/config/ui").json()["data"]


def test_password_is_stored_only_as_a_hash():
    """Given 비밀번호 / When 해시 / Then 원문이 없고 맞는 비밀번호만 통과한다."""
    stored = hash_password("가상-비밀번호")
    assert "가상-비밀번호" not in stored and stored.startswith("scrypt$")
    assert password_ok("가상-비밀번호", stored)
    assert not password_ok("가상-비밀번호2", stored)
    assert not password_ok("가상-비밀번호", "망가진 값")


def test_staff_add_shows_a_temporary_password_once_and_stores_only_the_hash(tmp_db):
    """Given 빈 DB / When staff-add sales-1 / Then 출력에 임시 비밀번호, DB에는 해시만.
    같은 아이디·예약 키 viewer·틀린 꼴은 종료 1."""
    result = runner.invoke(app, ["staff-add", "sales-1"])
    assert result.exit_code == 0, result.output
    password = re.search(r"임시 비밀번호: (\S+)", result.output).group(1)
    assert len(password) == 12
    with session_scope() as session:
        row = session.get(StaffAccount, "sales-1")
        assert row.role == "STAFF" and row.setup_required and row.display_name is None
        assert password not in row.password_hash and password_ok(password, row.password_hash)
    for args in (["staff-add", "sales-1"], ["staff-add", "viewer"], ["staff-add", "Sales 1"]):
        assert runner.invoke(app, args).exit_code == 1, args
    listed = runner.invoke(app, ["staff-list"])
    assert "sales-1 · 담당자 · 이름 아직 안 적음 · 첫 로그인 설정 전" in listed.output
    assert password not in listed.output


def test_with_an_account_login_needs_id_and_old_shared_sessions_end(env):
    """Given 공용 비밀번호로 들어온 세션 / When 계정을 하나 만든다
    / Then 그 세션은 401, 공용 비밀번호만으로는 401("아이디나 비밀번호"),
    아이디·임시 비밀번호로 200."""
    client = env["client"]
    assert client.post("/api/v1/session", json={"password": SHARED}).status_code == 200
    assert client.get("/api/v1/config/ui").status_code == 200
    temp = add("sales-1")
    expired = client.get("/api/v1/config/ui")
    assert expired.status_code == 401
    assert expired.json()["error"]["kind"] == "STAFF_LOGIN_REQUIRED"
    shared = client.post("/api/v1/session", json={"password": SHARED})
    assert shared.status_code == 401
    assert shared.json()["error"]["message"] == "아이디나 비밀번호가 맞지 않습니다."
    assert login(client, "nobody", temp).status_code == 401
    assert login(client, "sales-1", temp).status_code == 200
    with session_scope() as session:
        rows = session.scalars(select(AccessSession).where(AccessSession.staff_key == "sales-1"))
        assert len(list(rows)) == 1


def test_first_login_sets_name_and_password_before_recording(env):
    """Given 임시 비밀번호로 로그인 / When 바로 기록 / Then 403 STAFF_SETUP_REQUIRED.
    이름·새 비밀번호를 정하면 화면 설정의 지금 담당자·담당자 목록에 그 이름이 보이고
    기록할 수 있다."""
    client = env["client"]
    temp = add("sales-1")
    assert login(client, "sales-1", temp).status_code == 200
    current = me(client)["currentStaff"]
    assert current == {
        "key": "sales-1",
        "displayName": None,
        "canRecord": False,
        "setupRequired": True,
    }
    blocked = save_opinion(env)
    assert blocked.status_code == 403
    assert blocked.json()["error"]["kind"] == "STAFF_SETUP_REQUIRED"
    saved = setup(client, temp)
    assert saved.status_code == 200, saved.text
    assert saved.json()["data"]["displayName"] == "영업 김"
    data = me(client)
    assert data["currentStaff"]["canRecord"] is True
    # 계정이 먼저, 계정 전 기록의 담당자(설정 staff)는 이름만 보이도록 뒤에 남는다.
    assert data["staff"][0] == {"key": "sales-1", "displayName": "영업 김"}
    assert {"key": "park-lee", "displayName": "영업 담당"} in data["staff"]
    # 새 비밀번호로만 다시 들어올 수 있다.
    assert login(client, "sales-1", temp).status_code == 401
    assert login(client, "sales-1", NEW_PASSWORD).status_code == 200


@pytest.mark.parametrize(
    "name,current,new,status",
    [
        ("영업 김", "틀린-지금-비밀번호", NEW_PASSWORD, 401),
        ("김 010-1234-5678", None, NEW_PASSWORD, 400),
        ("가상@example.com", None, NEW_PASSWORD, 400),
        ("", None, NEW_PASSWORD, 400),
        ("영업 김", None, "짧은값", 400),
        ("영업 김", None, None, 400),
    ],
)
def test_profile_rejects_wrong_password_contacts_and_weak_password(env, name, current, new, status):
    """Given 첫 로그인
    / When 지금 비밀번호가 틀리거나 이름에 연락처·빈 이름·짧은 새 비밀번호·임시와 같은 값
    / Then 401·400이고 아무것도 바뀌지 않는다."""
    client = env["client"]
    temp = add("sales-1")
    assert login(client, "sales-1", temp).status_code == 200
    response = setup(client, current or temp, name=name, new=new or temp)
    assert response.status_code == status, response.text
    with session_scope() as session:
        row = session.get(StaffAccount, "sales-1")
        assert row.setup_required and row.display_name is None


def test_records_carry_the_logged_in_person_and_other_keys_are_refused(env):
    """Given 설정을 마친 sales-1과 sales-2 / When sales-1이 담당자 헤더 없이 의견 저장
    / Then 기록 담당자는 sales-1. 다른 담당자 키(park-lee·sales-2)를 보내면 403."""
    client = env["client"]
    temp = add("sales-1")
    add("sales-2")
    login(client, "sales-1", temp)
    setup(client, temp)
    assert save_opinion(env, {"X-Staff-Key": "sales-2"}).status_code == 403
    assert save_opinion(env, {"X-Staff-Key": "park-lee"}).status_code == 403
    with session_scope() as session:
        runtime = deps.with_account_staff(
            deps.load_runtime_config(session), list(session.scalars(select(StaffAccount)))
        )
        # 설정에만 있는 옛 담당자 키는 이름만 남고 기록할 수 없다.
        assert not runtime.app_settings.is_recording_staff("park-lee")
        assert runtime.app_settings.is_recording_staff("sales-1")
    response = save_opinion(env)
    assert response.status_code == 200, response.text
    with session_scope() as session:
        row = session.scalar(select(ReviewOpinion))
        assert (row.staff_name, row.created_by) == ("sales-1", "sales-1")
    assert save_opinion(env, {"X-Staff-Key": "sales-1"}).status_code == 200


def test_viewer_account_cannot_record(env):
    """Given 보기 전용 계정 / When 설정을 마치고 기록 / Then 403, 화면 설정은 canRecord false."""
    client = env["client"]
    temp = add("boss-1", viewer=True)
    login(client, "boss-1", temp)
    assert setup(client, temp, name="대표").status_code == 200
    assert me(client)["currentStaff"]["canRecord"] is False
    assert save_opinion(env).status_code == 403


def test_staff_role_turns_a_viewer_into_a_recording_account_and_back(env):
    """#862 Given 첫 로그인을 마친 보기 전용 boss-1(기록 403)
    / When staff-role boss-1 --staff
    / Then 그 세션은 끊기고(401), 같은 비밀번호로 다시 들어가면 이름은 그대로·설정 다시 안 함·기록 200.
    --viewer로 되돌리면 다시 기록 403."""
    client = env["client"]
    temp = add("boss-1", viewer=True)
    login(client, "boss-1", temp)
    assert setup(client, temp, name="대표").status_code == 200
    assert save_opinion(env).status_code == 403

    result = runner.invoke(app, ["staff-role", "boss-1", "--staff"])
    assert result.exit_code == 0, result.output
    assert "boss-1 계정을 담당자(기록 가능) 계정으로 바꿨습니다" in result.output
    assert client.get("/api/v1/config/ui").status_code == 401
    assert login(client, "boss-1", NEW_PASSWORD).status_code == 200
    current = me(client)["currentStaff"]
    assert current["displayName"] == "대표" and current["setupRequired"] is False
    assert current["canRecord"] is True
    assert save_opinion(env).status_code == 200
    with session_scope() as session:
        row = session.scalars(select(ReviewOpinion)).one()
        assert (row.staff_name, row.created_by) == ("boss-1", "boss-1")
    assert "boss-1 · 담당자 · 이름 대표" in runner.invoke(app, ["staff-list"]).output

    back = runner.invoke(app, ["staff-role", "boss-1", "--viewer"])
    assert back.exit_code == 0, back.output
    assert login(client, "boss-1", NEW_PASSWORD).status_code == 200
    assert me(client)["currentStaff"]["canRecord"] is False
    assert save_opinion(env).status_code == 403


@pytest.mark.parametrize(
    "args",
    [
        ["staff-role", "nobody", "--staff"],
        ["staff-role", "boss-1"],
        ["staff-role", "boss-1", "--staff", "--viewer"],
    ],
)
def test_staff_role_refuses_unknown_account_or_unclear_choice(env, args):
    """#862 Given 보기 전용 boss-1 / When 없는 계정이거나 종류를 안 고르거나 둘 다 고름
    / Then 종료 1이고 계정은 그대로 보기 전용."""
    add("boss-1", viewer=True)
    result = runner.invoke(app, args)
    assert result.exit_code == 1, result.output
    assert "오류:" in result.output
    with session_scope() as session:
        assert session.get(StaffAccount, "boss-1").role == "VIEWER"


def test_staff_role_to_the_same_kind_changes_nothing_and_keeps_the_session(env):
    """#862 Given 로그인한 담당자 sales-1 / When staff-role sales-1 --staff(이미 담당자)
    / Then 종료 0, "바꾼 것이 없습니다", 세션은 그대로라 화면이 계속 열린다."""
    client = env["client"]
    temp = add("sales-1")
    login(client, "sales-1", temp)
    setup(client, temp)
    result = runner.invoke(app, ["staff-role", "sales-1", "--staff"])
    assert result.exit_code == 0, result.output
    assert "바꾼 것이 없습니다" in result.output
    assert client.get("/api/v1/config/ui").status_code == 200


def test_reset_and_disable_end_sessions(env):
    """Given 로그인한 sales-1 / When staff-reset
    / Then 그 세션은 401, 옛 비밀번호는 안 되고 새 임시 비밀번호로
    들어가면 다시 첫 로그인 설정. staff-disable이면 로그인도 안 되고, --enable로 다시 열린다."""
    client = env["client"]
    temp = add("sales-1")
    login(client, "sales-1", temp)
    setup(client, temp)
    reset = runner.invoke(app, ["staff-reset", "sales-1"])
    assert reset.exit_code == 0, reset.output
    fresh = re.search(r"임시 비밀번호: (\S+)", reset.output).group(1)
    assert client.get("/api/v1/config/ui").status_code == 401
    assert login(client, "sales-1", NEW_PASSWORD).status_code == 401
    assert login(client, "sales-1", fresh).status_code == 200
    assert me(client)["currentStaff"]["setupRequired"] is True
    assert me(client)["currentStaff"]["displayName"] == "영업 김"
    add("sales-2")  # 마지막 계정을 막아도 공용 방식으로 돌아가지 않게 하나 더 둔다
    assert runner.invoke(app, ["staff-disable", "sales-1"]).exit_code == 0
    assert client.get("/api/v1/config/ui").status_code == 401
    assert login(client, "sales-1", fresh).status_code == 401
    assert runner.invoke(app, ["staff-disable", "sales-1", "--enable"]).exit_code == 0
    assert login(client, "sales-1", fresh).status_code == 200


def test_logout_removes_the_session(env):
    """Given 로그인 / When 로그아웃(두 번) / Then 세션 행이 지워지고 다음 조회는 401."""
    client = env["client"]
    temp = add("sales-1")
    login(client, "sales-1", temp)
    assert client.post("/api/v1/session/logout").status_code == 200
    assert client.post("/api/v1/session/logout").status_code == 200
    signed_out = client.get("/api/v1/config/ui")
    assert signed_out.status_code == 401
    assert signed_out.json()["error"]["kind"] == "STAFF_LOGIN_REQUIRED"
    with session_scope() as session:
        count = select(func.count()).select_from(AccessSession)
        assert session.scalar(count.where(AccessSession.staff_key == "sales-1")) == 0


def test_without_accounts_profile_is_not_found_and_current_staff_is_null(env):
    """Given 계정 없음(공용 방식) / When 로그인 뒤 화면 설정·이름 정하기
    / Then currentStaff null, 404."""
    client = env["client"]
    assert client.post("/api/v1/session", json={"password": SHARED}).status_code == 200
    assert me(client)["currentStaff"] is None
    assert setup(client, SHARED).status_code == 404


def test_serve_starts_with_accounts_and_no_shared_password(env, monkeypatch):
    """Given 보호 켜짐·공용 비밀번호 없음
    / When·Then 계정이 없으면 시작 거부, 계정이 있으면 시작 허용."""
    monkeypatch.delenv("GEOSAN_PASSWORD")
    problem = serve._access_problem(database_path(), "0.0.0.0")
    assert problem and "staff-add" in problem[1]
    add("sales-1")
    assert serve._access_problem(database_path(), "0.0.0.0") is None
