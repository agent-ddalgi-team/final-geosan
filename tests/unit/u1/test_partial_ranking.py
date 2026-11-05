"""#296: 한 곳의 점수만 계산하고 목록 전체의 순위는 빠짐없이 이어서 저장한다."""

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select

from geosan.api.app import create_app
from geosan.capability.importer import import_capability
from geosan.evaluation.ledger import latest_confirmed_evaluation, latest_full_batch
from geosan.evaluation.models import EvaluationRun
from geosan.opportunity.importer import import_case
from geosan.storage.session import session_scope
from geosan.workflows import flow_evaluate, flow_extract
from tests import factories
from tests.unit.u1.test_customer_relation import detail, save, stored_rows
from tests.unit.u1.test_snapshot_ledger import _write
from tests.unit.u2 import test_extraction as extraction_support

search_env = extraction_support.search_env
extract_env = extraction_support.extract_env


def add_case(tmp_path, key):
    case = factories.apjeong_renamed_customer(key, f"가상후보 {key}")
    case["customer"]["relationStatus"] = "NEW_CONFIRMED"
    return import_case(_write(tmp_path, f"{key}.json", case)).opp_id


def cards(client, **params):
    response = client.get("/api/v1/opportunities", params=params)
    assert response.status_code == 200, response.text
    return response.json()["data"]


def current_runs(opp_ids):
    with session_scope() as session:
        return {
            opp_id: {
                column.name: getattr(latest_confirmed_evaluation(session, opp_id), column.name)
                for column in EvaluationRun.__table__.columns
            }
            for opp_id in opp_ids
        }


def anchor_ranks():
    with session_scope() as session:
        batch = latest_full_batch(session, dataset_kind="VIRTUAL_REVIEWED")
        return {
            row.opp_id: row.original_rank
            for row in session.scalars(
                select(EvaluationRun).where(EvaluationRun.batch_id == batch.batch_id)
            )
        }


@pytest.fixture
def ranking_env(tmp_db, tmp_path):
    import_capability(_write(tmp_path, "cap.json", factories.capability_file()))
    opp_ids = [add_case(tmp_path, f"candidate-{i}") for i in range(3)]
    assert flow_evaluate.run_evaluation().ok
    with TestClient(create_app()) as client:
        yield client, opp_ids


def assert_list_ranks(client, expected):
    actual = cards(client)
    assert [row["oppId"] for row in actual] == expected
    assert [row["rank"] for row in actual] == list(range(1, len(expected) + 1))
    assert anchor_ranks() == {opp_id: i for i, opp_id in enumerate(expected, 1)}
    assert {
        opp_id: run["original_rank"] for opp_id, run in current_runs(expected).items()
    } == anchor_ranks()


def move_first_to_existing(client):
    before = cards(client)
    target = before[0]["oppId"]
    response = save(client, target, "EXISTING_CONFIRMED", detail(client, target)["evalId"])
    assert response.status_code == 200, response.text
    return target, [row["oppId"] for row in before]


def test_relation_change_moves_company_to_bottom_without_recalculating_peers(
    ranking_env, monkeypatch
):
    client, opp_ids = ranking_env
    before = current_runs(opp_ids)
    evaluated = []
    original = flow_evaluate.evaluate

    def track(source):
        evaluated.append(source.opportunity.opp_id)
        return original(source)

    monkeypatch.setattr(flow_evaluate, "evaluate", track)
    target, order = move_first_to_existing(client)
    expected = order[1:] + order[:1]
    assert_list_ranks(client, expected)
    assert set(evaluated) == {target}
    after = current_runs(opp_ids)
    for opp_id in opp_ids:
        if opp_id != target:
            assert {k: v for k, v in after[opp_id].items() if k != "original_rank"} == {
                k: v for k, v in before[opp_id].items() if k != "original_rank"
            }
        else:
            assert after[opp_id]["eval_id"] != before[opp_id]["eval_id"]
            assert [after[opp_id][k] for k in ("score_e", "score_p", "score_s", "score_r")] == [
                77,
                95,
                81.1,
                82,
            ]
    # 쪽 나누기·공정 탭도 저장된 전체 순서를 사용한다.
    assert cards(client, page=3, pageSize=1)[0]["oppId"] == target
    assert [row["oppId"] for row in cards(client, process="ANODIZING")] == expected


def test_repeated_partial_evaluation_uses_latest_peer_result_and_can_restore_order(ranking_env):
    client, _ = ranking_env
    target, order = move_first_to_existing(client)
    peer = order[1]
    assert flow_evaluate.run_evaluation([peer]).ok
    assert_list_ranks(client, order[1:] + order[:1])
    response = save(client, target, "NEW_CONFIRMED", detail(client, target)["evalId"])
    assert response.status_code == 200
    assert_list_ranks(client, order)


