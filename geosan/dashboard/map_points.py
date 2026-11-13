"""#642 지도 대상: 관심·진행·한국 시간 올해 성공. 지도 업체에 보낼 검색어는 만들지 않는다."""

from datetime import datetime

from sqlalchemy import select

from geosan.dashboard.queries import (
    _latest_outcomes,
    _won_since,
    dashboard_population,
)
from geosan.opportunity.geo_math import straight_distance_km
from geosan.opportunity.geo_store import customer_points, distance
from geosan.opportunity.models import Customer, Opportunity

# "같이 들를 곳"(#673)의 중심: 방문할 회사. 올해 성공은 다시 들를 일이 적어 뺀다(PM 2026-11-13).
VISIT_ANCHOR_GROUPS = ("IN_PROGRESS", "INTERESTED")


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


def build_visit_groups(settings, points):
    """방문할 회사(진행 중·관심)마다 반경 안의 다른 관심 기업 묶음(#673, PM 결정 2026-11-13).

    근처 회사도 관심 기업(지도 점: 관심·진행 중·올해 성공)만 넣는다. 영업 후보 목록에는 담당자가
    아직 보지 않은 회사도 있어서 넣지 않는다(PM 정정 2026-11-13). 좌표는 지도 점과 같은 값을 쓰므로
    외부 좌표 조회를 새로 하지 않는다.
    """
    radius = settings.visit_group_radius_km
    anchors = [point for point in points if point["group"] in VISIT_ANCHOR_GROUPS]
    order = {group: index for index, group in enumerate(VISIT_ANCHOR_GROUPS)}
    anchors.sort(
        key=lambda point: (order[point["group"]], point["distance_km"] or 0, point["opp_id"])
    )
    result = []
    for anchor in anchors:
        nearby = []
        for point in points:
            if point["opp_id"] == anchor["opp_id"]:
                continue
            km = straight_distance_km(anchor["lat"], anchor["lng"], point["lat"], point["lng"])
            if km <= radius:
                nearby.append(
                    dict(
                        opp_id=point["opp_id"],
                        customer_name=point["customer_name"],
                        lat=point["lat"],
                        lng=point["lng"],
                        distance_km=round(km, 1),
                        group=point["group"],
                    )
                )
        nearby.sort(key=lambda row: (row["distance_km"], row["opp_id"]))
        result.append(dict(opp_id=anchor["opp_id"], nearby=nearby))
    return result
