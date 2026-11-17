"""상세 조사 요청을 실제 API·임시 DB까지 연결하는 시나리오."""

from pytest_bdd import given, scenarios, then, when

from geosan.config.errors import AppError
from geosan.workflows import flow_extract
from tests.unit.u1 import test_homepage_api as support
from tests.unit.u1 import test_homepage_history as history_support

search_env = support.search_env
extract_env = support.extract_env
homepage_env = support.homepage_env

scenarios("u2/homepage_api.feature")


@given("홈페이지 주소와 가짜 외부 응답을 가진 공개 기회가 있다", target_fixture="before")
def prepared(homepage_env):
    return support.support.counts()


@when("담당자가 홈페이지 맞음을 저장한다", target_fixture="response")
def confirm(homepage_env):
    return support.post(homepage_env, {"confirmOnly": True})


@then("외부 호출 없이 주소 확인 상태만 바뀐다")
def confirmed(homepage_env, response, before):
    assert response.status_code == 200
    assert response.json()["data"]["homepageStatus"] == "CONFIRMED"
    assert response.json()["meta"]["reevaluated"] is False
    assert support.support.counts() == before and homepage_env[2].call_count == 0


@when("담당자가 상세에서 AI 조사를 요청한다", target_fixture="response")
def research(homepage_env):
    return support.post(homepage_env, {})


@then("실제로 저장한 근거와 질문 건수와 새 평가 번호가 응답에 있다")
def stored(homepage_env, response, before):
    assert response.status_code == 200
    data = response.json()["data"]
    assert data["evidenceCount"] == 1 and data["questionCount"] == 1 and data["evalId"]
    assert response.json()["meta"]["reevaluated"] is True
    assert support.support.counts()[0] == before[0] + 1 and homepage_env[2].call_count == 1


@when("보기 전용 사용자가 AI 조사를 요청한다", target_fixture="response")
def viewer(homepage_env):
    return support.post(homepage_env, {}, staff="viewer")


@then("외부 호출과 근거 저장 없이 요청을 거부한다")
def rejected(homepage_env, response, before):
    assert response.status_code == 403
    assert support.support.counts() == before and homepage_env[2].call_count == 0


@given("기존 주소의 조사가 완료되어 있다", target_fixture="saved")
def researched(homepage_env):
    assert support.post(homepage_env, {}).status_code == 200
    return support.saved_research(homepage_env)


@when("담당자가 주소를 고친 뒤 본문 읽기에 실패한다", target_fixture="response")
def failed_correction(homepage_env, monkeypatch):
    def fail_read(url, deadline):
        raise AppError("본문을 읽을 수 없습니다.", "다시 조사해 주세요.", 422, "UNREACHABLE")

    monkeypatch.setattr(flow_extract, "fetch", fail_read)
    return support.post(homepage_env, {"url": "https://example.org/corrected-company"})


@then("고친 주소는 유지되고 이전 근거와 질문과 평가는 그대로다")
def correction_preserved(homepage_env, response, saved):
    assert response.status_code == 422
    assert response.json()["error"]["kind"] == "UNREACHABLE"
    assert support.saved_research(homepage_env) == saved
    client, case, transport = homepage_env
    header = client.get(f"/api/v1/opportunities/{case.opp_id}").json()["data"]["header"]
    assert header["homepageUrl"] == "https://example.org/corrected-company"
    assert header["homepageStatus"] == "CONFIRMED"
    assert transport.call_count == 1


@then("주소 변경 이력에 이전 주소와 새 주소가 한 번 남는다")
def address_history_preserved(homepage_env):
    (row,) = history_support.notes(homepage_env)
    assert row.kind == "RESEARCH" and row.version == 1
    assert row.text == (
        f"홈페이지 주소 변경 · 이전 {support.URL} · 새 https://example.org/corrected-company"
    )
