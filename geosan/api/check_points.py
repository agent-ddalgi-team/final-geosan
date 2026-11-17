"""카드 "검토사항" 줄에 쓸 구체적인 말 (#659, 계약 C1 checkPoints·coreEvidenceGaps).

"필수조건 확인 필요"·"핵심 근거 재확인" 같은 말은 무엇을 확인해야 하는지 말하지 않는다. 여기서는
평가 기록(평가 때 저장한 입력 묶음, 요구 판정, 항목 판정)에 **실제로 있는 사실만** 짧은 말로 꺼낸다.
분류·필수 판정·점수는 다시 계산하지 않고, 저장된 값(필수 판정 대기, 핵심 근거 재확인 표시)이
그 상태일 때만 이유를 찾는다. 재료가 없으면 빈 목록을 돌려주고 화면은 지금 문장을 그대로 보인다.

목록 한 번에 회사 수만큼 조회가 늘지 않도록 요구 판정·항목 판정은 평가 번호를 모아 한 번씩만 읽는다.
"""

from __future__ import annotations

from dataclasses import dataclass, field

from sqlalchemy import select
from sqlalchemy.orm import Session

from geosan.dashboard.queries import classify_bookmarked
from geosan.dashboard.sales_analysis import LINK_CONFIRMED
from geosan.evaluation.ledger import latest_confirmed_evaluation
from geosan.evaluation.models import EvaluationRun, ItemJudgment, RequirementCheck
from geosan.opportunity.models import OppProcessLink


@dataclass(frozen=True)
class CardCheckPoints:
    """카드 한 장의 확인할 것과 핵심 근거가 모자란 이유."""

    check_points: list[str] = field(default_factory=list)
    core_evidence_gaps: list[str] = field(default_factory=list)
    # check_points와 같은 순서·같은 개수. 화면이 문장을 글자로 맞춰 추측하지 않게 종류를 알려 준다.
    check_kinds: list[str] = field(default_factory=list)


_EMPTY = CardCheckPoints()
# "평가 전" 회사의 검토사항 문장. 2026-11-13 전에 저장된 평가 기록에는 옛 문장이 남아 있다.
_OLD_NOT_EVALUATED_TEXT = "점수 입력 전 · 거래 관계·필수조건 확인 전"
_NOT_EVALUATED_TEXT = "점수 입력 전 · 필수조건 확인 전"
_NO_EVIDENCE_STATES = {"UNAVAILABLE", "NO_SIGNAL"}
# 대시보드 칸 이름: 보류 / 완료(성사·거절). "확인할 것이 남은 회사"에 세지 않는다(#679).
_CLOSED_BOARDS = ("ON_HOLD", "DONE")


def shown_blocker_text(text: str) -> str:
    """응답에 보일 검토사항 문장. 옛 "평가 전" 문장과 똑같을 때만 새 문장으로 바꾼다.

    PM 지시 2026-11-13(#659): 재접촉 관리를 하지 않으므로 "거래 관계"를 뺀다. 저장된 평가 기록은
    고치지 않고, 다른 문장(규칙이 만든 문장 포함)은 그대로 돌려준다.
    """
    return _NOT_EVALUATED_TEXT if text == _OLD_NOT_EVALUATED_TEXT else text


def _generic_filter_text(run: EvaluationRun) -> bool:
    """검토사항 문장이 분류 문구뿐인지. 이미 공정·요구 이름을 적은 문장은 그대로 둔다."""
    labels = run.input_snapshot.get("ruleConfig", {}).get("classificationLabels", {})
    return run.blocker_text == labels.get("FILTER_PENDING")


def _required_points(run: EvaluationRun, checks: list[RequirementCheck]) -> list[str]:
    """필수조건이 정해지지 않은 이유(문장만). 종류까지 필요하면 _required_rows를 쓴다."""
    return [text for _, text in _required_rows(run, checks)]


