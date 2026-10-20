# 팀원 시작 안내서 (Claude Code · Codex)

이 저장소에서 일을 시작하는 팀원을 위한 안내다. 공통 규칙의 원문은 루트 `AGENTS.md`에 있다. 이 안내서와 규칙이 다르면 `AGENTS.md`가 우선한다. (작성 2026-10-21)

## 1. 역할부터 확인하기

| 시기 | PM | 팀원 |
|---|---|---|
| 뼈대(U1, Bolt B1) 기간 (10/22~10/28) | AI-DLC 진행·승인(`/aidlc`, `$aidlc`)을 혼자 맡는다 | Claude Code나 Codex로 **맡은 파일의 코드 작성·테스트·PR만** 한다. `/aidlc`, `$aidlc`는 실행하지 않는다 |
| 뼈대 뒤 팀별 단위 소유로 바뀐 뒤 | 전체 순서 조정 | **자기 단위만** 진행·승인한다. 다른 사람의 단위는 진행·승인하지 않는다 |

- 같은 단위를 두 사람이 같은 시각에 진행하지 않는다. 진행 위치 기록은 하나뿐이라 서로 덮어쓴다.
- 어떤 도구로 만들든 같은 PR 검사(테스트, 코드 모양 검사, 약속 파일 비교)를 통과해야 `main`에 합친다.

## 2. 준비물 설치 (한 번만)

1. Git, 그리고 쓰려는 도구(Claude Code 또는 Codex CLI 0.145.0 이상)를 설치한다. Codex는 `codex --version`으로 확인한다.
2. AI-DLC 실행 파일 `aidlc`를 설치한다. Bun·Node.js는 필요 없다.
   - macOS / Linux / WSL: `curl -fsSL https://github.com/awslabs/aidlc-workflows/releases/latest/download/install.sh | sh`
   - Windows PowerShell: `irm https://github.com/awslabs/aidlc-workflows/releases/latest/download/install.ps1 | iex`
   - 설치 뒤 `aidlc`를 못 찾으면 설치 프로그램이 알려 준 PATH 안내를 따른다. `aidlc version`으로 확인한다.
3. 저장소를 받는다: `git clone <저장소 주소>` 후 그 폴더로 들어간다.
4. `aidlc doctor`를 돌려 "problems 0"인지 본다. 첫 대화 전에는 "hooks have not run yet" 경고가 나오는 게 정상이다.

## 3. 도구별 첫 실행

**Claude Code**
1. 저장소 폴더에서 터미널로 `claude`를 실행한다. (바탕화면 아이콘으로 열면 `aidlc`를 못 찾을 수 있다. 그때는 `aidlc doctor`가 알려 주는 대로 고친다.)
2. "이 폴더를 신뢰합니까?"에 예, 훅(자동 검사) 승인 질문에 예를 고른다. 그런 다음 Claude Code를 완전히 끄고 다시 연다. (`/clear`로는 부족하다.)
3. MCP 서버를 켤지 물으면 자격 증명이 있는 것만 켜고, 없으면 Esc로 건너뛴다.

**Codex CLI**
1. 저장소 폴더에서 `codex`를 실행한다. (Git 저장소여야 훅을 찾는다.)
2. 훅 신뢰 질문이 나오면 모두 신뢰(Trust all)를 고른다. 안 나오면 `/hooks`를 입력하고 `t`(모두 신뢰)를 누른 뒤 Esc.
3. 공통 규칙은 `AGENTS.md`에서 자동으로 읽힌다.

## 4. 일하는 순서 (팀원)

1. `main`을 최신으로 받는다: `git switch main && git pull`
2. 가지를 딴다: `git switch -c <이름>/<단위-또는-일>` (예: `minsu/u1-filter-tests`). 가지는 1~2일 안에 합친다.
3. 맡은 파일만 고친다. 약속 파일(`contracts/`, `contract-summary.md`)에 없는 API 경로·응답 필드·운영 명령·테이블·파일 항목은 만들지 말고 PM에게 먼저 묻는다.
4. 테스트와 코드 모양 검사를 돌린다. (명령은 뼈대 구현 뒤 `README.md`에 적힌다. Python은 `pytest`·Ruff, 화면은 Vitest·Prettier·ESLint.)
5. PR을 올린다. `.github/pull_request_template.md`의 항목을 모두 채운다. 약속 파일을 바꿨으면 "예"에 표시하고 PM 확인 뒤에 합친다.
6. 검사가 통과하고 확인이 끝나면 **스쿼시 머지**로 `main`에 합친다.

## 5. 하지 말 것

- `docs/input/`(원본 자료)과 `as-is/`(기존 레포 코드)는 고치지 않는다.
- `.claude/CLAUDE.md`, `.codex/`, `.agents/` 안의 파일은 프레임워크가 관리한다. 손으로 고치지 않는다. 규칙을 바꾸려면 `AGENTS.md`를 고쳐 PR로 올린다.
- 담당자 이름·이메일·전화 같은 개인정보를 저장하지 않는다.
- API 키·비밀번호를 코드에 적지 않는다. 환경 변수로 넘긴다.
- 가상 데이터(A정밀·아연도금 사례 등)는 화면과 출력물에 "가상·거산 실제 사양 아님"으로 표시한다.

## 6. 막히면

- `aidlc doctor`를 먼저 돌려 본다. 문제마다 고치는 방법이 같이 나온다.
- 훅이 안 도는 것 같으면 도구를 완전히 끄고 저장소 폴더에서 다시 연다.
- 그래도 안 되면 PM에게 `aidlc doctor --verbose` 결과를 보낸다.
