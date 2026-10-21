"""U1 뼈대 시나리오(한국어 Given/When/Then) 10개 파일을 모두 테스트로 만든다.

실행: `python -m pytest tests/features/u1 -q` (단위 테스트 지침 2장).
세 트랙(규칙 엔진·투입/API·화면)이 합쳐지기 전에는 실패하는 것이 정상이다(Step 27에서 전부 초록).
"""

from pytest_bdd import scenarios

scenarios("u1")
