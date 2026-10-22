# Team-Level Rules

> This team's affirmed practices and corrections. Loaded after `org.md` as
> strict-additive guidance; contradictions with broader policy are rejected.
> Populated by the practices-discovery affirmation gate. Edit at the gate,
> not directly.

## Way of Working

우리는 **트렁크 기반 개발**(가지를 길게 두지 않고 모두 한 줄기로 자주 합치는 방식)으로 일하며, 그 한 줄기는 `develop`이다(2026-10-22 PM 결정으로 `main`에서 `develop`으로 바꿈). 모든 작업은 `develop`에서 가지(브랜치)를 따서 시작하고, 1~2일 안에 다시 `develop`으로 합친다. 오래 사는 가지는 합칠 때 충돌이 커지므로 두지 않는다. `main`은 시연·전달용 줄기로, PM만 `develop` → `main` PR로 옮기며 `main`에 합쳐지면 시연 환경에 자동 배포한다. (인터뷰 Q1: A, 2026-10-22 PM 결정)

- 구현(Construction) 단계의 작업 공간(worktree)은 `develop`에서 따고, 합치는 대상도 `develop`이다.
- 한 묶음의 작업(Bolt)을 합칠 때는 **merge commit**(가지의 기록을 그대로 두고 '합쳤다'는 기록 하나를 더하는 방식)을 쓴다(2026-10-22 PM 결정, GitHub 설정에서 squash·rebase는 꺼 둠). 스쿼시는 `develop`과 `main`을 오갈 때 같은 변경이 다시 보이는 문제를 만들어 쓰지 않는다. 묶음 경계는 merge commit으로 보이고, 사건 순서는 감사 로그가 보존한다.
- 4명이 같은 저장소에서 AI 도구로 빠르게 고치는 환경에서는 가지를 짧게 가져갈수록 "내 코드와 네 코드가 안 맞는" 문제가 줄어든다. 기존 팀 레포 방식과 병행(CON-18)하더라도 이 저장소 안에서는 한 줄기 원칙을 지킨다.
- 시연·전달용 `main` 외에는 환경(거산 접속용 등)이 늘어도 가지를 더 두지 않고, 태그나 환경별 설정으로 구분한다.

## Walking Skeleton

우리는 **얇은 끝단 조각(워킹 스켈레톤)을 먼저** 만든다. 가상 사례 1건(A정밀)이 입력 → 필수조건 필터 → 점수 → 분류 → 추천 목록·근거 상세 화면 → 담당자 의견 저장까지 한 번에 이어지는 최소 동작을 첫 단위(Unit)로 삼고, 그다음 의존 순서대로 살을 붙인다. 이는 범위 정의 Q6에서 고른 순서이고 10/30 초기 동작의 정의(P0-6)와 같다. (인터뷰 Q2: A)

- 활성 범위 `mvp`는 `skeleton: on`이므로 이 의식이 적용된다. 첫 단위는 다른 단위보다 먼저 코드 생성까지 끝까지 통과시킨다.
- 뼈대가 "정말 동작한다"는 확인은 사람이 승인한 **구현 검증 명령**(예: 백엔드 테스트 + A정밀 사례가 기대값 E 77 / P 95 / S 81.1 / R 82로 나오는지 확인)으로 한다. 설계 검토만으로는 뼈대 완료로 보지 않는다.
- 뼈대 승인 후, 이후 단위를 자동으로 이어갈지(autonomous) 매 체크포인트마다 검토할지(gated) 그때 한 번 묻는다. 이 선택은 인터뷰에서 묻지 않았으므로 구현 단계 진입 시 정한다.

## Testing Posture

우리는 테스트를 모든 작업 묶음의 필수 산출물로 본다. 기획서의 시나리오 S01~S14가 이미 "어떤 상황에서 무엇을 하면 어떤 결과가 나와야 하는지"를 정해 두었으므로, 그 시나리오를 **"주어진 상황 / 할 때 / 결과"(Given/When/Then) 형식의 시나리오 테스트로 먼저 쓰고** 그 테스트가 통과하도록 구현한다. 함수 하나하나를 확인하는 세부 단위 테스트는 각 층을 구현한 뒤에 쓴다. (인터뷰 Q3: C)

- **Methodology**: custom
- **Methodology evidence**: 인터뷰 Q3에서 팀이 C를 골랐다. 기획서 시나리오 S01~S14를 Given/When/Then 시나리오 테스트로 구현 전에 쓰는 부분은 BDD 방식이고, 세부 단위 테스트를 구현 뒤에 쓰는 부분은 test-after 방식이다. 두 가지 순서가 섞여 있으므로 단일 값(bdd 또는 test-after)이 아니라 `custom`으로 기록한다. 조직 기본값(test-after)에서 바뀐 항목이다.
- **Ordering**: 기획서 시나리오 S01~S14를 Given/When/Then 시나리오 테스트로 먼저 작성한 뒤 그 시나리오가 통과하도록 각 층(규칙 계산 → API → 화면)을 구현하고, 세부 단위 테스트는 각 층 구현 뒤 같은 작업 묶음 안에서 작성·실행해 통과시킨다.
- 커버리지: `mvp` 범위의 조직 기본 하한인 **줄 커버리지 80%**(테스트가 실제로 실행한 코드 줄의 비율)를 지킨다. 부록 F 점수·11개 분류 분기 같은 규칙 계산은 시나리오 S01~S14와 A정밀 계산값(E 77 / P 95 / S 81.1 / R 82)을 그대로 기대값으로 쓴다. 하한은 통과를 위해 낮추지 않는다.
- 도구: Python 쪽은 `pytest`(+ `pytest-cov`)를 기본으로 하고, Given/When/Then 시나리오를 돌리는 러너(`pytest-bdd` 같은 후보)는 코드 생성 단계에서 확정한다. React 쪽은 Vitest + React Testing Library 같은 표준 러너를 쓰되 상세 화면 설계·코드 생성 단계에서 확정한다.
- 실행 시점: `develop`에 합치기 전에 CI(자동 검사)에서 테스트를 돌리고, 실패하면 합치지 않는다.
- 범위 메모: 외부 LLM 호출(P0-4)과 외부 API(CON-04)는 테스트에서 가짜 응답(mock)으로 대체해 비용과 변동을 없앤다. 활성 `Test Strategy`는 Standard이며 이 메모는 그 위에 더해질 뿐 줄이지 않는다.

