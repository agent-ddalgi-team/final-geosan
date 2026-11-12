"""가짜 서버와 실제 HTTP 요청·SQLite 정산·규칙 엔진의 끝단 연결 검사."""

import http.client
import json
from http.server import BaseHTTPRequestHandler, HTTPServer
from threading import Thread

from geosan.evidence import extraction
from geosan.workflows.flow_extract import run_extract
from tests.unit.u2 import test_extraction as support
from tests.unit.u2 import test_search_limits as search_support

extract_env = support.extract_env
search_env = search_support.search_env
REAL_POST = extraction._post


def test_real_extraction_request_and_database(extract_env, monkeypatch):
    case, _ = extract_env
    requests = []

    class Handler(BaseHTTPRequestHandler):
        def do_POST(self):
            requests.append(
                (self.path, json.loads(self.rfile.read(int(self.headers["Content-Length"]))))
            )
            body = json.dumps(support.reply()).encode()
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def log_message(self, *_):
            pass

    with HTTPServer(("127.0.0.1", 0), Handler) as server:
        worker = Thread(target=server.serve_forever, daemon=True)
        worker.start()

        def local(host, *, timeout):
            assert host == "api.openai.com" and 20 < timeout <= 60
            return http.client.HTTPConnection("127.0.0.1", server.server_port, timeout=timeout)

        monkeypatch.setattr(extraction.http.client, "HTTPSConnection", local)
        monkeypatch.setattr(extraction, "_post", REAL_POST)
        try:
            result = run_extract(case.opp_id, support.URL)
        finally:
            server.shutdown()
            worker.join()
    assert result.ok, result.error
    assert len(requests) == 1 and requests[0][0] == "/v1/responses"
    assert requests[0][1]["input"] == support.BODY
    assert requests[0][1]["text"]["format"]["strict"] is True
    assert search_support.logs()[0].input_tokens == 1000
