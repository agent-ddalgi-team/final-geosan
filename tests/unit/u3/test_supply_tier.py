"""#860: 목록에 들어온 회사만 공급망 위치(2·3차 가공 / 1차 완성품·조립)를 따로 판단한다.

가짜 Responses 응답과 실제 SQLite만 쓴다(실제 AI 호출 없음). 가상 회사만 쓴다(거산 실제 사양 아님).
"""

import json
from types import SimpleNamespace

import pytest
from sqlalchemy import select

from geosan.api.ingest_views import candidate_order, discovery_fields
from geosan.api.schemas import DetailHeader
from geosan.config.app_settings import AiPickSettings, load_app_settings
from geosan.config.errors import AppError
from geosan.evidence.transfer import TransferLog
from geosan.opportunity import supply_tier as tier
from geosan.opportunity.models import Customer, Opportunity
from geosan.storage.base import utcnow
from geosan.storage.session import session_scope
from tests.unit.u3.test_candidate_pick import envelope, setting

PRODUCTS = {
    "cust-bolt": ("가상볼트", "볼트·너트 가공"),
    "cust-train": ("가상차량", "철도차량 완성품 조립"),
    "cust-misc": ("가상기타", "기타 금속제품"),
}


def answer_for(ids):
    table = {
        "cust-bolt": ("TIER2_3", "볼트·너트를 직접 가공"),
        "cust-train": ("TIER1", "철도차량 완성품 조립 납품"),
        "cust-misc": ("UNKNOWN", None),
    }
    return json.dumps(
        [{"customerId": cid, "supplyTier": table[cid][0], "basis": table[cid][1]} for cid in ids],
        ensure_ascii=False,
    )


def add_company(customer_id, *, batch="batch-test", **changes):
    name, product = PRODUCTS.get(customer_id, ("가상회사", "부품"))
    with session_scope() as session:
        session.add(
            Customer(
                **(
                    dict(
                        customer_id=customer_id,
                        name=name,
                        normalized_name=name,
                        address="충남 아산시 가상길 1",
                        normalized_address=customer_id,
                        relation_status="UNCONFIRMED",
                        security_grade="PUBLIC",
                        discovery_source="FACTORY_FILE" if batch else "CASE_FILE",
                        ingest_batch_id=batch,
                        ingested_at=utcnow() if batch else None,
                        fit_level="HIGH" if batch else None,
                        dataset_kind="VIRTUAL_REVIEWED",
                        is_virtual=True,
                    )
                    | changes
                )
            )
        )
        session.add(
            Opportunity(
                opp_id=f"opp-{customer_id}",
                customer_id=customer_id,
                item=product,
                purpose="NEW_PROPOSAL",
                dataset_kind="VIRTUAL_REVIEWED",
                is_virtual=True,
            )
        )


@pytest.fixture
def tier_env(ingest_batch, monkeypatch):
    setting("ingestion", aiPick={"enabled": True, "rowsPerCall": 2})
    monkeypatch.setenv("OPENAI_API_KEY", "synthetic")
    calls = []

    def post(payload, key, deadline):
        rows = json.loads(payload["input"])
        calls.append({"payload": payload, "rows": rows})
        return envelope(answer_for([row["customerId"] for row in rows]))

    monkeypatch.setattr(tier, "_post", post)
    return calls


def customer(customer_id):
    with session_scope() as session:
        found = session.get(Customer, customer_id)
        session.expunge(found)
        return found


# ---------- 판단 결과 검사 ----------


def test_parse_keeps_sent_order_and_allows_unknown_without_basis():
    text = answer_for(["cust-train", "cust-misc", "cust-bolt"])
    result = tier.parse_supply_tiers(text, ["cust-bolt", "cust-train", "cust-misc"])
    assert [(item.customer_id, item.supply_tier, item.basis) for item in result] == [
        ("cust-bolt", "TIER2_3", "볼트·너트를 직접 가공"),
        ("cust-train", "TIER1", "철도차량 완성품 조립 납품"),
        ("cust-misc", "UNKNOWN", None),
    ]


