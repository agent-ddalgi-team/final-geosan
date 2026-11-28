# 지도 — 전체 기획과 현황을 한곳에서

> **기준일: 2026-11-29** (`develop` 줄기 기준)

이 폴더는 **"지금 이 프로그램이 무엇을 하고, 어디까지 됐고, 누가 무엇을 맡는지"**를 팀 누구나 같은 그림으로 보기 위한 곳입니다. 기획이 말로 조금씩 바뀌어 왔기 때문에, 바뀐 결과를 여기에 모아 둡니다.

## 무엇이 궁금한가요?

| 궁금한 것 | 볼 문서 |
|---|---|
| 전체가 어떻게 생겼나, 지금 어디까지 왔나 | 이 문서 (아래 그림 2장) |
| 담당자가 화면에서 지금 무엇을 할 수 있나 | [기능 지도](feature-map.md) |
| 그 기능은 어느 폴더에 있나 | [구조 지도](structure-map.md) |
| 처음 기획에서 무엇이 왜 바뀌었나 | [기획 변경 기록](change-log.md) |
| 어떤 자료를 넣어 무엇이 나오고, 그것이 어디로 가나 | [데이터 지도](data-map.md) |
| 발표 때 그림만 한 화면에서 탭으로 넘겨 보고 싶다 | [지도 보기 페이지](map-view.html) — 파일을 브라우저로 열면 그림 11개가 그려진다(인터넷 필요). 지도 그림이 바뀌면 이 파일의 같은 블록도 같이 고친다 |
| 문서와 코드가 서로 다른 곳은 어디인가 | [구조 지도 9장](structure-map.md#9-어긋난-곳--pm-확인이-필요한-목록) |

---

## 1. 이 프로그램이 하는 일

거산케미칼 영업 담당자가 **"어느 회사에 먼저 연락할까"**를 정하도록 돕는 웹 도구입니다. 거산이 할 수 있는 일(공정·인증)과 후보 회사의 공개 자료를 견주어 순위와 이유를 보여 주고, 담당자의 영업 기록을 쌓습니다.

```mermaid
flowchart LR
    A["① 자료 넣기<br/>거산이 할 수 있는 일<br/>후보 회사"]
    B["② AI 조사<br/>홈페이지 찾기<br/>읽고 근거 뽑기"]
    C["③ 평가<br/>조건으로 거르기<br/>점수 → 분류 → 순위"]
    D["④ 화면<br/>영업 홈<br/>거래처 후보 · 관심 기업<br/>기업 검토 상세"]
    E["⑤ 담당자 기록<br/>의견 · 메모 · 단계<br/>일정 · 거래 관계"]
    A --> B --> C --> D --> E
    E -.->|"거래 관계를 바꾸면<br/>순위를 다시 계산"| C
```

**그림을 글로 풀면**

1. **자료 넣기** — 거산이 할 수 있는 일과 후보 회사를 넣습니다. 팀이 손으로 정리한 실제 회사 18곳에 더해, 담당자가 공정·지역·산업을 고르면 AI가 공공자료에서 후보를 찾아 목록에 더합니다. 이 PC의 시험 DB에는 이렇게 찾은 161곳을 합쳐 179곳이 들어 있었습니다(11/12, 그 뒤는 다시 세지 않음). 웹에서도 찾는 갈래는 만들어 11/17에 켰고, 11/26부터 경기도까지 찾습니다([#221], [#314], [#961]).
2. **AI 조사** — 회사를 넣으면 AI가 공식 홈페이지를 찾고, 읽고, 근거 문장과 확인할 질문을 뽑습니다. 공개 자료만 씁니다.
3. **평가** — 꼭 맞아야 하는 조건으로 거르고, 점수를 매기고, 분류하고, 순위를 정합니다. 숫자는 기획서의 규칙 그대로입니다.
4. **화면** — 담당자는 영업 홈(오늘 할 일), 거래처 후보(순위), 관심 기업, 기업 검토 상세(이유와 근거)를 봅니다.
5. **담당자 기록** — 의견, 영업 메모, 영업 단계, 일정을 남깁니다. 기록은 대시보드의 건수가 됩니다. 점선 화살표는 **거래 관계를 바꾸면 순위를 다시 계산**한다는 뜻입니다. 다만 거래 관계를 넣는 단추는 11/13에 화면에서 뺐습니다(재접촉 관리를 하지 않기로 함, PM 결정). 서버의 계산 길은 남아 있습니다.

**이 서비스의 핵심** — 공개 자료로 한 번 뽑은 순위를 보여 주고 끝나는 것이 아니라, 담당자가 기록을 남길수록 그 기록이 순위와 근거에 되돌아와 **거산에 맞게 맞춰지는 것**입니다(PM 결정 2026-11-08). 기록이 순위로 돌아오는 되먹임 3단계는 2026-11-26에 모두 됐습니다: ① 상세 "지난 평가와 달라진 것" ② 비슷한 회사 참고 ③ 담당자가 반복해 고른 조합을 관리자가 승인하면 "근거 있음" 묶음 안 순서에 적용([#942] [#915] [#943]). 자세한 것은 [기능 지도 "이 서비스의 핵심" 장](feature-map.md#이-서비스의-핵심--쓸수록-거산에-맞게-순위근거가-맞춰진다)과 [발표 메모 0장](../presentation-notes.md).

**이 프로그램이 하지 않는 일** — 단가·견적 계산, 납기 확정, 고객에게 자동 발송, 가격·경쟁사 비교는 만들지 않습니다.

---

## 2. 지금 어디까지 왔나

일을 11개 묶음(U1~U11)으로 나눴고, 그 뒤 새로 더한 일(영업 비서·영업 코치, 되먹임 등)을 함께 둡니다. 묶음마다 지금 위치입니다.

```mermaid
flowchart TB
    subgraph DONE["✅ 끝남"]
        U1["U1 뼈대<br/>가상 사례 1건이<br/>처음부터 끝까지 돈다"]
        U2["U2<br/>AI 조사"]
        U3["U3<br/>조건을 골라 후보 찾기<br/>공공자료 · 웹 · 경기까지"]
        U4["U4<br/>거산 값을 '거산이 확인함'으로<br/>배포 DB까지"]
        U5["U5<br/>담당자 기록"]
        U7["U7<br/>영업 홈 · 지도<br/>영업 분석 · 운영 관리"]
        U8["U8<br/>접속 · 배포<br/>11/18 첫 배포 · 계정 로그인"]
        X1["새로 더함<br/>영업 비서 · 영업 코치"]
        X2["되먹임 ①②③<br/>기록이 순위로 돌아옴"]
    end
    subgraph NOW["⏳ 진행 중"]
        U10["U10<br/>전달 준비 · 안내서"]
        X6["기록 남기기 단순화"]
        X7["영업 홈 수정안"]
    end
    subgraph NEXT["📅 예정"]
        X0["매달 자동 수집<br/>맡은 이슈 없음"]
    end
    subgraph HOLD["⏸ 보류 · 하지 않음"]
        U6["U6<br/>재접촉 · 거래 관계 입력"]
        X3["접촉 승인<br/>질문 목록 화면"]
        X4["나라장터 공고<br/>채용 공고"]
        X5["만들어 두고 꺼 둠<br/>엑셀 · 기존 고객 참고"]
    end
    subgraph ASK["❓ 확인 필요"]
        U9["U9<br/>자료 출처 늘리기"]
        U11["U11<br/>화면 다듬기<br/>새 디자인으로 이미 손봄"]
    end
    DONE --> NOW --> NEXT
    NEXT ~~~ HOLD
    NEXT ~~~ ASK
```

**그림을 글로 풀면** — 끝난 것 9개(묶음 7개 + 영업 비서·영업 코치 + 되먹임), 만드는 중 3개(전달 준비, 기록 남기기 단순화, 영업 홈 수정안), 아직 시작 전 1개(매달 자동 수집), 하지 않거나 꺼 둔 것 4개, 확인이 필요한 것 2개입니다. 11/14보다 끝난 것이 4개에서 9개로 늘었습니다(후보 찾기, 거산 확인 창구, 접속·배포, 영업 비서·코치, 되먹임). 1차/2차로 나누던 구분은 없앴습니다(PM 결정 2026-11-13).

| 묶음 | 쉬운 말 | 지금 위치 | 볼 이슈 |
|---|---|---|---|
| U1 뼈대 | 가상 사례 1건이 넣기 → 평가 → 화면 → 의견 저장까지 이어진다 | ✅ 끝남 | — |
| U2 AI 조사 | 홈페이지를 찾아 안쪽 페이지까지 읽고 근거와 질문을 뽑는다. 밖으로 나가는 것을 검사한다. 상세의 [다시 조사]로 다시 돌리고, [관심]을 누르면 저절로 돈다 | ✅ 끝남 | [#218] [#557] [#596] [#690] |
| U3 후보 수집 | 담당자가 고른 조건으로 AI가 공공자료와 웹에서 후보를 찾고 점수를 제안한다. 누르기 전 예상 금액, 이름으로 회사 1곳 바로 넣기([새 후보 발굴 › 이름으로 회사 넣기]), 경기도까지 찾기가 됨. 웹 검색은 11/17에 켰고 배포 뒤 2~4주 결과를 보고 계속 쓸지 정한다([#314] 열림). 매달 자동 수집은 예정이지만 맡은 이슈가 없다 | ✅ 끝남 | [#221] [#314] [#823] [#948] [#961] |
| U4 거산 확인 창구 | 거산 값을 "확인 완료"로 바꾸는 명령. 배포 DB는 전환을 마친 이 PC DB의 사본으로 만들어 처음부터 "확인 완료"임을 11/20에 확인했다. 질문 목록 화면은 만들지 않기로 함(11/13) | ✅ 끝남 | [#212] [#223] |
| U5 담당자 기록 | 접촉·메모·영업 단계·일정·전달 사항을 남기고, 잘못 저장한 기록은 "잘못 입력"으로 표시한다. 상대 담당자 연락처는 가려서 보이고(11/28), 달력 날짜마다 짧은 메모를 남긴다(11/28). 접촉 승인은 두지 않기로 함(11/14) | ✅ 끝남 | [#210] [#253] [#771] [#980] [#984] |
| U6 재접촉 | 예전 거래처를 다시 영업한다. 거래 관계 입력도 화면에서 뺌(11/13) | ⏸ 보류 | 11/3 · 11/13 PM 결정 |
| U7 영업 홈 | 첫 화면(11/20 "대시보드"에서 "영업 홈"으로 이름 바꿈)의 오늘 할 일·일정·지도·같이 들를 곳, 영업 분석 화면(그림 · AI 분석 피드백 · 지난 분석), 운영 관리 화면(AI 사용액 · 자료 기준일). 엑셀은 만들어 두고 꺼 둠 | ✅ 끝남 | [#306] [#226] [#799] [#824] [#861] [#217] |
| U8 접속·배포 | 비밀번호 화면, 사람마다 아이디·비밀번호 로그인, 백업·되돌리기, 배포용 DB 만들기. 11/18 새벽(한국 시각)에 화면과 서버를 두 서비스에 나눠 처음 올렸다 | ✅ 끝남 | [#213] [#214] [#753] [#754] |
| U9 자료 출처 늘리기 | 일부는 U2·U3으로 옮겨 감. 나머지는 이슈가 없음 | ❓ 확인 필요 | — |
| U10 운영 인계 | 사용 안내 1쪽·접속 안내·백업 절차·전달 메일. 안내서 초안을 쓰는 중 | ⏳ 진행 중 | [#220] [#409] |
| U11 화면 다듬기 | 11/27 화면 전체를 새 디자인(보라 톤)으로 바꾸고 줄·접속 화면을 다듬었다. 이 묶음을 끝난 것으로 볼지 PM 확인 필요 | ❓ 확인 필요 | [#972] [#981] [#987] |
| 나라장터 공고 · 채용 공고 | 연결하지 않기로 함(11/13). 점수의 그 두 자리는 통화에서 확인한 신호 "구매·외주 의향"·"관심"으로 채운다 | ⏸ 보류 | [#315] [#685] |
| 영업 비서 · 영업 코치 | 영업 홈·목록·분석의 오른쪽 질문 칸(영업 비서)과 기업 상세 영업 코치(메모 [보내기] → 피드백·빠진 질문·다음 통화, 필요한 기록을 스스로 최대 3번 찾아봄). PC의 AI 앱이 읽는 MCP 서버도 만듦. 메모는 연락처를 지운 사본만 보낸다 | ✅ 끝남 | [#680] [#742] [#916] [#927] |
| 되먹임 ①②③ | 기록이 상세 "지난 평가와 달라진 것"(①), 비슷한 회사 참고(②), 관리자가 승인한 묶음 안 순서 조정(③)으로 돌아온다. 점수·부록 F 배점은 바꾸지 않는다 | ✅ 끝남 (11/26) | [#942] [#915] [#943] |
| 기존 고객 참고 자료 | 거산의 지금 거래처 목록을 넣으면 영업 코치가 견준다. 만들어 두고 꺼 둠, 기업이 요청하면 켠다 | ⏸ 보류 (꺼 둠) | [#932] |
| 지금 만드는 것 | 기록 남기기 단순화(종류 네 개 + 메모), 영업 홈 수정안(오늘 할 일 · 전달 사항을 맨 위로) | ⏳ 진행 중 | [#985] [#992] |

**이슈로 본 진행 (2026-11-29)**

마일스톤은 "12/11 최종 발표까지" 하나만 씁니다(PM 결정 2026-11-13, 마감일 11/20은 만들기를 끝내는 날). 지난 네 개에는 닫힌 이슈만 남았습니다.

| 마일스톤 | 끝난 이슈 | 열린 이슈 |
|---|---|---|
| 뼈대 (10/28) | 24 | 0 |
| 10월 말 부분 시연 | 63 | 0 |
| 11/15 거산 전달 | 189 | 0 |
| 2차 보강 (11/17 이후) | 27 | 0 |
| 12/11 최종 발표까지 | 189 | 8 |

이슈만 센 숫자입니다(PR 제외, 모두 500건: 닫힘 492 · 열림 8). 11/14 지도 갱신 뒤 닫힌 이슈는 141건이고, 같은 사이 합쳐진 PR은 125개입니다. 열린 8건의 우선순위는 지금 하는 중(P0) 1건(영업 홈 수정안 [#992]), 다음 차례(P1) 5건(이 지도 갱신 [#993], 기록 남기기 단순화 [#985], 거산 전달 준비 [#220]·안내서 초안 [#409], 거산에 물을 것 모음 [#275]), 결정·조건을 기다림(P2) 1건(웹 검색 갈래 [#314], 만들어 켰고 배포 뒤 결과를 기다림), 여유(P3) 1건(조심할 점 모음 [#276])입니다.

기능별 상태는 [기능 지도](feature-map.md)에 있습니다. 기능 117줄 가운데 됨 97, 진행 중 0, 예정 1, 보류 19입니다.

---

## 3. 누가 무엇을 맡나

2026-11-14부터 PM이 전체를 맡습니다: 기획·결정, 업무 설계·분배, 개발 전체, 품질(시험·PR 검토·합치기), 배포·운영, 문서·발표(역할표 1-0, [#881](https://github.com/agent-ddalgi-team/final-geosan/issues/881)). 그래서 지도에는 사람별 담당 칸을 두지 않습니다(2026-11-25 PM 지시). 11/13까지의 분담 기록은 `team-allocation.md` 1장에 남아 있습니다.

---

## 4. 꼭 알아야 할 말

| 말 | 쉬운 뜻 |
|---|---|
| 분류 | 프로그램이 회사마다 매긴 판정. "지금 바로 연락 검토", "추가 조사 필요" 같은 11가지 |
| 담당자 검토 의견 | 사람이 남기는 의견 3가지(영업 대상 / 검토 중 / 제외). 11/13에 말을 바꿨고 저장 값은 그대로다. 분류를 바꾸지 않는다 |
| 영업 단계 | 실제 영업이 어디까지 갔나. 미접촉 → 관심 → 접촉 → 견적·샘플 → 성사·보류·거절 |
| 점수 "참고 50점 · 3/8" | 확인된 점수와 "8개 항목 중 3개를 조사함". "참고"는 거산 확인 전 값으로 계산했다는 뜻 |
| 거래 확인 전 / 기존 거래처 | 거래 여부를 아직 모르는 회사 / 이미 거래 중인 회사 |
| 검토사항 | 담당자가 확인할 목록. AI가 만든 질문과 "자료 못 찾음", "자료 부족" 줄 |
| 거산 확인 전 | 거산 소개서에서 온 값이 아직 거산의 확인을 받지 않았다는 표시 |
| 가상 사례 | 실제 거산 사양이 아닌 연습용 자료 (A정밀) |
| 1차 / 2차 | 11/13까지 쓰던 구분(1차는 11/15 무렵부터 되는 순서대로 거산에 전달, 2차는 11/17 이후 보강). 지금은 없앴고 옛 기록에만 남아 있다 |
| 회사 파일 (사례 파일) | 회사 1곳의 공개 자료를 정해진 칸에 맞춰 쓴 파일 |
| 약속 파일 | "이 모양으로만 주고받는다"고 정한 파일. PM 확인 없이 고치지 않는다 |
| 창구 (API) | 화면이 서버에 요청하는 정해진 문 |
| 운영 명령 | 운영자가 터미널에서 실행하는 명령 |
| 이슈 / PR | 이슈는 할 일 한 건, PR은 "이 변경을 합쳐 주세요"라는 요청 |

---

## 5. 지도를 낡지 않게 하는 법

지도는 **늘 한 벌**만 둡니다. 날짜별 사본을 만들지 않습니다. 옛 모습은 GitHub에서 파일을 열고 **History**를 누르면 볼 수 있습니다.

| 언제 | 누가 | 무엇을 고치나 |
|---|---|---|
| 담당자 눈에 보이는 기능이 생기거나 바뀌는 PR을 올릴 때 | PR을 올리는 사람 | [기능 지도](feature-map.md)의 그 줄과 맨 위 "최근 바뀐 것" |
| PM 결정으로 기획이 바뀔 때 | PM (또는 AI 도구) | [기획 변경 기록](change-log.md) 3장 맨 위에 한 줄 |
| 새 자료(파일·공공 소스)가 들어오거나 단계의 입력·출력이 바뀔 때 | PR을 올리는 사람 | [데이터 지도](data-map.md) 1장의 자료 줄과 3장의 단계 줄 |
| 정기적으로, 또는 PM이 "지도 갱신해 줘"라고 할 때 | AI 도구 | 이슈 목록과 코드를 다시 읽어 네 문서를 맞추고, 기획 변경 기록 1장에 건수 한 줄 |

- 지도의 상태 칸은 **요약**입니다. 진행 상황의 기준은 계속 이슈입니다.
- 문서와 코드가 다르면 한쪽에 맞추지 않고 [구조 지도 9장](structure-map.md#9-어긋난-곳--pm-확인이-필요한-목록)에 적습니다.
- 연락처, 거산 내부 자료, 단가는 적지 않습니다.

<details><summary>기술 메모 — AI 도구가 지도를 갱신하는 순서</summary>

1. `git switch develop && git pull`로 최신 `develop`을 받는다. 지도는 항상 최신 `develop` 기준으로 쓴다.
2. `gh issue list --state all --limit 400 --json number,title,state,labels,milestone,assignees`로 이슈를 읽는다.
3. `contracts/openapi.json`(창구), `geosan/commands/app.py`(명령), `migrations/versions/`(표), `web/src/pages/`·`web/src/components/`(화면)를 읽어 지난 기준일 이후 달라진 것을 찾는다. `git log --since=<지난 기준일> --oneline`이 출발점이다.
4. 기능 지도의 줄을 고치고 "최근 바뀐 것" 5줄을 새로 쓴다. 상태 값은 `✅ 됨` / `⏳ 진행 중` / `📅 예정` / `⏸ 보류` 네 가지만 쓴다("예정"은 만들기로 했고 아직 시작 전).
5. 기능 지도 표에서 상태별 줄 수를 세어 기능 지도의 원 그림, 이 문서 2장, 기획 변경 기록 1장에 같은 숫자를 적는다.
6. 구조 지도의 창구·명령·표 개수와 "어긋난 곳"을 맞춘다. 정리된 줄은 지운다. 데이터 지도 1장의 자료 목록과 3장의 단계 상태도 같이 맞춘다.
6-1. 지도 문서의 Mermaid 블록을 고쳤으면 `map-view.html`의 같은 `id`(`mm-…`) 블록에 그대로 복사한다. 파일을 브라우저로 열어 그림이 그려지는지 보는 것이 Mermaid 문법 검사다.
7. 네 문서의 기준일을 고친다.
8. 그림(Mermaid)은 문법 검사 도구로 그려지는지 확인하고, 그림마다 "그림을 글로 풀면"을 함께 둔다.
9. 확인하지 못한 것은 추측으로 쓰지 않고 "확인 필요"로 적는다.

</details>

---

## 6. 더 깊이 볼 문서

| 문서 | 어디 |
|---|---|
| 팀 규칙 | 저장소 맨 위 `AGENTS.md` |
| 설치와 명령 | 저장소 맨 위 `README.md` |
| 팀원 시작 안내 | `docs/team-start-guide.md` |
| 회사 파일 쓰는 법 | `docs/case-file-guide.md` |
| 역할표 | `aidlc/…/inception/delivery-planning/team-allocation.md` |
| 작업 묶음 U1~U11 | `aidlc/…/inception/units-generation/unit-of-work.md` |
| 약속 요약 | `aidlc/…/inception/contract-design/contract-summary.md` |
| 처음 기획서 | `docs/input/` (고치지 않는 원본) |

`aidlc/…`는 `aidlc/spaces/default/intents/261019-geosan-sales-agent/`를 줄여 쓴 것입니다.

[#210]: https://github.com/agent-ddalgi-team/final-geosan/issues/210
[#212]: https://github.com/agent-ddalgi-team/final-geosan/issues/212
[#213]: https://github.com/agent-ddalgi-team/final-geosan/issues/213
[#214]: https://github.com/agent-ddalgi-team/final-geosan/issues/214
[#218]: https://github.com/agent-ddalgi-team/final-geosan/issues/218
[#220]: https://github.com/agent-ddalgi-team/final-geosan/issues/220
[#221]: https://github.com/agent-ddalgi-team/final-geosan/issues/221
[#223]: https://github.com/agent-ddalgi-team/final-geosan/issues/223
[#304]: https://github.com/agent-ddalgi-team/final-geosan/issues/304
[#306]: https://github.com/agent-ddalgi-team/final-geosan/issues/306
[#314]: https://github.com/agent-ddalgi-team/final-geosan/issues/314
[#253]: https://github.com/agent-ddalgi-team/final-geosan/issues/253
[#549]: https://github.com/agent-ddalgi-team/final-geosan/issues/549
[#557]: https://github.com/agent-ddalgi-team/final-geosan/issues/557
[#596]: https://github.com/agent-ddalgi-team/final-geosan/issues/596
[#690]: https://github.com/agent-ddalgi-team/final-geosan/issues/690
[#706]: https://github.com/agent-ddalgi-team/final-geosan/issues/706
[#131]: https://github.com/agent-ddalgi-team/final-geosan/issues/131
[#226]: https://github.com/agent-ddalgi-team/final-geosan/issues/226
[#217]: https://github.com/agent-ddalgi-team/final-geosan/issues/217
[#315]: https://github.com/agent-ddalgi-team/final-geosan/issues/315
[#680]: https://github.com/agent-ddalgi-team/final-geosan/issues/680
[#685]: https://github.com/agent-ddalgi-team/final-geosan/issues/685
[#275]: https://github.com/agent-ddalgi-team/final-geosan/issues/275
[#276]: https://github.com/agent-ddalgi-team/final-geosan/issues/276
[#409]: https://github.com/agent-ddalgi-team/final-geosan/issues/409
[#742]: https://github.com/agent-ddalgi-team/final-geosan/issues/742
[#753]: https://github.com/agent-ddalgi-team/final-geosan/issues/753
[#754]: https://github.com/agent-ddalgi-team/final-geosan/issues/754
[#771]: https://github.com/agent-ddalgi-team/final-geosan/issues/771
[#799]: https://github.com/agent-ddalgi-team/final-geosan/issues/799
[#823]: https://github.com/agent-ddalgi-team/final-geosan/issues/823
[#824]: https://github.com/agent-ddalgi-team/final-geosan/issues/824
[#861]: https://github.com/agent-ddalgi-team/final-geosan/issues/861
[#915]: https://github.com/agent-ddalgi-team/final-geosan/issues/915
[#916]: https://github.com/agent-ddalgi-team/final-geosan/issues/916
[#927]: https://github.com/agent-ddalgi-team/final-geosan/issues/927
[#932]: https://github.com/agent-ddalgi-team/final-geosan/issues/932
[#942]: https://github.com/agent-ddalgi-team/final-geosan/issues/942
[#943]: https://github.com/agent-ddalgi-team/final-geosan/issues/943
[#948]: https://github.com/agent-ddalgi-team/final-geosan/issues/948
[#961]: https://github.com/agent-ddalgi-team/final-geosan/issues/961
[#972]: https://github.com/agent-ddalgi-team/final-geosan/issues/972
[#980]: https://github.com/agent-ddalgi-team/final-geosan/issues/980
[#981]: https://github.com/agent-ddalgi-team/final-geosan/issues/981
[#984]: https://github.com/agent-ddalgi-team/final-geosan/issues/984
[#985]: https://github.com/agent-ddalgi-team/final-geosan/issues/985
[#987]: https://github.com/agent-ddalgi-team/final-geosan/issues/987
[#992]: https://github.com/agent-ddalgi-team/final-geosan/issues/992
[#993]: https://github.com/agent-ddalgi-team/final-geosan/issues/993