## Guard Policy

<!-- Affirmed by the team. Mode: strict, relaxed, or off. Strict here holds for every intent, whatever one person asks in chat; relaxed or off here applies to every intent whose policy came from its scope, unless project.md or the person sets another; changing this line changes it. A section under the retired Change Control heading, written by an earlier release, is still read. -->

## Deployment

우리는 인터뷰 Q4에서 팀이 직접 적은 다음 절차를 따른다.

> 본줄기에 합쳐지면 시연 환경에 자동으로 올라가고, 거산 환경은 PM이 거산 담당자와 확인한 뒤 사람이 올린다. 직전 버전으로 되돌리는 절차를 둔다. 단, 비전공 팀이므로 자동 배포 설정은 GitHub 연결만으로 되는 쉬운 방식을 고르고, 설정이 막히면 처음엔 수동으로 올리다가 나중에 자동으로 바꾼다. 거산이 11/15부터 써야 하므로 시연 환경은 늦어도 11/6까지 한 번 올려 본다.

이를 팀 방식으로 풀면 다음과 같다.

- **시연 환경**: `main`에 합쳐지면 자동으로 올라간다(합치면 배포). 자동 배포 설정은 GitHub 저장소를 연결하는 것만으로 되는 쉬운 방식을 고른다. 설정이 막혀 시간이 걸리면 처음에는 사람이 직접 올리고, 나중에 자동으로 바꾼다. 수동으로 시작하는 것은 실패가 아니라 예정된 1단계다.
- **첫 시연 배포 기한**: 거산이 11/15부터 써야 하므로, 시연 환경에는 **늦어도 11/6까지 한 번 올려 본다**. 이 날짜는 배포 절차가 실제로 동작하는지 확인하는 예행연습 기한이다.
- **거산 실사용 환경**(11/15 이후): 자동으로 올리지 않는다. PM이 거산 담당자와 확인한 뒤 사람이 올린다. 재접촉 실제 이력은 거산이 지정한 환경에 둔다는 원칙(CON-13)을 배포 설계에서 지킨다.
- **되돌리기**: 어떤 배포든 직전 버전으로 되돌리는 절차를 문서로 둔다. SQLite 개발 DB를 쓰는 동안은 배포 전 DB 파일 백업을 되돌리기 수단으로 삼는다.
- **구체 서비스는 아직 정하지 않는다**: 시연 환경을 어디에 둘지(저비용 호스팅 등)와 구체 서비스명은 G0(기업 업무 합의, 10/27 목표)와 인프라 설계 단계에서 정한다(CON-22, 범위 문서 P1-6). 여기서는 절차만 확정한다.
- **비용**: AWS 계정이 없고(CON-22) 12/11 이후 비용을 팀이 계속 부담하지 않으므로(CON-15), 무료 또는 월 수천 원 수준에서 멈출 수 있는 방식을 우선 검토한다.

## Code Style

우리는 저장소에 둔 설정 파일이 정한 규칙을 따르고, 사람이 손으로 고치지 않고 도구가 자동으로 맞추게 한다. 전원 비전공자이므로 "규칙을 외우는 것"이 아니라 "저장하면 도구가 고쳐 주는 것"을 기본으로 한다. (인터뷰 Q5: A)

- Python: 포매터(코드 모양을 고쳐 주는 도구)와 린터(흔한 실수를 찾아 주는 도구)를 모두 **Ruff** 하나로 통일한다(설정은 `pyproject.toml`). 조직 기본값은 Black + Ruff지만, 도구가 하나면 비전공 팀이 익히기 쉽다. 이름은 `snake_case`.
- JS/TS(React): 포매터 **Prettier**, 린터 **ESLint**(설정은 저장소 루트 `.prettierrc`, `eslint.config.*`). 이름은 `camelCase`, 컴포넌트는 `PascalCase`.
- 편집기에서 저장할 때 자동으로 고친다(저장 시 포맷).
- `develop`에 합치기 전 CI에서 포매터·린터를 먼저 돌리고, 오류가 있으면 합치지 않는다.
- 가상 데이터 표시: 화면과 출력물에서 가상(실제 거산 사양 아님) 데이터는 눈에 띄게 표시하는 공통 부품을 둔다(CON-10). 이는 스타일이 아니라 규칙이므로 `discovered-rules.md`에도 적었다.
- 그 밖의 이름 규칙은 린터 설정이 다루지 않는 경우에만 코드 생성 단계에서 제안한다.
## Forbidden

<!-- Team-specific forbidden patterns -->

## Mandated

<!-- Team-specific mandates -->

## Corrections

<!-- Self-learning loop appends here. -->
