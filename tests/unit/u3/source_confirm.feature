Feature: 운영자가 소스 이용·저장 확인을 기록한다
  Scenario Outline: 허용된 소스를 확인한 뒤 실제 확인표에 저장한다
    Given 소스 확인 기록이 없는 임시 DB와 담당자 설정이 있다
    When 담당자가 "<source>"의 이용·저장 확인 명령을 실행한다
    Then 해당 소스의 확인자와 날짜가 실제 DB에 저장된다

    Examples:
      | source               |
      | kicox-factory-csv    |
      | kicox-production-api |
