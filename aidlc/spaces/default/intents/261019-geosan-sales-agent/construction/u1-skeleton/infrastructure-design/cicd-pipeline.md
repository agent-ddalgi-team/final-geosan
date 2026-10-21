# CI/CD 파이프라인 (CI/CD Pipeline) — U1 뼈대 (u1-skeleton)

팀 실천 방식(트렁크 기반, `main`에 합치기 전 CI에서 포매터·린터·테스트, 스쿼시 머지, 시연 환경은 합치면 자동 배포·거산 환경은 수동)을 뼈대 기간에 맞춘 설계입니다. 확인된 답변 Q2: **검사만 하는 최소 CI**를 3.5 코드 생성의 기본 틀에 먼저 넣고(10/23 팀원 PR부터 검사), 3.7 CI 파이프라인 단계에서 약속 파일 비교·취약점 검사·배포 연결을 더합니다. 배포 단계는 호스팅이 정해지는 U8 뒤에만 생깁니다.

## 1. 흐름 한 줄

```
PR 열기 → [검사: 파이썬] [검사: 화면] (병렬) → 통과 + 1명 읽음 → 스쿼시 머지 → (11/6부터) 시연 환경 자동 배포 → (11/15 이후) 거산 환경 수동 배포
```

## 2. 검사 단계 (뼈대 기간 최소 CI, GitHub Actions `.github/workflows/check.yml`)

| 순서 | 작업 | 명령(코드 생성에서 확정) | 실패 시 | 시간 목표 |
|---|---|---|---|---|
| 1 | 파이썬 준비 | 3.12 설치, 잠금 파일로 의존성 설치(캐시) | 합치지 못함 | 1분 |
| 2 | 코드 모양(서버) | `ruff format --check .`, `ruff check .` | 합치지 못함 | 30초 |
| 3 | 테스트·커버리지 | `pytest -q --cov=geosan --cov-fail-under=80` | 합치지 못함(커버리지 80% 미만 포함) | 3분 |
| 4 | 뼈대 검증 | `python -m geosan verify-case examples/case-apjeong.json`(임시 DB에 init-db·import 뒤) | 합치지 못함 | 1분 |
| 5 | 노드 준비 | 20 설치, `npm ci`(캐시) | 합치지 못함 | 1분 |
| 6 | 코드 모양(화면) | `npm run lint`(ESLint), `npm run format:check`(Prettier) | 합치지 못함 | 30초 |
| 7 | 화면 테스트·빌드 | `npm test`(Vitest), `npm run build`(Vite) | 합치지 못함 | 2분 |
| 8 | 비밀·DB 파일 검사 | 커밋에 `*.db`·`.env`·비밀 패턴이 없는지(간단 스크립트) | 합치지 못함 | 10초 |

- 1~4와 5~8은 병렬 두 작업. 전체 5분 안.
- 검사 결과가 모두 초록이고 다른 모듈 담당 1명이 PR을 읽어야 합친다(`main` 보호 규칙은 3.7에서 설정; 뼈대 기간에는 PM이 손으로 지킴).
- PR 템플릿(`.github/pull_request_template.md`)의 "약속 파일을 바꿨나요?" 항목은 사람이 확인한다. 약속 파일 자동 비교(서버가 만든 OpenAPI ↔ `contracts/openapi.json`, 검사기 스키마 ↔ `contracts/*.schema.json`)는 3.7에서 추가.

## 3. 3.7에서 더하는 것

| 추가 | 내용 |
|---|---|
| 약속 파일 비교 | `geosan export-contracts --check`(생성본과 커밋본이 같은지) |
| 취약점 검사 | `pip-audit`, `npm audit --audit-level=high` |
| `main` 보호 규칙 | 검사 통과 필수, 1명 승인 필수, 스쿼시만 |
| 배포 단계 | 호스팅 결정 뒤: `main` 합치기 → 시연 환경 자동 배포(GitHub 연결 방식), 배포 전 DB 백업, 되돌리기 = 직전 커밋 재배포 + 백업 복원 |

## 4. 배포 전략·되돌리기 (설계만, 실행은 U8 뒤)

| 항목 | 설계 |
|---|---|
| 전략 | 재생성(Recreate): 단일 프로세스라 블루/그린·카나리 불필요. 배포 중 수십 초 중단 허용(시연 환경) |
| 환경 승격 | `main` → 시연 환경 자동. 거산 환경은 PM이 거산 담당자와 확인 뒤 수동(태그 `release-YYYYMMDD`) |
| 되돌리기 | 직전 태그 재배포 + 배포 전 백업한 DB 파일 복원(`restore`, 서버 멈춘 뒤). 마이그레이션은 downgrade 가능(Alembic) |
| 비밀 | GitHub Actions secrets에 `GEOSAN_PASSWORD` 등을 두고 호스팅 환경 변수로 전달. 저장소에 없음. 회전은 수동(소규모) |
| 기능 플래그 | 없음. 앱 설정(`activeDatasetKind`, `demoLabel`, `accessProtection.enabled`)이 그 역할 |
| 산출물 | 컨테이너 이미지 또는 소스 배포(호스팅에 따라). 커밋 SHA로 식별 |

## 5. 로컬에서 같은 검사 (뼈대 기간, CI가 올라오기 전·후 모두)

- `make check`(또는 `scripts/check.sh`): 2·3·4·6·7·8을 순서대로. 팀원은 PR 전에 이것을 돌린다(안내서 4장).
- 구현 검증 명령 `python -m pytest -q && python -m geosan verify-case examples/case-apjeong.json`은 CI 3·4단계와 같은 뜻이며 뼈대 체크포인트에서 PM 세션이 돌린다.

## 상류 문서와의 연결

- 팀 실천 방식(Way of Working·Testing Posture·Deployment·Code Style), 전달 계획 6장(검증 명령·CI는 B2 뒤 추가 → Q2로 최소 CI를 앞당김), 7장 3항(PR 검사 동일).
- 안정성 요구 NFR9.6·9.7, 보안 요구 NFR4.7·4.16, 기술 묶음(Ruff·pytest-cov·ESLint·Prettier·Vitest·Vite).
- 계약 2장(약속 파일 갱신 규칙·`export-contracts`), 8장.