@pytest.mark.parametrize(
    "row",
    [
        {"customerId": "a", "supplyTier": "TIER1", "basis": None},
        {"customerId": "a", "supplyTier": "UNKNOWN", "basis": "근거가 있음"},
        {"customerId": "a", "supplyTier": "TIER2_3", "basis": "담당 010-1234-5678"},
        {"customerId": "a", "supplyTier": "TIER3", "basis": "모르는 값"},
        {"customerId": "a", "supplyTier": "TIER1", "basis": "조립", "extra": 1},
        {"customerId": "b", "supplyTier": "TIER1", "basis": "보내지 않은 회사"},
    ],
    ids=["1차인데 근거 없음", "모름인데 근거", "연락처", "모르는 값", "모르는 칸", "다른 회사"],
)
def test_parse_rejects_whole_batch_on_any_mismatch(row):
    with pytest.raises(AppError) as error:
        tier.parse_supply_tiers(json.dumps([row], ensure_ascii=False), ["a"])
    assert error.value.kind == "LLM_FAILED"


# ---------- 판단·저장 ----------


def test_judges_only_given_companies_in_batches_and_records_each_call(tier_env):
    """Given 후보 찾기로 들어온 회사 3곳 / When 공급망 위치 판단(묶음 2곳)
    / Then 2번 보내고 위치·근거·출처(PRODUCT)가 저장되며 전송 기록이 호출마다 남는다."""
    for customer_id in PRODUCTS:
        add_company(customer_id)
    result = tier.judge_supply_tiers(list(PRODUCTS), requested_by="park-lee")
    assert result == tier.SupplyTierResult(judged=3, skipped=0)
    assert [len(call["rows"]) for call in tier_env] == [2, 1]
    assert (customer("cust-train").supply_tier, customer("cust-train").supply_tier_basis) == (
        "TIER1",
        "철도차량 완성품 조립 납품",
    )
    assert customer("cust-bolt").supply_tier_source == "PRODUCT"
    assert (customer("cust-misc").supply_tier, customer("cust-misc").supply_tier_basis) == (
        "UNKNOWN",
        None,
    )
    with session_scope() as session:
        logs = session.scalars(select(TransferLog).where(TransferLog.purpose == "EXTERNAL_AI"))
        assert [(log.decision, log.call_count) for log in logs] == [("ALLOWED", 1)] * 2


def test_sends_only_public_fields(tier_env):
    """보내는 값은 회사명·생산품·업종명·원자재뿐이다. 주소·대표번호·메모는 보내지 않는다."""
    add_company(
        "cust-bolt",
        main_phone="041-000-0000",
        factory_industry_name="볼트 제조업",
        factory_raw_materials="철강재",
    )
    tier.judge_supply_tiers(["cust-bolt"], requested_by="park-lee")
    (call,) = tier_env
    assert call["rows"] == [
        {
            "customerId": "cust-bolt",
            "companyName": "가상볼트",
            "product": "볼트·너트 가공",
            "industryName": "볼트 제조업",
            "rawMaterials": "철강재",
        }
    ]
    sent = json.dumps(call["payload"], ensure_ascii=False)
    assert "041-000-0000" not in sent and "가상길" not in sent
    assert "tier-v2" in call["payload"]["instructions"]


def test_homepage_decided_company_is_not_asked_or_overwritten(tier_env):
    add_company(
        "cust-train",
        supply_tier="TIER2_3",
        supply_tier_basis="홈페이지: 부품 가공",
        supply_tier_source="HOMEPAGE",
    )
    add_company("cust-bolt")
    result = tier.judge_supply_tiers(["cust-train", "cust-bolt"], requested_by="park-lee")
    assert result == tier.SupplyTierResult(judged=1, skipped=1)
    assert [row["customerId"] for row in tier_env[0]["rows"]] == ["cust-bolt"]
    assert customer("cust-train").supply_tier_source == "HOMEPAGE"


def test_company_with_contact_in_public_value_is_not_sent(tier_env):
    add_company("cust-bolt")
    add_company("cust-misc", factory_raw_materials="문의 010-1234-5678")
    result = tier.judge_supply_tiers(["cust-bolt", "cust-misc"], requested_by="park-lee")
    assert result == tier.SupplyTierResult(judged=1, skipped=1)
    assert customer("cust-misc").supply_tier is None


def test_failed_batch_keeps_earlier_batch_and_raises(tier_env, monkeypatch):
    for customer_id in PRODUCTS:
        add_company(customer_id)
    original = tier._post

    def second_fails(payload, key, deadline):
        if tier_env:
            return {
                "status": "failed",
                "output": [],
                "usage": {"input_tokens": 1, "output_tokens": 1},
            }
        return original(payload, key, deadline)

    monkeypatch.setattr(tier, "_post", second_fails)
    with pytest.raises(AppError):
        tier.judge_supply_tiers(list(PRODUCTS), requested_by="park-lee")
    assert customer("cust-bolt").supply_tier == "TIER2_3"
    assert customer("cust-misc").supply_tier is None


