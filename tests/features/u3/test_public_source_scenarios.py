"""#390·#393 실제 임시 SQLite, 고정 시각. 외부 HTTP·캐시 실행은 하지 않는다."""

from datetime import UTC, date, datetime, timedelta

from pytest_bdd import given, parsers, scenarios, then, when
from sqlalchemy import select

from geosan.commands.cost import run_cost
from geosan.config.app_settings import AppSettings, load_app_settings
from geosan.evidence import public_source
from geosan.evidence.public_source import FactoryRegistryLimitError, reserve_factory_registry
from geosan.evidence.transfer import TransferLog
from geosan.opportunity.models import IngestBatch
from geosan.opportunity.source_models import SourceContract
from geosan.storage.base import new_id
from geosan.storage.engine import dispose_engines
from geosan.storage.session import session_scope

scenarios("u3/public_source.feature")


@given("이용 확인을 마친 조회 소스와 실행 중인 회차가 있다", target_fixture="context")
def confirmed_registry(tmp_db, monkeypatch):
    context = {"now": datetime(2026, 11, 7, 14, 59, 59, tzinfo=UTC), "results": []}
    monkeypatch.setattr(public_source, "utcnow", lambda: context["now"])
    with session_scope() as session:
        session.add(
            SourceContract(
                source_id="kicox-production-api",
                source_name="가상 등록 조회",
                allowed_use="검사",
                allowed_storage="검사",
                confirmed_at=date(2026, 1, 1),
                is_virtual=True,
            )
        )
        session.add(
            IngestBatch(
                batch_id="batch-source",
                source_id="kicox-factory-csv",
                requested_by="park-lee",
                started_at=context["now"],
                status="RUNNING",
                is_virtual=True,
            )
        )
    return context


@given(parsers.parse("한국 시간 오늘 허용한 공장등록 조회가 {count:d}건이다"))
def existing_requests(context, count):
    with session_scope() as session:
        for _ in range(count):
            session.add(
                TransferLog(
                    transfer_log_id=new_id("transfer"),
                    occurred_at=context["now"],
                    batch_id="batch-source",
                    purpose="PUBLIC_SOURCE",
                    kind="FACTORY_REGISTRY",
                    mode="NONE",
                    security_grade="PUBLIC",
                    decision="ALLOW",
                    call_count=1,
                    cost_usd=0,
                    is_virtual=True,
                )
            )


def reserve(context):
    try:
        result = reserve_factory_registry(batch_id="batch-source")
    except FactoryRegistryLimitError as error:
        result = error.skipped_reason
    context["results"].append(result)


@when("공장등록 조회를 두 번 예약한다")
def twice(context):
    reserve(context)
    reserve(context)


@then("첫 요청만 허용되고 다음 요청은 하루 한도 사유로 거부된다")
def first_only(context):
    assert context["results"][0].startswith("transfer-")
    assert context["results"][1] == "DAILY_LIMIT"
    with session_scope() as session:
        rows = session.scalars(select(TransferLog)).all()
    assert sum(row.call_count for row in rows if row.decision == "ALLOW") == 1000
    assert [row.reject_reason for row in rows if row.decision == "REJECT"] == ["DAILY_LIMIT"]


@then("AI 사용량 명령에는 공장등록 조회가 합산되지 않는다")
def ai_excluded():
    output = []
    assert run_cost("2026-11", output.append) == 0
    assert "호출 0/" in output[0] and "거부 0건" in output[0]
    assert any("$0.000000/" in line for line in output)


@when("저장소 연결을 다시 열고 요청한 뒤 한국 시간 자정에 다시 요청한다")
def restart_then_midnight(context):
    dispose_engines()
    reserve(context)
    context["now"] += timedelta(seconds=1)
    reserve(context)


@then("자정 전 요청은 거부되고 자정의 요청만 허용된다")
def midnight_only(context):
    assert context["results"][0] == "DAILY_LIMIT"
    assert context["results"][1].startswith("transfer-")


@given("단지 조회 칸이 없는 예전 앱 설정이 있다", target_fixture="old_settings")
def old_settings(app_settings_path):
    data = load_app_settings(app_settings_path).model_dump(by_alias=True)
    del data["ingestion"]["complexList"]
    return data


@when("예전 앱 설정을 읽는다", target_fixture="settings")
def read_settings(old_settings):
    return AppSettings.model_validate(old_settings).ingestion.complex_list


@then("단지 조회는 꺼져 있고 보관 일수는 7일이며 추가 단지 목록은 비어 있다")
def defaults(settings):
    assert not settings.enabled and settings.cache_days == 7 and settings.extra_names == []
