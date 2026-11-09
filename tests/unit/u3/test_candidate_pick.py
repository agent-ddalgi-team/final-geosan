"""#425: 가상 Responses 응답 + 실제 SQLite. 실제 소켓은 공통 픽스처가 차단한다."""

import json
from decimal import Decimal

import pytest
from sqlalchemy import event, select
from sqlalchemy.exc import OperationalError

from geosan.capability.models import FieldEvidence, Process
from geosan.config.app_settings import AiPickSettings, AppSettings, load_app_settings
from geosan.config.errors import AppError
from geosan.config.models import AppSetting
from geosan.evidence.transfer import TransferLog
from geosan.opportunity import candidate_pick as pick
from geosan.opportunity.candidate_judgments import candidate_criteria_version, select_candidates
from geosan.opportunity.models import IngestBatch
from geosan.opportunity.source_models import CandidateJudgment, SourceContract, SourceFactoryRow
from geosan.storage.base import utcnow
from geosan.storage.session import session_scope
from tests.unit.u3.test_judgment_store import public_rows as public_rows
from tests.unit.u3.test_judgment_store import response


def setting(key, **changes):
    with session_scope() as session:
        item = session.get(AppSetting, key)
        item.value = item.value | changes


@pytest.fixture
def pick_context(ingest_batch, public_rows, tmp_path, monkeypatch):
    prompt = tmp_path / "prompt.md"
    prompt.write_text("가상 검사: 공개 공장을 전체 공정으로 판단한다.", encoding="utf-8")
    setting("ingestion", aiPick={"enabled": True, "rowsPerCall": 1, "promptFile": str(prompt)})
    with session_scope() as session:
        session.get(AppSetting, "activeDatasetKind").value = "VIRTUAL_REVIEWED"
        for code, name in [("ZINC_PLATING", "아연도금"), ("ANODIZING", "아노다이징")]:
            session.add(
                Process(
                    process_id=code,
                    code=code,
                    name=name,
                    dataset_kind="VIRTUAL_REVIEWED",
                    is_virtual=True,
                    review_status="REVIEWED",
                )
            )
    monkeypatch.setenv("OPENAI_API_KEY", "synthetic")
    return {"batch": ingest_batch, "ids": public_rows, "prompt": prompt, "calls": []}


def envelope(text):
    return {
        "status": "completed",
        "usage": {"input_tokens": 1000, "output_tokens": 200},
        "output": [
            {
                "type": "message",
                "status": "completed",
                "role": "assistant",
                "content": [{"type": "output_text", "text": text}],
            }
        ],
    }


def fake(context, monkeypatch, mutate=None):
    def post(payload, key, deadline):
        rows = json.loads(payload["input"])
        context["calls"].append(payload)
        answer = envelope(response([row["rowId"] for row in rows]))
        if mutate:
            return mutate(answer, len(context["calls"]))
        return answer

    monkeypatch.setattr(pick, "_post", post)


def run(context):
    return pick.pick_candidates(context["batch"], context["ids"])


def stored(model):
    with session_scope() as session:
        return session.scalars(select(model)).all()


def test_grouped_calls_store_all_judgments_and_reuse_without_key(pick_context, monkeypatch):
    context = pick_context
    fake(context, monkeypatch)
    first = run(context)
    assert [row.row_id for row in first] == list(context["ids"])
    assert len(context["calls"]) == len(stored(CandidateJudgment)) == 2
    assert all(
        row.cost_usd == Decimal("0.004") and row.batch_id == context["batch"]
        for row in stored(TransferLog)
    )
    for payload in context["calls"]:
        assert payload["store"] is False and "tools" not in payload
        assert "ANODIZING" in payload["instructions"]
        assert set(json.loads(payload["input"])[0]) == {
            "rowId",
            "companyName",
            "complexName",
            "product",
            "industryName",
            "address",
        }
    monkeypatch.delenv("OPENAI_API_KEY")
    with session_scope() as session:
        session.get(IngestBatch, context["batch"]).criteria = {
            "regions": ["충남"],
            "processCodes": ["ANODIZING"],
            "industries": ["반도체"],
        }
    assert run(context) == first
    assert len(context["calls"]) == len(stored(TransferLog)) == 2


def test_negative_judgment_stays_saved_and_selection_excludes_it(pick_context, monkeypatch):
    setting(
        "ingestion",
        aiPick={"enabled": True, "rowsPerCall": 100, "promptFile": str(pick_context["prompt"])},
    )
    fake(pick_context, monkeypatch)
    result = run(pick_context)
    assert [row.is_manufacturer for row in result] == [True, False]
    assert len(stored(CandidateJudgment)) == 2 and len(pick_context["calls"]) == 1
    assert len(select_candidates(result, process_codes=["ZINC_PLATING"])) == 1


