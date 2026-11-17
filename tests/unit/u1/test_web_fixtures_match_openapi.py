"""#719 품질 검토: 화면 테스트의 가짜 응답이 약속 명세(openapi.json)와 어긋나지 않는지 본다.

화면 테스트는 `web/src/test/fixtures/`의 가짜 응답으로 돈다. 서버 응답에 칸이 더해졌는데 가짜 응답이
옛 모양이면 화면 테스트는 통과해도 실제 화면은 다르게 보일 수 있다. 여기서는 명세의 필수 칸이
가짜 응답에 모두 있는지만 본다(값·선택 칸은 보지 않는다). 파일만 읽고 서버·DB는 쓰지 않는다.
"""

import json
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[3]
FIXTURES = ROOT / "web" / "src" / "test" / "fixtures"
OPENAPI = json.loads((ROOT / "contracts" / "openapi.json").read_text(encoding="utf-8"))

# 가짜 응답 파일 → 그 응답을 주는 창구(명세의 경로·방식).
CASES = [
    ("config-ui.json", "get", "/api/v1/config/ui"),
    ("opportunities-apjeong.json", "get", "/api/v1/opportunities"),
    ("opportunity-detail-apjeong.json", "get", "/api/v1/opportunities/{oppId}"),
    ("dashboard.json", "get", "/api/v1/dashboard"),
    ("dashboard-map.json", "get", "/api/v1/dashboard/map"),
    ("peers.json", "get", "/api/v1/opportunities/{oppId}/peers"),
    ("opinion-saved.json", "post", "/api/v1/opportunities/{oppId}/opinions"),
]


def _resolve(schema: dict) -> dict:
    while "$ref" in schema:
        schema = OPENAPI["components"]["schemas"][schema["$ref"].rsplit("/", 1)[-1]]
    return schema


def missing_required(value, schema: dict, path: str = "$") -> list[str]:
    """명세의 필수 칸 가운데 값에 없는 것의 위치 목록."""
    schema = _resolve(schema)
    alternatives = schema.get("anyOf") or schema.get("oneOf")
    if alternatives:
        results = [missing_required(value, option, path) for option in alternatives]
        return min(results, key=len)
    missing: list[str] = []
    for part in schema.get("allOf", []):
        missing += missing_required(value, part, path)
    if isinstance(value, dict):
        missing += [f"{path}.{name}" for name in schema.get("required", []) if name not in value]
        properties = schema.get("properties", {})
        extra = schema.get("additionalProperties")
        for name, item in value.items():
            if name in properties:
                missing += missing_required(item, properties[name], f"{path}.{name}")
            elif isinstance(extra, dict):
                missing += missing_required(item, extra, f"{path}.{name}")
    elif isinstance(value, list) and "items" in schema:
        for index, item in enumerate(value):
            missing += missing_required(item, schema["items"], f"{path}[{index}]")
    return missing


def _response_schema(method: str, path: str) -> dict:
    return OPENAPI["paths"][path][method]["responses"]["200"]["content"]["application/json"][
        "schema"
    ]


@pytest.mark.parametrize("name,method,path", CASES)
def test_fake_response_has_every_required_field_of_the_contract(name, method, path):
    """Given 화면 가짜 응답 / Then 명세가 필수로 정한 칸이 하나도 빠지지 않았다."""
    body = json.loads((FIXTURES / name).read_text(encoding="utf-8"))
    assert missing_required(body, _response_schema(method, path)) == []


def test_checker_reports_a_missing_field():
    """검사기 자체: 필수 칸을 지우면 그 위치를 알려 준다(늘 통과하는 검사가 아니다)."""
    body = json.loads((FIXTURES / "config-ui.json").read_text(encoding="utf-8"))
    del body["data"]["staff"]
    assert "$.data.staff" in missing_required(body, _response_schema("get", "/api/v1/config/ui"))