def test_switch_off_sends_nothing(tier_env):
    setting("ingestion", aiPick={"enabled": False})
    add_company("cust-bolt")
    with pytest.raises(AppError):
        tier.judge_supply_tiers(["cust-bolt"], requested_by="park-lee")
    assert tier_env == []


def test_targets_are_found_companies_without_tier(ingest_batch):
    add_company("cust-bolt")
    add_company(
        "cust-train", supply_tier="TIER1", supply_tier_basis="조립", supply_tier_source="PRODUCT"
    )
    add_company("cust-case", batch=None)
    with session_scope() as session:
        assert tier.customers_without_tier(session) == ["cust-bolt"]


# ---------- 목록 순서·응답 칸 ----------


def _order(fit_level, supply_tier):
    customer_row = SimpleNamespace(
        ingest_batch_id="b",
        own_plating_line_suspected=False,
        fit_level=fit_level,
        supply_tier=supply_tier,
        ingested_at=None,
        created_at=utcnow(),
    )
    run = SimpleNamespace(score_s=None, opp_id="o", batch_id="x", original_rank=0)
    return candidate_order(run, run, customer_row, None)


def test_tier1_goes_back_only_within_same_fit_level():
    """같은 적합도 안에서는 1차가 뒤, 적합도가 다르면 적합도가 먼저다(PM 결정 2026-11-19)."""
    assert _order("HIGH", "TIER2_3") < _order("HIGH", "TIER1")
    assert _order("HIGH", None) < _order("HIGH", "TIER1")
    assert _order("HIGH", "TIER1") < _order("MEDIUM", "TIER2_3")


def test_card_and_header_carry_tier_fields(ingest_batch):
    add_company(
        "cust-train",
        supply_tier="TIER1",
        supply_tier_basis="조립 납품",
        supply_tier_source="PRODUCT",
    )
    fields = discovery_fields(customer("cust-train"))
    assert (fields["supply_tier"], fields["supply_tier_basis"], fields["supply_tier_source"]) == (
        "TIER1",
        "조립 납품",
        "PRODUCT",
    )
    dumped = DetailHeader.model_fields
    assert {"supply_tier", "supply_tier_basis", "supply_tier_source"} <= set(dumped)


def test_example_settings_point_to_existing_prompt(app_settings_path):
    config = load_app_settings(app_settings_path).ingestion.ai_pick
    assert (tier.REPO_ROOT / config.supply_tier_prompt_file).is_file()


def test_old_settings_without_new_key_read_default_prompt():
    """배포 설정 파일에는 새 칸이 없다. 기본 지시문 경로로 읽혀 설정 파일을 바꾸지 않아도 된다."""
    config = AiPickSettings.model_validate({"enabled": True})
    assert config.supply_tier_prompt_file == "examples/prompts/supply-tier.md"


# ---------- 부르는 곳: 후보 찾기 직후 · 운영 명령 ----------


def test_ingest_judges_only_new_companies_of_the_batch(tier_env):
    """Given 이번 회차로 들어온 회사 2곳과 다른 회차 회사 / When 후보 찾기 끝 단계
    / Then 이번 회차 회사만 판단하고 전송 기록은 회차에 남는다."""
    from geosan.workflows.flow_ingest import _judge_new_tiers

    add_company("cust-bolt")
    add_company("cust-train")
    add_company("cust-misc", batch="other-batch")
    _judge_new_tiers("batch-test", "park-lee")
    assert sorted(row["customerId"] for call in tier_env for row in call["rows"]) == [
        "cust-bolt",
        "cust-train",
    ]
    assert customer("cust-misc").supply_tier is None
    with session_scope() as session:
        assert {log.batch_id for log in session.scalars(select(TransferLog))} == {"batch-test"}


def test_ingest_tier_failure_leaves_companies_before_judgment(tier_env, monkeypatch, caplog):
    """PM 결정 2026-11-20: 위치 판단이 실패해도 후보 찾기는 끝나고 위치는 판단 전(로그)."""
    from geosan.workflows.flow_ingest import _judge_new_tiers

    add_company("cust-bolt")
    monkeypatch.setattr(
        tier, "_post", lambda *args: {"status": "failed", "output": [], "usage": {}}
    )
    _judge_new_tiers("batch-test", "park-lee")
    assert customer("cust-bolt").supply_tier is None
    assert "공급망 위치 판단 실패" in caplog.text


