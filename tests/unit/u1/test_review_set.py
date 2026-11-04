"""PM의 #212 결정 A: 원본 보존·확인 묶음 복사·전체 평가를 실제 DB로 검증한다."""

import json
import sqlite3
from datetime import date

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select
from typer.testing import CliRunner

from geosan.api.app import create_app
from geosan.capability.importer import import_capability
from geosan.capability.models import FieldEvidence, Process, Qualification, QualificationStatus
from geosan.capability.queries import latest_qualification_status, latest_review
from geosan.capability.review import REVIEW_MODELS
from geosan.commands.app import app
from geosan.config.app_settings import set_active_dataset_kind
from geosan.config.registry import active_dataset_kind
from geosan.evaluation.models import EvaluationBatch, EvaluationRun
from geosan.opportunity.importer import import_case
from geosan.storage.session import session_scope
from geosan.workflows import flow_evaluate
from tests.factories import brochure_case

REVIEW_DATE = date(2026, 11, 4)
FLAGS = ["--by", "가상 검수자", "--basis", "가상 전체 확인"]


def invoke(*args):
    return CliRunner().invoke(app, ["review-set", *args, *FLAGS])


def database_rows(path):
    with sqlite3.connect(path) as connection:
        return tuple(connection.iterdump())


@pytest.fixture
def review_db(tmp_db, tmp_path, monkeypatch):
    from geosan.commands import review_set

    monkeypatch.setattr(review_set, "today_in_seoul", lambda: REVIEW_DATE)
    monkeypatch.setattr(flow_evaluate, "today_in_seoul", lambda: REVIEW_DATE)
    import_capability("tests/data/capability-brochure.json")
    with session_scope() as session:
        set_active_dataset_kind(session, "BROCHURE", updated_by="test")
    for case_id in ("review-one", "review-two"):
        path = tmp_path / f"{case_id}.json"
        path.write_text(json.dumps(brochure_case(case_id)), encoding="utf-8")
        import_case(path)
    result = flow_evaluate.run_evaluation(base_date=REVIEW_DATE)
    assert result.ok and len(result.new_eval_ids) == 2
    return tmp_db


def catalogue(session, kind):
    return {
        model: list(session.scalars(select(model).where(model.dataset_kind == kind)))
        for model in (*REVIEW_MODELS, QualificationStatus, FieldEvidence)
    }


def snapshot(rows):
    return {
        model: [
            {column.name: getattr(row, column.name) for column in model.__table__.columns}
            for row in values
        ]
        for model, values in rows.items()
    }


def test_copy_preserves_originals_and_all_links_with_audited_full_evaluation(review_db):
    with session_scope() as session:
        before = snapshot(catalogue(session, "BROCHURE"))
        prior_statuses = {
            row.official_name: latest_qualification_status(
                session, row.qual_id, dataset_kind="BROCHURE"
            ).status
            for row in session.scalars(select(Qualification))
        }
    result = invoke("--all", "REVIEWED")
    assert result.exit_code == 0, result.output
    assert "COMPANY_CONFIRMED" in result.output and "기회 2건" in result.output
    with session_scope() as session:
        assert active_dataset_kind(session) == "COMPANY_CONFIRMED"
        assert snapshot(catalogue(session, "BROCHURE")) == before
        copied = catalogue(session, "COMPANY_CONFIRMED")
        process_ids = {row.process_id for row in copied[Process]}
        qual_ids = {row.qual_id for row in copied[Qualification]}
        for model, rows in copied.items():
            assert len(rows) == len(before[model])
            for row in rows:
                assert not row.is_virtual
                if hasattr(row, "process_id") and row.process_id:
                    assert row.process_id in process_ids
                if hasattr(row, "qual_id"):
                    assert row.qual_id in qual_ids
                if model in REVIEW_MODELS:
                    proof = latest_review(session, row, dataset_kind="COMPANY_CONFIRMED")
                    assert proof.data_version == 1
                    assert proof.review_status == row.review_status == "REVIEWED"
                    assert (proof.reviewer, proof.reviewed_at, proof.basis) == (
                        "가상 검수자",
                        REVIEW_DATE,
                        "가상 전체 확인",
                    )
                    assert proof.value_snapshot["dataset_kind"] == "COMPANY_CONFIRMED"
                    assert proof.value_snapshot["review_status"] == "REVIEWED"
        for row in copied[Qualification]:
            status = latest_qualification_status(
                session, row.qual_id, dataset_kind="COMPANY_CONFIRMED"
            )
            assert status.status == prior_statuses[row.official_name]
        batch = session.scalar(
            select(EvaluationBatch).where(EvaluationBatch.dataset_kind == "COMPANY_CONFIRMED")
        )
        assert (batch.scope, batch.status, batch.base_date) == ("FULL", "CONFIRMED", REVIEW_DATE)
        runs = list(
            session.scalars(select(EvaluationRun).where(EvaluationRun.batch_id == batch.batch_id))
        )
        assert len(runs) == 2 and all(row.score_display.startswith("참고") is False for row in runs)
    saved = database_rows(review_db)
    again = invoke("--all", "REVIEWED")
    assert again.exit_code == 1 and "이미 COMPANY_CONFIRMED" in again.output
    assert database_rows(review_db) == saved


