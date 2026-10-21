# 인프라 명세 (Infrastructure Specification) — U1 뼈대 (u1-skeleton)

뼈대 기간(10/21~10/28)과 10월 말 부분 시연의 실행 환경은 **팀 노트북 로컬 실행**뿐입니다(확인된 답변 Q1). 클라우드 자원·컨테이너·IaC는 없습니다. 11/6 시연 환경(호스팅·접속 보호·HTTPS·백업 명령)은 U8과 그때의 인프라 설계에서 정하며(외부 의존 E-4, 팀 실천 방식: 구체 서비스는 G0·인프라 설계에서), AWS 계정은 없습니다(CON-22). 비용은 0원입니다.

## 1. 배포 (Deployment)

| Facet | Choice | Rationale |
|---|---|---|
| 실행 모델 | 단일 파이썬 프로세스(`geosan serve`): FastAPI가 API와 React 빌드 결과(정적 파일)를 함께 내보냄. 명령은 같은 패키지의 짧은 프로세스 | 제약 CON-02(단일 애플리케이션), 작업 단위 U1 "한 덩어리 실행". 컨테이너는 호스팅 결정 뒤(U8) |
| 네트워크 | `127.0.0.1:8000`(기본)만 듣는다. 외부 주소·포트 포워딩·터널 없음. CORS 없음(같은 출처) | 접속 보호가 없는 기간이라 외부 노출 금지(보안 요구 NFR4.10). 계약 C1 같은 출처 |
| 저장소 | SQLite 파일 `data/geosan.db`(+ WAL·SHM), 로그 `logs/`, 백업 `backups/` — 모두 저장소 폴더 안이며 `.gitignore` | NFR3.9, NFR4.7, NFR7.4 |
| 설정 | `rule-config.yaml`·`app-settings.yaml`(저장소에 커밋, 예시는 `examples/`), 환경 변수 `GEOSAN_DB_PATH`(선택, 기본 `./data/geosan.db`), `.env.example` | NFR11.1~11.3 |
| 환경 구성 | **dev(로컬)**: 팀원 4명 각자 노트북, 각자 DB 파일. **demo(부분 시연)**: PM 노트북, 소개서 묶음·실제 기업 파일 투입본. **시연 환경(11/6)·거산 환경(11/15)**: U8/11월 인프라 설계 | 팀 실천 방식 Deployment(시연 환경 11/6, 거산 환경 수동 배포) |
| 환경 동일성 | 세 사람 노트북과 CI가 같은 파이썬 3.12·노드 20·잠금 파일을 쓴다(`.python-version`, `.nvmrc`, `requirements.lock`, `package-lock.json`) | NFR11.5 |
| IaC | 없음(로컬). 호스팅이 정해지면 "GitHub 연결만으로 되는" 방식을 우선하므로 IaC 도구를 따로 두지 않을 가능성이 큼 | 팀 실천 방식 Deployment |
| 자원 크기 | 메모리 512MB 이하, 디스크 1GB 이하(DB 500MB 상한 + 로그·백업) | NFR2.14, NFR3.8 |
| 시작·중지 | `geosan serve` / Ctrl+C. 재시작 1분 이내. 포트 사용 중이면 "포트 8000이 사용 중입니다. --port로 바꾸세요" | NFR7.3 |
| 비용 | 0원(노트북). 호스팅 비용은 무료~월 수천 원 목표로 U8에서 | NFR6, CON-15 |

## 2. 인프라 서비스 (Infrastructure Services)

| Service | Role | Configuration | Notes |
|---|---|---|---|
| SQLite(파이썬 내장) | database | 파일 1개, WAL 모드, `busy_timeout=5000`, 외래 키 검사 켬, 저널 동기화 NORMAL | 동시 쓰기는 잠금 대기만(NFR 설계 Q2). 백업 = 파일 복사(뼈대), `backup`/`restore` 명령은 U8 |
| 로컬 파일 시스템 | storage | `data/`, `logs/`(일 1회 회전·14일), `backups/`, `examples/` | 저장소 밖으로 쓰지 않음. 경로는 설정·환경 변수 |
| 파이썬 `logging` JSON | logging | 표준 출력 + 파일 | 로그 집계 서비스 없음(관측 설계) |
| 캐시 / 큐 / 검색 / CDN / DNS / 로드 밸런서 | — | 없음 | 단일 프로세스·로컬. 캐시 없음은 NFR 설계 Q1 |
| GitHub(저장소·Actions) | source, ci | `main` 보호(PR 필수, 검사 통과 필수 — 3.7에서 설정), Actions 무료 한도 | 팀 실천 방식(트렁크·스쿼시) |

## 3. 공유 자원 (Shared Infrastructure)

| Shared Resource | Owner Unit | Consumer Units | Access Boundary |
|---|---|---|---|
| SQLite 스키마(접두사 7묶음)와 마이그레이션 체계(Alembic, `migrations/`) | U1 | U2~U11 | 각 단위는 자기 접두사 테이블·마이그레이션 파일만 추가. 머리가 둘이면 `geosan db merge-heads` |
| 설정 파일 2개와 `examples/` | U1 | U2~U11 | 키는 "추가만", 기존 키 변경 금지. 비밀 값 금지 |
| `contracts/`(약속 파일) | U1 | 전체 | PM 확인 뒤에만 변경, `export-contracts`는 사람이 실행 |
| CI 워크플로(최소 검사) | U1(기본 틀) → 3.7에서 완성 | 전체 PR | 검사 항목 추가는 3.7·PR로 |
| 한 덩어리 빌드(React → 정적 파일 → FastAPI) | U1 | U8(배포), U11(화면) | 빌드 산출물 경로는 설정 한 곳 |

## 4. 11월로 넘기는 결정 (U8 인프라 설계에서)

| 결정 | 조건(이미 정해진 것) |
|---|---|
| 호스팅 서비스 | GitHub 연결만으로 자동 배포, SQLite 파일이 지워지지 않는 영구 저장, HTTPS, 무료~월 수천 원, 12/11 뒤 비용 중단 가능 |
| 접속 보호 | 공용 비밀번호 환경 변수 `GEOSAN_PASSWORD`, 세션 쿠키, 5회 실패 30초 |
| 백업·복원 명령 | `geosan backup`(VACUUM INTO), `geosan restore`(서버 멈춘 뒤) |
| 헬스 경로 | `/api/v1/health` |
| 컨테이너 여부 | 호스팅이 요구할 때만 |

## 상류 문서와의 연결

- NFR 설계: 논리 구성 요소(프로세스·파일·브라우저), 안정성 설계 3·4장(WAL·백업), 보안 설계 3·4장(환경 변수·외부 호출 없음), 성능 설계 1장.
- 부품 목록(한 덩어리 실행·바깥 의존 표), 기능 명세 W9(서버 시작·설정 검사), 계약 C6·C8.
- 팀 실천 방식 Deployment, 전달 계획 B3·외부 의존 E-4, 제약 CON-02·CON-15·CON-22.