def test_shared_customer_moves_all_its_opportunities_without_recalculating_peers(tmp_db, tmp_path):
    """Given 같은 회사의 카드 둘 / When 거래 중 저장 / Then 둘 다 뒤로 가고 점수는 보존된다."""
    import_capability(_write(tmp_path, "cap.json", factories.capability_file()))
    cases = []
    for key, name in (
        ("shared-a", "가상공유회사"),
        ("shared-b", "가상공유회사"),
        ("unrelated", "가상다른회사"),
    ):
        document = factories.apjeong_renamed_customer(key, name)
        document["customer"]["relationStatus"] = "NEW_CONFIRMED"
        cases.append(import_case(_write(tmp_path, f"{key}.json", document)))
    assert cases[0].customer_id == cases[1].customer_id != cases[2].customer_id
    assert flow_evaluate.run_evaluation().ok
    target, sibling, unrelated = [case.opp_id for case in cases]
    with TestClient(create_app()) as client:
        original_order = [row["oppId"] for row in cards(client)]
        before = current_runs([target, sibling, unrelated])
        response = save(client, target, "EXISTING_CONFIRMED", detail(client, target)["evalId"])
        assert response.status_code == 200, response.text
        # BR6.4~6.5: 동점 카드끼리의 기존 기회 ID 순서는 보존하고 거래 중 묶음만 뒤로 보낸다.
        expected = [unrelated] + [opp_id for opp_id in original_order if opp_id != unrelated]
        assert_list_ranks(client, expected)
        assert all(row["relationStatus"] == "EXISTING_CONFIRMED" for row in cards(client)[1:])
        assert cards(client, page=1, pageSize=1)[0]["oppId"] == unrelated
        assert [row["oppId"] for row in cards(client, process="ANODIZING")] == expected
        after = current_runs([sibling, unrelated])
        for opp_id in after:
            assert {k: v for k, v in after[opp_id].items() if k != "original_rank"} == {
                k: v for k, v in before[opp_id].items() if k != "original_rank"
            }
        response = save(client, target, "NEW_CONFIRMED", detail(client, target)["evalId"])
        assert response.status_code == 200, response.text
        assert_list_ranks(client, original_order)


def test_research_reevaluation_preserves_peer_scores_and_population_ranks(extract_env, tmp_path):
    case, transport = extract_env
    opp_ids = [
        case.opp_id,
        add_case(tmp_path, "research-peer-a"),
        add_case(tmp_path, "research-peer-b"),
    ]
    assert flow_evaluate.run_evaluation().ok
    with TestClient(create_app()) as client:
        order = [row["oppId"] for row in cards(client)]
        target = order[-1]  # 혼자 1등이 되던 오류를 확실하게 재현한다.
        before = current_runs(opp_ids)
        result = flow_extract.run_extract(target, extraction_support.URL)
        assert result.ok, result.error
        assert result.affected_opp_ids == [target] and len(result.new_eval_ids) == 1
        assert transport.call_count == 1
        assert_list_ranks(client, order)
        after = current_runs(opp_ids)
        for opp_id in opp_ids:
            if opp_id != target:
                assert after[opp_id] == before[opp_id]


def test_failure_after_reranking_rolls_back_peer_ranks_and_relation(ranking_env, monkeypatch):
    client, _ = ranking_env
    target = cards(client)[0]["oppId"]
    before = stored_rows()
    original = flow_evaluate.upsert_question

    def fail_after_question(*args, **kwargs):
        original(*args, **kwargs)
        raise RuntimeError("가상 질문 저장 실패")

    monkeypatch.setattr(flow_evaluate, "upsert_question", fail_after_question)
    response = save(client, target, "EXISTING_CONFIRMED", detail(client, target)["evalId"])
    assert response.status_code == 500
    assert stored_rows() == before


def test_partial_evaluation_does_not_change_an_older_full_batch(ranking_env):
    client, _ = ranking_env
    with session_scope() as session:
        old = latest_full_batch(session, dataset_kind="VIRTUAL_REVIEWED").batch_id
        old_ranks = {
            row.eval_id: row.original_rank
            for row in session.scalars(select(EvaluationRun).where(EvaluationRun.batch_id == old))
        }
    assert flow_evaluate.run_evaluation().ok
    target, order = move_first_to_existing(client)
    assert_list_ranks(client, order[1:] + [target])
    with session_scope() as session:
        assert {
            row.eval_id: row.original_rank
            for row in session.scalars(select(EvaluationRun).where(EvaluationRun.batch_id == old))
        } == old_ranks


def test_new_case_outside_full_population_does_not_leave_gaps(ranking_env, tmp_path):
    client, _ = ranking_env
    order = [row["oppId"] for row in cards(client)]
    outside = add_case(tmp_path, "outside-full-population")
    assert flow_evaluate.run_evaluation([outside]).ok
    assert_list_ranks(client, order)
    assert current_runs([outside])[outside]["original_rank"] == 1


def test_partial_evaluation_before_any_full_batch_stays_supported(tmp_db, tmp_path):
    import_capability(_write(tmp_path, "cap.json", factories.capability_file()))
    opp_id = add_case(tmp_path, "without-full-batch")
    result = flow_evaluate.run_evaluation([opp_id])
    assert result.ok and result.affected_opp_ids == [opp_id]
    assert current_runs([opp_id])[opp_id]["original_rank"] == 1
