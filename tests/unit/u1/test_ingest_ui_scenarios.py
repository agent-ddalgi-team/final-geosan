"""S02 연결 경계: 선택지는 실제 역량·설정, 실행 함수만 검사 대역을 쓴다."""

from pathlib import Path

from pytest_bdd import given, scenarios, then, when

from tests.unit.u1.test_ingest_ui_options import options
from tests.unit.u1.test_ingest_ui_options import options_env as options_env
from tests.unit.u1.test_serve_ingest_connection import post
from tests.unit.u1.test_serve_ingest_connection import wired_app as wired_app
from tests.unit.u3.test_ingest_batches import batch_db as batch_db

scenarios(str(Path(__file__).with_name("ingest_ui_connection.feature")))


@given("활성 역량 파일과 후보가 없는 데이터베이스가 있다", target_fixture="choices_context")
def choices_context(options_env):
    return options_env


@when("화면 설정을 읽는다", target_fixture="actual_choices")
def actual_choices(choices_context):
    return options(choices_context[0])


@then("파일 순서의 공정 9종과 설정의 지역 및 산업이 나온다")
def choices_match(choices_context, actual_choices):
    expected = choices_context[1]["processes"]
    assert len(actual_choices["processes"]) == len(expected) == 9
    assert actual_choices["processes"] == [{"code": p["code"], "name": p["name"]} for p in expected]
    # #521(PM 결정 2026-11-09): 충남 전체 뒤에 충남 15개 시·군, 그다음 대전·세종.
    regions = actual_choices["regions"]
    assert regions[:3] == ["충남", "천안시", "아산시"] and regions[-2:] == ["대전", "세종"]
    assert len(regions) == 18
    assert actual_choices["industries"]


@given("완료 상태를 저장하는 검사 실행 함수를 연결한 서버가 있다", target_fixture="server_context")
def server_context(wired_app):
    return wired_app


@when("담당자가 아노다이징 후보 가져오기를 누른다", target_fixture="accepted")
def accepted(server_context):
    return post(server_context[0])


@then("접수한 회차가 실제 데이터베이스에 완료로 남는다")
def completed(server_context, accepted):
    assert accepted.status_code == 200
    batch_id = accepted.json()["data"]["batchId"]
    assert server_context[1] == [batch_id]
    progress = server_context[0].get("/api/v1/opportunities").json()["meta"]["latestIngest"]
    assert progress["batchId"] == batch_id and progress["status"] == "DONE"
