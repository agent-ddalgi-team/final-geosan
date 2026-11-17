"""사례 저장이 끝난 뒤 설정에 따라 투입한 한 곳만 자동 조사한다(C7·C8)."""

import logging
from pathlib import Path

import typer

from geosan.commands.import_capability import run_import
from geosan.commands.research import print_research_result
from geosan.config.app_settings import (
    DEFAULT_APP_SETTINGS_PATH,
    load_app_settings,
    read_app_settings,
)
from geosan.config.errors import AppError, NotFoundError, RunFailedError
from geosan.opportunity.importer import CaseImportResult, import_case
from geosan.opportunity.models import Customer, Opportunity
from geosan.storage.session import session_scope
from geosan.workflows.research import research_one

logger = logging.getLogger(__name__)


def _research_imported_case(imported: CaseImportResult) -> int:
    try:
        with session_scope() as session:
            settings = read_app_settings(session) or load_app_settings(DEFAULT_APP_SETTINGS_PATH)
            if not settings.homepage_discovery.auto_research:
                typer.echo("자동 조사가 꺼져 있어 사례 저장만 완료했습니다.")
                return 0
            opportunity = session.get(Opportunity, imported.opp_id)
            customer = session.get(Customer, imported.customer_id)
            if opportunity is None or customer is None:
                raise NotFoundError("저장한 사례를 조사 목록에서 찾지 못했습니다.")
            if (
                opportunity.dataset_kind != settings.active_dataset_kind.value
                or opportunity.is_virtual
                or opportunity.purpose != "NEW_PROPOSAL"
                or customer.security_grade != "PUBLIC"
            ):
                typer.echo("자동 조사 대상이 아니어서 사례 저장만 완료했습니다.")
                return 0
            name = customer.name
        typer.echo("사례 저장 완료. 이 사례의 자동 조사를 시작합니다.")
        result = research_one(imported.opp_id)
        print_research_result(name, result)
        if result.error or result.usage_unconfirmed:
            typer.echo(
                "사례는 저장했습니다. 자동 조사는 확인이 필요합니다. "
                "파일을 다시 넣지 않아도 됩니다."
            )
            return 2
        if result.status == "NOT_FOUND":
            typer.echo("홈페이지를 못 찾아 근거 추출·재평가를 건너뛰었습니다. 사례는 저장했습니다.")
        else:
            typer.echo("자동 조사 완료: 근거 저장·재평가를 마쳤습니다.")
        return 0
    except Exception as exc:
        error = (
            exc if isinstance(exc, AppError) else RunFailedError("자동 조사를 완료하지 못했습니다.")
        )
        logger.error("투입 후 조사 실패: type=%s ref=%s", type(exc).__name__, error.ref)
        typer.echo(f"사례는 저장했습니다. 자동 조사 실패: {error.message} {error.next_action}")
        typer.echo(f"파일을 다시 넣지 않아도 됩니다. (문의 시 이 번호: {error.ref})")
        return 2


def run_import_case(file: Path) -> int:
    return run_import(file, import_case, "cmd.import_case", after_import=_research_imported_case)