def test_command_judges_missing_companies_and_prints_counts_only(tier_env, capsys):
    from geosan.commands.supply_tier import run_supply_tier

    add_company("cust-bolt")
    add_company("cust-case", batch=None)
    assert run_supply_tier("park-lee") == 0
    out = capsys.readouterr().out
    assert "1곳 저장" in out and "가상볼트" not in out
    assert customer("cust-case").supply_tier is None
    with session_scope() as session:
        (log,) = session.scalars(select(TransferLog))
        assert (log.batch_id, log.opp_id) == (None, "opp-cust-bolt")
    assert run_supply_tier("park-lee") == 0
    assert "판단할 것이 없습니다" in capsys.readouterr().out


def test_command_rejects_unknown_staff_and_switch_off(tier_env, capsys):
    from geosan.commands.supply_tier import run_supply_tier

    add_company("cust-bolt")
    assert run_supply_tier("nobody") == 1
    setting("ingestion", aiPick={"enabled": False})
    assert run_supply_tier("park-lee") == 2
    assert tier_env == []


# ---------- 이전 파일 opp_012 ----------


def test_migration_adds_empty_tier_columns_and_keeps_rows(tmp_path):
    """Given rec_018 DB의 회사 한 곳 / When opp_012로 올림 / Then 세 칸이 비어 있는 채로 붙고
    다른 값은 그대로, 내리면 칸만 빠진다."""
    import sqlite3

    from geosan.storage.migrate import downgrade, upgrade_to_head
    from tests.unit.u3.test_ingest_tables import _insert_filled

    db = tmp_path / "old.db"
    upgrade_to_head(db)
    downgrade(db, "rec_018")
    with sqlite3.connect(db) as con:
        _insert_filled(con, "opp_customer", customer_id="cust-old", name="가상기업")
    assert upgrade_to_head(db) == ["opp_012"]
    with sqlite3.connect(db) as con:
        row = con.execute(
            "SELECT name, supply_tier, supply_tier_basis, supply_tier_source FROM opp_customer"
        ).fetchone()
    assert row == ("가상기업", None, None, None)
    assert downgrade(db, "rec_018") == ["rec_018"]
    with sqlite3.connect(db) as con:
        columns = {line[1] for line in con.execute("PRAGMA table_info(opp_customer)")}
        assert "supply_tier" not in columns
        assert con.execute("SELECT name FROM opp_customer").fetchone() == ("가상기업",)


# ---------- #877: 지시문을 고친 뒤 다시 판단(--redo) ----------


def test_redo_targets_product_judged_but_not_homepage(ingest_batch):
    """Given 생산품으로 판단한 회사·홈페이지로 정한 회사·빈 회사 / When --redo 대상
    / Then 홈페이지로 정한 회사만 빠진다."""
    add_company(
        "cust-bolt", supply_tier="TIER1", supply_tier_basis="조립", supply_tier_source="PRODUCT"
    )
    add_company(
        "cust-train",
        supply_tier="TIER1",
        supply_tier_basis="홈페이지",
        supply_tier_source="HOMEPAGE",
    )
    add_company("cust-misc")
    add_company("cust-case", batch=None)
    with session_scope() as session:
        assert tier.customers_without_tier(session) == ["cust-misc"]
        assert tier.customers_without_tier(session, redo=True) == ["cust-bolt", "cust-misc"]


def test_command_redo_overwrites_product_judgment(tier_env, capsys):
    from geosan.commands.supply_tier import run_supply_tier

    add_company(
        "cust-bolt", supply_tier="TIER1", supply_tier_basis="조립", supply_tier_source="PRODUCT"
    )
    assert run_supply_tier("park-lee") == 0
    assert "판단할 것이 없습니다" in capsys.readouterr().out
    assert run_supply_tier("park-lee", redo=True) == 0
    assert (customer("cust-bolt").supply_tier, customer("cust-bolt").supply_tier_basis) == (
        "TIER2_3",
        "볼트·너트를 직접 가공",
    )


def test_tier_prompt_v2_sends_functional_parts_to_tier2_3():
    text = (tier.REPO_ROOT / "examples/prompts/supply-tier.md").read_text(encoding="utf-8")
    assert text.startswith("[지시문 버전] tier-v2")
    assert "기능 부품" in text and "TIER2_3로 본다" in text and "창호·수배전반" in text
