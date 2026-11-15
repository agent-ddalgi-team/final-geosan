"""#549 1단계: 맞는 공장 수 줄(약속 C1 GET /ingest/preview).

실제 판단 저장 흐름(pick_candidates, 가상 AI 답)이 남긴 판단을 숫자 줄이 같은 기준으로 세는지,
외부 호출·저장 없이 세는지 본다. 가상 공장 2곳(충남 아산 볼트·당진 운송)만 쓴다.
"""

import json
import time
from concurrent.futures import ThreadPoolExecutor

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import func, select

from geosan.api.app import create_app
from geosan.config.registry import load_runtime_config
from geosan.evidence.transfer import TransferLog
from geosan.opportunity import candidate_pick as pick
from geosan.opportunity import ingest_preview as preview
from geosan.opportunity.ingest_preview import preview_counts
from geosan.opportunity.queries import normalize_address, normalize_name
from geosan.opportunity.source_models import CandidateJudgment, SourceFactoryRow
from geosan.storage.session import session_scope
from geosan.workflows.ingest_conditions import IngestRequest, validate_ingest_conditions
from tests.unit.u3.test_candidate_pick import envelope
from tests.unit.u3.test_candidate_pick import pick_context as pick_context
from tests.unit.u3.test_ingest_tables import _insert_filled
from tests.unit.u3.test_judgment_store import public_rows as public_rows

PATH = "/api/v1/ingest/preview"


def _answer(row):
    """볼트 공장은 아연도금에 맞는 제조업(상), 운송은 제조업 아님."""
    maker = "볼트" in row["product"]
    return {
        "rowId": row["rowId"],
        "isManufacturer": maker,
        "processCodes": ["ZINC_PLATING"] if maker else [],
        "industries": ["자동차 부품"] if maker else [],
        "reason": "가상 생산품에 따른 판단" if maker else "",
        "fitLevel": "HIGH" if maker else "LOW",
        "ownPlatingLineSuspected": False,
        "ownPlatingLineBasis": None,
    }


@pytest.fixture
def judged(pick_context, monkeypatch):
    """실제 판단 흐름으로 두 공장의 판단을 저장한다. 외부 호출은 가상 답으로 대신한다."""

    def post(payload, key, deadline):
        rows = json.loads(payload["input"])
        return envelope(json.dumps([_answer(row) for row in rows], ensure_ascii=False))

    monkeypatch.setattr(pick, "_post", post)
    pick.pick_candidates(pick_context["batch"], pick_context["ids"])
    return pick_context


def counts(process_codes=("ZINC_PLATING",), regions=("충남",), industries=()):
    with session_scope() as session:
        settings = load_runtime_config(session).app_settings
        prepared = validate_ingest_conditions(
            IngestRequest.model_validate(
                {
                    "processCodes": list(process_codes),
                    "regions": list(regions),
                    "industries": list(industries),
                }
            ),
            settings=settings,
            available_process_codes={"ZINC_PLATING", "ANODIZING"},
        )
        return preview_counts(
            session,
            process_codes=prepared.process_codes,
            regions=prepared.regions,
            industries=prepared.industries,
            max_candidates=prepared.max_candidates,
            dataset_kind="VIRTUAL_REVIEWED",
        )


def _no_ai(monkeypatch):
    def refuse(*args, **kwargs):
        raise AssertionError("숫자 줄은 AI를 부르면 안 된다")

    monkeypatch.setattr(pick, "_post", refuse)


def _row_counts():
    with session_scope() as session:
        return (
            session.scalar(select(func.count()).select_from(TransferLog)),
            session.scalar(select(func.count()).select_from(CandidateJudgment)),
        )


def test_before_judgment_counts_unjudged_and_plans_max(pick_context, monkeypatch):
    """Given 아직 판단하지 않은 충남 공장 2곳 / When 아연도금으로 센다
    / Then 맞는 공장 0 · 판단 전 2 · 더할 곳은 최대 건수(판단 뒤 늘 수 있어서), AI는 안 부른다."""
    _no_ai(monkeypatch)
    before = _row_counts()
    result = counts()
    assert (result.matched_count, result.unjudged_count) == (0, 2)
    assert result.add_count == 50  # 예시 설정 ingestion.maxCandidates
    assert _row_counts() == before


