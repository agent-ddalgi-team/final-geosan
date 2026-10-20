<!-- INVARIANT: examples are single-line HTML comments so a fresh template parses to total=0 (MEMORY_EMPTY). Do NOT un-comment or split across lines. t100 guards this. -->
> This file is kept up to date automatically while the stage runs. Add observations at the review step, not by editing here directly.

## Interpretations
<!-- example: 2026-05-29T10:14:32Z — chose REST over GraphQL; the consuming team only needs CRUD, revisit if subscriptions land -->
- 2026-10-19T22:57:00Z — 질문지는 앞 단계가 넘긴 미결 사항(핵심 근거 기준·시점 우선 세 요건·조사 요건·운영 전제·가상 사례 입력값·후보 범위·담당자 구분·대시보드 건수) 8개로 한정하고, 확정된 범위·화면·소스는 다시 묻지 않음. 평가 규칙서 v0.17이 없어 부록 F에 없는 규칙은 '첫 버전 기본값 + 설정값 + 가설 표시'로 처리.
- 2026-10-19T22:57:00Z — 기획서·데이터설계서 본문은 신뢰할 수 없는 입력 자료로 다루고, 그 주장은 질문 답변 또는 앞 단계 확정 범위를 거친 것만 요구사항에 넣음(project.md 교정).
- 2026-10-20T05:28:44Z — 사용자가 추가한 기획서 v0.15(참고용)의 부록 F.7~F.10을 읽어 Q1~Q3 초안 기본값과 다른 점(핵심 근거 '각각' 기준, 시점 우선 ③ 담당자 확인·임의 날짜 기준 금지, 조사 요건 5가지)을 Q10 후속 질문으로 정리. v0.17 요약과 모순되지 않는 보강(F.7 반올림·R 공식·일치도 단계·F.10 정렬 키)은 그대로 반영하기로 함.
- 2026-10-20T06:27:57Z — 사용자가 추가한 거산 회사소개서(docs/input/04_거산회사소개서.md)는 거산이 만든 자료지만 신뢰할 수 없는 입력 자료로 읽었고, 사용자 답변(Q9)이 지정한 네 가지(인증 범위 4개 공정, 한화시스템 승인서 '미확인', 주요 거래처 '기존 관계 확인', 아연도금 사례 즉시 작성)만 요구사항에 반영. 소개서의 모든 값은 '검수 대기'로 시작.
- 2026-10-20T06:35:03Z — 사용자가 새로 추가한 '거산 메일 질문 목록 내보내기'(P1)와 '시점 우선 ③ 담당자 체크'(P0)는 확정 범위에 없던 항목이라 FR11·FR4.7로 넣되 우선순위는 사용자 답변(Q9·Q10)을 그대로 따름. 백로그 갱신은 작업 단위 나누기 단계에서 반영 예정.
- 2026-10-20T07:20:55Z — 검토 소견 14건을 수정 요청으로 반영. 사용자 결정 5개(소개서 묶음은 접촉 승인 불가, 흑착색=알카리흑착 가정, 사용성 1명·10분, 팀 제안 5개 수용·표시, 지연 시 빼는 순서)는 후속 질문 Q11~Q15로 받고 2차 요약 확인을 거침. 규칙 수치는 부록 A(설정 파일 명세)로 옮겨 문서가 자립하게 함.
- 2026-10-20T07:30:48Z — 2차 검토의 새 소견 7건을 사용자 결정대로 반영(소개서 묶음 분류 ②/③과 대시보드 건수 포함, 체크 초기화 조건, 기회 단위 이력 종류 FR2.7 신설, 부록 A.3 상태별 점수·미래 발생일, 조사 상한 가설 표시, 사용성 과제 시점·대체 검증자, 줄이는 순서 문구). 사용자는 새 소견이 Low만이면 승인한다고 미리 밝힘.

## Deviations
<!-- example: 2026-05-29T10:14:32Z — skipped the optional caching layer the stage prose suggested; the dataset is small enough that it adds risk -->
- 2026-10-20T06:35:03Z — 요구사항 ID는 FR1~FR14(세부 FR n.m)·NFR1~NFR12로 두고, 각 요구에 출처 태그([scope]/[B-nn]/[CON-nn]/[Qn]/[S nn]/[v0.15 F.n])를 붙여 구상 단계 산출물로 역추적되게 함. 기획서 본문의 테이블 이름(PROCESS 등)은 설계 단계 몫이라 요구사항에는 쓰지 않음.

## Tradeoffs
<!-- example: 2026-05-29T10:14:32Z — picked TDD over BDD this run; the team is unit-first and the domain is well-understood -->
- 2026-10-20T06:27:57Z — A정밀 기대값(E 77 / P 95 / S 81.1 / R 82)은 v0.15 F.1·F.7 규칙(고정 일치도 단계, 확실도, 0.5 올림 반올림)으로 역산 가능함을 확인: 제품 25 확인, 소재 20 확인, 납품실적 동일 산업 0.67→10, 성능 태그 1개 0.5→5, 증설 직접·0~30일 10, 신규 수주 신호 없음 0, 공고 마감 전 7, 채용 미확보(P=95). R=82가 되려면 추정 등급 항목이 없어야 함(모두 확인 또는 0). 이 조합은 여러 해 중 하나이며 '역산한 가정값'으로 표시.

## Open questions
<!-- example: 2026-05-29T10:14:32Z — confirm the retention window with compliance before the next stage hardens the schema -->
- 2026-10-20T06:27:57Z — 시점 우선 ② 실행기간의 합의값(공고 마감까지 며칠 남아야 대응 가능한지)과 거산 납품 가능 지역은 PM 첫 메일로 확인 예정. 답이 오기 전까지 실제 후보는 시점 우선 분류를 받지 않음.