def _required_rows(run: EvaluationRun, checks: list[RequirementCheck]) -> list[tuple[str, str]]:
    """필수조건이 정해지지 않은 이유를 평가 때 입력에서 찾는다. 판정은 다시 하지 않는다.

    (종류, 문장) 쌍으로 돌려준다. 종류는 PROCESS·MATERIAL·REQUIREMENT·COMPANY_FILTER.
    """
    snapshot = run.input_snapshot
    opportunity = snapshot.get("opportunity", {})
    requirements = {row["reqId"]: row for row in snapshot.get("requirements", [])}
    points: list[tuple[str, str]] = []
    # 거래 관계는 "확인할 것"에 넣지 않는다(PM 지시 2026-11-13: 재접촉 관리를 하지 않는다).
    if opportunity.get("companyFilterStatus") == "PENDING":
        points.append(("COMPANY_FILTER", "회사 단위 필수조건"))

    # 지금 단계의 필수 요구만 막는다(수량·납기와 나중 단계 요구는 막지 않는다).
    blocking = [
        check
        for check in checks
        if (definition := requirements.get(check.req_id)) is not None
        and definition.get("reqLevel") == "REQUIRED"
        and definition.get("neededStage") != "LATER"
        and definition.get("reqKind") != "QUANTITY_DELIVERY"
    ]
    excluded_links = {
        check.link_id
        for check in blocking
        if check.result == "EXCLUDED" and check.scope_judged == "PROCESS_LINK"
    }
    processes = {
        (row["processId"], row["code"]): row
        for row in snapshot.get("capability", {}).get("processes", [])
        if row.get("datasetKind") == snapshot.get("datasetKind")
    }
    brochure = snapshot.get("datasetKind") == "BROCHURE"
    no_material: list[str] = []
    for link in snapshot.get("processLinks", []):
        if link["linkId"] in excluded_links:
            continue
        process = processes.get((link.get("processId"), link.get("processCode")))
        if process is None:
            points.append(("PROCESS", f"거산 역량 자료에 없는 공정({link.get('processCode')})"))
            continue
        name = (process.get("name") or "").strip() or process["code"]
        codes = process.get("materialCodes") or []
        applied = link.get("appliedMaterial")
        status = process.get("reviewStatus")
        if status == "REVIEWED" and codes and applied and applied not in codes:
            continue  # 소재가 맞지 않아 이 공정 연결은 이미 제외로 정해졌다.
        if status != "REVIEWED" and not (brochure and status == "PENDING"):
            points.append(("PROCESS", f"거산 {name} 공정(거산 확인 전)"))
        if not codes:
            points.append(("MATERIAL", f"거산 {name}의 처리 소재"))
        if not applied:
            no_material.append(name)
    if len(no_material) == 1:
        points.append(("MATERIAL", f"{no_material[0]} 적용 부품의 소재"))
    elif no_material:
        points.append(("MATERIAL", f"공정 {len(no_material)}개 적용 부품의 소재"))
    for check in blocking:
        if check.link_id in excluded_links and check.scope_judged == "PROCESS_LINK":
            continue
        if check.stage_judged == "UNKNOWN":
            points.append(
                ("REQUIREMENT", f"{requirements[check.req_id]['name']}(필요 시점 미확인)")
            )
        elif check.result == "UNKNOWN":
            points.append(("REQUIREMENT", requirements[check.req_id]["name"]))
    # 같은 문장은 한 번만(처음 나온 종류를 쓴다).
    seen: dict[str, str] = {}
    for kind, text in points:
        seen.setdefault(text, kind)
    return [(kind, text) for text, kind in seen.items()]


def _core_gaps(run: EvaluationRun, judgments: dict[str, ItemJudgment]) -> list[str]:
    """핵심 근거를 다시 확인해야 하는 이유를 항목 판정에서 찾는다."""
    snapshot = run.input_snapshot
    config = snapshot.get("ruleConfig", {})
    if snapshot.get("profile") != "NEW" or not judgments:
        return []
    rule = config.get("coreEvidence", {}).get("new") or {}
    codes = rule.get("items") or []
    allowed = set(rule.get("allowedStates") or [])
    labels = {
        row["itemCode"]: row.get("label") or row["itemCode"] for row in config["newProfileItems"]
    }
    gaps: list[str] = []
    for code in codes:
        label = labels.get(code, code)
        state = judgments[code].state if code in judgments else None
        if state in allowed:
            continue
        if state is None or state in _NO_EVIDENCE_STATES:
            # 이름이 "…근거"로 끝나면 "근거 근거 없음"이 되지 않게 한 번만 쓴다.
            gaps.append(f"{label} 없음" if label.endswith("근거") else f"{label} 근거 없음")
        elif state == "WEAK":
            gaps.append(f"{label}: 약한 추정뿐")
        elif state == "MISMATCH":
            gaps.append(f"{label}: 맞지 않음")
        else:
            gaps.append(f"{label}: 확인 필요")
    if gaps or not rule.get("requireReviewedCapability"):
        return gaps
    # 항목 상태는 괜찮은데 재확인이면, 대조에 쓴 거산 값이 없거나 거산 확인 전이다.
    capability = snapshot.get("capability", {})
    values = {
        row["processId"]: (row.get("name"), row.get("reviewStatus"))
        for row in capability.get("processes", [])
    }
    values.update(
        {
            row["capabilityId"]: (row.get("name"), row.get("reviewStatus"))
            for row in capability.get("capabilities", [])
        }
    )
    used = list(
        dict.fromkeys(
            key
            for code in codes
            if code in judgments
            for key in judgments[code].used_capability_ids
        )
    )
    if not used or ("NEW_MATERIAL" in codes and not judgments["NEW_MATERIAL"].used_capability_ids):
        return ["대조에 쓴 거산 공정·역량 값이 없음"]
    for key in used:
        name, status = values.get(key, (None, None))
        if status != "REVIEWED":
            gaps.append(
                f"대조한 거산 {name} 값이 거산 확인 전" if name else "대조한 거산 값이 거산 확인 전"
            )
    return list(dict.fromkeys(gaps))


