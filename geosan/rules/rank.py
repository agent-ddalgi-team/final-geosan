"""접촉 분류별 순서와 설정에 따른 나머지 후보 정렬 (BR6.4, BR6.5)."""

from datetime import date

from geosan.rules.codes import ClassificationCode, DatasetKind, ItemState, SortGroup
from geosan.rules.models import (
    EvaluationInput,
    ItemJudgmentOutput,
    RankInput,
    RankOutput,
    RuleConfig,
    SortKey,
    Totals,
)
from geosan.rules.timing import valid_contact_until


def build_sort_key(
    data: EvaluationInput, code: ClassificationCode, items: list[ItemJudgmentOutput], totals: Totals
) -> SortKey:
    """표시용 S가 아닌 E·F·확인 배점·P·기한을 정렬 입력으로 만든다 (BR6.4)."""
    group = {
        ClassificationCode.CONTACT_URGENT: SortGroup.URGENT,
        ClassificationCode.CONTACT_PLANNED: SortGroup.PLANNED,
        ClassificationCode.CONTACT_REVIEW: SortGroup.REVIEW,
    }.get(code, SortGroup.OTHER)
    return SortKey(
        group=group,
        valid_until=valid_contact_until(data),
        E=totals.E,
        F=totals.F,
        direct_confirmed_weight=sum(i.weight for i in items if i.state == ItemState.CONFIRMED),
        P=totals.P,
        R=totals.R,
        opp_id=data.opportunity.opp_id,
    )


def rank_outputs(
    outputs: list[RankInput], dataset_kind: DatasetKind, rule_config: RuleConfig
) -> list[RankOutput]:
    """같은 프로필의 목록을 안정적으로 정렬하고 순위를 1부터 매긴다 (BR6.4, BR6.5)."""
    if len({row.profile for row in outputs}) > 1:
        raise ValueError("신규 기회와 재접촉 프로필은 함께 정렬할 수 없습니다")
    if len({row.opp_id for row in outputs}) != len(outputs):
        raise ValueError("한 묶음에 같은 기회가 중복되었습니다")
    if any(row.opp_id != row.sort_key.opp_id for row in outputs):
        raise ValueError("기회 ID와 정렬 키의 기회 ID가 다릅니다")
    if dataset_kind not in rule_config.dataset_kinds:
        raise ValueError("설정에 없는 자료 묶음입니다")
    ordered = []
    for group in SortGroup:
        rows = [row for row in outputs if row.sort_key.group == group]
        if group == SortGroup.OTHER:
            specs = (
                rule_config.other_group_sort.brochure
                if dataset_kind == DatasetKind.BROCHURE
                else rule_config.other_group_sort.default
            )
            if not specs:
                raise ValueError("접촉 후보 외 정렬 설정이 비어 있습니다")
            rows.sort(key=lambda row: row.opp_id)
            for spec in reversed(specs):
                attr = "opp_id" if spec.key == "oppId" else spec.key
                rows.sort(key=lambda row: getattr(row.sort_key, attr), reverse=spec.order == "desc")
        else:
            rows.sort(key=lambda row: _contact_key(row.sort_key))
        ordered.extend(rows)
    return [
        RankOutput(opp_id=row.opp_id, original_rank=index)
        for index, row in enumerate(ordered, start=1)
    ]


def _contact_key(key: SortKey) -> tuple:
    """유효 기한이 없는 후보는 같은 조건의 기한 있는 후보 뒤에 둔다 (BR6.4)."""
    scores = (-key.E, -key.F, -key.direct_confirmed_weight, -key.P)
    deadline = key.valid_until or date.max
    if key.group == SortGroup.URGENT:
        return (deadline, *scores, key.opp_id)
    if key.group == SortGroup.REVIEW:
        return (*scores, deadline, key.opp_id)
    return (*scores, key.opp_id)
