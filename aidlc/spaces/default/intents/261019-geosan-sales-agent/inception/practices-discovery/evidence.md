# 근거 (Evidence) — 실천 방식 발견

리드(aidlc-pipeline-deploy-agent)가 초안을 쓰며 무엇을 보았고, 무엇을 추론했으며, 인터뷰에서 사람이 무엇을 정했는지 적습니다. 이번 실행은 리드 단독(협업자 끔)이라 지원 에이전트 검토는 없습니다.

## 1. 살펴본 것

| 파일 | 얻은 사실 |
|---|---|
| `aidlc/spaces/default/intents/261019-geosan-sales-agent/aidlc-state.md` | 그린필드, 범위 `mvp`, 깊이 Standard, Test Strategy Standard, 협업자 off, 구현 체크포인트 enabled, unit-major, serial |
| `aidlc/spaces/default/intents/261019-geosan-sales-agent/ideation/feasibility/constraint-register.md` | CON-01~23. 기술 기본안(Python, FastAPI + React, SQLAlchemy, SQLite), 단순 구조, 보안·데이터 제약(CON-07/09/10/11), 비용·일정·인력(CON-14~18), AWS 계정 없음·실행 환경 미확정(CON-22) |
| `aidlc/spaces/default/intents/261019-geosan-sales-agent/ideation/scope-definition/scope-document.md` | P0~P3 확정, 이정표(10/27 G0, 10/30, 11/6, 11/13, 11/15, 11/27, 12/11), Q6 "뼈대 먼저" 순서, 데이터 소스 정책, 줄이는 순서 |
| `aidlc/spaces/default/memory/org.md` | 다섯 항목의 조직 기본값(트렁크 기반·스쿼시, 스켈레톤 on, test-after + mvp 80% 커버리지, 합치면 스테이징 자동·프로덕션 수동 승인, Prettier/Black/Ruff/ESLint) |
| `aidlc/spaces/default/memory/team.md` | 다섯 항목 모두 비어 있음 → 재실행 기준선 없음 |
| `aidlc/spaces/default/memory/project.md` | `## Corrections`에 이 의도에서 배운 교정 14건(배포 방식은 G0·인프라 설계로 미룸, 외부 소스 3개 이내, 완료 기준은 S01~S14·A정밀 계산값 연결 등) |
| 저장소 루트 | 애플리케이션 코드·CI 설정·린터 설정 없음(`docs/input/`, `aidlc/`, `.claude/`만 존재). 그린필드이므로 git 이력·CI 설정에서 추론할 근거 없음 |

## 2. 추론한 것

- **Way of Working**: 조직 기본값(트렁크 기반, 스쿼시)을 그대로 제안. 4인이 AI 도구로 빠르게 고치는 환경에서는 짧은 가지가 충돌을 줄인다는 일반 원칙 외에 팀 고유 근거는 없음.
- **Walking Skeleton**: 범위 정의 Q6의 "뼈대 먼저"와 P0-6(10/30 초기 동작 정의)이 사실상 스켈레톤을 이미 고른 것으로 봄. 활성 범위 `mvp`가 `skeleton: on`이라 조직 규칙과도 일치.
- **Testing Posture**: 전원 비전공자(CON-16)와 짧은 일정(CON-17)을 근거로 test-after 제안. 커버리지 80%는 조직의 mvp 하한을 그대로 적용. 규칙 계산 테스트의 기대값은 `project.md` 교정(S01~S14, E 77 / P 95 / S 81.1 / R 82)에서 가져옴.
- **Deployment**: 조직 기본값의 두 단계(자동 → 수동 승인)를 "시연 환경 / 거산 실사용 환경"으로 바꿔 읽음. 구체 대상은 `project.md` 교정에 따라 G0·인프라 설계로 미룸.
- **Code Style**: 저장소에 설정 파일이 없으므로 조직 기본값을 제안하되, Python은 Ruff 하나로 통일하는 변형을 제안(비전공 팀의 도구 수 최소화). 이는 조직 기본값(Black + Ruff)과 충돌하지 않는 범위의 특화로 봄.
- **규칙(Mandated/Forbidden)**: 제약 목록에서 "확정" 상태인 보안·데이터·범위 제약만 옮김. "확인 필요"(CON-06, CON-12)와 "미정"(CON-19, CON-22)은 규칙으로 쓰지 않음.