def test_bulk_changes_pending_only_and_keeps_existing_review_proof(review_db):
    with session_scope() as session:
        processes = list(session.scalars(select(Process)))
        statuses = ["UNAVAILABLE", "REVIEWED", "RECHECK"]
        expected = {}
        for row, status in zip(processes, statuses, strict=False):
            proof = latest_review(session, row, dataset_kind="BROCHURE")
            proof.review_status = row.review_status = status
            proof.reviewer, proof.reviewed_at, proof.basis = (
                "이전 확인자",
                date(2026, 10, 29),
                "이전 근거",
            )
            expected[row.code] = status
        before = snapshot(catalogue(session, "BROCHURE"))
    assert invoke("--all", "REVIEWED", "--no-evaluate").exit_code == 0
    with session_scope() as session:
        assert snapshot(catalogue(session, "BROCHURE")) == before
        rows = session.scalars(select(Process).where(Process.dataset_kind == "COMPANY_CONFIRMED"))
        for row in rows:
            proof = latest_review(session, row, dataset_kind="COMPANY_CONFIRMED")
            assert row.review_status == expected.get(row.code, "REVIEWED")
            if row.code in expected:
                assert (proof.reviewer, proof.reviewed_at, proof.basis) == (
                    "이전 확인자",
                    date(2026, 10, 29),
                    "이전 근거",
                )


@pytest.mark.parametrize("bulk", [True, False])
def test_failure_after_first_evaluation_save_rolls_back_every_table(review_db, monkeypatch, bulk):
    """Given 평가 2건 / When 1건 저장 후 실패 / Then 이전 평가·검수·설정 모두 그대로."""
    with session_scope() as session:
        target = session.scalar(select(Process)).process_id
    before = database_rows(review_db)
    original = flow_evaluate.save_evaluation
    called = []

    def save_then_fail(*args, **kwargs):
        saved = original(*args, **kwargs)
        called.append(saved.eval_id)
        raise RuntimeError("평가 저장 뒤 가상 실패")

    monkeypatch.setattr(flow_evaluate, "save_evaluation", save_then_fail)
    result = invoke(*(["--all", "REVIEWED"] if bulk else ["PROCESS", target, "REVIEWED"]))
    assert result.exit_code == 2 and len(called) == 1
    assert "재평가 완료" not in result.output
    assert database_rows(review_db) == before