@pytest.mark.parametrize("change", ["industry", "prompt", "catalog", "rejudge"])
def test_changed_input_or_criteria_rejudges_only_required_rows(pick_context, monkeypatch, change):
    fake(pick_context, monkeypatch)
    run(pick_context)
    with session_scope() as session:
        if change == "industry":
            session.get(SourceFactoryRow, pick_context["ids"][0]).industry_name = "금속가공업"
        elif change == "catalog":
            session.get(Process, "ANODIZING").name = "양극산화"
        elif change == "rejudge":
            session.get(IngestBatch, pick_context["batch"]).rejudge = True
    if change == "prompt":
        pick_context["prompt"].write_text("가상 검사 지시문 변경", encoding="utf-8")
    run(pick_context)
    assert len(pick_context["calls"]) == (3 if change == "industry" else 4)


@pytest.mark.parametrize(
    "fault",
    [
        "missing",
        "contact",
        "unknown_process",
        "too_many_industries",
        "refusal",
        "incomplete",
        "wrong_role",
    ],
)
def test_bad_response_fails_whole_call_but_keeps_confirmed_cost(pick_context, monkeypatch, fault):
    def corrupt(answer, count):
        content = answer["output"][0]["content"][0]
        values = json.loads(content["text"])
        if fault == "missing":
            values = []
        elif fault == "contact":
            values[0]["reason"] = "연락 010-1234-5678"
        elif fault == "unknown_process":
            values[0]["processCodes"] = ["PRIVATE_PROCESS"]
        elif fault == "too_many_industries":
            values[0]["industries"] = ["방위산업", "반도체", "반도체 장비", "자동차 부품"]
        elif fault == "refusal":
            content["type"] = "refusal"
        elif fault == "wrong_role":
            answer["output"][0]["role"] = "user"
        else:
            answer["status"] = "incomplete"
        content["text"] = json.dumps(values, ensure_ascii=False)
        return answer

    fake(pick_context, monkeypatch, corrupt)
    with pytest.raises(AppError) as error:
        run(pick_context)
    assert "PRIVATE" not in str(error.value) and "010-" not in str(error.value)
    assert not stored(CandidateJudgment) and len(pick_context["calls"]) == 1
    assert stored(TransferLog)[0].cost_usd == Decimal("0.004")


@pytest.mark.parametrize("fault", ["timeout", "usage", "server"])
def test_unknown_usage_blocks_next_call_without_hidden_retry(pick_context, monkeypatch, fault):
    def fail(answer, count):
        if fault == "timeout":
            raise TimeoutError("PRIVATE_PROVIDER_ERROR")
        if fault == "server":
            raise pick._HttpError(500)
        answer["usage"] = None
        return answer

    fake(pick_context, monkeypatch, fail)
    with pytest.raises(AppError):
        run(pick_context)
    with pytest.raises(AppError) as error:
        run(pick_context)
    assert error.value.kind == "USAGE_UNCONFIRMED"
    assert len(pick_context["calls"]) == 1 and stored(TransferLog)[0].cost_usd is None
    assert not stored(CandidateJudgment)


def test_429_retries_once_with_separate_zero_cost_record(pick_context, monkeypatch):
    def throttle(answer, count):
        if count == 1:
            raise pick._HttpError(429)
        return answer

    fake(pick_context, monkeypatch, throttle)
    assert len(run(pick_context)) == 2
    assert len(pick_context["calls"]) == 3
    assert [row.cost_usd for row in stored(TransferLog)] == [
        Decimal(0),
        Decimal("0.004"),
        Decimal("0.004"),
    ]


@pytest.mark.parametrize("status", [400, 401, 403, 404, 429])
def test_provider_rejection_never_retries_more_than_once(pick_context, monkeypatch, status):
    def reject(answer, count):
        raise pick._HttpError(status)

    fake(pick_context, monkeypatch, reject)
    with pytest.raises(AppError):
        run(pick_context)
    assert len(pick_context["calls"]) == (2 if status == 429 else 1)
    assert all(row.cost_usd == 0 for row in stored(TransferLog))


def test_partial_batch_failure_returns_no_partial_success(pick_context, monkeypatch):
    def fail_second(answer, count):
        return envelope("[]") if count == 2 else answer

    fake(pick_context, monkeypatch, fail_second)
    with pytest.raises(AppError):
        run(pick_context)
    assert len(stored(CandidateJudgment)) == 1
    assert len(stored(TransferLog)) == 2
    assert all(row.cost_usd is not None for row in stored(TransferLog))


@pytest.mark.parametrize(
    "kind", ["key", "mode", "limit", "disabled", "approval", "private", "dataset", "prompt"]
)
def test_invalid_configuration_or_public_source_never_sends(pick_context, monkeypatch, kind):
    fake(pick_context, monkeypatch)
    if kind == "key":
        monkeypatch.delenv("OPENAI_API_KEY")
    elif kind == "mode":
        setting("llm", mode="NONE")
    elif kind == "limit":
        setting("llm", monthlyCallLimit=0)
    elif kind == "disabled":
        setting("ingestion", aiPick={"enabled": False})
    elif kind == "prompt":
        pick_context["prompt"].unlink()
    else:
        with session_scope() as session:
            if kind == "approval":
                session.get(SourceContract, "kicox-factory-csv").confirmed_at = None
            elif kind == "dataset":
                session.get(SourceFactoryRow, pick_context["ids"][0]).dataset_kind = "BROCHURE"
            else:
                session.get(
                    SourceFactoryRow, pick_context["ids"][0]
                ).company_name = "가상 연락 010-1234-5678"
    with pytest.raises(AppError):
        run(pick_context)
    assert not pick_context["calls"] and not stored(CandidateJudgment)