def test_after_judgment_counts_match_by_fit_and_not_yet_registered(judged, monkeypatch):
    """Given 실제 흐름이 저장한 판단(볼트 = 아연도금 상, 운송 = 제조업 아님) / When 센다
    / Then 맞는 공장 1(상 1) · 들어온 곳 0 · 더할 곳 1 · 판단 전 0. 외부 호출·저장 0건."""
    _no_ai(monkeypatch)
    before = _row_counts()
    result = counts()
    assert result.matched_count == 1
    assert result.fit_counts == {"HIGH": 1, "MEDIUM": 0, "LOW": 0}
    assert (result.registered_count, result.addable_count, result.addable_high_count) == (0, 1, 1)
    assert (result.unjudged_count, result.add_count) == (0, 1)
    assert _row_counts() == before
    # 공정·산업 조건은 판단 뒤 거르기만 한다(0원).
    assert counts(process_codes=("ANODIZING",)).matched_count == 0
    assert counts(industries=("반도체",)).matched_count == 0
    assert counts(industries=("자동차 부품",)).matched_count == 1


def test_city_filter_counts_only_rows_in_that_city(judged):
    """Given 아산·당진 공장 / When 시·군을 고른다(#521) / Then 그 시·군 공장만 센다."""
    assert counts(regions=("아산시",)).matched_count == 1
    dangjin = counts(regions=("당진시",))
    assert (dangjin.matched_count, dangjin.unjudged_count) == (0, 0)


def test_company_already_in_list_counts_as_registered(judged):
    """Given 같은 이름·주소의 회사가 이미 목록에 있음 / When 센다
    / Then 들어온 곳 1 · 더할 곳 0(등록 때 건너뛰는 기준과 같다)."""
    with session_scope() as session:
        con = session.connection().connection.driver_connection
        _insert_filled(
            con,
            "opp_customer",
            customer_id="cust-bolt",
            name="가상볼트",
            normalized_name=normalize_name("가상볼트"),
            normalized_address=normalize_address("충남 아산시 가상길 1"),
            is_virtual=1,
        )
    result = counts()
    assert (result.registered_count, result.addable_count, result.add_count) == (1, 0, 0)


def test_changed_product_or_criteria_makes_judgment_stale(judged):
    """Given 저장된 판단 / When 생산품 글이나 판단 지시문이 바뀜
    / Then 그 판단은 다시 판단할 대상(판단 전)으로 센다 — 실행 흐름의 재사용 기준과 같다."""
    with session_scope() as session:
        row = session.scalar(select(SourceFactoryRow).where(SourceFactoryRow.product == "볼트"))
        row.product = "볼트·너트"
    result = counts()
    assert (result.matched_count, result.unjudged_count) == (0, 1)
    judged["prompt"].write_text("가상 검사: 바뀐 지시문", encoding="utf-8")
    assert counts().unjudged_count == 2


def test_api_returns_counts_without_staff_key_and_rejects_bad_conditions(judged):
    """Given 판단이 저장된 DB / When 담당자 키 없이 창구를 부른다
    / Then 200과 숫자 칸(camelCase, 적합도는 HIGH·MEDIUM·LOW). 공정 없음·설정 밖 지역은 400."""
    with TestClient(create_app()) as client:
        ok = client.get(PATH, params={"processCodes": "ZINC_PLATING", "regions": "충남"})
        assert ok.status_code == 200
        assert ok.json()["data"] == {
            "matchedCount": 1,
            "fitCounts": {"HIGH": 1, "MEDIUM": 0, "LOW": 0},
            "registeredCount": 0,
            "addableCount": 1,
            "addableHighCount": 1,
            "unjudgedCount": 0,
            "addCount": 1,
            # 2단계(#549)에서 더한 칸. 값의 계산은 test_ingest_estimate.py가 본다.
            "estimate": ok.json()["data"]["estimate"],
            "month": ok.json()["data"]["month"],
            "blocked": None,
        }
        assert set(ok.json()["data"]["estimate"]) == {
            "judgeRows",
            "judgeCalls",
            "judgeUsd",
            "researchCount",
            "researchCalls",
            "researchUsd",
            "webSearchUsd",
            "totalUsd",
        }
        assert set(ok.json()["data"]["month"]) == {"usedUsd", "limitUsd", "usedCalls", "limitCalls"}
        missing = client.get(PATH, params={"regions": "충남"})
        assert missing.status_code == 400
        assert missing.json()["error"]["message"] == "찾기 조건을 확인해 주세요."
        outside = client.get(PATH, params={"processCodes": "ZINC_PLATING", "regions": "부산"})
        assert outside.status_code == 400
        assert outside.json()["error"]["fields"][0]["path"] == "regions[0]"


