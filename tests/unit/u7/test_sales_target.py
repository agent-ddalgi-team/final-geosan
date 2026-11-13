"""#697: 접촉 기록이 검토 의견을 영업 대상으로 정하는 규칙의 가장자리를 실제 SQLite와 API로 본다.

큰 흐름(의견 없음·검토 중·영업 대상·제외·관심만)은 `tests/features/u5/sales_target.feature`에 있다.
가상 사례만 쓴다(거산 실제 사양 아님). 외부 호출 없음.
"""

import pytest
from sqlalchemy import event, func, select

from geosan.api.routes.records import CONTACT_RESTORES_TARGET_MEMO, CONTACT_SETS_TARGET_MEMO
from geosan.records.models import Outcome, ReviewOpinion
from geosan.storage.session import session_scope
from tests.unit.u1.test_sales_questions import contact
from tests.unit.u7.test_bookmark import (
    MINE,
    URL,
    bookmark_rows,
    eval_ids,
    give_opinion,
    listed_ids,
)
from tests.unit.u7.test_dashboard import dashboard_env  # noqa: F401


def opinions(opp_id):
    with session_scope() as session:
        return [
            (row.opinion, row.version, row.memo, row.reason)
            for row in session.scalars(
                select(ReviewOpinion)
                .where(ReviewOpinion.opp_id == opp_id)
                .order_by(ReviewOpinion.version)
            )
        ]


def post(client, opp_id, body):
    return client.post(f"{URL}/{opp_id}/outcomes", json=body, headers=MINE)


@pytest.mark.parametrize(
    "body",
    [
        contact(result="ABSENT"),
        contact(result="DECLINED"),
        contact(method="EMAIL"),
        contact(method="VISIT"),
    ],
)
def test_any_contact_sets_target_with_fixed_memo(dashboard_env, body):  # noqa: F811
    """Given 의견 없는 회사 / When 부재·거절 전화, 메일, 방문 / Then 영업 대상 1행과 정해진 메모."""
    client, (a, *_rest) = dashboard_env
    response = post(client, a, {**body, "evalId": eval_ids(client)[a]})
    assert response.status_code == 200, response.text
    assert opinions(a) == [("WORTH_REVIEW", 1, CONTACT_SETS_TARGET_MEMO, None)]
    # 의견을 더하면서 관심도 한 번만 켠다(행이 두 개 생기지 않는다).
    assert bookmark_rows(a) == [(a, 1, True, "AUTO_RECORD", "park-lee")]
    assert listed_ids(client, opinion="WORTH_REVIEW") == {a}


@pytest.mark.parametrize(
    "body",
    [
        {"status": "IN_PROGRESS"},
        {"status": "NOT_EXECUTED", "nextScheduleAt": "2026-12-01", "nextScheduleNote": "가상 일정"},
        {"status": "IN_PROGRESS", "stepOverride": "REACHED"},
    ],
)
def test_records_without_contact_do_not_touch_opinion(dashboard_env, body):  # noqa: F811
    """Given 의견 없는 회사 / When 단계만·일정만·단계 고치기 / Then 의견 행이 생기지 않는다."""
    client, (a, *_rest) = dashboard_env
    response = post(client, a, {**body, "evalId": eval_ids(client)[a]})
    assert response.status_code == 200, response.text
    assert opinions(a) == []


def test_contact_without_viewed_evaluation_keeps_opinion_empty(dashboard_env):  # noqa: F811
    """Given 의견 없는 회사 / When 본 평가 번호 없이 접촉 / Then 접촉만 저장, 의견은 안 정함."""
    client, (a, *_rest) = dashboard_env
    assert post(client, a, contact()).status_code == 200
    assert opinions(a) == []


def test_restore_flag_needs_a_contact(dashboard_env):  # noqa: F811
    """Given 제외한 회사 / When 접촉 없이 되돌리기만 보냄 / Then 400으로 알리고 그대로다."""
    client, (a, *_rest) = dashboard_env
    give_opinion(client, a, "NOT_TARGET")
    response = post(
        client, a, {"status": "IN_PROGRESS", "restoreExcluded": True, "evalId": eval_ids(client)[a]}
    )
    assert response.status_code == 400
    assert response.json()["error"]["fields"] == [
        {"path": "restoreExcluded", "message": "접촉 기록에서만 고를 수 있습니다."}
    ]
    assert [row[0] for row in opinions(a)] == ["NOT_TARGET"]


def test_restore_keeps_exclusion_reason_in_history(dashboard_env):  # noqa: F811
    """Given 제외한 회사 / When 되돌리기를 확인하고 접촉 / Then 제외 행은 남고 새 행이 붙는다."""
    client, (a, *_rest) = dashboard_env
    give_opinion(client, a, "NOT_TARGET")
    body = contact(restoreExcluded=True, evalId=eval_ids(client)[a])
    assert post(client, a, body).status_code == 200
    assert opinions(a) == [
        ("NOT_TARGET", 1, None, "가상 제외 사유"),
        ("WORTH_REVIEW", 2, CONTACT_RESTORES_TARGET_MEMO, None),
    ]
    assert listed_ids(client, bookmarked="true") == {a}
    assert listed_ids(client, opinion="NOT_TARGET") == set()


def test_restore_false_on_excluded_company_saves_contact_only(dashboard_env):  # noqa: F811
    """Given 제외한 회사 / When 되돌리지 않고 접촉 / Then 접촉은 남고 의견·관심은 그대로."""
    client, (a, *_rest) = dashboard_env
    give_opinion(client, a, "NOT_TARGET")
    body = contact(restoreExcluded=False, evalId=eval_ids(client)[a])
    assert post(client, a, body).status_code == 200
    assert [row[0] for row in opinions(a)] == ["NOT_TARGET"]
    assert listed_ids(client, bookmarked="true") == set()
    with session_scope() as session:
        assert session.scalar(select(func.count()).select_from(Outcome)) == 1


def test_failed_contact_save_rolls_opinion_back(dashboard_env):  # noqa: F811
    """Given 의견 없는 회사 / When 접촉 저장이 DB에서 실패 / Then 의견·관심도 함께 되돌린다."""
    client, (a, *_rest) = dashboard_env

    def fail_insert(*_):
        raise RuntimeError("가상 저장 실패")

    event.listen(Outcome, "before_insert", fail_insert)
    try:
        response = post(client, a, contact(evalId=eval_ids(client)[a]))
    finally:
        event.remove(Outcome, "before_insert", fail_insert)
    assert response.status_code == 500
    assert opinions(a) == []
    assert bookmark_rows() == []
