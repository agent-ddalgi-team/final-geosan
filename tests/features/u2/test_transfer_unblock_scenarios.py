import pytest
from pytest_bdd import given, scenarios, then, when
from typer.testing import CliRunner

from geosan.commands.app import app
from geosan.config.errors import AppError
from geosan.evidence.homepage import find_case_homepage
from tests.unit.u2 import test_transfer_unblock as support

search_env = support.search_env
fixed_clock = support.fixed_clock
scenarios("u2/transfer_unblock.feature")


@given("20분 전 사용량 미확정 검색 기록 때문에 새 검색이 막혀 있다", target_fixture="before")
def pending(search_env, fixed_clock, tmp_db):
    support.make_log(opp_id=search_env[0].opp_id)
    with pytest.raises(AppError) as blocked:
        find_case_homepage(search_env[0].opp_id)
    assert blocked.value.kind == "USAGE_UNCONFIRMED"
    assert blocked.value.next_action == "문의 번호와 함께 운영자에게 알려 주세요"
    search_env[1].assert_not_called()
    return support.database_rows(tmp_db)


@when("정리 대상을 조회한다")
def preview():
    result = CliRunner().invoke(app, ["transfer-unblock"])
    assert result.exit_code == 0 and "정리 대상 1건" in result.output


@then("기록과 사용량은 모두 그대로이다")
def untouched(tmp_db, before):
    assert support.database_rows(tmp_db) == before


@when("제공사에서 확인한 사용량으로 해당 기록을 정산한다", target_fixture="settled")
def reconcile(search_env, tmp_db):
    result = support.settle()
    assert result.exit_code == 0 and "1건을 정리했습니다" in result.output
    search_env[1].assert_not_called()
    return support.database_rows(tmp_db)


@then("원래 호출 횟수를 보존하고 가짜 제공사로 새 검색 한 번만 보낸다")
def allowed(search_env):
    assert find_case_homepage(search_env[0].opp_id).url == "https://example.org/"
    assert search_env[1].call_count == 1
    assert support.read()["call_count"] == 1
    assert support.read()["reconciled_by"] == "choi-pm"


@when("같은 기록의 정산을 다시 실행한다")
def repeat():
    assert support.settle().exit_code == 1


@then("최초 사용량과 처리자 이력은 그대로이다")
def preserved(tmp_db, settled):
    assert support.database_rows(tmp_db) == settled
