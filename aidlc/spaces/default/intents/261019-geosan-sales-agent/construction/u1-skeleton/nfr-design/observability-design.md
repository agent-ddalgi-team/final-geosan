# 관측 설계 (Observability Design) — U1 뼈대 (u1-skeleton)

관측 요구(`../nfr-requirements/observability-requirements.md` NFR10.x·NFR5.x)를 지키는 설계입니다. 뼈대의 관측 수단은 **JSON 한 줄 로그**와 **기록 테이블** 둘뿐이며, 지표 수집기·대시보드·분산 추적·알림은 두지 않습니다(이유: 단일 프로세스 로컬 실행, 운영 단계는 이번 범위에서 건너뜀).

## 1. 로그 설계 (NFR10.1~10.6)

- 포매터: 파이썬 `logging`에 JSON 포매터 하나. 필드: `ts`(ISO, 시간대), `level`, `event`(예: `http.request`, `cmd.evaluate.done`, `eval.link_recomputed`), `ref`, `path`·`method`·`status`·`ms`(요청), `batchId`·`evalId`·`oppId`·`caseId`(해당 시), `msg`(짧은 영문 식별 문구; 사람에게 보이는 한국어는 응답·명령 출력에).
- 금지 필드 차단: 포매터가 `quote`·`memo`·`reason`·`password`·`key`·`snapshot` 키를 받으면 값을 `[redacted]`로 바꾼다(실수 방지, NFR10.3).
- 출력: 표준 출력 + `logs/geosan.log`(일 1회 회전, 14일). 명령도 같은 포매터.
- 요청 로그는 FastAPI 미들웨어 한 곳에서 시작·끝·소요 ms·ref를 남긴다. ref는 요청마다 생성한 짧은 ID(8자)이며 오류 응답에 실린다.

## 2. 상관 ID (correlation)

- API: 요청 ref를 그 요청의 모든 로그 줄에 붙인다(contextvar).
- 명령: 실행마다 run ID를 만들어 로그에 붙이고 출력 마지막 줄에 표시("문의 시 이 번호: …").
- 평가: batchId가 상관 키. 평가 안의 경고(공정 연결 재계산, 검수 사본 불일치)는 batchId·oppId와 함께.

## 3. 기록 테이블로 답하기 (NFR5.5)

안내서(U10)에 넣을 조회 예시 5개를 코드 생성에서 `docs/queries.md`로 둔다: 최신 묶음·규칙 버전, 기회의 평가 이력, 항목별 점수와 근거, 요구 판정 사유, 의견 이력. SQL 또는 명령(`geosan show …`는 범위 밖이므로 SQL 파일로).

## 4. 지표 (NFR10.7~10.10)

- 수집기 없음. 로그에서 계산: 요청 소요(ms 필드), 평가 소요(`cmd.evaluate.done`의 ms·count), 오류 수(level=ERROR 줄 수), 외부 전송 수(전송 로그 테이블 0행).
- 체크포인트 측정은 로그를 `jq`나 짧은 스크립트로 집계해 `tests/perf-notes.md`에 적는다.

## 5. 알림·대시보드

- 없음. 11/6 시연 환경에서 U8이 헬스 경로를 두고, 호스팅의 기본 "서버 응답 없음" 알림만 쓴다(인프라 설계).

## 6. 화면 상태 정보 (NFR10.11~10.13)

- `/config/ui`와 목록·상세 `meta`에 갱신 시각·가상 포함·묶음을 실어 띠에 표시. 오류 띠에 ref를 작게 표시해 로그와 대조.

## 상류 문서와의 연결

- 관측 요구 NFR10.1~10.13, NFR5.1~5.5; 기술 묶음(logging JSON 포매터).
- 기능 명세 W3·W5~W7, 규칙 BR2.5·BR10.4·BR10.7; 계약 3장 로그 규칙.