@pytest.mark.parametrize(
    "kind,model",
    [
        ("PROCESS", REVIEW_MODELS[0]),
        ("CAPABILITY", REVIEW_MODELS[1]),
        ("FIELD", REVIEW_MODELS[2]),
        ("QUALIFICATION", REVIEW_MODELS[3]),
        ("FIELD", REVIEW_MODELS[4]),
    ],
)
def test_individual_review_and_recheck_reevaluate_active_dataset(review_db, kind, model):
    with session_scope() as session:
        row = session.scalar(select(model))
        target = getattr(row, next(iter(model.__table__.primary_key.columns)).name)
    for status in ("REVIEWED", "RECHECK"):
        result = invoke(kind, target, status)
        assert result.exit_code == 0 and "기회 2건" in result.output
        with session_scope() as session:
            row = session.get(model, target)
            assert row.review_status == status
            assert latest_review(session, row, dataset_kind="BROCHURE").review_status == status
            assert active_dataset_kind(session) == "BROCHURE"


def test_no_evaluate_is_explicit_and_later_evaluation_populates_list(review_db):
    result = invoke("--all", "REVIEWED", "--no-evaluate")
    assert result.exit_code == 0 and "재평가 생략" in result.output
    with TestClient(create_app()) as client:
        assert client.get("/api/v1/opportunities").json()["data"] == []
        evaluated = CliRunner().invoke(app, ["evaluate"])
        assert evaluated.exit_code == 0
        response = client.get("/api/v1/opportunities")
        assert response.status_code == 200
        payload = response.json()
        assert payload["meta"]["datasetKind"] == "COMPANY_CONFIRMED"
        assert len(payload["data"]) == 2


@pytest.mark.parametrize(
    "args",
    [
        [],
        ["--all", "RECHECK"],
        ["--all", "PENDING"],
        ["PROCESS", "missing", "REVIEWED"],
        ["REQUIREMENT", "missing", "REVIEWED"],
        ["PROCESS", "missing", "REVIEWED", "--no-evaluate"],
    ],
)
def test_invalid_target_is_rejected_without_writes(review_db, args):
    before = database_rows(review_db)
    assert invoke(*args).exit_code == 1
    assert database_rows(review_db) == before


@pytest.mark.parametrize(
    "flags",
    [
        [],
        ["--by", "검수자"],
        ["--by", " ", "--basis", "근거"],
        ["--by", "test@example.com", "--basis", "근거"],
        ["--by", "검수자", "--basis", "전화 010-1234-5678"],
    ],
)
def test_missing_proof_or_contact_is_rejected_without_writes(review_db, flags):
    before = database_rows(review_db)
    result = CliRunner().invoke(app, ["review-set", "--all", "REVIEWED", *flags])
    assert result.exit_code == 1
    assert database_rows(review_db) == before


def test_wrong_active_dataset_and_preexisting_confirmed_dataset_are_rejected(review_db):
    with session_scope() as session:
        process_id = session.scalar(select(Process)).process_id
        set_active_dataset_kind(session, "VIRTUAL_REVIEWED", updated_by="test")
    before = database_rows(review_db)
    assert invoke("PROCESS", process_id, "REVIEWED").exit_code == 1
    assert invoke("--all", "REVIEWED").exit_code == 1
    assert database_rows(review_db) == before
    with session_scope() as session:
        set_active_dataset_kind(session, "BROCHURE", updated_by="test")
    assert invoke("--all", "REVIEWED").exit_code == 0
    with session_scope() as session:
        set_active_dataset_kind(session, "BROCHURE", updated_by="test")
    before = database_rows(review_db)
    result = invoke("--all", "REVIEWED")
    assert result.exit_code == 1 and "이미 COMPANY_CONFIRMED" in result.output
    assert database_rows(review_db) == before


def test_empty_catalogue_is_rejected(tmp_db):
    with session_scope() as session:
        set_active_dataset_kind(session, "BROCHURE", updated_by="test")
    before = database_rows(tmp_db)
    result = invoke("--all", "REVIEWED")
    assert result.exit_code == 1 and "복사할 소개서 값" in result.output
    assert database_rows(tmp_db) == before


def test_missing_database_is_not_created(tmp_path, monkeypatch):
    path = tmp_path / "missing.db"
    monkeypatch.setenv("GEOSAN_DB_PATH", str(path))
    result = invoke("--all", "REVIEWED")
    assert result.exit_code == 1 and "init-db" in result.output
    assert not path.exists()
