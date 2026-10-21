# language: ko
기능: S07 요구 수준을 짐작하지 않는다 (US5.2 / AC5.2.1, AC5.2.2, BR2.6, BR3.4, BR8.1)
  요구 수준이 미확인(UNKNOWN)인 요구는 그대로 저장되어 필터에 영향 없이 확인 질문만 남기고,
  검수 대기 자격으로는 통과가 나오지 않는다.

  배경:
    조건 임시 데이터베이스가 준비되어 있다
    그리고 가상 검수 역량 파일을 투입했다

  시나리오: 수준 미확인 요구는 필터에 영향 없이 질문만 남긴다 (AC5.2.1)
    조건 A정밀 사례 파일을 투입했다
    만일 평가를 실행하면
    그러면 A정밀의 요구 "Nadcap"은 수준 UNKNOWN, 단계 UNKNOWN으로 저장되어 있다
    그리고 A정밀의 필터 상태는 PASS이고 "Nadcap" 판정 표시는 QUESTION_NEEDED이다
    그리고 A정밀에 연결된 WAITING 질문은 1건이고 그 질문은 "Nadcap"에 관한 것이다
    그리고 A정밀의 막는 조건은 승인을 막지 않는다

  시나리오: 파일의 UNKNOWN은 그대로 저장되고 REQUIRED·NOW로 채워지지 않는다 (BR2.6)
    조건 요구 "Nadcap"의 수준과 단계를 UNKNOWN으로 적은 A정밀 사례 파일을 투입했다
    그러면 A정밀의 요구 "Nadcap"은 수준 UNKNOWN, 단계 UNKNOWN으로 저장되어 있다
    그리고 A정밀의 요구 "Nadcap"의 proposedBy는 FILE이다

  시나리오: 검수 대기 자격으로는 통과가 나오지 않는다 (AC5.2.2)
    조건 소개서 묶음 역량 파일을 투입했다
    그리고 활성 거산 값 묶음을 BROCHURE로 두었다
    그리고 A정밀 사례 파일을 투입했다
    만일 평가를 실행하면
    그러면 A정밀의 "ISO 9001" 판정은 UNKNOWN이고 판정 표시는 PENDING_BLOCKS이다
    그리고 A정밀의 필터 상태는 PENDING이고 분류는 FILTER_PENDING이다
    그리고 A정밀에 연결된 WAITING 질문 중 "ISO 9001"에 관한 것이 있다
