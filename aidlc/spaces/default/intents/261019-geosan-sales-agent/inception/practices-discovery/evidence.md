# 근거 (Evidence) — 실천 방식 발견 초안

리드(aidlc-pipeline-deploy-agent)가 초안을 쓰며 무엇을 보았고, 무엇을 추론했으며, 무엇은 인터뷰에서 사람이 정해야 하는지 적습니다. 이번 실행은 리드 단독(협업자 끔)이라 지원 에이전트 검토는 없습니다.

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

## 3. 인터뷰에서 사람이 정해야 하는 것

1. **가지·합치기**: 트렁크 기반 + 스쿼시를 받아들일지, 또는 가지를 좀 더 오래 두는 방식(GitHub Flow)을 원하는지. 기존 팀 레포(as-is)와의 병행 방식도 함께 확인.
2. **뼈대 먼저 여부**: Q6에서 이미 고른 순서를 그대로 확정할지. 뼈대 승인 후 이후 단위를 자동으로 이어갈지(autonomous), 매번 검토할지(gated).
3. **테스트 방법·커버리지**: test-after로 갈지, TDD/BDD 경험이 있어 바꿀지. 80% 줄 커버리지를 지킬 수 있는지(조직 하한이라 낮출 수는 없고 높이기만 가능). 외부 LLM·API를 가짜 응답으로 대체하는 데 동의하는지.
4. **배포 대상과 주기**: 시연 환경을 팀 노트북으로 할지 저비용 호스팅으로 할지(선택지만 비교; 결정은 G0·인프라 설계). 거산 실사용 배포의 승인자가 누구인지.
5. **포매터·린터**: Python을 Ruff 하나로 갈지 Black + Ruff로 갈지. React 쪽 Prettier + ESLint 수용 여부. 저장 시 자동 포맷을 켤지.

## 4. 남은 불확실성

- `team.md`가 비어 있어 "팀이 실제로 익숙한 방식"에 대한 근거가 전혀 없음. 초안은 전부 조직 기본값 + 제약 조건에서 나온 추론임.
- 기존 팀 레포(`as-is/`)의 작업 방식은 읽지 않았음(참고용 폴더이며 이 단계의 입력이 아님). 팀이 그쪽 관행을 가져오고 싶다면 인터뷰에서 밝혀야 함.
- React 테스트 러너(Vitest 등)와 린터 설정의 구체 선택은 코드 생성·상세 화면 설계에서 확정. 여기서는 "표준 러너를 쓴다"까지만 제안.
- 배포 관련 규칙(되돌리기 절차, DB 백업)은 운영 단계가 범위에서 빠져 있으므로(4.x SKIP) 구현 단계의 CI 파이프라인 단계에서 최소한만 다루게 됨.
- 타임스탬프 산출물은 최종 통합 때 다시 찍기 전까지 초안임.