## 3. 인터뷰 결정

인터뷰 파일 `practices-discovery-questions.md`에서 팀이 답했고, 통합 요약 확인(`Looks correct`)까지 마친 내용입니다.

| 질문 | 답 | 초안 대비 |
|---|---|---|
| Q1 가지·합치기 | A — 본줄기(`main`) 하나, 작업마다 짧은 가지를 따서 1~2일 안에 스쿼시 머지 | 초안 그대로 |
| Q2 뼈대 먼저 | A — A정밀 1건이 끝까지 통과하는 뼈대를 첫 작업 단위로 먼저 만들고, 사람이 승인한 검증 명령으로 확인한 뒤 나머지를 붙인다 | 초안 그대로 |
| Q3 테스트 | C — 기획서 시나리오 S01~S14를 Given/When/Then 시나리오 테스트로 먼저 쓰고, 세부 단위 테스트는 구현 뒤에 쓴다. 줄 커버리지 80% 유지, 외부 LLM·외부 API는 가짜 응답 | **바뀜**: 초안의 test-after에서 BDD 시나리오 먼저 + 단위 테스트 나중의 혼합으로. `Methodology`는 `custom`으로 기록 |
| Q4 배포 절차 | X(직접 작성) — 합치면 시연 환경 자동 배포, 거산 환경은 PM이 거산 담당자와 확인 후 사람이 배포, 되돌리기 절차 둠. 자동 배포는 GitHub 연결만으로 되는 쉬운 방식, 막히면 처음엔 수동 → 나중에 자동. 시연 환경은 늦어도 11/6까지 한 번 올려 봄 | **바뀜**: 초안의 두 단계 원칙은 유지하되, (1) 자동 배포 설정의 난이도 조건(GitHub 연결만으로), (2) 수동 → 자동 전환 허용, (3) 11/6 첫 시연 배포 기한이 추가됨. 구체 서비스명은 여전히 G0·인프라 설계에서 정함 |
| Q5 코드 모양 | A — Python은 Ruff 하나, React는 Prettier + ESLint. 저장 시 자동 수정, 합치기 전 자동 검사 실패 시 합치지 않음 | 초안 그대로 |

- 뼈대 승인 후 자동 진행(autonomous) / 매 체크포인트 검토(gated) 선택은 이번 인터뷰에서 묻지 않았으므로 구현 단계 진입 시 정한다. 초안의 "gated 제안" 문구는 확정본에서 뺐다.
- 인터뷰 답변에서 새 딱딱한 제약(ALWAYS/NEVER)은 나오지 않았다. 배포 시점·테스트 방식은 관행이므로 `discovered-rules.md`에 추가하지 않았다.

## 4. 남은 불확실성

- Given/When/Then 시나리오를 돌릴 도구(`pytest-bdd` 등 후보)와 React 테스트 러너(Vitest 등)의 구체 선택은 코드 생성·상세 화면 설계 단계에서 확정한다. 여기서는 "시나리오 러너를 쓴다"까지만 정했다.
- 자동 배포에 쓸 서비스(시연 환경을 어디에 둘지 포함)는 G0(10/27 목표)와 인프라 설계 단계에서 정한다. "GitHub 연결만으로 되는 쉬운 방식"이라는 선택 기준만 확정됐다.
- 시연 환경 첫 배포 기한(11/6)은 배포 절차 예행연습 기한이다. 자동 설정이 막히면 수동으로라도 그 날짜까지 한 번 올린다는 뜻이며, 자동화 완료 기한은 아니다.
- 배포 관련 절차(되돌리기, DB 백업)는 운영 단계가 범위에서 빠져 있으므로(4.x SKIP) 구현 단계의 CI 파이프라인 단계에서 최소한만 다루게 된다.
- `team.md`가 비어 있어 "팀이 실제로 익숙한 방식"에 대한 근거는 인터뷰 답변이 전부다. 기존 팀 레포(`as-is/`)의 작업 방식은 읽지 않았다(참고용 폴더이며 이 단계의 입력이 아님).
