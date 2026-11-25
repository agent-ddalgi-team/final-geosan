# PC의 AI 앱에 거산 영업 기록 연결하기 (MCP 서버, #927)

**결론: PC의 Claude 앱 설정에 `geosan mcp` 한 줄을 적으면, 앱에서 "B금속 지난 기록 정리해 줘"처럼 물을 때 우리 DB의 영업 기록을 찾아 답합니다.** 배포 서버와는 상관없고, 이 PC 안에서만 연결됩니다.

## 무엇을 읽을 수 있나

| 도구 | 앱에서 이렇게 물으면 | 돌려주는 것 |
|---|---|---|
| 회사 찾기 | "성사된 회사 목록 보여 줘", "아노다이징 쪽 회사" | 이름·공정·산업·상태·세부 단계·접촉 수·마지막 접촉일 |
| 회사 기록 보기 | "B금속 지난 기록 정리해 줘" | 접촉 흐름·꼬리 질문 답·메모(최근 10개)·결과 사유 |
| 비슷한 성사 회사 | "A정밀이랑 비슷한데 성사된 곳은 어떻게 했어?" | 공정·산업이 겹치는 성사 회사 3곳과 그 기록 |
| 비슷한 거절 회사 | "비슷한 회사 중 거절된 곳은 왜 거절했어?" | 같은 기준의 거절 회사와 거절 이유 |
| 지난 영업 분석 | "지난번 영업 분석에서 뭐라고 했지?" | [지난 분석] 탭에 쌓인 분석 목록과 내용 |

**지키는 것**
- 전화·이메일·사람 이름은 지운 사본만 돌려줍니다. 대표번호·주소는 싣지 않습니다. 회사 이름은 보입니다.
- 영업 기록 스위치(`llm.salesRecordsEnabled`)가 꺼져 있으면 아무것도 돌려주지 않습니다.
- 부를 때마다 전송 기록이 남습니다(누가 불렀는지는 `--by`의 아이디).
- 하루 200번까지입니다(설정 `assistant.mcpDailyLimit`). 앱 쪽 AI 비용은 우리 비용 한도에 들어가지 않습니다.
- 읽기만 합니다. 기록을 저장하거나 고치지 않습니다.

## 연결하기 — Claude 앱(데스크톱)

1. Claude 앱 › 설정 › 개발자(Developer) › [설정 편집]으로 `claude_desktop_config.json`을 엽니다.
2. 아래를 넣습니다. `<저장소 폴더>`는 이 저장소를 받은 폴더(예: 홈 폴더 아래 `dev/final-geosan`)의 전체 경로, `<아이디>`는 내 담당자 계정 아이디입니다(보기 전용 계정은 안 됨).

```json
{
  "mcpServers": {
    "geosan": {
      "command": "<저장소 폴더>/.venv/bin/python",
      "args": ["-m", "geosan", "mcp", "--by", "<아이디>"],
      "env": { "GEOSAN_DB_PATH": "<저장소 폴더>/data/geosan.db" }
    }
  }
}
```

3. Claude 앱을 완전히 끄고 다시 켭니다. 입력 칸 아래 도구 표시에 "geosan" 도구 5개가 보이면 연결된 것입니다.
4. 시연용 DB로 보려면 `GEOSAN_DB_PATH`를 `data/geosan-demo.db`로 바꿉니다.

윈도우는 `command`를 `<저장소 폴더>\\.venv\\Scripts\\python.exe`로 적습니다.

## 연결하기 — Claude Code(터미널)

```bash
claude mcp add geosan -e GEOSAN_DB_PATH=<저장소 폴더>/data/geosan.db -- <저장소 폴더>/.venv/bin/python -m geosan mcp --by <아이디>
```

## 안 될 때

| 보이는 것 | 할 일 |
|---|---|
| 도구가 안 보임 | 앱을 완전히 다시 켬. 앱의 MCP 기록(로그)에 "기록 담당자 키…로 실행해 주세요"가 있으면 `--by` 아이디를 확인 |
| "영업 기록을 외부 AI로 보내는 설정이 꺼져 있습니다." | 운영 담당에게 `llm.salesRecordsEnabled` 확인 요청 |
| "오늘 MCP 조회 한도를 다 썼습니다." | 내일 다시. 늘리려면 PM이 설정 `assistant.mcpDailyLimit`을 바꿈 |
| "DB를 열지 못했습니다." | `GEOSAN_DB_PATH` 경로 확인, `geosan init-db` |

<details><summary>기술 메모</summary>

- 규격: MCP(표준 입출력, JSON-RPC 2.0 한 줄에 하나). 판 2025-11-25·2025-06-18·2025-03-26·2024-11-05. 메시지 initialize·ping·tools/list·tools/call.
- 코드: `geosan/api/mcp_server.py`(주고받기), `geosan/api/mcp_tools.py`(도구 5개·문), `geosan/commands/mcp.py`(명령). MCP SDK 꾸러미는 쓰지 않음(보안 설계 4장).
- 전송 기록: `tg_transfer_log` purpose·kind `MCP_TOOL`, 값이 실린 회사마다 1행(첫 회사만 호출 수 1), 비용 0. 월 AI 한도·`geosan cost`에는 안 셈.
- 약속: 계약 요약 C0·C4·C7·C8 (#927).

</details>
