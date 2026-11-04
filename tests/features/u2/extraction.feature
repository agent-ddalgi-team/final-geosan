Feature: S03 공개 홈페이지 조사와 S11 외부 전송 보호
  Scenario: S03 공개 본문에서 근거를 저장하고 재평가한다
    Given 공개 신규 기회와 가짜 OpenAI 추출 응답이 준비되었다
    When 홈페이지 본문 조사를 실행한다
    Then 새 근거와 질문과 실제 재평가가 함께 저장된다

  Scenario: S11 내부 자료는 외부로 한 건도 보내지 않는다
    Given 내부 자료인 기회가 준비되었다
    When 홈페이지 본문 조사를 실행한다
    Then OpenAI 전송 없이 거부 기록만 남는다
