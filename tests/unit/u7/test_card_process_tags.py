"""#659 카드 공정 꼬리표: 목록 카드가 확정된 공정과 AI 제안 수를 나눠 준다(실제 SQLite·평가·API)."""

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import event, select

from geosan.api.app import create_app
from geosan.capability.importer import import_capability
from geosan.opportunity.importer import import_case
from geosan.opportunity.models import OppProcessLink
from geosan.storage.base import new_id, utcnow
from geosan.storage.session import get_engine, session_scope
from geosan.workflows.flow_evaluate import run_evaluation
from tests import factories
from tests.unit.u1.test_snapshot_ledger import _write


def _link(session, opp_id, code, *, proposed):
    session.add(
        OppProcessLink(
            link_id=new_id("link"),
            opp_id=opp_id,
            process_code=code,
            source="AI" if proposed else "STAFF",
            state="PENDING" if proposed else "CONFIRMED",
            dataset_kind="VIRTUAL_REVIEWED",
            is_virtual=True,
            created_by="system",
        )
    )


@pytest.fixture
def card_env(tmp_db, tmp_path):
    """네 회사: 확정만 / AI 제안만 / 둘 다(같은 공정에 확정·제안이 겹침 포함) / 연결 없음."""
    capability = factories.capability_file()
    import_capability(_write(tmp_path, "cap.json", capability))
    ids = [
        import_case(
            _write(tmp_path, f"case-{i}.json", factories.apjeong_renamed_customer(str(i)))
        ).opp_id
        for i in range(4)
    ]
    assert run_evaluation().ok
    confirmed_only, proposed_only, both, none = ids
    with session_scope() as session:
        # 사례 파일이 만든 연결은 모두 이력으로 돌리고, 회사마다 원하는 연결만 새로 둔다.
        for row in session.scalars(select(OppProcessLink)):
            row.superseded_at = utcnow()
        _link(session, confirmed_only, "ZINC_PLATING", proposed=False)
        _link(session, confirmed_only, "ANODIZING", proposed=False)
        _link(session, proposed_only, "ZINC_PLATING", proposed=True)
        _link(session, proposed_only, "ANODIZING", proposed=True)
        _link(session, proposed_only, "BLACK_OXIDE", proposed=True)
        _link(session, both, "ANODIZING", proposed=False)
        _link(session, both, "ANODIZING", proposed=True)
        _link(session, both, "ZINC_PLATING", proposed=True)
    order = [row["code"] for row in capability["processes"]]
    with TestClient(create_app()) as client:
        yield client, ids, order


def _cards(client):
    body = client.get("/api/v1/opportunities").json()
    return {row["oppId"]: row for row in body["data"]}, body


def _in_file_order(order, codes):
    return [code for code in order if code in codes]


def test_confirmed_only_company_shows_every_link_as_confirmed(card_env):
    """Given 확정된 연결만 있는 회사 / When 목록 / Then 확정 공정 = 전체 공정, 제안 0."""
    client, ids, order = card_env
    card = _cards(client)[0][ids[0]]
    expected = _in_file_order(order, {"ZINC_PLATING", "ANODIZING"})
    assert card["processCodes"] == expected
    assert card["confirmedProcessCodes"] == expected
    assert card["proposedProcessCount"] == 0


def test_proposed_only_company_has_no_confirmed_process_and_counts_proposals(card_env):
    """Given AI 제안만 있는 회사 / When 목록 / Then 확정 공정은 비고 제안 수만 온다."""
    client, ids, order = card_env
    card = _cards(client)[0][ids[1]]
    assert card["processCodes"] == _in_file_order(
        order, {"ZINC_PLATING", "ANODIZING", "BLACK_OXIDE"}
    )
    assert card["confirmedProcessCodes"] == []
    assert card["proposedProcessCount"] == 3


def test_mixed_company_splits_confirmed_and_proposed(card_env):
    """Given 확정과 제안이 섞인 회사 / When 목록 / Then 확정만 꼬리표 값, 같은 공정은 확정으로."""
    client, ids, order = card_env
    card = _cards(client)[0][ids[2]]
    assert card["processCodes"] == _in_file_order(order, {"ZINC_PLATING", "ANODIZING"})
    assert card["confirmedProcessCodes"] == ["ANODIZING"]
    assert card["proposedProcessCount"] == 1


def test_company_without_links_has_empty_values(card_env):
    """Given 살아 있는 연결이 없는 회사(모두 이력) / When 목록 / Then 빈 값과 0."""
    client, ids, _ = card_env
    card = _cards(client)[0][ids[3]]
    assert card["processCodes"] == []
    assert card["confirmedProcessCodes"] == []
    assert card["proposedProcessCount"] == 0


def test_process_select_and_filter_still_count_proposals(card_env):
    """Given 제안만 있는 공정 / When 선택란 건수·공정 거르기 / Then 전처럼 제안도 센다."""
    client, ids, _ = card_env
    _, body = _cards(client)
    counts = {row["processCode"]: row["count"] for row in body["meta"]["processCounts"]}
    assert counts["ZINC_PLATING"] == 3
    assert counts["BLACK_OXIDE"] == 1
    filtered = client.get("/api/v1/opportunities?process=BLACK_OXIDE").json()
    assert [row["oppId"] for row in filtered["data"]] == [ids[1]]


def test_link_states_are_read_once_for_the_whole_list(card_env):
    """Given 회사 4곳 / When 목록 / Then 공정 연결 표는 회사 수와 무관하게 한 번만 읽는다."""
    client, _, _ = card_env
    statements = []

    def record(conn, cursor, statement, parameters, context, executemany):
        if "opp_process_link" in statement:
            statements.append(statement)

    engine = get_engine()
    event.listen(engine, "before_cursor_execute", record)
    try:
        assert client.get("/api/v1/opportunities").status_code == 200
    finally:
        event.remove(engine, "before_cursor_execute", record)
    assert len(statements) == 1
