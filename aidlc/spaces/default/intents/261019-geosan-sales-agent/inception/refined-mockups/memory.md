<!-- INVARIANT: examples are single-line HTML comments so a fresh template parses to total=0 (MEMORY_EMPTY). Do NOT un-comment or split across lines. t100 guards this. -->
> This file is kept up to date automatically while the stage runs. Add observations at the review step, not by editing here directly.

## Interpretations
<!-- example: 2026-05-29T10:14:32Z — chose REST over GraphQL; the consuming team only needs CRUD, revisit if subscriptions land -->
- 2026-10-20T08:47:27Z — 러프 화면·스토리에서 이미 정한 배치·문구·접근성·기기 범위는 다시 묻지 않고, 구현 전 결정이 필요한 6가지(부품 라이브러리 추천, 글꼴, 짧은 입력 방식, 재접촉 입력 화면 형태, 1280 미만 처리, 진행 단계 모양)만 질문. 부품 라이브러리 추천은 러프 화면 Q4에서 '상세 화면 설계 단계에서'로 미룬 것을 이 단계에서 함.
- 2026-10-20T11:02:53Z — 스토리에서 추가된 질문 목록·거산 확인 요청을 별도 화면 S6(/questions)으로 둠: 러프 화면 5개에 없던 화면이지만 US9.1(P1)의 내보내기·상태 추적을 담을 자리가 필요했고 메뉴는 3개로 유지. 사용자 정렬 변경 조작은 두지 않음(요구사항 검토 소견 반영).
- 2026-10-20T13:50:14Z — 수정 요청(R-01~R-14)을 사용자 결정대로 반영: 질문 목록 읽기 전용·상태 모델 대기/요청/회신/반영, beforeunload+window.confirm 예외 1개, 결과 상태 '샘플·등록 승인 받음', 접촉 승인 [승인][거절], 보기 전용(실수 방지용), 지연 시 줄이는 순서 6단계, S0 접속 보호, 담아 둔 목록 토글, 태그 색 6조합 대비표. 재검토 소견(남은 반영 표기, 이탈 확인 범위, 보기 전용 범위, 직접 추가 질문 첫 상태)은 게이트 전에 정리.
- 2026-10-20T13:55:06Z — 두 번째 수정 요청: 거산 홈페이지 연계는 범위 밖 후속 후보로 기록만(mockups 11장), 지금은 독립 웹 주소·테마 한 곳 관리·인프라 설계로 넘기는 배포 검토 메모만 반영. 화면 설계는 바꾸지 않음.

## Deviations
<!-- example: 2026-05-29T10:14:32Z — skipped the optional caching layer the stage prose suggested; the dataset is small enough that it adds risk -->

## Tradeoffs
<!-- example: 2026-05-29T10:14:32Z — picked TDD over BDD this run; the team is unit-first and the domain is well-understood -->
- 2026-10-20T11:02:53Z — 강조색 초기값 #1F5FBF(차분한 파랑)와 11분기 코드 이름은 팀 제안으로 적음. 거산 색은 자료가 오면 brand.ts 한 곳에서 교체. 모달·서랍은 쓰지 않기로 해 모든 짧은 입력을 인라인으로 통일(S5 이탈 확인창만 예외).

## Open questions
<!-- example: 2026-05-29T10:14:32Z — confirm the retention window with compliance before the next stage hardens the schema -->
- 2026-10-20T11:02:53Z — 담당자명 '보기 전용'(대표·상무) 옵션과 운영자 전용 [반영] 버튼은 계정 없는 첫 버전에서 담당자명 선택만으로 구분하는 가정. 담당자별 계정 전환(G0 이후) 때 다시 봄.
