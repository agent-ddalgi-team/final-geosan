"""#213: 성공·오류 API 응답이 외부 프록시 캐시에 남지 않는다."""

import pytest
from fastapi.testclient import TestClient

from geosan.api.app import create_app
from geosan.api.deps import get_session
from geosan.config.errors import AppError


@pytest.mark.parametrize("status", [200, 400, 401, 403, 404, 500])
def test_api_responses_disable_proxy_caching(tmp_db, status):
    """Given 성공 또는 실패 요청 / When API 응답 / Then 두 캐시 방지 헤더를 보낸다."""
    app = create_app()
    if status in (401, 500):

        def failed_session():
            if status == 401:
                raise AppError("접속 확인 필요", "다시 접속", status=401)
            raise RuntimeError("가상 저장소 실패")

        app.dependency_overrides[get_session] = failed_session
    with TestClient(app) as client:
        if status == 400:
            response = client.get("/api/v1/opportunities?page=invalid")
        elif status == 403:
            response = client.post(
                "/api/v1/opportunities/missing/opinions",
                json={"opinion": "WORTH_REVIEW", "evalId": "missing"},
            )
        elif status == 404:
            response = client.get("/api/v1/not-found")
        else:
            response = client.get("/api/v1/config/ui")
    assert response.status_code == status
    assert response.headers["cache-control"] == "no-store"
    assert response.headers["x-vercel-enable-rewrite-caching"] == "0"


def test_oversize_request_also_disables_cache():
    """Given 허용 크기 초과 / When 라우트 전에 거부 / Then 오류도 캐시하지 않는다."""
    with TestClient(create_app()) as client:
        response = client.post("/api/v1/session", content=b"x" * (64 * 1024 + 1))
    assert response.status_code == 400
    assert response.headers["cache-control"] == "no-store"
    assert response.headers["x-vercel-enable-rewrite-caching"] == "0"


def test_api_root_error_also_disables_cache():
    """Given API 루트 / When 없는 경로 조회 / Then 404 응답도 캐시하지 않는다."""
    with TestClient(create_app()) as client:
        response = client.get("/api")
    assert response.status_code == 404
    assert response.headers.get("cache-control") == "no-store"
    assert response.headers.get("x-vercel-enable-rewrite-caching") == "0"
