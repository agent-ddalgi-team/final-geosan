"""테스트용 작은 생성 함수 골격 (단위 테스트 지침 1장).

원칙: 기준 데이터는 `examples/`의 예시 파일 그대로 쓰고, 변형이 필요할 때만 복사해 한 값만 바꾼다.
공유 가변 픽스처를 두지 않는다. 모든 데이터는 가상이며 연락처를 포함하지 않는다.
본문은 Step 9~12(PM 세션)에서 채운다. 세 트랙은 여기에 함수를 "추가만" 할 수 있다.
"""

from __future__ import annotations

import copy
import json
from pathlib import Path
from typing import Any

EXAMPLES_DIR = Path(__file__).resolve().parent.parent / "examples"


def load_example_json(name: str) -> dict[str, Any]:
    """examples/<name>을 읽어 새 dict로 돌려준다(호출마다 새 객체)."""
    return json.loads((EXAMPLES_DIR / name).read_text(encoding="utf-8"))


def apjeong_case(**overrides: Any) -> dict[str, Any]:
    """A정밀 사례 파일 사본. 예: apjeong_case(customer={"relationStatus": "UNCONFIRMED"}) 처럼
    위쪽 키만 바꾼다(중첩 값은 병합이 아니라 교체이므로 필요한 하위 키를 모두 적는다)."""
    data = load_example_json("case-apjeong.json")
    return _apply_overrides(data, overrides)


def capability_file(**overrides: Any) -> dict[str, Any]:
    """가상 검수 역량 파일 사본."""
    data = load_example_json("capability-geosan.json")
    return _apply_overrides(data, overrides)


def _apply_overrides(data: dict[str, Any], overrides: dict[str, Any]) -> dict[str, Any]:
    result = copy.deepcopy(data)
    for key, value in overrides.items():
        if key not in result:
            raise KeyError(f"예시 파일에 없는 키를 바꾸려 했습니다: {key}")
        result[key] = value
    return result
