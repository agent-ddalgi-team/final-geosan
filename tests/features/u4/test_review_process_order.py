"""S02·#483: 실제 검수 명령과 목록·후보 선택지의 공정 순서를 함께 확인한다."""

from pytest_bdd import given, scenarios, then, when

from tests.unit.u1 import test_review_process_order as support

review_db = support.review_db
scenarios("u4/review_process_order.feature")


@given("소개서의 공정과 사례 평가가 저장되어 있다", target_fixture="capability")
def original(review_db):
    return support.brochure()


@given("공정 순서를 바꾼 소개서가 같은 시각에 두 번 재투입되어 있다", target_fixture="capability")
def reordered(review_db, tmp_path):
    return support.reordered_brochure(tmp_path, 9)


@when("소개서 전체 검수를 진행하고 공정 선택지를 비교한다", target_fixture="verified")
def verify(capability):
    support.copy_and_assert_order(capability)
    return True


@then("목록과 후보 가져오기는 원본 공정 순서와 값을 그대로 보인다")
def preserved(verified):
    assert verified