@pytest.mark.parametrize("change", ["industry", "prompt", "region", "source", "catalog"])
def test_context_changed_during_response_keeps_cost_but_rejects_save(
    pick_context, monkeypatch, change
):
    def mutate(answer, count):
        with session_scope() as session:
            if change == "industry":
                session.get(SourceFactoryRow, pick_context["ids"][0]).industry_name = "변경업종"
            elif change == "region":
                session.get(IngestBatch, pick_context["batch"]).criteria = {"regions": ["대전"]}
            elif change == "source":
                session.get(SourceContract, "kicox-factory-csv").confirmed_at = None
            elif change == "catalog":
                session.get(Process, "ZINC_PLATING").name = "변경공정"
        if change == "prompt":
            pick_context["prompt"].write_text("변경 지시문", encoding="utf-8")
        return answer

    fake(pick_context, monkeypatch, mutate)
    with pytest.raises(AppError):
        run(pick_context)
    assert not stored(CandidateJudgment) and stored(TransferLog)[0].cost_usd is not None


def test_storage_failure_rolls_back_judgment_only_and_does_not_retry(pick_context, monkeypatch):
    fake(pick_context, monkeypatch)

    def fail(*args):
        raise OperationalError("PRIVATE_SQL", {}, Exception("PRIVATE_VALUE"))

    event.listen(CandidateJudgment, "before_insert", fail)
    try:
        with pytest.raises(AppError) as error:
            run(pick_context)
        assert "PRIVATE" not in str(error.value)
    finally:
        event.remove(CandidateJudgment, "before_insert", fail)
    assert len(pick_context["calls"]) == 1 and not stored(CandidateJudgment)
    assert stored(TransferLog)[0].cost_usd == Decimal("0.004")


def test_field_list_changes_criteria_even_with_same_prompt_and_catalog():
    args = {
        "process_catalog": {"A": "가상공정"},
        "industry_catalog": ["가상산업"],
        "prompt": "지시문",
    }
    assert candidate_criteria_version(**args) != candidate_criteria_version(
        **args, input_fields=["rowId", "product"]
    )


def test_process_names_follow_import_order_even_with_equal_timestamps(pick_context, monkeypatch):
    fake(pick_context, monkeypatch)
    stamp = utcnow()
    with session_scope() as session:
        for index, code in enumerate(["ZINC_PLATING", "ANODIZING"]):
            session.add(
                FieldEvidence(
                    field_evidence_id=f"process-review-{index}",
                    target_table="cap_process",
                    target_id=code,
                    target_field="reviewStatus",
                    value_snapshot="REVIEWED",
                    data_version=1,
                    review_status="REVIEWED",
                    created_at=stamp,
                    dataset_kind="VIRTUAL_REVIEWED",
                    is_virtual=True,
                )
            )
            session.flush()
    run(pick_context)
    instructions = pick_context["calls"][0]["instructions"]
    assert instructions.index("ZINC_PLATING") < instructions.index("ANODIZING")


def test_old_settings_default_off_and_examples_match(app_settings_path):
    for filename in (app_settings_path, "examples/app-settings-virtual.yaml"):
        data = load_app_settings(filename).model_dump(by_alias=True)
        assert data["ingestion"].pop("aiPick") == {
            "enabled": False,
            "rowsPerCall": 100,
            "promptFile": "examples/prompts/candidate-pick.md",
            "surfaceTreatmentIndustryNames": [],
        }
        assert AppSettings.model_validate(data).ingestion.ai_pick == AiPickSettings()


@pytest.mark.parametrize("value", [0, -1, True, "100", 1.2])
def test_invalid_batch_size_does_not_coerce(value):
    with pytest.raises(ValueError):
        AiPickSettings(rows_per_call=value)


PHONE_LIKE_ROW_ID = "factory-01M6Z00RYQBP07979303397SFN"


def test_row_id_with_phone_like_digits_is_still_sent(pick_context, monkeypatch):
    """#505: 행 번호의 숫자 열은 연락처가 아니다. 글 칸만 검사하고 행은 그대로 보낸다."""
    context = pick_context
    first = context["ids"][0]
    with session_scope() as session:
        row = session.get(SourceFactoryRow, first)
        row.row_id = PHONE_LIKE_ROW_ID
    context["ids"] = [PHONE_LIKE_ROW_ID, *context["ids"][1:]]
    fake(context, monkeypatch)
    judgments = run(context)
    assert [item.row_id for item in judgments] == context["ids"]
    sent = [json.loads(call["input"])[0]["rowId"] for call in context["calls"]]
    assert PHONE_LIKE_ROW_ID in sent