def card_check_points(session: Session, runs: list[EvaluationRun]) -> dict[str, CardCheckPoints]:
    """보이는 카드들의 평가 기록에서 확인할 것을 한 번에 만든다. 키는 평가 번호."""
    # "평가 전" 회사도 필수조건이 대기면 확인 전인 조건을 준다(PM 지시 2026-11-13).
    # 카드가 "점수 입력 전 …" 문장 대신 낱말로 보이기 때문이다.
    pending = [
        run.eval_id
        for run in runs
        if run.filter_state == "PENDING"
        and (_generic_filter_text(run) or run.classification_code == "NOT_EVALUATED")
    ]
    # "평가 전" 회사의 핵심 근거 이유는 덧붙이지 않는다(점수 항목이 아직 하나도 없다).
    recheck = [
        run.eval_id
        for run in runs
        if run.core_evidence_recheck_flag and run.classification_code != "NOT_EVALUATED"
    ]
    checks: dict[str, list[RequirementCheck]] = {}
    if pending:
        for row in session.scalars(
            select(RequirementCheck)
            .where(RequirementCheck.eval_id.in_(pending))
            .order_by(RequirementCheck.req_id)
        ):
            checks.setdefault(row.eval_id, []).append(row)
    judgments: dict[str, dict[str, ItemJudgment]] = {}
    if recheck:
        for row in session.scalars(select(ItemJudgment).where(ItemJudgment.eval_id.in_(recheck))):
            judgments.setdefault(row.eval_id, {})[row.item_code] = row
    result: dict[str, CardCheckPoints] = {}
    for run in runs:
        rows = _required_rows(run, checks.get(run.eval_id, [])) if run.eval_id in pending else []
        gaps = _core_gaps(run, judgments.get(run.eval_id, {})) if run.eval_id in recheck else []
        result[run.eval_id] = (
            CardCheckPoints(
                [text for _, text in rows], gaps, check_kinds=[kind for kind, _ in rows]
            )
            if rows or gaps
            else _EMPTY
        )
    return result


def check_left_opp_ids(
    session: Session, opp_ids: list[str], catalog_codes: set[str] | frozenset[str]
) -> list[str]:
    """`opp_ids`(관심 기업) 가운데 "확인할 것이 남은 관심 회사"(#679).

    대시보드 "확인할 것이 남은 관심 회사" 건수와 목록 `?filter=CHECK_LEFT`가 이 한 곳을 같이 쓴다.
    평가 기록에 저장된 값으로만 판단한다(판정·점수는 다시 계산하지 않는다). 하나라도 맞으면 센다:
    필수 판정이 대기(검토사항 문장이 이미 요구 이름을 말해 카드에 "확인할 것:" 줄이 없어도) /
    확정된 공정이 없고 AI 제안만 있음 / 분류가 "평가 전" / 핵심 근거가 모자란 이유가 있음.
    최신 영업 단계가 성사·거절·보류인 회사는 뺀다(끝난 회사는 오늘 할 일이 아니다, PM 결정
    2026-11-13). 최신 단계는 대시보드 칸 나누기와 같은 함수로 본다(취소한 기록 제외).
    공정은 카드처럼 거산 공정 목록(`catalog_codes`)에 있는 것만 센다. 최신 확정 평가가 없는
    기회는 카드가 없으므로 뺀다. 카드의 낱말 줄 계산은 바꾸지 않는다.
    """
    if not opp_ids:
        return []
    closed = {
        opp_id for opp_id, board in classify_bookmarked(session).items() if board in _CLOSED_BOARDS
    }
    runs = {
        opp_id: run
        for opp_id in opp_ids
        if opp_id not in closed
        and (run := latest_confirmed_evaluation(session, opp_id)) is not None
    }
    linked: dict[str, set[str]] = {}
    confirmed: dict[str, set[str]] = {}
    for opp_id, code, state in session.execute(
        select(OppProcessLink.opp_id, OppProcessLink.process_code, OppProcessLink.state)
        .where(OppProcessLink.opp_id.in_(list(runs)), OppProcessLink.superseded_at.is_(None))
        .distinct()
    ):
        if code not in catalog_codes:
            continue
        linked.setdefault(opp_id, set()).add(code)
        if state == LINK_CONFIRMED:
            confirmed.setdefault(opp_id, set()).add(code)
    points = card_check_points(session, list(runs.values()))
    left = []
    for opp_id, run in runs.items():
        not_evaluated = run.classification_code == "NOT_EVALUATED"
        proposed_count = len(linked.get(opp_id, set()) - confirmed.get(opp_id, set()))
        process_unconfirmed = not confirmed.get(opp_id) and (proposed_count > 0 or not_evaluated)
        if (
            run.filter_state == "PENDING"
            or process_unconfirmed
            or not_evaluated
            or points[run.eval_id].core_evidence_gaps
        ):
            left.append(opp_id)
    return left
