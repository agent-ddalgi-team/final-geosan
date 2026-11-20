"""#427 외부 Responses 통신만 대체한다. 판단 저장·선별·회사 등록은 실제 부품이다."""

import json


class FakeCandidateResponses:
    def __init__(self):
        self.calls = 0

    def __call__(self, payload, key, deadline):
        self.calls += 1
        rows = json.loads(payload["input"])
        response = [
            {
                "rowId": row["rowId"],
                "isManufacturer": row["product"] != "가상 사무 서비스",
                "processCodes": ["ANODIZING" if row["product"] == "가상 패널" else "ZINC_PLATING"],
                "industries": [],
                "reason": "가상 응답에서만 사용하는 판단",
                "fitLevel": "HIGH",
                "ownPlatingLineSuspected": False,
                "ownPlatingLineBasis": None,
            }
            for row in rows
        ]
        return {
            "status": "completed",
            "usage": {"input_tokens": 1000, "output_tokens": 200},
            "output": [
                {
                    "type": "message",
                    "status": "completed",
                    "role": "assistant",
                    "content": [{"type": "output_text", "text": json.dumps(response)}],
                }
            ],
        }


class FakeSupplyTierResponses:
    """#860 공급망 위치 판단의 가짜 응답. 보낸 회사를 모두 2·3차 가공으로 답한다(가상 근거)."""

    def __init__(self):
        self.calls = 0

    def __call__(self, payload, key, deadline):
        self.calls += 1
        rows = json.loads(payload["input"])
        response = [
            {"customerId": row["customerId"], "supplyTier": "TIER2_3", "basis": "가상 응답 근거"}
            for row in rows
        ]
        return {
            "status": "completed",
            "usage": {"input_tokens": 100, "output_tokens": 20},
            "output": [
                {
                    "type": "message",
                    "status": "completed",
                    "role": "assistant",
                    "content": [{"type": "output_text", "text": json.dumps(response)}],
                }
            ],
        }


def fake_supply_tier(monkeypatch) -> FakeSupplyTierResponses:
    """후보 찾기 끝에 도는 공급망 위치 판단(#860)을 가짜 응답으로 바꾼다. 실제 호출 없음."""
    from geosan.opportunity import supply_tier

    fake = FakeSupplyTierResponses()
    monkeypatch.setattr(supply_tier, "_post", fake)
    return fake
