"""담당자 계정 명령 `staff-add`·`staff-reset`·`staff-list`·`staff-disable`·`staff-role` (#754·#862, 계약 C8).

PM이 계정을 만들면 임시 비밀번호가 이 출력에 한 번만 보인다(DB에는 해시만). 담당자는 첫 로그인
때 화면에 보일 이름과 새 비밀번호를 정한다. 계정이 하나라도 있으면 접속 보호가 켜진 서버는
사람마다 아이디·비밀번호로 로그인한다.
"""

from __future__ import annotations

import typer
from sqlalchemy import select
from sqlalchemy.exc import SQLAlchemyError

from geosan.api.models import StaffAccount
from geosan.api.staff_accounts import add_account, reset_account, set_disabled, set_role
from geosan.config.errors import AppError
from geosan.storage.engine import database_path
from geosan.storage.session import session_scope

EXIT_OK = 0
EXIT_INPUT_ERROR = 1
EXIT_RUN_FAILED = 2


def _run(action) -> int:
    db_path = database_path()
    if not db_path.exists():
        typer.echo(f"오류: 데이터베이스 파일이 없습니다 ({db_path}).")
        typer.echo("먼저 `geosan init-db`를 실행해 주세요.")
        return EXIT_INPUT_ERROR
    try:
        with session_scope(db_path) as session:
            action(session)
    except AppError as exc:
        typer.echo(f"오류: {exc.message}")
        typer.echo(exc.next_action)
        return EXIT_INPUT_ERROR if exc.status < 500 else EXIT_RUN_FAILED
    except SQLAlchemyError as exc:
        typer.echo(f"오류: 계정을 저장하지 못했습니다 ({type(exc).__name__}).")
        typer.echo("데이터베이스 파일과 init-db 적용 여부를 확인해 주세요.")
        return EXIT_RUN_FAILED
    return EXIT_OK


def _show_password(staff_key: str, password: str) -> None:
    typer.echo(f"아이디: {staff_key}")
    typer.echo(f"임시 비밀번호: {password}")
    typer.echo(
        "이 비밀번호는 다시 보이지 않습니다. 담당자에게 직접 전달해 주세요(메일·이슈에 적지 않기)."
    )
    typer.echo("담당자가 첫 로그인 때 화면에 보일 이름과 새 비밀번호를 정합니다.")


def run_staff_add(staff_key: str, viewer: bool) -> int:
    def action(session):
        password = add_account(session, staff_key, viewer=viewer)
        typer.echo(f"{'보기 전용' if viewer else '담당자'} 계정을 만들었습니다.")
        _show_password(staff_key, password)

    return _run(action)


def run_staff_reset(staff_key: str) -> int:
    def action(session):
        password = reset_account(session, staff_key)
        typer.echo("새 임시 비밀번호를 만들었습니다. 그 계정의 접속은 모두 끊었습니다.")
        _show_password(staff_key, password)

    return _run(action)


def run_staff_list() -> int:
    def action(session):
        rows = list(session.scalars(select(StaffAccount).order_by(StaffAccount.staff_key)))
        if not rows:
            typer.echo("담당자 계정이 없습니다. 지금은 공용 비밀번호로 로그인합니다.")
            return
        typer.echo(f"담당자 계정 {len(rows)}개")
        for row in rows:
            role = "보기 전용" if row.role == "VIEWER" else "담당자"
            name = row.display_name or "아직 안 적음"
            setup = "첫 로그인 설정 전" if row.setup_required else "설정 끝"
            state = " · 막힘" if row.disabled_at else ""
            typer.echo(f"  {row.staff_key} · {role} · 이름 {name} · {setup}{state}")

    return _run(action)


def run_staff_disable(staff_key: str, enable: bool) -> int:
    def action(session):
        set_disabled(session, staff_key, disabled=not enable)
        if enable:
            typer.echo(f"{staff_key} 계정을 다시 열었습니다.")
        else:
            typer.echo(f"{staff_key} 계정을 막았습니다. 그 계정의 접속은 모두 끊었습니다.")
            typer.echo("지난 기록의 담당자 값은 그대로 남습니다.")

    return _run(action)


def run_staff_role(staff_key: str, *, staff: bool, viewer: bool) -> int:
    """#862 계정 종류 바꾸기. --staff와 --viewer 중 하나만 고른다."""
    if staff == viewer:
        typer.echo("오류: 바꿀 종류를 하나만 골라 주세요.")
        typer.echo("기록할 수 있게: --staff / 보기만 하게: --viewer")
        return EXIT_INPUT_ERROR
    label = "보기 전용" if viewer else "담당자(기록 가능)"

    def action(session):
        if not set_role(session, staff_key, viewer=viewer):
            typer.echo(f"{staff_key} 계정은 이미 {label} 계정입니다. 바꾼 것이 없습니다.")
            return
        typer.echo(f"{staff_key} 계정을 {label} 계정으로 바꿨습니다. 그 계정의 접속은 끊었습니다.")
        typer.echo("아이디·비밀번호·화면 이름은 그대로입니다. 다시 로그인하면 바뀐 권한으로 보입니다.")

    return _run(action)
