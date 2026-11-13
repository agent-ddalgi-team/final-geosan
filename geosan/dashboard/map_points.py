"""#642 지도 대상: 관심·진행·한국 시간 올해 성공. 지도 업체에 보낼 검색어는 만들지 않는다."""

from datetime import datetime

from sqlalchemy import select

from geosan.dashboard.queries import (
    _latest_outcomes,
    _won_since,
    dashboard_population,
)
from geosan.opportunity.geo_math import straight_distance_km
from geosan.opportunity.geo_store import customer_points, distance, stored_point
from geosan.opportunity.models import Customer, Opportunity
from geosan.records.models import ReviewOpinion

# "같이 들를 곳"(#673)의 중심: 방문할 회사. 올해 성공은 다시 들를 일이 적어 뺀다(PM 2026-11-13).
VISIT_ANCHOR_GROUPS = ("IN_PROGRESS", "INTERESTED")
_OPINION_EXCLUDED = "NOT_TARGET"


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
    locations = customer_points(
        session,
        [customer for _, customer, _ in targets],
        {customer.customer_id: opportunity.opp_id for opportunity, customer, _ in targets},
        settings,
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


def build_visit_groups(session, settings, points):
    """방문할 회사(진행 중·관심)마다 반경 안 후보 회사 묶음(#673, PM 결정 2026-11-13).

    근처 회사는 활성 묶음의 최신 확정 평가 대상 전부에서 최신 검토 의견이 "검토 대상 제외"인
    회사·가상·비공개를 뺀 곳이다. 저장된 공공좌표만 쓰고 외부 좌표 조회는 하지 않는다
    (근처 후보마다 조회하면 하루 한도를 금방 쓴다). 좌표가 없는 회사는 묶음에 들지 않는다.
    """
    radius = settings.visit_group_radius_km
    anchors = [point for point in points if point["group"] in VISIT_ANCHOR_GROUPS]
    if not anchors:
        return []
    population = dashboard_population(settings.active_dataset_kind.value, bookmarked_only=False)
    # 상세·카드의 최신 의견(버전, 그다음 저장 시각)과 같은 순서로 마지막 행을 고른다.
    opinions = {}
    for opp_id, opinion in session.execute(
        select(ReviewOpinion.opp_id, ReviewOpinion.opinion)
        .where(ReviewOpinion.opp_id.in_(population))
        .order_by(ReviewOpinion.version, ReviewOpinion.recorded_at)
    ):
        opinions[opp_id] = opinion
    groups_by_opp = {point["opp_id"]: point["group"] for point in points}
    pool = []
    for opportunity, customer in session.execute(
        select(Opportunity, Customer)
        .join(Customer, Customer.customer_id == Opportunity.customer_id)
        .where(
            Opportunity.opp_id.in_(population),
            Opportunity.is_virtual.is_(False),
            Customer.is_virtual.is_(False),
            Customer.security_grade == "PUBLIC",
        )
        .order_by(Opportunity.opp_id)
    ).all():
        if opinions.get(opportunity.opp_id) == _OPINION_EXCLUDED:
            continue
        point = stored_point(customer)
        if point is None:
            continue
        pool.append((opportunity.opp_id, customer.name, point))
    order = {group: index for index, group in enumerate(VISIT_ANCHOR_GROUPS)}
    anchors.sort(
        key=lambda point: (order[point["group"]], point["distance_km"] or 0, point["opp_id"])
    )
    result = []
    for anchor in anchors:
        nearby = []
        for opp_id, name, point in pool:
            if opp_id == anchor["opp_id"]:
                continue
            km = straight_distance_km(anchor["lat"], anchor["lng"], point.lat, point.lng)
            if km <= radius:
                nearby.append(
                    dict(
                        opp_id=opp_id,
                        customer_name=name,
                        lat=point.lat,
                        lng=point.lng,
                        distance_km=round(km, 1),
                        group=groups_by_opp.get(opp_id),
                    )
                )
        nearby.sort(key=lambda row: (row["distance_km"], row["opp_id"]))
        result.append(dict(opp_id=anchor["opp_id"], nearby=nearby))
    return result
