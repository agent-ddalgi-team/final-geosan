"""#538: 실제 로컬 API 서버·HTTP 제공처·임시 DB로 실패 뒤 재요청을 확인한다."""

import http.client
import json
import socket
import time
from http.server import BaseHTTPRequestHandler, HTTPServer
from threading import Thread

import uvicorn
from typer.testing import CliRunner

from geosan.api.app import create_app
from geosan.commands.app import app
from geosan.evidence import extraction
from tests.unit.u2 import test_extraction as support
from tests.unit.u2 import test_search_limits as search_support

search_env = search_support.search_env
extract_env = support.extract_env
REAL_POST = extraction._post


def test_real_api_retries_after_missing_http_response(extract_env, monkeypatch):
    case, _ = extract_env
    requests = []

    class Handler(BaseHTTPRequestHandler):
        def do_POST(self):
            requests.append(json.loads(self.rfile.read(int(self.headers["Content-Length"]))))
            if len(requests) == 1:
                self.close_connection = True  # 응답·사용량 없이 실제 연결을 끊는다.
                return
            body = json.dumps(support.reply()).encode()
            self.send_response(200)
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def log_message(self, *_):
            pass

    with HTTPServer(("127.0.0.1", 0), Handler) as provider:
        provider_worker = Thread(target=provider.serve_forever, daemon=True)
        provider_worker.start()

        def local(host, *, timeout):
            assert host == "api.openai.com" and 0 < timeout <= 60
            return http.client.HTTPConnection("127.0.0.1", provider.server_port, timeout=timeout)

        monkeypatch.setattr(extraction.http.client, "HTTPSConnection", local)
        monkeypatch.setattr(extraction, "_post", REAL_POST)
        with socket.socket() as listener:
            listener.bind(("127.0.0.1", 0))
            server = uvicorn.Server(
                uvicorn.Config(create_app(), log_config=None, access_log=False, lifespan="off")
            )
            worker = Thread(target=server.run, kwargs={"sockets": [listener]}, daemon=True)
            worker.start()
            try:
                deadline = time.monotonic() + 5
                while not server.started and worker.is_alive() and time.monotonic() < deadline:
                    time.sleep(0.01)
                assert server.started
                client = http.client.HTTPConnection(*listener.getsockname(), timeout=10)
                body = json.dumps({"url": support.URL, "pastedText": support.BODY})
                endpoint = f"/api/v1/opportunities/{case.opp_id}/homepage"
                before = support.counts()

                def post():
                    client.request(
                        "POST",
                        endpoint,
                        body=body,
                        headers={"Content-Type": "application/json", "X-Staff-Key": "park-lee"},
                    )
                    response = client.getresponse()
                    return response.status, json.loads(response.read())

                status, failed = post()
                assert status == 503 and failed["error"]["kind"] == "LLM_FAILED"
                assert support.counts() == before
                status, success = post()
                assert status == 200 and success["meta"]["reevaluated"]
                assert success["data"]["evidenceCount"] == 1
                assert support.counts()[0] == before[0] + 1
                assert support.counts()[1] == before[1] + 1
                assert len(requests) == 2
                assert all(request["input"] == support.BODY for request in requests)
                cost = CliRunner().invoke(app, ["cost"])
                assert cost.exit_code == 2 and "추정 비용 $0.100000" in cost.output
                assert "한도 계산 비용 $0.104000" in cost.output
                client.close()
            finally:
                server.should_exit = True
                worker.join(timeout=5)
                provider.shutdown()
                provider_worker.join(timeout=5)
            assert not worker.is_alive() and not provider_worker.is_alive()


def test_slow_http_response_stops_at_overall_deadline(monkeypatch):
    class Handler(BaseHTTPRequestHandler):
        def do_POST(self):
            self.rfile.read(int(self.headers["Content-Length"]))
            time.sleep(0.5)  # 남은 전체 시간보다 응답이 늦는 제공처.
            self.close_connection = True

        def log_message(self, *_):
            pass

    with HTTPServer(("127.0.0.1", 0), Handler) as provider:
        worker = Thread(target=provider.serve_forever, daemon=True)
        worker.start()
        monkeypatch.setattr(
            extraction.http.client,
            "HTTPSConnection",
            lambda host, *, timeout: http.client.HTTPConnection(
                "127.0.0.1", provider.server_port, timeout=timeout
            ),
        )
        import pytest

        started = time.monotonic()
        try:
            with pytest.raises((OSError, http.client.HTTPException)):
                REAL_POST({}, "test-only-placeholder", started + 0.1)
            assert time.monotonic() - started < 0.45
        finally:
            provider.shutdown()
            worker.join(timeout=5)