def _count_reads(monkeypatch):
    """지역 바탕을 실제로 읽은 횟수를 센다(#752)."""
    reads = []
    real = preview._read_region_base

    def counted(*args, **kwargs):
        reads.append(args[1])
        return real(*args, **kwargs)

    monkeypatch.setattr(preview, "_read_region_base", counted)
    return reads


def test_changing_process_or_industry_reuses_the_region_read(judged, monkeypatch):
    """Given 판단이 저장된 충남 / When 공정·산업만 바꿔 여러 번 센다(#752)
    / Then 공장 행·판단은 한 번만 읽고 숫자는 처음부터 센 것과 같다.
    지역을 바꾸면 그 지역만 새로 읽는다."""
    preview.clear_region_cache()
    reads = _count_reads(monkeypatch)
    assert counts().matched_count == 1
    assert counts(process_codes=("ANODIZING",)).matched_count == 0
    assert counts(industries=("자동차 부품",)).matched_count == 1
    assert counts(process_codes=("ZINC_PLATING", "ANODIZING")).matched_count == 1
    assert len(reads) == 1
    assert counts(regions=("아산시",)).matched_count == 1
    assert len(reads) == 2


def test_new_judgments_or_registered_company_are_seen_after_a_remembered_count(
    pick_context, monkeypatch
):
    """Given 판단 전에 한 번 센 충남(판단 전 2)
    / When 실제 흐름이 판단을 저장하고, 같은 회사가 목록에 들어온다
    / Then 다음 셈은 지역을 다시 읽어 맞는 공장 1 · 판단 전 0, 이어서 들어온 곳 1로 바로 바뀐다."""
    preview.clear_region_cache()
    reads = _count_reads(monkeypatch)
    assert counts().unjudged_count == 2

    def post(payload, key, deadline):
        rows = json.loads(payload["input"])
        return envelope(json.dumps([_answer(row) for row in rows], ensure_ascii=False))

    monkeypatch.setattr(pick, "_post", post)
    pick.pick_candidates(pick_context["batch"], pick_context["ids"])
    after = counts()
    assert (after.matched_count, after.unjudged_count, after.addable_count) == (1, 0, 1)
    assert len(reads) == 2
    with session_scope() as session:
        con = session.connection().connection.driver_connection
        _insert_filled(
            con,
            "opp_customer",
            customer_id="cust-bolt",
            name="가상볼트",
            normalized_name=normalize_name("가상볼트"),
            normalized_address=normalize_address("충남 아산시 가상길 1"),
            is_virtual=1,
        )
    registered = counts()
    assert (registered.registered_count, registered.addable_count) == (1, 0)
    # 목록에 들어온 회사는 매번 새로 세므로 지역을 다시 읽지 않는다.
    assert len(reads) == 2


def test_changed_prompt_rereads_the_region(judged, monkeypatch):
    """Given 기억한 충남 셈 / When 판단 지시문이 바뀐다(판단 기준 지문이 바뀜)
    / Then 다시 읽어 저장된 판단을 쓰지 않는다(판단 전 2)."""
    preview.clear_region_cache()
    reads = _count_reads(monkeypatch)
    assert counts().unjudged_count == 0
    judged["prompt"].write_text("가상 검사: 바뀐 지시문", encoding="utf-8")
    assert counts().unjudged_count == 2
    assert len(reads) == 2


def _bare_count():
    """설정 등록 없이 맞는 공장 수만 센다(동시 요청 시험용)."""
    with session_scope() as session:
        return preview_counts(
            session,
            process_codes=["ZINC_PLATING"],
            regions=["충남"],
            industries=[],
            max_candidates=50,
            dataset_kind="VIRTUAL_REVIEWED",
        ).matched_count


def test_requests_at_the_same_time_read_the_region_once(judged, monkeypatch):
    """Given 아직 기억이 없는 충남 / When 같은 조건의 셈 네 개가 동시에 들어온다(#752 쌓임)
    / Then 지역은 한 번만 읽고 넷 모두 같은 숫자를 받는다."""
    counts()  # 설정 등록은 먼저 한 번(동시 등록은 이 시험의 대상이 아니다)
    preview.clear_region_cache()
    reads = []
    real = preview._read_region_base

    def slow(*args, **kwargs):
        reads.append(args[1])
        time.sleep(0.2)
        return real(*args, **kwargs)

    monkeypatch.setattr(preview, "_read_region_base", slow)
    with ThreadPoolExecutor(max_workers=4) as pool:
        results = list(pool.map(lambda _: _bare_count(), range(4)))
    assert results == [1, 1, 1, 1]
    assert len(reads) == 1
