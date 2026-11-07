"""#404 가상 제공처·실제 CSV와 SQLite. 외부 연결은 별도 소량 조회로 확인한다."""

from datetime import date
from xml.etree import ElementTree as ET

from pytest_bdd import given, scenarios, then, when
from sqlalchemy import select

from geosan.config.app_settings import load_app_settings, sync_app_settings
from geosan.evidence.transfer import TransferLog
from geosan.opportunity import complex_source
from geosan.opportunity.complex_collection import collect_complex_rows
from geosan.opportunity.factory_csv import read_factory_csv
from geosan.opportunity.models import IngestBatch
from geosan.opportunity.source_models import SourceContract
from geosan.storage.base import utcnow
from geosan.storage.session import session_scope

scenarios("u3/complex_source.feature")


def xml(name="새공장", *, page=1, total=1, code="00"):
    root = ET.Element("response")
    header = ET.SubElement(root, "header")
    ET.SubElement(header, "resultCode").text = code
    body = ET.SubElement(root, "body")
    item = ET.SubElement(ET.SubElement(body, "items"), "item")
    for key, value in {
        "cmpnyNm": name,
        "rnAdres": "충남 아산시 가상로 1",
        "irsttNm": "단지A",
        "fctryManageNo": "F1" if name == "기존공장" else "F2",
        "mainProductCn": "부품",
        "rprsntvNm": "PRIVATE_PERSON_MARKER",
        "cmpnyTelno": "PRIVATE_PHONE_MARKER",
        "cmpnyFxnum": "PRIVATE_FAX_MARKER",
        "hmpadr": "PRIVATE_HOME_MARKER",
    }.items():
        ET.SubElement(item, key).text = value
    for key, value in {"pageNo": page, "numOfRows": 1, "totalCount": total}.items():
        ET.SubElement(body, key).text = str(value)
    return ET.tostring(root, encoding="utf-8")


@given("단지 조회를 켠 회차와 가상 공장 파일이 있다", target_fixture="context")
def ready(tmp_db, tmp_path, app_settings_path, monkeypatch):
    settings = load_app_settings(app_settings_path)
    settings.ingestion.complex_list.enabled = True
    monkeypatch.setenv("DATA_GO_KR_SERVICE_KEY", "synthetic")
    monkeypatch.setattr(complex_source, "PAGE_SIZE", 1)
    with session_scope() as session:
        sync_app_settings(session, settings)
        for source_id in ("kicox-factory-csv", "kicox-production-api"):
            session.add(
                SourceContract(
                    source_id=source_id,
                    source_name="가상 소스",
                    allowed_use="검사",
                    allowed_storage="검사",
                    confirmed_at=date(2026, 1, 1),
                    is_virtual=True,
                )
            )
        session.add(
            IngestBatch(
                batch_id="batch-http",
                source_id="kicox-factory-csv",
                requested_by="park-lee",
                status="RUNNING",
                started_at=utcnow(),
                criteria={"regions": ["충남"]},
                is_virtual=True,
            )
        )
    path = tmp_path / "factory.csv"
    path.write_text(
        "순번,회사명,단지명,생산품,공장주소\n1,기존공장,단지A,파일 원문,충남 아산시 가상로 1\n",
        encoding="utf-8",
    )
    return {
        "files": read_factory_csv(path, regions=["충남"]).rows,
        "settings": settings,
        "calls": [],
        "responses": [],
    }


@given("제공처가 처음에는 실패하고 두 쪽에 걸쳐 기존 공장과 새 공장을 돌려준다")
def retry_pages(context):
    context["responses"] = [TimeoutError(), xml("기존공장", total=2), xml(page=2, total=2)]


@given("첫 단지는 성공하고 다음 단지는 제공처 하루 한도 응답을 돌려준다")
def partial(context):
    context["settings"].ingestion.complex_list.extra_names = ["단지B", "단지C"]
    with session_scope() as session:
        sync_app_settings(session, context["settings"])
    context["responses"] = [xml(), xml(code="22")]


@given("단지 조회 설정을 끈다")
def disabled(context):
    context["settings"].ingestion.complex_list.enabled = False
    with session_scope() as session:
        sync_app_settings(session, context["settings"])


@when("파일의 단지 입주 목록을 조회해 합친다", target_fixture="result")
def collect(context, monkeypatch):
    def request(name, key, page):
        context["calls"].append((name, page))
        response = context["responses"].pop(0)
        if isinstance(response, Exception):
            raise response
        return response

    monkeypatch.setattr(complex_source, "_request_page", request)
    return collect_complex_rows("batch-http", context["files"])


@then("파일 원문과 새 공장 한 곳이 보존되고 완료 사유는 비어 있다")
def complete(context, result):
    assert result.combined.file_rows == context["files"]
    assert result.combined.file_rows[0].product == "파일 원문"
    assert len(result.combined.added_rows) == 1 and result.skipped_reason is None


@then("재시도와 쪽 넘김을 포함한 호출 세 건이 각각 무료 공공 조회로 기록된다")
def records(context):
    assert context["calls"] == [("단지A", 1), ("단지A", 1), ("단지A", 2)]
    with session_scope() as session:
        logs = session.scalars(select(TransferLog)).all()
    assert len(logs) == 3
    assert all(
        row.purpose == "PUBLIC_SOURCE"
        and row.call_count == 1
        and row.cost_usd == 0
        and row.batch_id == "batch-http"
        for row in logs
    )


@then("원래 파일과 받은 새 공장 한 곳을 유지하고 하루 한도 사유를 반환한다")
def partial_result(context, result):
    assert result.combined.file_rows == context["files"]
    assert len(result.combined.added_rows) == 1 and result.skipped_reason == "DAILY_LIMIT"


@then("나머지 단지는 호출하지 않고 받은 원문의 개인정보도 남기지 않는다")
def stopped(context, result):
    assert context["calls"] == [("단지A", 1), ("단지B", 1)]
    assert "PRIVATE_" not in repr(result)
    with session_scope() as session:
        assert len(session.scalars(select(TransferLog)).all()) == 2


@then("원래 파일만 반환하고 외부 호출 기록은 없다")
def only_file(context, result):
    assert result.skipped_reason == "DISABLED" and result.combined.file_rows == context["files"]
    assert result.combined.added_rows == () and context["calls"] == []
    with session_scope() as session:
        assert session.scalars(select(TransferLog)).all() == []
