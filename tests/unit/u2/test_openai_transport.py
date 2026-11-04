"""로컬 HTTP 서버에 실제 요청을 보내며 HTTPS 목적지·본문·DB 정산 연결을 확인한다."""

import http.client
import json
from http.server import BaseHTTPRequestHandler, HTTPServer
from threading import Thread

from geosan.evidence import openai_search
from geosan.evidence.homepage import find_case_homepage
from tests.unit.u2 import test_search_limits as search_support
from tests.unit.u2.test_search_limits import logs, provider_reply

search_env = search_support.search_env

REAL_POST = openai_search._post_response


def test_real_request_serialization_and_accounting(search_env, monkeypatch):
    case, _ = search_env
    received = []

    class Handler(BaseHTTPRequestHandler):
        def do_POST(self):
            received.append(
                (
                    self.path,
                    self.headers["Authorization"],
                    json.loads(self.rfile.read(int(self.headers["Content-Length"]))),
                )
            )
            payload = json.dumps(provider_reply()).encode()
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(payload)))
            self.end_headers()
            self.wfile.write(payload)

        def log_message(self, *args):
            pass

    with HTTPServer(("127.0.0.1", 0), Handler) as server:
        worker = Thread(target=server.serve_forever, daemon=True)
        worker.start()

        def local_connection(host, *, timeout):
            assert host == "api.openai.com"
            assert timeout == 20
            return http.client.HTTPConnection("127.0.0.1", server.server_port, timeout=timeout)

        monkeypatch.setattr(openai_search.http.client, "HTTPSConnection", local_connection)
        monkeypatch.setattr(openai_search, "_post_response", REAL_POST)
        try:
            result = find_case_homepage(case.opp_id)
        finally:
            server.shutdown()
            worker.join()
    path, authorization, body = received[0]
    assert len(received) == 1
    assert path == "/v1/responses"
    assert authorization == "Bearer test-only-placeholder"
    assert body["text"]["format"]["strict"] is True
    assert body["store"] is False
    assert result.url == "https://example.org/"
    assert logs()[0].input_tokens == 1000
