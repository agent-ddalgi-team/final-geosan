<!-- INVARIANT: examples are single-line HTML comments so a fresh template parses to total=0 (MEMORY_EMPTY). Do NOT un-comment or split across lines. t100 guards this. -->
> This file is kept up to date automatically while the stage runs. Add observations at the review step, not by editing here directly.

## Interpretations
<!-- example: 2026-05-29T10:14:32Z — chose REST over GraphQL; the consuming team only needs CRUD, revisit if subscriptions land -->
- 2026-10-20T07:35:00Z — 협업자가 꺼져 있어 mob 단계를 제품 관리자 단독으로 진행(디자이너·개발자·QA 기여 파일 없음). 질문은 페르소나 수·묶음 단위·이야기 크기·S01~S14 연결·팀 운영자 스토리 포함 여부 5개로 한정하고, 우선순위(P0~P3→MoSCoW)와 AC 형식(Given/When/Then)은 백로그·인셉션 규칙에서 이미 정해져 다시 묻지 않음.
- 2026-10-20T07:57:34Z — 사용자가 추가한 '활동 요약'(P2)은 US9.3으로, '운영자 안내서만 보고 명령 3개 이내'는 US1.1·US1.3·US2.1·US5.1·US9.4의 수용 기준으로 넣음. 두 항목은 요구사항 문서에 없어 출처를 [Q1]·[Q5]로 달고 '범위 문서·백로그 갱신 필요' 목록에 추가.
- 2026-10-20T08:08:38Z — 사용자가 추가한 팀 페르소나 v2.0(docs/input/05_사용자페르소나_v2_참고.md)은 참고용 입력으로 읽고, 사용자가 '가져올 것/따르지 않을 것'으로 지정한 항목만 반영. 문서와 오늘 답변이 다른 점(대표 요약 6지표, 검색, 검수 요청 큐·상태 추적, 활동 이력·기한 초과, 질문 3개 상한·내부용 표시, Q5 '명령 3개' 문구)을 Q6~Q11 후속 질문으로 정리. 신입사원 페르소나·재접촉 우선 홈·390px·조건부 판정·견적/품질 시나리오는 사용자 지시대로 제외.
- 2026-10-20T08:37:48Z — 대시보드 건수 변경(Q6)은 승인된 요구사항 FR6.4와 달라지므로 요구사항 문서를 직접 고치지 않고 스토리에 '요구사항 갱신 필요'로 표시해 작업 단위 나누기에서 갱신하도록 넘김.

## Deviations
<!-- example: 2026-05-29T10:14:32Z — skipped the optional caching layer the stage prose suggested; the dataset is small enough that it adds risk -->
- 2026-10-20T08:37:48Z — 검토(READY, 소견 11건) 뒤 사용자가 추가한 결정(Q6~Q12)을 반영해 산출물을 다시 저장함(이야기 36→40개: 검색 US6.5, 진행 단계 US6.6, 활동 이력 US6.7, 화면 다듬기 US9.6). Guard Policy가 off라 새 검토 없이 변경 알림으로 진행하되, 검토 소견 중 High 2건(S03 태그, 시점 우선 체크의 10/30 입력 경로)과 FR6.9 추적 오류는 같은 수정에서 함께 닫음. 나머지 소견은 게이트에서 사람이 판단.

## Tradeoffs
<!-- example: 2026-05-29T10:14:32Z — picked TDD over BDD this run; the team is unit-first and the domain is well-understood -->
- 2026-10-20T07:57:34Z — 이야기 36개(목표 25~35보다 1개 많음)로 묶음 10개를 채움. 화면 없는 규칙(필터·11분기·정렬)은 '평가를 실행하면 A정밀이 기대값으로 나온다'처럼 결과가 보이는 이야기 3개(US5.1~5.3)로 묶고 세부 규칙은 수용 기준에 둠. 재접촉 프로필·재접촉용 상세는 요구사항 FR6.2a 그대로 US6.3에 둠.

## Open questions
<!-- example: 2026-05-29T10:14:32Z — confirm the retention window with compliance before the next stage hardens the schema -->
- 2026-10-20T07:57:34Z — traceability.json은 요구사항 ID 111개(그룹 FR1~FR14, 세부 FR n.m, NFR1~12)를 모두 적고 NFR3·NFR6은 nfr-requirements, NFR9는 build-and-test로 Deferred. FR6.2a(영문자 접미 ID)는 센서가 ID로 인식하지 않을 수 있어 FR6 그룹으로 추적.
