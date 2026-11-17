"""#586: 거산 확인 완료로 전환한 뒤에도 소개서 묶음 때 모은 공개 자료·AI 판단을 다시 쓴다.

가상 묶음은 실제 자료와 섞이지 않는다. 가상 응답 + 실제 임시 SQLite.
"""

import pytest

from geosan.config.errors import InputError
from geosan.opportunity.judgment_store import prepare_candidate_judgments, save_candidate_judgments
from geosan.opportunity.models import IngestBatch
from geosan.opportunity.source_models import (
    SourceFactoryRow,
    public_source_kinds,
    shares_public_source,
)
from geosan.rules.codes import DatasetKind
from geosan.storage.session import session_scope
from tests.unit.u3.test_judgment_store import INDUSTRIES, MODEL, PROCESSES, PROMPT, response
from tests.unit.u3.test_judgment_store import public_rows as public_rows


def relabel(batch_id, ids, *, rows_kind, batch_kind):
    """가상 픽스처를 실제 묶음 이름표로 바꾼다(검수 전환 뒤 DB 모양)."""
    with session_scope() as session:
        for row_id in ids:
            row = session.get(SourceFactoryRow, row_id)
            row.dataset_kind, row.is_virtual = rows_kind, rows_kind == "VIRTUAL_REVIEWED"
        batch = session.get(IngestBatch, batch_id)
        batch.dataset_kind, batch.is_virtual = batch_kind, batch_kind == "VIRTUAL_REVIEWED"


def prepare(batch_id, ids):
    return prepare_candidate_judgments(
        batch_id, ids, process_catalog=PROCESSES, industry_catalog=INDUSTRIES, prompt=PROMPT
    )


@pytest.mark.parametrize(
    ("row_kind", "batch_kind", "shared"),
    [
        ("BROCHURE", "COMPANY_CONFIRMED", True),
        ("COMPANY_CONFIRMED", "BROCHURE", True),
        ("BROCHURE", "BROCHURE", True),
        ("BROCHURE", "VIRTUAL_REVIEWED", False),
        ("VIRTUAL_REVIEWED", "COMPANY_CONFIRMED", False),
        ("VIRTUAL_REVIEWED", DatasetKind.VIRTUAL_REVIEWED, True),
    ],
)
def test_real_bundles_share_public_source_but_virtual_stays_apart(row_kind, batch_kind, shared):
    assert shares_public_source(row_kind, batch_kind) is shared
    assert (str(row_kind) in public_source_kinds(batch_kind)) is shared


def test_confirmed_batch_judges_and_reuses_brochure_rows(ingest_batch, public_rows):
    """Given 소개서 묶음 때 저장한 공장 행 / When 거산 확인 완료 회차가 판단
    / Then 거부하지 않고 판단을 저장하며, 다음 회차는 그 판단을 다시 쓴다."""
    relabel(ingest_batch, public_rows, rows_kind="BROCHURE", batch_kind="COMPANY_CONFIRMED")
    plan = prepare(ingest_batch, public_rows)
    assert plan.pending_row_ids == public_rows
    save_candidate_judgments(plan, response(public_rows), model=MODEL)
    again = prepare(ingest_batch, public_rows)
    assert again.pending_row_ids == () and len(again.reused) == 2


def test_virtual_batch_never_uses_real_rows(ingest_batch, public_rows):
    """Given 실제(소개서) 공장 행 / When 가상 회차가 판단 / Then 섞지 않고 거부한다."""
    relabel(ingest_batch, public_rows, rows_kind="BROCHURE", batch_kind="VIRTUAL_REVIEWED")
    with pytest.raises(InputError, match="자료 묶음"):
        prepare(ingest_batch, public_rows)
