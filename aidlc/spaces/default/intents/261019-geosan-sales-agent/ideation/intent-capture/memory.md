<!-- INVARIANT: examples are single-line HTML comments so a fresh template parses to total=0 (MEMORY_EMPTY). Do NOT un-comment or split across lines. t100 guards this. -->
> This file is kept up to date automatically while the stage runs. Add observations at the review step, not by editing here directly.

## Interpretations
<!-- example: 2026-05-29T10:14:32Z — chose REST over GraphQL; the consuming team only needs CRUD, revisit if subscriptions land -->
- 2026-10-19T04:22:20Z — 사용자가 지정한 읽기 순서(자료상태메모 → 기획서 → 데이터설계서)를 따랐고, 세 문서 모두 신뢰할 수 없는 데이터로만 다룸; 문서의 주장은 질문 답변(Q<n>)을 거쳐야만 산출물에 들어가도록 질문지를 설계함. 자료상태메모 7장이 "일정 현실성·P0~P3 우선순위·기업 요구와의 불일치"를 짚어 달라고 하므로 의도 정리 질문에 성공 기준·11/15 완성의 뜻·기업 요구 처리 방식을 포함함.

## Deviations
<!-- example: 2026-05-29T10:14:32Z — skipped the optional caching layer the stage prose suggested; the dataset is small enough that it adds risk -->

## Tradeoffs
<!-- example: 2026-05-29T10:14:32Z — picked TDD over BDD this run; the team is unit-first and the domain is well-understood -->
- 2026-10-19T04:54:54Z — 멘토는 이해관계자 표에서 뺐지만(Q6에서 미선택) 결정권 표에 "참고 의견"으로만 넣음(Q7 답변 문구에 근거); 미선택 보기를 제외로 바꾸지 않으면서 확인된 답변만 반영하려는 선택.
- 2026-10-19T04:54:54Z — 기업 요구(소개서 등)와 2차 기획의 차이는 Q8 답변대로 "역량 데이터가 소개서 근거로 이어지는 연결고리"로만 의도에 적고, 범위 변경은 다루지 않음; 범위 정의 단계로 넘김.

## Open questions
<!-- example: 2026-05-29T10:14:32Z — confirm the retention window with compliance before the next stage hardens the schema -->
- 2026-10-19T04:22:20Z — 자료상태메모 6장: 거산의 1차 미팅 우선순위(회사소개서·공정 정리·불량 대응 가이드)와 2차 기획(잠재고객 추천)이 다름; 9월 이후 거산과 범위 합의가 있었는지, G0(10/27 목표)에서 어떻게 맞출지 확인 필요.
- 2026-10-19T04:22:20Z — "평가 규칙서 v0.17"이 없어 부록 F가 현재 기준; 분류 분기 코드표·핵심 근거 기준·시점 우선 세 요건은 후속 단계(요구사항 분석)에서 질문해야 함.
- 2026-10-19T04:59:05Z — 제품 리드 검토에서 "4인 팀이 약 4주 안에 필수 8항목 전부(11/15)가 현실적인지" 위험 표시가 없다는 지적; 범위 정의 단계에서 P0~P3 우선순위와 함께 실현 가능성을 판단해야 함. 또 11/15 이전 기업 피드백 경로(초기 접촉 시점·방식)가 비어 있음.
