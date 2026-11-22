"""#860: 공급망 위치가 빈 목록 회사(후보 찾기로 들어온 회사 + 사례 파일 회사, #886)를 한 번에 판단하는 운영 명령(C8).

배포 뒤 지금 있는 회사에 한 번 돌린다. 새로 들어오는 회사는 후보 찾기가 들어올 때 판단한다.
회사 이름·근거 글은 출력하지 않고 건수만 낸다.
"""

import typer
from sqlalchemy.exc import SQLAlchemyError

from geosan.config.app_settings import read_app_settings
from geosan.config.errors import AppError, InputError, exit_code_for
from geosan.opportunity.supply_tier import customers_without_tier, judge_supply_tiers
from geosan.storage.session import session_scope

EXIT_OK = 0
EXIT_RUN_FAILED = 2


def run_supply_tier(staff_key: str, *, redo: bool = False) -> int:
    try:
        with session_scope() as session:
            settings = read_app_settings(session)
            if settings is None:
                raise InputError("앱 설정을 먼저 등록해 주세요.")
            if not settings.is_recording_staff(staff_key):
                raise InputError("설정에 등록된 기록 담당자 키로 실행해 주세요.")
            targets = customers_without_tier(session, redo=redo)
        if not targets:
            typer.echo("공급망 위치가 빈 회사가 없습니다. 판단할 것이 없습니다.")
            return EXIT_OK
        result = judge_supply_tiers(targets, requested_by=staff_key)
    except AppError as error:
        typer.echo(error.message)
        typer.echo(error.next_action)
        typer.echo("공급망 위치 판단을 마치지 못했습니다.")
        typer.echo("끝난 묶음은 저장됐고, 다시 실행하면 남은 회사를 이어서 판단합니다.")
        return exit_code_for(error)
    except SQLAlchemyError:
        typer.echo("공급망 위치를 저장하지 못했습니다. DB 상태를 확인한 뒤 다시 실행해 주세요.")
        return EXIT_RUN_FAILED
    typer.echo(
        f"공급망 위치 판단 끝: {result.judged}곳 저장, {result.skipped}곳 건너뜀"
        "(홈페이지로 이미 정했거나 공개 값에 연락처가 섞인 회사)."
    )
    return EXIT_OK
