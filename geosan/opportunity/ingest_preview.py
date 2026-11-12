"""#549 1단계: 고른 조건에 맞는 공장 수를 저장된 판단만으로 센다(약속 C1 GET /ingest/preview).

AI·웹 검색·공장등록 조회를 부르지 않고 아무것도 저장하지 않는다(0원). 후보 찾기 실행과
같은 기준을 쓴다: 지역 추리기(#521), 판단 재사용(최신 기준·같은 생산품 지문), 조건
거르기(select_candidates), 같은 회사 가리기(이름·주소, #528). 예상 금액·잠금은 2단계(#543 뒤).
"""

from __future__ import annotations

from collections import Counter
from collections.abc import Sequence
from dataclasses import dataclass

from sqlalchemy import select

from geosan.opportunity.candidate_judgments import select_candidates
from geosan.opportunity.candidate_pick import current_criteria_version
from geosan.opportunity.candidate_registration import company_key, registered_company_keys
from geosan.opportunity.factory_csv import parent_regions, row_in_selected_regions
from geosan.opportunity.factory_profile import ProfileIndex
from geosan.opportunity.judgment_store import _SOURCES, judgment_inputs
from geosan.opportunity.source_models import CandidateJudgment as StoredJudgment
from geosan.opportunity.source_models import SourceFactoryRow

FIT_LEVELS = ("HIGH", "MEDIUM", "LOW")


@dataclass(frozen=True)
class IngestPreviewCounts:
    """맞는 공장·들어온 곳·판단 전 수. add_count는 지금 누르면 더할 최대 곳 수다."""

    matched_count: int
    fit_counts: dict[str, int]
    registered_count: int
    addable_count: int
    addable_high_count: int
    unjudged_count: int
    add_count: int


def preview_counts(
    session,
    *,
    process_codes: Sequence[str],
    regions: Sequence[str],
    industries: Sequence[str],
    max_candidates: int,
    dataset_kind: str,
) -> IngestPreviewCounts:
    """검사를 마친 조건(validate_ingest_conditions 결과의 값)으로 센다."""
    is_virtual = dataset_kind == "VIRTUAL_REVIEWED"
    rows = [
        row
        for row in session.execute(
            select(
                SourceFactoryRow.row_id,
                SourceFactoryRow.region,
                SourceFactoryRow.address,
                SourceFactoryRow.company_name,
                SourceFactoryRow.product,
                SourceFactoryRow.industry_name,
            ).where(
                SourceFactoryRow.source_id.in_(sorted(_SOURCES)),
                SourceFactoryRow.region.in_(parent_regions(regions)),
                SourceFactoryRow.missing_since.is_(None),
                SourceFactoryRow.dataset_kind == dataset_kind,
                SourceFactoryRow.is_virtual == is_virtual,
            )
        )
        if row_in_selected_regions(row.region, row.address, regions)
    ]
    by_id = {row.row_id: row for row in rows}
    version = current_criteria_version(session)
    latest: dict[str, StoredJudgment] = {}
    # 행 번호를 IN으로 나열하지 않고 같은 지역 조건으로 이어 읽는다(충남은 만 곳이 넘는다).
    judged = session.scalars(
        select(StoredJudgment)
        .join(SourceFactoryRow, SourceFactoryRow.row_id == StoredJudgment.row_id)
        .where(
            StoredJudgment.criteria_version == version,
            SourceFactoryRow.region.in_(parent_regions(regions)),
            SourceFactoryRow.missing_since.is_(None),
        )
        .order_by(
            StoredJudgment.judged_at.desc(),
            StoredJudgment.created_at.desc(),
            StoredJudgment.judgment_id.desc(),
        )
    )
    for judgment in judged:
        if judgment.row_id in by_id:
            latest.setdefault(judgment.row_id, judgment)
    # 판단 때와 같은 입력(팩토리온 원자재·업종명 포함, #570)으로 지문을 비교한다.
    inputs = judgment_inputs(session, rows, index=ProfileIndex(session))
    current = [
        judgment
        for row_id, judgment in latest.items()
        if judgment.product_hash == inputs[row_id].product_hash(by_id[row_id].product)
    ]
    matched = select_candidates(current, process_codes=process_codes, industries=industries)
    known = registered_company_keys(session, is_virtual=is_virtual)
    fresh = [
        item
        for item in matched
        if company_key(by_id[item.row_id].company_name, by_id[item.row_id].address) not in known
    ]
    fits = Counter(item.fit_level for item in matched)
    unjudged = len(rows) - len(current)
    limit = max_candidates
    return IngestPreviewCounts(
        matched_count=len(matched),
        fit_counts={level: fits.get(level, 0) for level in FIT_LEVELS},
        registered_count=len(matched) - len(fresh),
        addable_count=len(fresh),
        addable_high_count=sum(item.fit_level == "HIGH" for item in fresh),
        unjudged_count=unjudged,
        # 판단 전 공장이 있으면 판단 뒤 늘 수 있어 최대 건수로 잡는다(약속 C1).
        add_count=limit if unjudged else min(limit, len(fresh)),
    )
