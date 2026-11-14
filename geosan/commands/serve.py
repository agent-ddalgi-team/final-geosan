"""`geosan serve [--port N] [--host 주소]` 본문 (기능 명세 W9, 계약 C8).

설정 파일을 먼저 검사하고(오류면 시작 거부, 어느 키인지 표시), 데이터베이스가 준비됐는지 보고,
API와 화면(`web/dist` 정적 파일)을 한 프로세스로 띄운다. 설정 검사는 파일 모양만 보고 DB의
앱 설정 사본(활성 묶음 등)은 바꾸지 않는다. 등록은 `check-config`의 몫이다(이슈 #91).
기본은 `127.0.0.1`, PM의 Railway 배포 지시에 따라 명시적으로 `0.0.0.0`도 받는다.
포트가 사용 중이면 "포트 N이 사용 중입니다. --port로 바꾸세요"를 내고 종료 코드 2로 끝낸다(NFR7.3).

#736: 바깥에 여는 주소(내 PC 주소가 아님)인데 접속 보호가 꺼져 있으면, 또는 보호를 켰는데 비밀번호
환경 변수가 없으면 시작하지 않는다.
"""

from __future__ import annotations

import os
import socket
import time
from pathlib import Path

import typer

from geosan.commands.check_config import run_check_config
from geosan.commands.serving_marker import remove_marker, write_marker
from geosan.storage.engine import database_path

EXIT_OK = 0
EXIT_INPUT_ERROR = 1
EXIT_RUN_FAILED = 2

HOST = "127.0.0.1"
# 이 PC 안에서만 접속되는 주소. 여기에 없는 주소는 배포(바깥 접속)로 본다.
LOCAL_HOSTS = frozenset({HOST, "localhost", "::1"})
WEB_DIST = Path(__file__).resolve().parents[2] / "web" / "dist"


def port_in_use(port: int, host: str = HOST) -> bool:
    """포트를 잠깐 열어 봐서 쓸 수 있는지 확인한다. 열리면 바로 닫는다."""
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as probe:
        try:
            probe.bind((host, port))
        except OSError:
            return True
    return False


def _run_server(port: int, host: str = HOST) -> None:
    """uvicorn을 실제로 띄운다. 테스트에서는 이 함수를 가짜로 바꾼다."""
    import uvicorn

    from geosan.api.app import configure_logging, create_app
    from geosan.workflows.flow_ingest import run_ingest

    configure_logging()
    # geosan 로거가 JSON 한 줄 로그를 맡으므로 uvicorn의 기본 로그 설정은 끈다(NFR10.1).
    uvicorn.run(
        create_app(ingest_runner=run_ingest),
        host=host,
        port=port,
        log_config=None,
        access_log=False,
    )


def _warm_location_index() -> None:
    """좌표 조회를 켰고 위치 CSV가 있으면 색인을 한 번 만들어 둔다. 실패해도 서버는 띄운다."""
    from geosan.config.app_settings import read_app_settings
    from geosan.config.errors import AppError
    from geosan.opportunity.location_csv import location_index
    from geosan.storage.session import session_scope

    with session_scope() as session:
        settings = read_app_settings(session)
    if settings is None or not settings.geocoding.enabled:
        return
    files = settings.geocoding.location_csv_files
    if not files:
        return
    started = time.monotonic()
    try:
        location_index(files)
    except AppError as error:
        # 파일이 없으면 거리 기능만 안 된다. 숨기지 않고 알리되 목록·상세는 계속 쓰게 한다.
        typer.echo(f"경고: {error.message} 거리 계산 전에 설정의 위치 CSV 경로를 확인해 주세요.")
        return
    typer.echo(f"위치 CSV {len(files)}개를 미리 읽었습니다 ({time.monotonic() - started:.1f}초).")


DEMO_DB_FILE_NAME = "geosan-demo.db"
"""발표 시연용 DB의 약속된 파일 이름(#274). 이름을 바꿔도 DB 안 시연 표시로 알아본다."""


