# language: ko
기능: S01 거산 역량 파일 등록과 검수 상태 (US1.1, US1.2)
  공정 9종·역량 항목·자격과 적용 범위·검수 상태를 파일 하나로 넣어 등록한다.
  검수 완료(REVIEWED)만 근거이며, 소개서 묶음은 모두 검수 대기(PENDING)로 들어간다.

  배경:
    조건 임시 데이터베이스가 준비되어 있다

  시나리오: 공정 9종이 각각 하나로 등록되고 등록 상태가 보인다 (AC1.1.1, AC1.2.4)
    만일 가상 검수 역량 파일을 투입하면
    그러면 투입 명령은 종료 코드 0으로 끝난다
    그리고 VIRTUAL_REVIEWED 묶음에 공정 9종이 각각 한 건씩 있고 등록 상태는 모두 BROCHURE_NAME이다
    그리고 공정 BLACK_OXIDE에는 "거산 확인 전" 가정 메모가 남아 있다

  시나리오: 숫자 사양은 최소·최대·단위로 나뉘고 설비 항목은 설명용이다 (AC1.1.2)
    만일 가상 검수 역량 파일을 투입하면
    그러면 VIRTUAL_REVIEWED 묶음 ANODIZING 공정의 "피막 두께" 역량은 최소 5, 최대 25, 단위 "μm"로 저장된다
    그리고 VIRTUAL_REVIEWED 묶음 ANODIZING 공정의 "아노다이징 라인" 항목은 EQUIPMENT이고 설명용이다

  시나리오: 검수 상태는 넷 중 하나이고 검수 기록이 함께 남는다 (AC1.1.3)
    만일 가상 검수 역량 파일을 투입하면
    그러면 모든 거산 값의 검수 상태는 UNAVAILABLE·PENDING·REVIEWED·RECHECK 중 하나이고 VIRTUAL_REVIEWED 묶음은 모두 REVIEWED이다
    그리고 VIRTUAL_REVIEWED 묶음의 모든 공정에 검수자 "PM(가상 검수)"와 검수일 2026-10-20의 검수 기록이 있다

  시나리오: ISO 9001·AS9100D 범위는 4개 공정에만 연결된다 (AC1.1.4)
    만일 가상 검수 역량 파일을 투입하면
    그러면 VIRTUAL_REVIEWED 묶음 자격 "ISO 9001"의 적용 범위는 ANODIZING, CHROMATE, ZINC_PLATING, PASSIVATION 4개 공정뿐이다
    그리고 VIRTUAL_REVIEWED 묶음 ELECTROLESS_NICKEL 공정에는 "ISO 9001" 범위 행이 없다

  시나리오: 소개서 묶음은 모두 검수 대기로 들어가고 승인서는 미확인이다 (AC1.2.1, AC1.2.2)
    만일 소개서 묶음 역량 파일을 투입하면
    그러면 BROCHURE 묶음의 모든 거산 값은 PENDING이다
    그리고 BROCHURE 묶음 자격 "한화시스템 특수공정 승인서"의 현재 상태는 UNCONFIRMED이다
    그리고 VIRTUAL_REVIEWED 묶음에는 공정이 하나도 없다

  시나리오: 재투입해도 검수 완료를 검수 대기로 되돌리지 않는다 (BR1.7)
    조건 가상 검수 역량 파일을 투입했다
    만일 검수 상태를 PENDING으로 바꾼 가상 검수 역량 파일을 다시 투입하면
    그러면 투입 명령은 종료 코드 0으로 끝나고 출력에 "검수" 유지 경고가 있다
    그리고 VIRTUAL_REVIEWED 묶음 공정 9종의 검수 상태는 그대로 REVIEWED이고 공정은 여전히 9건이다
    그리고 VIRTUAL_REVIEWED 묶음 ANODIZING 공정의 검수 기록은 dataVersion 1과 2의 두 행이다
