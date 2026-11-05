from pytest_bdd import given, scenarios, then, when

from geosan.opportunity.models import Customer
from geosan.storage.session import session_scope
from geosan.workflows.flow_extract import run_extract
from tests.unit.u2 import test_extraction as support
from tests.unit.u2 import test_search_limits as search_support

extract_env = support.extract_env
search_env = search_support.search_env
scenarios("u2/extraction.feature")


@given("공개 신규 기회와 가짜 OpenAI 추출 응답이 준비되었다")
def public(extract_env):
    pass


@given("내부 자료인 기회가 준비되었다")
def private(extract_env):
    case, _ = extract_env
    with session_scope() as session:
        session.get(Customer, case.customer_id).security_grade = "INTERNAL_ONLY"


@when("홈페이지 본문 조사를 실행한다", target_fixture="result")
def run(extract_env):
    return run_extract(extract_env[0].opp_id, support.URL)


@then("새 근거와 질문과 실제 재평가가 함께 저장된다")
def stored(result):
    assert result.ok and len(result.new_eval_ids) == 1
    assert "근거 1건·질문 1건 저장" in result.summary


@then("OpenAI 전송 없이 거부 기록만 남는다")
def rejected(extract_env, result):
    assert not result.ok and extract_env[1].call_count == 0
    assert search_support.logs()[0].decision == "REJECTED"


@given("홈페이지에 제목과 프레임 안내문만 있다", target_fixture="before_frame")
def frame_notice(extract_env, monkeypatch):
    from geosan.evidence import reader
    from geosan.workflows import flow_extract
    from tests.unit.u2.test_homepage_reader import FRAME_PAGE

    monkeypatch.setattr(flow_extract, "fetch", reader.fetch)
    monkeypatch.setattr(
        reader,
        "_get",
        lambda url, _: (
            (404, {}, "")
            if url.endswith("robots.txt")
            else (200, {"content-type": "text/html"}, FRAME_PAGE)
        ),
    )
    return support.counts()


@then("공개 본문 붙여넣기를 안내하고 AI 호출 없이 기존 근거와 평가를 보존한다")
def frame_rejected(extract_env, result, before_frame):
    assert not result.ok and result.error.kind == "UNREACHABLE"
    assert "붙여넣어" in result.error.next_action
    assert extract_env[1].call_count == 0 and search_support.logs() == []
    assert support.counts() == before_frame