def _is_deploy_setting(host: str) -> bool:
    """배포 설정인가: 바깥에서 들어오는 주소로 듣거나 배포용 비밀번호가 있는 환경(계약 C8).

    #719: 내 PC 주소가 아니면 모두 배포로 본다(`::`·사내 주소도 바깥에서 접속된다).
    """
    return host not in LOCAL_HOSTS or bool(os.environ.get("GEOSAN_PASSWORD"))


def _is_demo_db(db_path: Path) -> bool:
    """시연용 DB인가: 파일 이름이 geosan-demo.db이거나 앱 설정 사본에 시연 표시가 있다."""
    from geosan.config.app_settings import is_demo_database
    from geosan.storage.session import session_scope

    if db_path.name == DEMO_DB_FILE_NAME:
        return True
    with session_scope(db_path) as session:
        return is_demo_database(session)


def _is_public_host(host: str) -> bool:
    """바깥에서 접속되는 주소로 듣는가. 내 PC 주소(127.0.0.1·localhost·::1)가 아니면 모두 바깥."""
    return host not in LOCAL_HOSTS


def _access_protection_enabled(db_path: Path) -> bool:
    """서버가 실제로 쓸 접속 보호 값. DB의 앱 설정 사본을 읽고, 사본이 없으면 서버와 같이
    예시 설정 파일(`examples/app-settings.yaml`) 값을 쓴다(registry의 대체 동작과 같음)."""
    from geosan.config.app_settings import (
        DEFAULT_APP_SETTINGS_PATH,
        load_app_settings,
        read_app_settings,
    )
    from geosan.storage.session import session_scope

    with session_scope(db_path) as session:
        settings = read_app_settings(session)
    if settings is None:
        settings = load_app_settings(DEFAULT_APP_SETTINGS_PATH)
    return settings.access_protection.enabled


def _password_configured() -> bool:
    """로그인 검사와 같은 기준: 비어 있거나 빈칸뿐이면 없는 것으로 본다(access_policy)."""
    return bool(os.environ.get("GEOSAN_PASSWORD", "").strip())


def _access_problem(db_path: Path, host: str) -> list[str] | None:
    """접속 보호 때문에 시작하면 안 되는 이유(쉬운 말 줄들). 문제없으면 None (#736, 계약 C8)."""
    try:
        protected = _access_protection_enabled(db_path)
    except Exception as exc:  # 사본이 깨졌으면 보호 여부를 모른다. 숨기지 않고 거부한다.
        return [
            f"오류: DB의 앱 설정 사본을 읽지 못해 서버를 시작하지 않습니다 ({type(exc).__name__}).",
            "`geosan check-config <규칙 설정> <앱 설정>`으로 설정을 다시 등록한 뒤 시작해 주세요.",
        ]
    if not protected and _is_public_host(host):
        return [
            "접속 보호가 꺼져 있어 배포 환경에서 서버를 시작하지 않습니다.",
            f"--host {host}로 열면 비밀번호 없이 누구나 목록을 볼 수 있습니다. 앱 설정의 "
            "accessProtection.enabled를 true로 바꾼 파일을 `geosan check-config <규칙 설정> "
            "<앱 설정>`으로 등록하고, 비밀번호는 환경 변수 GEOSAN_PASSWORD에 넣은 뒤 다시 "
            "시작해 주세요. 내 PC에서만 쓸 때는 --host 없이(127.0.0.1) 시작하면 됩니다.",
        ]
    if protected and not _password_configured():
        return [
            "접속 보호가 켜져 있는데 비밀번호(GEOSAN_PASSWORD)가 없어 서버를 시작하지 않습니다.",
            "이대로 띄우면 아무도 로그인할 수 없습니다. 서버 환경 변수 GEOSAN_PASSWORD에 "
            "공용 비밀번호를 넣고 다시 시작해 주세요.",
        ]
    return None


