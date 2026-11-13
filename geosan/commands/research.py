"""공개 신규 사례를 한 곳씩 검색·추출·재평가하는 운영 명령(C8)."""

import logging

import typer
from sqlalchemy import or_, select

from geosan.commands.geocode import active_evaluated_opp_ids
from geosan.config.app_settings import (
    DEFAULT_APP_SETTINGS_PATH,
    load_app_settings,
    read_app_settings,
)
from geosan.config.errors import AppError, InputError, exit_code_for
from geosan.evidence.contacts import scrub_contacts
from geosan.opportunity.models import Customer, Opportunity
from geosan.opportunity.queries import public_origin_condition
from geosan.storage.session import session_scope
from geosan.workflows.research import STOP_KINDS, ResearchResult, research_one

logger = logging.getLogger(__name__)
STATUS_LABELS = {
    "AI_FOUND": "찾음",
    "CONFIRMED": "확인된 주소",
    "NEEDS_CONFIRMATION": "확인 필요",
    "NOT_FOUND": "못 찾음",
}


def print_research_result(name: str, result: ResearchResult, echo=typer.echo) -> None:
    """일괄 조사와 투입 후 조사에서 같은 상태·근거 수·비용을 보여 준다."""
    label = "확인 필요" if result.error else STATUS_LABELS[result.status]
    safe_name = " ".join(scrub_contacts(name)[0].split())
    cost = f"확인된 비용 ${result.cost:.6f}"
    if result.usage_unconfirmed:
        cost += " · 총비용 미확정"
    echo(f"{safe_name}: {label} · 근거 {result.evidence_count}건 · {cost}")
    if result.error:
        echo(f"  {result.error.message} {result.error.next_action}")


def run_research(
    missing_homepage: bool, all_companies: bool, limit: int | str | None, echo=typer.echo
) -> int:
    try:
        if missing_homepage and all_companies:
            raise InputError("--missing-homepage와 --all은 함께 쓸 수 없습니다.")
        if isinstance(limit, str):
            try:
                limit = int(limit)
            except ValueError:
                raise InputError("--limit은 1 이상의 정수여야 합니다.") from None
        if limit is not None and (type(limit) is not int or limit < 1):
            raise InputError("--limit은 1 이상의 정수여야 합니다.")
        with session_scope() as session:
            settings = read_app_settings(session) or load_app_settings(DEFAULT_APP_SETTINGS_PATH)
            query = (
                select(Opportunity.opp_id, Customer.name)
                .join(Customer, Customer.customer_id == Opportunity.customer_id)
                .where(
                    # 영업 건 원본 표시가 검수 전환 뒤에도 BROCHURE로 남을 수 있어, 최신 확정 평가가
                    # 활성 묶음인 기회도 대상으로 본다(#664, 좌표 채우기와 같은 기준).
                    or_(
                        Opportunity.dataset_kind == settings.active_dataset_kind.value,
                        Opportunity.opp_id.in_(
                            active_evaluated_opp_ids(settings.active_dataset_kind.value)
                        ),
                    ),
                    Opportunity.purpose == "NEW_PROPOSAL",
                    public_origin_condition(),  # 사례 파일 + 후보 찾기 회사(#492)
                    Opportunity.is_virtual.is_(False),
                    Customer.security_grade == "PUBLIC",
                )
                .order_by(Opportunity.created_at, Opportunity.opp_id)
            )
            if not all_companies:
                query = query.where(Customer.homepage_url.is_(None))
            rows = session.execute(query).all()
        if not rows:
            echo("조사할 공개 신규 사례가 없습니다. 처리 0건.")
            return 0
        if not settings.homepage_discovery.auto_research:
            raise InputError(
                "자동 조사가 꺼져 있습니다.",
                "앱 설정의 homepageDiscovery.autoResearch를 켜서 등록한 뒤 실행해 주세요.",
            )
        selected = rows if limit is None else rows[:limit]
        completed = missing = failed = processed = 0
        for opp_id, name in selected:
            result = research_one(opp_id)
            processed += 1
            if result.error:
                failed += 1
            elif result.status == "NOT_FOUND":
                missing += 1
            else:
                completed += 1
            print_research_result(name, result, echo)
            if result.error and result.error.kind in STOP_KINDS:
                echo(f"조사를 멈췄습니다. 남은 대상 {len(rows) - processed}건.")
                break
        echo(
            f"처리 {processed}건: 저장·재평가 {completed}건, 못 찾음 {missing}건, "
            f"실패 {failed}건, 미처리 {len(rows) - processed}건."
        )
        return 2 if failed else 0
    except AppError as error:
        echo(f"{error.message} {error.next_action}")
        return exit_code_for(error)
    except Exception as error:
        logger.error("일괄 조사 명령 실패: type=%s", type(error).__name__)
        echo("일괄 조사를 완료하지 못했습니다. 저장 상태와 운영 로그를 확인해 주세요.")
        return 2
