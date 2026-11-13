"""#222: 회사 공공좌표 저장 및 네이버 일회성 확인 건수. 좌표·주소·키는 출력하지 않는다."""

from collections import Counter

import typer
from sqlalchemy import select
from sqlalchemy.exc import SQLAlchemyError

from geosan.config.app_settings import read_app_settings
from geosan.config.errors import AppError, InputError, exit_code_for
from geosan.opportunity.geo_store import store_public_coordinate, stored_point
from geosan.opportunity.geocode_address import parse_address
from geosan.opportunity.geocode_http import GeocodeClient
from geosan.opportunity.geocoding import GeocodeResolver
from geosan.opportunity.location_csv import LocationIndex
from geosan.opportunity.models import Customer, Opportunity
from geosan.storage.session import session_scope


def run_geocode(missing_only=True):
    counts = Counter()
    try:
        with session_scope() as session:
            settings = read_app_settings(session)
            if settings is None:
                raise InputError("앱 설정을 먼저 등록해 주세요.")
            opportunities = session.execute(
                select(Customer, Opportunity.opp_id)
                .join(Opportunity, Opportunity.customer_id == Customer.customer_id)
                .where(Customer.dataset_kind == settings.active_dataset_kind.value)
            ).all()
            targets = {}
            for customer, opp_id in opportunities:
                if customer.customer_id in targets:
                    continue
                if (
                    customer.is_virtual
                    or customer.security_grade != "PUBLIC"
                    or not parse_address(customer.address)
                ):
                    counts["excluded"] += 1
                    continue
                if missing_only and stored_point(customer):
                    counts["reused"] += 1
                    continue
                targets[customer.customer_id] = (customer.address, opp_id)
        resolver = GeocodeResolver(
            LocationIndex(settings.geocoding.location_csv_files), settings.geocoding
        )
        for customer_id, (address, opp_id) in targets.items():
            try:
                point = resolver.resolve(address, GeocodeClient(opp_id, address))
                if point is None:
                    counts["unresolved"] += 1
                elif point.source == "NAVER":
                    counts["live"] += 1
                else:
                    store_public_coordinate(customer_id, address, point)
                    counts["stored"] += 1
                    counts[point.source] += 1
            except AppError:
                counts["failed"] += 1
                raise
    except AppError as error:
        typer.echo(error.message)
        typer.echo(error.next_action)
        _summary(counts)
        return exit_code_for(error)
    except SQLAlchemyError:
        # 저장 실패의 SQL 매개변수에는 좌표가 있어 예외 원문을 출력하지 않는다.
        counts["failed"] += 1
        typer.echo("좌표 저장에 실패했습니다. DB 상태를 확인한 뒤 다시 실행해 주세요.")
        _summary(counts)
        return 2
    _summary(counts)
    return 0


def _summary(counts):
    typer.echo(
        f"좌표 처리: 공공좌표 저장 {counts['stored']}곳"
        f"(CSV {counts['CSV']}·행안부 {counts['JUSO']}), "
        f"기존 재사용 {counts['reused']}곳, 네이버 실시간 확인 {counts['live']}곳(미저장), "
        f"미확인 {counts['unresolved']}곳, 제외 {counts['excluded']}곳, 실패 {counts['failed']}곳"
    )