def run_serve(port: int, host: str = HOST) -> int:
    if host not in (HOST, "0.0.0.0"):
        typer.echo("오류: 듣는 주소는 127.0.0.1 또는 0.0.0.0으로 지정해 주세요.")
        return EXIT_INPUT_ERROR
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

    # 2-1) 시연용 DB는 배포 설정에서 시작하지 않는다(#274, 계약 C8). 로컬에서는 그대로 쓴다.
    if _is_deploy_setting(host) and _is_demo_db(db_path):
        typer.echo("시연용 DB는 배포 환경에서 쓸 수 없습니다.")
        typer.echo(
            f"배포 설정(--host 0.0.0.0 또는 GEOSAN_PASSWORD)에서는 {db_path.name}로 서버를 "
            "시작하지 않습니다. GEOSAN_DB_PATH를 실제 DB로 바꿔 주세요."
        )
        return EXIT_RUN_FAILED

    # 2-2) 접속 보호(#736, 계약 C8). 시연 DB 차단과 같은 자리에서 시작 전에 거부한다.
    #      바깥 주소인데 보호가 꺼져 있으면, 또는 보호를 켰는데 비밀번호가 없으면 띄우지 않는다.
    #      내 PC 주소(127.0.0.1)에서 보호가 꺼진 것은 지금처럼 허용한다.
    problem = _access_problem(db_path, host)
    if problem is not None:
        for line in problem:
            typer.echo(line)
        return EXIT_RUN_FAILED

    # 2-3) 코드 버전(평가 기록에 적는 값)을 알 수 없으면 시작 줄에 한 번 알린다(#719).
    #      평가는 그대로 저장되고 버전 칸에 "커밋 번호 없음" 표시가 남는다.
    from geosan.workflows.flow_evaluate import CODE_VERSION_ENV_NAMES, resolve_code_version

    version = resolve_code_version()
    if version.refused:
        typer.echo(
            f"경고: 환경 변수 {', '.join(version.refused)}의 값은 코드 버전으로 쓸 수 없어 "
            "건너뜁니다(영문·숫자·.·_·- 40자 이내)."
        )
    if version.source == "FALLBACK":
        typer.echo(
            f"경고: 코드 버전을 알 수 없어 패키지 버전으로 적습니다({version.value}). "
            f"배포 환경 변수 {CODE_VERSION_ENV_NAMES[0]}을 정하면 정확해집니다."
        )

    # 3) 화면 빌드 결과가 없으면 API만 띄운다는 것을 알린다(실패는 아니다).
    screen = "API + 화면" if (WEB_DIST / "index.html").exists() else "API만"
    if screen == "API만":
        typer.echo(
            "안내: web/dist가 없어 화면 없이 API만 띄웁니다. 화면까지 보려면 "
            "`npm --prefix web run build`를 먼저 실행해 주세요."
        )

    # 4) 포트 확인.
    if port_in_use(port, host):
        typer.echo(f"포트 {port}이 사용 중입니다. --port로 바꾸세요.")
        return EXIT_RUN_FAILED

    # 5) 위치 CSV 색인을 미리 읽는다(#664). 받은 CSV 3개(64만 줄)는 처음 읽는 데 10초가 넘어
    #    서버를 켠 뒤 첫 가까운 순 요청이 요청 제한(10초)에 걸려 실패했다.
    _warm_location_index()

    typer.echo(f"서버 시작: http://{host}:{port} ({screen}, {db_path.name}). 중지는 Ctrl+C.")
    # 켜져 있는 동안 DB 옆에 실행 중 표식을 둔다. restore가 이것을 보고 복원을 거부한다(#214).
    write_marker(db_path, port, host)
    try:
        _run_server(port, host)
    except KeyboardInterrupt:
        pass
    except Exception as exc:  # 어떤 실패든 숨기지 않고 종류만 보인다(본문·스택은 로그에만)
        typer.echo(f"오류: 서버가 멈췄습니다 ({type(exc).__name__}).")
        return EXIT_RUN_FAILED
    finally:
        remove_marker(db_path)
    typer.echo("서버를 종료했습니다.")
    return EXIT_OK
