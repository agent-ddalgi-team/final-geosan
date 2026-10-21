"""Part C가 합쳐지기 전 연결 검사 전용. A정밀 고정 출력이며 실제 규칙 엔진이 아니다.

이 파일은 작업 지시서의 명시된 예외다. 점수·판정·순위 규칙의 정확성을 검증하지 않는다.
"""

from __future__ import annotations

from geosan.rules.models import (
    EvaluationInput,
    EvaluationOutput,
    RankInput,
    RankOutput,
    RuleConfig,
)


def evaluate(source: EvaluationInput) -> EvaluationOutput:
    if source.dataset_kind != "VIRTUAL_REVIEWED" or {row.name for row in source.requirements} != {
        "ISO 9001",
        "품질팀 샘플 승인",
        "Nadcap",
    }:
        raise ValueError("가짜 엔진은 A정밀 연결 검사만 지원합니다. 실제 평가를 할 수 없습니다.")
    fixed_scores = {
        "NEW_PRODUCT": 25,
        "NEW_MATERIAL": 20,
        "NEW_RECORD": 10,
        "NEW_PERF": 5,
        "SIG_EXPAND": 10,
        "SIG_ORDER": 0,
        "SIG_BID": 7,
        "SIG_HIRE": None,
    }
    weights = {row.item_code: row.weight for row in source.rule_config.new_profile_items}
    checked = bool(source.readiness_check and source.readiness_check.checked)
    classification = "CONTACT_URGENT" if checked else "CONTACT_PLANNED"
    question = next(row for row in source.requirements if row.name == "Nadcap")
    return EvaluationOutput.model_validate(
        {
            "requirementChecks": [
                {
                    "reqId": row.req_id,
                    "result": "PASS" if row.name == "ISO 9001" else "UNKNOWN",
                    "displayResult": {
                        "ISO 9001": "PASS",
                        "품질팀 샘플 승인": "LATER_STAGE",
                        "Nadcap": "QUESTION_NEEDED",
                    }[row.name],
                    "stageJudged": row.needed_stage,
                    "scopeJudged": row.scope_kind,
                    "reason": "A정밀 가짜 엔진 고정 판정 — 실제 규칙 계산 아님",
                    "linkId": row.link_id,
                }
                for row in source.requirements
            ],
            "filterState": "PASS",
            "processLinkResults": [
                {"linkId": row.link_id, "result": "PASS", "reason": "가짜 엔진 고정 결과"}
                for row in source.process_links
            ],
            "items": [
                {
                    "itemCode": item.item_code,
                    "state": item.state,
                    "weight": weights[item.item_code],
                    "matchRate": item.match_rate,
                    "score": fixed_scores[item.item_code],
                    "factJudged": item.fact_judged,
                    "reasoning": "가짜 엔진 고정 점수",
                    "evidenceIds": item.evidence_ids,
                    "usedCapabilityIds": item.used_capability_ids,
                }
                for item in source.item_inputs
            ],
            "totals": {"E": 77, "F": 60, "T": 17, "P": 95, "R": 82, "S": 81.1, "C": 87.5},
            "coreEvidenceMet": "MET",
            "timing": {"directSignal": True, "agreedWindow": True, "readiness": checked},
            "researchReady": False,
            "classificationCode": classification,
            "displayFlags": {"coreEvidenceRecheck": False, "brochureDataset": False},
            "sortKey": {
                "group": "URGENT" if checked else "PLANNED",
                "validUntil": next(
                    (row.deadline_at for row in source.signals if row.signal_kind == "BID"), None
                ),
                "E": 77,
                "F": 60,
                "directConfirmedWeight": 7,
                "P": 95,
                "R": 82,
                "oppId": source.opportunity.opp_id,
            },
            "questionCandidates": [
                {
                    "targetKind": "REQUIREMENT",
                    "targetId": question.req_id,
                    "text": "Nadcap이 필수입니까? (가짜 엔진 질문)",
                    "currentValue": "UNKNOWN",
                    "effectIfAnswered": "필수 요구 여부를 확인합니다.",
                }
            ],
            "display": {
                "reason": "가짜 엔진의 A정밀 고정 결과 — 실제 추천으로 쓰지 마세요.",
                "blockerText": "가짜 엔진: 요구 판정은 실제 확인하지 않았습니다.",
                "blocksApproval": False,
                "scoreDisplay": "81",
                "nextAction": "규칙 엔진 연결 후 다시 확인",
            },
        }
    )


def rank(outputs: list[RankInput], dataset_kind, rule_config: RuleConfig) -> list[RankOutput]:
    """연결 검사에서는 ID 순으로만 번호를 준다. 실제 정렬 규칙은 Part C 책임이다."""
    return [
        RankOutput(opp_id=row.opp_id, original_rank=index)
        for index, row in enumerate(sorted(outputs, key=lambda row: row.opp_id), start=1)
    ]
