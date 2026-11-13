"""#642 지도 대상: 관심·진행·한국 시간 올해 성공. 지도 업체에 보낼 검색어는 만들지 않는다."""

from datetime import datetime

from sqlalchemy import select

from geosan.dashboard.queries import (
    _latest_outcomes,
    _won_since,
    dashboard_population,
)
from geosan.opportunity.geo_store import customer_points, distance
from geosan.opportunity.models import Customer, Opportunity


def map_group(status, won_at, now, *, tz):
    if status in {None, "NOT_EXECUTED"}:
        return "INTERESTED"
    if status in {"IN_PROGRESS", "SAMPLE_OR_REGISTRATION_APPROVED"}:
        return "IN_PROGRESS"
    year_start = datetime(now.astimezone(tz).year, 1, 1, tzinfo=tz)
    if status == "WON" and won_at is not None and year_start <= won_at <= now:
        return "WON_THIS_YEAR"
    return None


def build_map_points(session, settings, now, *, tz):
    if settings.active_dataset_kind.value == "VIRTUAL_REVIEWED":
        return [], 0
    population = dashboard_population(settings.active_dataset_kind.value)
    outcomes = _latest_outcomes(session, population)
    stages = {row.opp_id: row.status for row in outcomes}
    won = _won_since(session, [row.opp_id for row in outcomes if row.status == "WON"])
    candidates = session.execute(
        select(Opportunity, Customer)
        .join(Customer, Customer.customer_id == Opportunity.customer_id)
        .where(
            Opportunity.opp_id.in_(population),
            Opportunity.is_virtual.is_(False),
            Customer.is_virtual.is_(False),
            Customer.security_grade == "PUBLIC",
        )
        .order_by(Opportunity.opp_id)
    ).all()
    targets = [
        (opportunity, customer, group)
        for opportunity, customer in candidates
        if (
            group := map_group(
                stages.get(opportunity.opp_id), won.get(opportunity.opp_id), now, tz=tz
            )
        )
    ]
    # 대시보드 지도도 저장된 공공좌표만 쓴다(#686). 실시간 보완은 상세에서만.
    locations = customer_points(
        session,
        [customer for _, customer, _ in targets],
        {customer.customer_id: opportunity.opp_id for opportunity, customer, _ in targets},
        settings,
        live=False,
    )
    points = []
    missing = 0
    for opportunity, customer, group in targets:
        point = locations[customer.customer_id]
        if point is None:
            missing += 1
            continue
        points.append(
            dict(
                opp_id=opportunity.opp_id,
                customer_name=customer.name,
                lat=point.lat,
                lng=point.lng,
                group=group,
                distance_km=distance(point, settings),
            )
        )
    return points, missing
