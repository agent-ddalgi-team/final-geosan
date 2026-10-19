<!-- INVARIANT: examples are single-line HTML comments so a fresh template parses to total=0 (MEMORY_EMPTY). Do NOT un-comment or split across lines. t100 guards this. -->
> This file is kept up to date automatically while the stage runs. Add observations at the review step, not by editing here directly.

## Interpretations
<!-- example: 2026-05-29T10:14:32Z — chose REST over GraphQL; the consuming team only needs CRUD, revisit if subscriptions land -->
- 2026-10-19T13:12:56Z — 새 프로젝트(greenfield)라 org.md 기본값을 제안 답으로 쓰고, 팀 조건(4인 비전공·AI 도구 의존·SQLite·단순 구조·800만 원 예산)을 질문 보기에 반영함. 지원 전문가는 collaborators off라 부르지 않고 릴리스 엔지니어 단독으로 초안·통합.
- 2026-10-19T13:37:50Z — 배포 절차(Q4)는 사용자가 A를 바탕으로 '자동 배포는 GitHub 연결만으로 되는 쉬운 방식, 막히면 처음엔 수동→나중에 자동, 시연 환경은 11/6까지 한 번 올려 본다'를 덧붙임. 구체 서비스명은 여전히 G0·인프라 설계로 미룸.

## Deviations
<!-- example: 2026-05-29T10:14:32Z — skipped the optional caching layer the stage prose suggested; the dataset is small enough that it adds risk -->

## Tradeoffs
<!-- example: 2026-05-29T10:14:32Z — picked TDD over BDD this run; the team is unit-first and the domain is well-understood -->
- 2026-10-19T13:37:50Z — 테스트 방법은 초안(test-after) 대신 사용자가 BDD 혼합(C)을 골라 custom으로 기록; 기획서 시나리오 S01~S14를 시나리오 테스트로 먼저 쓰고 세부 단위 테스트는 구현 뒤에 쓴다. 커버리지 80% 하한은 유지.

## Open questions
<!-- example: 2026-05-29T10:14:32Z — confirm the retention window with compliance before the next stage hardens the schema -->
- 2026-10-19T13:37:50Z — 비전공 팀이 BDD 시나리오 테스트(Given/When/Then)를 쓸 도구(pytest-bdd 등)는 코드 생성 단계에서 정해야 함.
