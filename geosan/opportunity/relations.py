"""거래 관계 저장과 이력을 요청 세션에 남긴다. 재평가는 API가 이어서 호출한다(#265)."""

from datetime import date

from sqlalchemy.orm import Session

from geosan.config.errors import AppError, FieldError, InputError, NotFoundError, RunFailedError
from geosan.evaluation.ledger import latest_confirmed_evaluation
from geosan.opportunity.models import Customer, Opportunity, RelationHistory
from geosan.rules.codes import RelationStatus
from geosan.storage.base import new_id, utcnow


def change_relation(
    session: Session,
    opp_id: str,
    relation_status: RelationStatus,
    eval_id: str,
    staff: str,
    confirmed_on: date,
) -> Customer:
    # 최신 평가 검사부터 저장까지 다른 요청이 끼지 않게 한다. 재시도는 하지 않는다.
    connection = session.connection()
    if not connection.connection.driver_connection.in_transaction:
        connection.exec_driver_sql("BEGIN IMMEDIATE")
    opportunity = session.get(Opportunity, opp_id)
    if opportunity is None:
        raise NotFoundError("거래 관계를 바꿀 기회가 없습니다.")
    current = latest_confirmed_evaluation(session, opp_id)
    if current is None or current.eval_id != eval_id:
        raise AppError(
            "다시 평가되었습니다. 새 평가를 확인해 주세요.",
            "상세 화면을 새로 불러온 뒤 저장해 주세요.",
            status=409,
            kind="STALE_EVALUATION",
        )
    customer = session.get(Customer, opportunity.customer_id)
    if customer is None:
        raise RunFailedError("기회에 연결된 고객을 확인해 주세요.")
    if customer.relation_status == relation_status.value:
        raise InputError(
            "지금 거래 관계와 같습니다.",
            fields=[FieldError(path="relationStatus", message="다른 거래 관계를 골라 주세요.")],
        )
    now = utcnow()
    session.add(
        RelationHistory(
            relation_history_id=new_id("relation"),
            customer_id=customer.customer_id,
            opp_id=opp_id,
            from_status=customer.relation_status,
            to_status=relation_status.value,
            staff_key=staff,
            changed_at=now,
            created_at=now,
            created_by=staff,
            dataset_kind=opportunity.dataset_kind,
            is_virtual=opportunity.is_virtual,
        )
    )
    customer.relation_status = relation_status.value
    customer.relation_confirmed_at = confirmed_on
    # 확인 전으로 되돌려도 담당자를 남겨 재투입 파일의 덮어쓰기를 막는다.
    customer.relation_confirmed_by = staff
    session.flush()
    return customer
