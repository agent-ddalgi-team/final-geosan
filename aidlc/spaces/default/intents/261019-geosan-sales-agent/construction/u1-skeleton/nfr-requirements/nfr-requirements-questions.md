# NFR 요구 질문 — U1 뼈대 (u1-skeleton)

성능·보안·규모·안정성·관측 목표치는 요구사항 NFR1~NFR12와 계약 3장(응답 시간·재시도·동시 수정·로그)에 이미 수치로 정해져 있어 다시 묻지 않습니다. 기술 묶음도 제약(CON-01: Python, FastAPI + React, SQLAlchemy, SQLite)과 상세 화면 설계(Ant Design 5, Pretendard)로 정해져 있습니다. 앞 단계가 "코드 생성에서 확정"으로 넘긴 도구 선택 2가지만 여기서 정합니다. PM 지시(2026-10-21, "작은 결정은 추천안으로 정하고 기록만 해")에 따라 추천안으로 기록합니다.

## Q1. 시나리오 테스트(주어진 상황 / 할 때 / 결과)는 어떤 도구로 돌릴까요?

팀 실천 방식은 기획서 시나리오 S01~S14를 Given/When/Then 시나리오 테스트로 먼저 쓰고, 세부 단위 테스트는 뒤에 쓰는 것입니다. 러너 선택은 코드 생성에서 확정하기로 했으나 기술 묶음 문서가 이 단계 산출물이라 여기서 정합니다. 팀원이 자기 모듈 시나리오를 직접 쓰므로 비전공자가 읽고 쓰기 쉬운 쪽이 좋습니다.

A. `pytest-bdd`: 시나리오를 한국어 `.feature` 파일(Given/When/Then 문장)로 쓰고, 문장마다 작은 파이썬 함수를 붙인다. 기획서 시나리오 문장이 그대로 테스트 이름이 된다. (추천: 팀원이 문장을 먼저 쓰고 개발자가 붙이는 분업이 자연스럽고, 커버리지·CI는 pytest 그대로)
B. 순수 `pytest`: 시나리오를 파이썬 테스트 함수로 쓰고 함수 이름·주석에 Given/When/Then을 적는다. 추가 도구 없음.
C. `behave`: 별도 BDD 도구. pytest와 따로 돌아 커버리지·CI 설정이 둘이 된다.
X. Other (please specify)

[Answer]: A

## Q2. 데이터베이스 스키마 변경(마이그레이션) 도구는 무엇으로 할까요?

계약 C6은 단위마다 접두사별 마이그레이션 파일을 두고 머리가 둘이면 `geosan db merge-heads`로 합친다고 정했고, 도구는 "코드 생성에서, Alembic 후보"로 넘겼습니다.

A. `Alembic`(SQLAlchemy 공식 마이그레이션 도구): 접두사별 파일 이름 규칙을 그대로 쓰고, `merge-heads`는 Alembic의 merge 기능을 감싼 명령으로 만든다. (추천: SQLAlchemy와 한 묶음이라 AI 도구가 가장 잘 만들고, 되돌리기(downgrade)가 있어 백업·복원 절차와 맞음)
B. 마이그레이션 도구 없이 `init-db`가 매번 "없는 테이블·열만 추가"한다: 단순하지만 되돌리기·머리 합치기가 없고 뒤 단위가 열을 바꿀 때 위험.
C. 직접 쓴 SQL 파일을 번호순으로 적용하는 자체 스크립트.
X. Other (please specify)

[Answer]: A

## 답변 요약 (요약 확인은 PM 지시로 이 작업에서 꺼짐, 2026-10-21)

- 성능·보안·규모·안정성·관측 목표는 요구사항 NFR1~12·계약 3장 수치를 그대로 쓴다(목록·상세 3초, 평가 1건 1초, 요청 중단 10초, 동시 5명, 기회 2,000건, 커버리지 80%, 연락처·금지 원문·비밀 값 비노출)
- Q1 시나리오 테스트 러너: `pytest-bdd`(한국어 .feature + pytest) — 추천안, PM 지시로 기록
- Q2 마이그레이션 도구: `Alembic`(접두사별 파일, merge-heads 명령으로 감쌈) — 추천안, PM 지시로 기록
- 기술 묶음: Python 3.12 · FastAPI · SQLAlchemy 2 · Alembic · pydantic · pytest/pytest-bdd/pytest-cov · Ruff / Node 20 LTS · Vite · React 18 · TypeScript · Ant Design 5 · Pretendard · Vitest + React Testing Library · ESLint + Prettier / SQLite(WAL) — 제약·상세 화면 설계·팀 실천 방식에서 온 것이며 새 선택은 Q1·Q2뿐
- 답변 분석: 모순 없음
