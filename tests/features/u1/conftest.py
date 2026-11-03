"""U1 시나리오 테스트가 쓰는 단계 함수를 한곳에 모은다.

pytest-bdd는 `@given/@when/@then`으로 만든 단계 함수를 그 모듈의 픽스처로 등록하므로, 여기서
`import *`로 가져오면 이 폴더의 모든 feature가 같은 단계를 쓴다. 단계 본문은 `tests/steps/u1/`.
"""

from tests.steps.u1.common import *  # noqa: F403
from tests.steps.u1.steps_brochure import *  # noqa: F403
from tests.steps.u1.steps_capability import *  # noqa: F403
from tests.steps.u1.steps_engine import *  # noqa: F403
from tests.steps.u1.steps_opinion import *  # noqa: F403
from tests.steps.u1.steps_opportunity import *  # noqa: F403
from tests.steps.u1.steps_requirements import *  # noqa: F403
from tests.steps.u1.steps_sales_records import *  # noqa: F403
