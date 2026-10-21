# 안정성 설계 (Reliability Design) — U1 뼈대 (u1-skeleton)

안정성 요구(`../nfr-requirements/reliability-requirements.md` NFR1.x·NFR7.x·NFR9.x·NFR12.x)를 지키는 설계입니다. 외부 의존이 없으므로 회로 차단기·재시도·장애 조치는 해당 없음이고, 핵심은 **결정적 계산**, **트랜잭션 되돌림**, **파일 복사 백업**, **고정 기준일 테스트**입니다.

## 1. 해당 없는 패턴과 이유

| 패턴 | 뼈대 | 이유 |
|---|---|---|
| 회로 차단기·격벽·재시도 | 없음 | 외부 호출 없음. U2(LLM·HTTP)에서 계약 C9의 재시도 1회·타임아웃을 설계 |
| 장애 조치·복제 | 없음 | 단일 파일·단일 프로세스. 복제는 백업 파일로 대신 |
| 헬스 체크 | U8 | 로컬 실행에는 불필요. 11/6 시연 환경부터 `/api/v1/health` |
| 가용성 SLO | 없음 | 팀 노트북 실행. 호스팅 뒤 운영 단계는 이번 범위에서 건너뜀 |

## 2. 결정적 계산 (NFR1)

- 규칙 엔진은 입력 구조체(C3 EvaluationInput)만 받는 순수 함수 묶음(`geosan/rules/`)이며 DB·시계·난수·설정 파일 읽기를 하지 않는다. 규칙 설정 값도 입력으로 받는다.
- 반올림은 `decimal` 모듈 HALF_UP으로 고정한다(부동소수 반올림 금지). 81.05 → 81.1, 10.05 → 10.
- 규칙 설정 파일은 시작 때 해시를 계산해 RuleConfigVersion과 대조한다. 해시가 등록된 버전과 다르면 evaluate를 거부하고 "새 버전으로 등록하세요(check-config)"를 안내한다. 등록은 `check-config`가 하되 FIXED 버전은 덮어쓰지 않는다.
- 결정성 테스트: 같은 입력 2회 실행 결과 동일(AC5.1.2), 기준일만 바꾼 실행에서 시점 항목만 변함.

## 3. 트랜잭션과 되돌림 (NFR7.1~7.3)

- 흐름 함수(`workflows/flow_evaluate.py`)가 세션을 열고 `with session.begin():` 한 블록 안에서 모든 저장을 한다. 예외가 나면 블록을 빠져나가며 자동 되돌림, 흐름은 FlowResult{ok: false, error}를 돌려준다.
- 묶음 행만 FAILED로 남기는 것은 되돌림 뒤 별도 짧은 트랜잭션으로 기록한다(실패 사유 추적용, 평가 행은 없음).
- SQLite 연결 설정: WAL, `busy_timeout=5000`, 외래 키 검사 켬, 저널 동기화 NORMAL(WAL에서 안전).
- 강제 종료 복구: WAL 덕분에 재시작 시 마지막 커밋까지 일관. 재시작 절차 = 그냥 `serve` 다시 실행(1분 이내).

## 4. 백업·복원 (NFR7.4)

- 뼈대 기간: 투입·평가 전 `data/geosan.db`를 `backups/geosan-<날짜시각>.db`로 복사(안내서 한 줄). 서버를 멈추고 복사하거나 WAL 체크포인트 뒤 복사.
- U8이 `geosan backup`(온라인 백업 VACUUM INTO)·`geosan restore`를 만들면 그것으로 바꾼다.

## 5. 재투입 안전 (NFR7.5)

- 투입 명령은 식별 키로 기존 행을 찾아 덮어쓰고, 자식 행은 supersededAt으로 교체하며, 검수 완료는 되돌리지 않는다(BR1.7). 같은 파일 2회 투입 테스트가 멱등성을 지킨다.

## 6. 마이그레이션 (NFR7.6)

- Alembic 환경을 `migrations/`에 두고 `init-db`가 `upgrade head`를 실행한다. 파일 이름 `<접두사>_<번호>_<설명>.py`, 머리가 둘이면 `db merge-heads`가 Alembic merge를 실행해 합치는 파일을 만든다.
- 모든 마이그레이션은 downgrade를 가진다. 뼈대의 첫 마이그레이션 묶음: cfg_, cap_, opp_, ev_, eval_, q_, rec_ 테이블 생성(단위 U1 소유분).

## 7. 오류 처리 설계 (NFR7.7, NFR10)

- 오류 종류: 입력 오류(검사기, 400/종료 코드 1) / 규칙·설정 오류(evaluate 거부, 종료 코드 2) / 저장 오류(되돌림, 500/종료 코드 2) / 없는 대상(404).
- 모든 오류는 `AppError(kind, message, nextAction, fields?)`로 올리고, API 층 한 곳(예외 처리기)이 계약 3장 형식으로 바꾸며 ref를 붙여 로그에 남긴다. 명령 층 한 곳이 한국어 요약과 종료 코드로 바꾼다. 조용한 실패(try/except pass)는 금지(코드 검토 항목).

## 8. 시간 처리 (NFR12)

- 저장: `datetime`은 항상 시간대 포함(UTC 저장, 표시 시 Asia/Seoul 변환). `date`는 시간대 없는 날짜(기준일·마감일).
- 기준일 결정은 BR2.8 순서, 날짜 경계 포함 규칙은 NFR12.3. 테스트는 기준일을 상수로 고정한다.

## 9. 테스트 설계 (NFR9)

- `tests/features/*.feature`(한국어 Given/When/Then) + `tests/steps/`(pytest-bdd), `tests/unit/`. 커버리지는 `pytest --cov=geosan --cov-fail-under=80`.
- 테스트 DB는 임시 파일(tmp_path), 픽스처가 `init-db`·예시 파일 투입을 수행.
- 네트워크 차단 픽스처로 외부 호출 0건 보장(NFR9.5).
- 검증 명령 `python -m pytest -q && python -m geosan verify-case examples/case-apjeong.json`이 CI와 체크포인트에서 같은 의미로 돈다.

## 상류 문서와의 연결

- 안정성 요구 NFR1.1~1.5, NFR7.1~7.7, NFR9.1~9.7, NFR12.1~12.4; 기술 묶음(Alembic·pytest-bdd·decimal·zoneinfo).
- 기능 명세 W3(트랜잭션·실패), 3-2 상태 기계, 규칙 BR1.7·BR2.8·BR4.6~4.8·BR7.5·BR7.6.
- 계약 3장(되돌림·잠금 5초), C6, C8(종료 코드).
