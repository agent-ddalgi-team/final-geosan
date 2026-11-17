"""#213: 화면(Vercel)이 서버(Railway)로 API를 넘기는 연결 파일 `web/vercel.json` 검사.

API 규칙이 먼저 와야 하고, 화면 주소 되돌리기(index.html)는 /api를 빼야 API 오류가
"화면 HTML 성공"으로 바뀌지 않는다. 주소는 Railway가 준 https 주소 하나만 쓴다.
"""

from __future__ import annotations

import json
import re
from pathlib import Path

VERCEL_JSON = Path(__file__).resolve().parents[3] / "web" / "vercel.json"
RAILWAY_HOST = "geosan-server-production.up.railway.app"


def _config() -> dict:
    return json.loads(VERCEL_JSON.read_text(encoding="utf-8"))


def test_api_rule_comes_first_and_points_to_railway_https():
    """Given vercel.json / When 첫 넘기기 규칙을 읽음 / Then /api 전체를 Railway https로 넘긴다."""
    first = _config()["rewrites"][0]
    assert first["source"] == "/api/:path*"
    assert first["destination"] == f"https://{RAILWAY_HOST}/api/:path*"


def test_screen_fallback_excludes_api_paths():
    """Given 화면 되돌리기 규칙 / When API·화면 주소를 맞춰 봄 / Then 화면 주소만 index.html로."""
    rewrites = _config()["rewrites"]
    assert len(rewrites) == 2
    fallback = rewrites[1]
    assert fallback["destination"] == "/index.html"
    pattern = re.compile("^" + fallback["source"] + "$")
    assert pattern.match("/opportunities/42")
    assert pattern.match("/")
    assert not pattern.match("/api")
    assert not pattern.match("/api/v1/opportunities")
    # "api"로 시작하지만 API가 아닌 화면 주소는 화면으로 간다.
    assert pattern.match("/apiary")


def test_api_responses_are_not_cached_by_vercel():
    """Given vercel.json / When /api 머리말을 읽음 / Then 넘긴 응답을 Vercel이 저장하지 않는다."""
    headers = _config()["headers"]
    api = [h for h in headers if h["source"] == "/api/:path*"]
    assert api, "/api 머리말 규칙이 없습니다"
    pairs = {h["key"]: h["value"] for h in api[0]["headers"]}
    assert pairs.get("x-vercel-enable-rewrite-caching") == "0"


def test_no_placeholder_host_left():
    """Given vercel.json / When 글자를 훑음 / Then README 예시의 자리표시가 남지 않았다."""
    assert "RAILWAY_HOST" not in VERCEL_JSON.read_text(encoding="utf-8")
