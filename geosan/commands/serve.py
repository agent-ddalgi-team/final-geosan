"""`geosan serve [--port N]` 본문 (기능 명세 W9, 계약 C8, 인프라 명세 1장).

설정 파일을 먼저 검사하고(오류면 시작 거부, 어느 키인지 표시), 데이터베이스가 준비됐는지 보고,
API와 화면(`web/dist` 정적 파일)을 한 프로세스로 띄운다. 설정 검사는 파일 모양만 보고 DB의
앱 설정 사본(활성 묶음 등)은 바꾸지 않는다. 등록은 `check-config`의 몫이다(이슈 #91).
`127.0.0.1`에서만 듣는다(NFR4.10).
포트가 사용 중이면 "포트 N이 사용 중입니다. --port로 바꾸세요"를 내고 종료 코드 2로 끝낸다(NFR7.3).
"""

from __future__ import annotations

import socket
from pathlib import Path

import typer

from geosan.commands.check_config import run_check_config
from geosan.storage.engine import database_path

EXIT_OK = 0
EXIT_INPUT_ERROR = 1
EXIT_RUN_FAILED = 2

HOST = "127.0.0.1"
WEB_DIST = Path(__file__).resolve().parents[2] / "web" / "dist"


def port_in_use(port: int, host: str = HOST) -> bool:
    """포트를 잠깐 열어 봐서 쓸 수 있는지 확인한다. 열리면 바로 닫는다."""
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as probe:
        try:
            probe.bind((host, port))
        except OSError:
            return True
    return False


def _run_server(port: int) -> None:
    """uvicorn을 실제로 띄운다. 테스트에서는 이 함수를 가짜로 바꾼다."""
    import uvicorn

    from geosan.api.app import configure_logging, create_app

    configure_logging()
    # geosan 로거가 JSON 한 줄 로그를 맡으므로 uvicorn의 기본 로그 설정은 끈다(NFR10.1).
    uvicorn.run(create_app(), host=HOST, port=port, log_config=None, access_log=False)


def run_serve(port: int) -> int:
    if not 1 <= port <= 65535:
        typer.echo(f"오류: 포트는 1~65535 사이여야 합니다 (입력값 {port}).")
        return EXIT_INPUT_ERROR

    # 1) 설정 검사. check-config와 같은 검사기로 틀린 키와 줄 번호를 보인다(BR7.6, NFR11.3).
    #    파일 모양만 확인한다. DB에 등록된 규칙 버전·앱 설정 사본은 여기서 덮어쓰지 않는다(#91).
    check_result = run_check_config(None, None, register=False)
    if check_result != EXIT_OK:
        typer.echo("서버를 시작하지 않았습니다. 위 설정 오류를 고친 뒤 다시 실행해 주세요.")
        return check_result

    # 2) 데이터베이스 준비 확인. 없으면 조용히 만들지 않고 init-db를 안내한다.
    db_path = database_path()
    if not db_path.exists():
        typer.echo(f"오류: 데이터베이스 파일이 없습니다 ({db_path}).")
        typer.echo("먼저 `geosan init-db`를 실행해 주세요.")
        return EXIT_INPUT_ERROR

    # 3) 화면 빌드 결과가 없으면 API만 띄운다는 것을 알린다(실패는 아니다).
    screen = "API + 화면" if (WEB_DIST / "index.html").exists() else "API만"
    if screen == "API만":
        typer.echo(
            "안내: web/dist가 없어 화면 없이 API만 띄웁니다. 화면까지 보려면 "
            "`npm --prefix web run build`를 먼저 실행해 주세요."
        )

    # 4) 포트 확인.
    if port_in_use(port):
        typer.echo(f"포트 {port}이 사용 중입니다. --port로 바꾸세요.")
        return EXIT_RUN_FAILED

    typer.echo(f"서버 시작: http://{HOST}:{port} ({screen}, {db_path.name}). 중지는 Ctrl+C.")
    try:
        _run_server(port)
    except KeyboardInterrupt:
        pass
    except Exception as exc:  # 어떤 실패든 숨기지 않고 종류만 보인다(본문·스택은 로그에만)
        typer.echo(f"오류: 서버가 멈췄습니다 ({type(exc).__name__}).")
        return EXIT_RUN_FAILED
    typer.echo("서버를 종료했습니다.")
    return EXIT_OK
