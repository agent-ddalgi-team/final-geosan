# language: ko
기능: S10 담당자 의견은 분류·평가와 따로 저장된다 (US7.1 / AC7.1.1~AC7.1.5, BR9.1~BR9.5)
  의견은 세 값 중 하나이고 '대상 아님'은 사유가 필수이며, 담당자 키가 없거나 보기 전용이면 거부된다.
  수정은 새 행(version+1)이고 동시 수정은 이전 값을 알려 준다. 의견 저장은 분류를 바꾸지 않는다.

  배경:
    조건 임시 데이터베이스가 준비되어 있다
    그리고 가상 검수 역량 파일을 투입했다
    그리고 A정밀 사례 파일을 투입했다
    그리고 평가를 실행했다

  시나리오 개요: 세 가지 의견이 각각 저장된다 (AC7.1.1)
    만일 담당자 park-lee가 A정밀에 의견 <opinion>을 사유 "<reason>"으로 저장하면
    그러면 의견 응답은 200이고 version 1, updatedBy park-lee이다
    그리고 저장된 의견 행의 값은 <opinion>이고 본 평가 ID는 최신 확정 평가다

    예:
      | opinion      | reason             |
      | WORTH_REVIEW |                    |
      | NEED_CHECK   |                    |
      | NOT_TARGET   | 자체 도금라인 보유 추정 |

  시나리오: 대상 아님은 사유가 없으면 저장되지 않는다 (AC7.1.2)
    만일 담당자 park-lee가 A정밀에 의견 NOT_TARGET을 사유 없이 저장하면
    그러면 의견 응답은 400이고 fields에 reason 오류가 있다
    그리고 A정밀의 의견 행은 0건이다

  시나리오: 메모에 연락처가 있으면 저장되지 않는다 (BR2.1, BR9.1)
    만일 담당자 park-lee가 A정밀에 의견 WORTH_REVIEW를 메모 "담당 010-1234-5678"로 저장하면
    그러면 의견 응답은 400이고 fields에 memo 오류가 있다
    그리고 A정밀의 의견 행은 0건이다

  시나리오 개요: 담당자 키가 없거나 목록 밖이거나 보기 전용이면 거부된다 (BR9.3)
    만일 담당자 키 "<key>"로 A정밀에 의견 WORTH_REVIEW를 저장하면
    그러면 의견 응답은 403이고 오류 형식에 message·nextAction·ref가 있다

    예:
      | key      |
      |          |
      | nobody   |
      | viewer   |

  시나리오: 재평가로 낡은 평가 ID여도 의견은 저장된다 (AC7.1.4, BR9.2)
    조건 A정밀의 최신 확정 평가 ID를 기억했다
    그리고 평가를 실행했다
    만일 담당자 park-lee가 기억한 평가 ID로 A정밀에 의견 NEED_CHECK를 저장하면
    그러면 의견 응답은 200이다
    그리고 저장된 의견 행의 본 평가 ID는 기억한 평가 ID이다

  시나리오: 수정은 새 행이고 낡은 expectedVersion이면 이전 값을 알려 준다 (AC7.1.5, BR9.4)
    조건 담당자 park-lee가 A정밀에 의견 WORTH_REVIEW를 저장했다
    만일 담당자 kim-gwajang이 expectedVersion 1로 A정밀에 의견 NEED_CHECK를 저장하면
    그러면 의견 응답은 200이고 version 2, updatedBy kim-gwajang이다
    그리고 A정밀의 의견 행은 2건이고 version 2 행은 version 1 행을 가리킨다
    만일 담당자 park-lee가 expectedVersion 1로 A정밀에 의견 NOT_TARGET을 사유 "검토 완료"로 저장하면
    그러면 의견 응답은 200이고 version 3이며 meta.previousValue의 의견은 NEED_CHECK이다

  시나리오: 의견 저장은 분류·평가를 바꾸지 않는다 (AC7.1.4, BR9.5)
    만일 담당자 park-lee가 A정밀에 의견 NOT_TARGET을 사유 "대상 아님 사유"로 저장하면
    그러면 A정밀의 분류는 CONTACT_URGENT이고 확정 평가는 1건이다
