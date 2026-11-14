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
