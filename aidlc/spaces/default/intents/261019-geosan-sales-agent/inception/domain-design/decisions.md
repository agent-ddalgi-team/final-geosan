# 설계 결정 기록 (Architecture Decision Records) — 도메인 설계

`components.md`의 근거 표는 부품별 한 줄 이유이고, 이 문서는 "왜 그렇게 나눴는가"를 오래 남기는 기록입니다. 각 결정은 맥락 → 결정 → 결과(좋은 점·나쁜 점·중립) → 기각한 대안 순서로 적었습니다. 모두 날짜 2026-10-20, 상태 Accepted(사용자 승인 게이트에서 확정)입니다.

| ADR | 제목 | 출처 |
|---|---|---|
| ADR-001 | 단일 애플리케이션 안의 논리 부품 15개(업무 경계로 나눔) | CON-02, 요구사항 4장 |
| ADR-002 | 규칙 엔진은 순수 계산, 평가 기록은 별도 부품 | Q2 |
| ADR-003 | 확인·조사 창구를 별도 부품으로, 거산 값은 바꾸지 않음(읽기 전용) | Q3, 상세 화면 R-02 결정 |
| ADR-004 | 외부 전송 검사를 전송 보호 부품 하나로 | Q4 |
| ADR-005 | 엔티티 이름은 팀 데이터 설계서 24개를 출발점으로, 요구사항 우선 | Q1 |
| ADR-006 | 재평가 촉발은 흐름 부품(WorkflowRunner)이 조정, 부품 간 순환 없음 | FR5.10, FR11.3, FR4.7 |
| ADR-007 | 공정 연결 "현재 결과"는 기회 기록이 소유하는 파생값, 원본은 평가 기록 | FR2.5 |
| ADR-008 | 화면은 부품 하나(WebUI), HTTP API(WebApi)와 운영 명령(OperatorCommands)은 얇은 진입 부품 | 상세 화면 설계, US9.4 |
| ADR-009 | 흐름 부품(WorkflowRunner): 평가 실행과 촉발 흐름 7개를 소유하고 한 흐름 = 한 트랜잭션 | 검토 R-04 결정 |
| ADR-010 | 사람 입력 중 평가 입력(기한 체크·순위 조정)은 평가 기록이 소유, 순위 조정은 이력 행 | 검토 R-07, FR4.7, FR4.12 |
| ADR-011 | 교차 부품 참조는 ID만 저장·외래 키 없음·존재 확인은 서버 검사, 같은 부품 안은 외래 키 | 검토 R-08 결정 |

---

## ADR-001: 단일 애플리케이션 안의 논리 부품 15개(업무 경계로 나눔)

**Context** — 4인 비전공 팀, AI 도구 의존, Python(FastAPI)+React+SQLite 단일 파일, "구조는 최대한 단순하게"(CON-02), 10/30·11/15·11/27 이정표. 요구사항은 거산 역량 검수, 기회 병합, 근거 추출, 규칙 계산, 사람의 기록, 거산 확인 소통, 유출 방지라는 서로 다른 책임을 담고 있고, 바뀌는 속도(규칙 수치는 G0마다, 화면은 P1·P3, 소스는 P0→P3)와 데이터 주인(거산 검수자 / 담당자 / 시스템)이 다르다. 트렁크 기반으로 4명이 동시에 고치므로 "누가 어느 파일을 고치는가"가 분명해야 한다.

**Decision** — 코드는 하나의 애플리케이션(배포 모양은 작업 단위 나누기에서 확정)이지만, 안을 업무 경계로 나눈 논리 부품 15개로 설계한다: ConfigRegistry, CapabilityCatalog, OpportunityRegistry, SourceIngestion, TransferGuard, EvidenceExtraction, RuleEngine, EvaluationLedger, ConfirmationDesk, SalesRecords, DashboardReporting, WorkflowRunner, OperatorCommands, WebApi, WebUI. 각 부품은 자기 엔티티만 고치고 다른 부품의 데이터는 그 부품의 함수로만 읽는다. 부품 간 호출 그래프는 순환이 없다.

**Consequences**
- 좋은 점: 부품마다 담당을 정할 수 있어 4명이 충돌 없이 나눠 고친다. 규칙·보안·검수처럼 틀리면 안 되는 것이 각각 한 곳에 있다. 테스트를 부품 단위로 쓸 수 있다.
- 나쁜 점: 부품 수가 15개라 처음 익히는 데 시간이 든다. 한 요청이 여러 부품을 거쳐 코드 추적이 길어진다.
- 중립: 부품 = Python 패키지(폴더) 하나로 대응시키면 충분하며, 서비스 분리나 메시지 큐는 쓰지 않는다. 작업 단위 나누기에서 부품을 몇 개 단위로 묶을지 정한다.
- 보안 영향: 거산 값 변경(CapabilityCatalog)과 외부 전송(TransferGuard)이 각각 한 부품에 있어 화면에서 거산 값을 바꾸거나 검사 없이 밖으로 보내는 경로가 호출 그래프에 존재하지 않는다. 단일 프로세스·단일 파일이라 네트워크 경계는 WebApi 하나뿐이다.

**Alternatives Rejected**
- 기술 층 세 개(api / service / db): 업무 규칙이 service 한 덩어리에 섞여 "검수 규칙은 어디?"를 찾기 어렵고, 전송 보호 같은 단일 지점을 만들 수 없음.
- 서비스 여러 개(마이크로서비스): 단일 애플리케이션·단일 DB 제약(CON-02)과 비전공 팀 운영 부담에 맞지 않음.
- 부품 5개로 크게 묶기(데이터 / 계산 / 화면 / 운영 / 보안): 기회 기록과 거산 역량처럼 주인이 다른 데이터가 한 부품에 섞여 검수 규칙 경계가 흐려짐.

## ADR-002: 규칙 엔진은 순수 계산, 평가 기록은 별도 부품

**Context** — 규칙 엔진은 기획서 5장·부록 F 수치를 그대로 써야 하고(바꾸지 않음), 같은 입력이면 같은 결과(NFR1), A정밀 E 77 / P 95 / S 81.1 / R 82와 읽기 예시 2가 기대값이다. 규칙 수치는 기업 승인·G0에서 바뀔 수 있어 설정 파일(버전·해시)로 둔다. 테스트 방식은 시나리오 S01~S14를 먼저 쓰는 custom 방식이다. 사용자가 Q2에서 A(순수 계산 분리)를 골랐다.

**Decision** — RuleEngine은 입력 스냅샷(기회·요구·신호·이력·근거·거산 값·검수 상태·담당자 체크)과 규칙 설정 값을 받아 결과(항목 판정·점수·필터·요구 판정·분류·순위·질문 후보)만 돌려주는 순수 계산 부품으로 두고, DB·파일·네트워크를 쓰지 않는다. 스냅샷 만들기·평가 묶음/평가/판정 저장·재평가·이전 평가 보존은 EvaluationLedger가 맡는다.

**Consequences**
- 좋은 점: 기대값 테스트를 DB 없이 몇 밀리초에 돌린다. 규칙 설정 파일만 바꿔 다른 버전을 같은 입력으로 비교할 수 있다. 재현성(스냅샷·해시)이 EvaluationLedger 한 곳에 모인다.
- 나쁜 점: 스냅샷 구조(입력 형식)를 두 부품이 공유하므로 형식이 바뀌면 둘 다 고친다. 큰 모집단에서는 스냅샷을 메모리에 올리는 비용이 있다(후보 1,000건·기회 2,000건 범위에서는 문제 없음, NFR3).
- 중립: 스냅샷 형식은 기능 설계에서 확정한다. LLM 모드가 달라도 스냅샷 형식은 같다(FR5.5).
- 보안 영향: RuleEngine은 네트워크·파일을 쓰지 않아 유출 경로가 없다. 스냅샷에 '처리 금지'·철회 자료의 원문을 넣지 않는 책임은 EvaluationLedger에 있다(NFR4).

**Alternatives Rejected**
- 규칙 엔진이 DB에서 직접 읽고 저장까지(Q2-B): 부품은 하나 줄지만 테스트마다 DB 준비가 필요하고 규칙 수치 변경·재현 확인이 어려움.
- 평가 저장을 OpportunityRegistry 안에: 기회 하나에 평가가 여러 번 쌓이는 생애가 달라 "이전 평가 보존" 규칙이 기회 코드에 섞임.

## ADR-003: 확인·조사 창구를 별도 부품으로, 거산 값은 바꾸지 않음(읽기 전용)

**Context** — 확인 질문 생성(P0)은 평가 결과에서 나오지만, 질문 상태(대기/요청/회신/반영)·거산 확인 요청·복사/내보내기(P1)·추가조사 기록(P2)은 거산과의 소통 흐름이며 평가 계산과 바뀌는 속도가 다르다. 상세 화면 설계에서 사용자가 "질문 목록 화면은 읽기 전용, '검수 완료' 반영은 운영 안내서 명령으로만"(R-02 결정)을 정했다. 계정이 없어 누구나 누를 수 있는 버튼으로 확인 안 된 값이 추천·승인 근거가 되는 것을 막기 위해서다. 사용자가 Q3에서 A를 골랐다.

**Decision** — ConfirmationDesk 부품이 ConfirmationQuestion(상태·요청자·기한·회신)과 ResearchTask를 소유한다. EvaluationLedger는 "이 평가에서 생긴 질문 후보"만 넘기고, '반영' 상태는 ConfirmationDesk가 바꾸는 것이 아니라 CapabilityCatalog의 검수 상태를 조회해 파생 표시한다. 거산 값을 바꾸는 함수는 CapabilityCatalog에만 있고 OperatorCommands에서만 호출한다.

**Consequences**
- 좋은 점: 질문 상태 규칙이 바뀌어도 평가 기록 코드는 건드리지 않는다. "화면에서 거산 값을 바꿀 수 없다"가 호출 그래프로 보장된다(WebApi → CapabilityCatalog 쓰기 경로 없음).
- 나쁜 점: 질문 '반영' 표시가 조회 때 계산되므로 질문 목록 조회가 CapabilityCatalog를 한 번 더 읽는다(건수가 적어 문제 없음).
- 중립: 복사·내보내기는 TransferGuard의 출력 검사를 거친다(ADR-004).
- 보안 영향: 거산 값 쓰기 함수가 CapabilityCatalog에만 있고 OperatorCommands에서만 호출되므로, 화면(WebApi → ConfirmationDesk)에서 거산 값을 바꾸는 경로가 호출 그래프에 없다. 계정 없는 첫 버전에서 확인 안 된 값이 추천·승인 근거가 되는 것을 구조로 막는다.

**Alternatives Rejected**
- 질문·조사를 EvaluationLedger 안에(Q3-B): 질문 상태 변경이 평가 기록 코드를 건드리고, 읽기 전용 원칙을 코드 구조로 보장하기 어려움.
- 화면에 [반영] 버튼과 운영자 판별: 계정이 없는 첫 버전에서 보호 장치가 없어 상세 화면 설계에서 기각됨.

## ADR-004: 외부 전송 검사를 전송 보호 부품 하나로

**Context** — 재접촉 입력값·거산 내부 이력·주요 거래처 관계는 외부 LLM으로 보내지 않고(CON-09, FR8.2), 전송 전 보안 등급 검사(FR5.4), 연락처 패턴 제거(FR5.3), 본문 없는 전송 로그(NFR5), 전송 0건 테스트(AC10.5.1~10.5.3), 사용 허용 철회 시 비노출이 모두 "밖으로 나가면 안 되는 것"을 지키는 규칙이다. 대표·상무가 보는 것은 "도면·노하우·거래처 정보가 새지 않는가"다. 사용자가 Q4에서 A를 골랐다.

**Decision** — TransferGuard 부품이 등급·용도별 허용 판정(단일 규칙 표), 연락처 패턴 제거, TransferLog(본문 없음), 월 호출 상한 판정을 소유한다. EvidenceExtraction(LLM 전송), ConfirmationDesk(질문 목록 복사·내보내기), DashboardReporting(엑셀·PDF)은 반드시 이 부품을 거친다. TransferGuard는 다른 부품에 의존하지 않는다. 판정의 입력 계약은 TransferGuard의 규칙이다: 전송 요청은 항목 묶음이고 항목마다 자료 종류 태그(공개 본문 / 근거 자료 / 기회 정보 / 재접촉 입력 / 내부 이력 / 거래처 관계 / 거산 내부 값)와 보안 등급을 함께 받으며, 금지 종류가 하나라도 있으면 묶음 전체 거부, 태그·등급이 없으면 '미확인'으로 거부(기본 거부)한다. 종류 태그는 호출자가 임의로 적는 값이 아니라 엔티티 소유 부품이 붙인 속성을 그대로 넘긴다.

**Consequences**
- 좋은 점: 금지 규칙이 한 곳이라 빠뜨릴 수 없고, "전송 0건"·"거부 로그" 테스트를 한 번에 쓴다. 유출 방지 근거를 한 부품으로 설명할 수 있다.
- 나쁜 점: 출력 기능이 늘 때마다 TransferGuard 호출을 잊지 않아야 한다(코드 검토 항목으로 둔다). 호출자가 종류 태그를 빠뜨리면 거부되므로 정상 전송도 막힐 수 있다(기본 거부는 의도한 안전 쪽 실패).
- 보안 영향: 유출 방지 규칙(CON-09·NEVER 규칙)이 한 부품의 입력 계약으로 강제되며, 호출자의 표기 실수가 단일 방어선을 뚫지 못한다.
- 중립: LLM 어댑터 자체(모델 호출)는 EvidenceExtraction에 남고, TransferGuard는 "보내도 되는가"만 답한다.

**Alternatives Rejected**
- 각 부품이 자기 자리에서 검사(Q4-B): 규칙이 세 곳에 흩어져 하나가 달라지면 불일치가 생기고 테스트도 세 벌.
- 데이터베이스 수준의 열 암호화로 대신: 유출 경로가 "보내는 행위"라 저장 암호화로는 막을 수 없음.

## ADR-005: 엔티티 이름은 팀 데이터 설계서 24개를 출발점으로, 요구사항 우선

**Context** — 팀이 만든 데이터 설계서 v0.17(논리 테이블 24개)은 사용자가 넣은 원본 자료로 신뢰할 수 없는 입력이며, 프로젝트 규칙상 사용자 답변을 거쳐야 산출물에 들어간다. 팀이 이미 아는 이름을 유지하면 비전공 팀의 혼란이 줄고, 승인된 요구사항·스토리에는 설계서에 없는 것(확인 질문, 담기, 질문 상태, 접속 보호, 기한 체크)과 다른 것(결과 상태 추가, 승인 상태)이 있다. 사용자가 Q1에서 A를 골랐다.

**Decision** — 24개 테이블을 같은 뜻의 엔티티로 두고 주인 부품을 정하되, 요구사항과 다른 곳은 요구사항을 따른다. 새로 더한 엔티티는 RuleConfigVersion, AppSetting, MergeCandidate, IngestionRun, SourceContract, TransferLog, HomepageCandidate, ClassificationCode, ReadinessCheck, RankAdjustment, ConfirmationQuestion, QuestionOpportunityLink, Bookmark, AccessSession이다. 데이터 종류·검증 규칙·관계의 개수는 기능 설계에서 정한다.

**Consequences**
- 좋은 점: 설계서를 읽은 팀원이 부품 목록을 바로 읽는다. 기능 설계가 설계서 5장·6장의 제약 표를 이어받을 수 있다.
- 나쁜 점: 설계서와 요구사항이 다른 곳(OUTCOME 상태 추가, ACTION 승인 상태, 재접촉 7칸 저장 위치 확정)은 설계서 갱신이 필요하다는 것을 팀이 알아야 한다.
- 중립: 설계서의 "현재 결과는 조회용 파생값" 원칙은 ADR-007로 받아들였다.
- 보안 영향: 설계서 6장의 사용 허용·보안 등급 속성(securityGrade, externalAiAllowed)을 Evidence·Interaction·Customer에 그대로 두어 TransferGuard의 종류 태그 원천이 된다. 연락처 열은 어떤 엔티티에도 없다(CON-11).

**Alternatives Rejected**
- 요구사항만으로 새 이름(Q1-B): 같은 것을 두 이름으로 부르게 되어 팀 소통 비용이 큼.
- 설계서 그대로·설계서 우선(Q1-C): 승인된 요구사항·스토리·상세 화면 설계와 어긋나는 곳이 생김.

## ADR-006: 재평가 촉발은 흐름 부품(WorkflowRunner)이 조정, 부품 간 순환 없음

**Context** — 재평가는 세 경로에서 일어난다: 근거 추출 뒤(FR5.10), 검수 상태 전환 뒤(FR11.3), 담당자 기한 체크(FR4.7). EvaluationLedger는 스냅샷을 위해 EvidenceExtraction·CapabilityCatalog를 읽어야 하므로, 그 부품들이 다시 EvaluationLedger를 부르면 순환이 생긴다. 메시지 큐·이벤트 버스는 쓰지 않는다(CON-02).

**Decision** — 데이터 부품은 재평가를 부르지 않는다. EvidenceExtraction은 "근거가 추가된 기회 ID"를(Evidence.oppId가 있으므로 스스로 알 수 있음), CapabilityCatalog는 "바뀐 거산 값의 ID와 새 검수 상태"만 돌려준다. 바뀐 거산 값이 어느 기회에 영향을 주는지는 EvaluationLedger가 찾는다. **첫 버전은 바뀐 값이 속한 묶음 전체를 재평가한다**(기회 2,000건 이하 NFR3, 1건 1초 NFR2). ID 기반 찾기(RequirementCheck.qualId, ItemJudgment.usedCapabilityIds)는 규모가 커질 때의 개선 항목이다. CapabilityCatalog는 OpportunityRegistry나 EvaluationLedger를 읽지 않으므로 순환이 생기지 않는다. 호출 순서는 이름 있는 흐름 부품 WorkflowRunner(ADR-009)가 소유하는 일곱 흐름(⓪ 평가 실행, ① 근거 추출 → 재평가, ② 검수 전환 → 영향 기회(묶음 전체) → 재평가, ③ 기한 체크 → 새 평가, ④ 재접촉 저장 → 평가, ⑤ 병합 확정 → 재평가, ⑥ 수집 → 등록 → 평가)으로 조정하며, WebApi와 OperatorCommands는 그 흐름 함수를 호출한다. 한 흐름은 한 SQLite 트랜잭션이고 중간 단계가 실패하면 흐름 전체를 되돌린다. 호출 그래프는 비순환이다.

**Consequences**
- 좋은 점: 어느 부품도 서로를 기다리지 않아 테스트와 추적이 단순하다. 재평가 순서가 WorkflowRunner의 흐름 함수 하나에 보여 비전공 팀이 흐름을 읽기 쉽고, 두 진입 부품에 같은 코드가 생기지 않는다.
- 나쁜 점: 흐름이 늘 때마다 WorkflowRunner에 추가해야 하고, 한 흐름을 한 트랜잭션으로 묶으므로 외부 호출(LLM·HTTP)은 트랜잭션 밖에서 먼저 끝내야 한다.
- 중립: 나중에 이벤트 방식이 필요해지면 WorkflowRunner의 흐름 함수만 바꾸면 된다.
- 보안 영향: 재평가가 화면 요청 한 번으로 연쇄되므로 WebApi의 접속 보호·담당자명 검사를 통과한 요청만 흐름을 시작한다. 흐름 안에서 외부로 나가는 호출은 EvidenceExtraction → TransferGuard 경로뿐이다.

**Alternatives Rejected**
- 데이터 부품이 EvaluationLedger를 직접 호출: 순환 의존(EvaluationLedger ↔ EvidenceExtraction)으로 테스트·추적이 어려움.
- 프로세스 안 이벤트 버스: 단순 구조 제약과 맞지 않고, 비전공 팀이 "누가 언제 호출됐는지" 추적하기 어려움.

## ADR-007: 공정 연결 "현재 결과"는 기회 기록이 소유하는 파생값, 원본은 평가 기록

**Context** — FR2.5는 기회-공정 연결의 현재 결과(통과 / 확인 대기 / 제외)를 조회용 파생값으로 보여주되 원본은 평가 기록이어야 한다고 정했다. 추천 목록·상세는 연결의 현재 결과를 자주 읽고, 평가는 여러 번 쌓인다.

**Decision** — OppProcessLink는 OpportunityRegistry가 소유하고 currentResult·currentReason·sourceEvalId를 가진다. 값은 EvaluationLedger가 평가 저장 뒤 OpportunityRegistry의 갱신 함수를 호출해 넣으며, 원본(RequirementCheck·EvaluationRun)과 다르면 원본이 기준이다.

**Consequences**
- 좋은 점: 목록·상세 조회가 평가 기록을 다시 계산하지 않는다. 원본 eval ID가 있어 캐시가 틀려도 추적된다.
- 나쁜 점: 같은 사실이 두 곳에 있어 갱신을 빠뜨리면 불일치가 생긴다. 완화책 두 가지: (1) 평가 저장과 연결 갱신은 WorkflowRunner의 한 트랜잭션 안에 있어 하나만 저장되는 일이 없다(ADR-009). (2) EvaluationLedger의 목록·상세 읽기 함수가 OppProcessLink.sourceEvalId를 그 기회의 최신 확정 평가 ID와 비교하고, 다르면 원본(RequirementCheck)으로 다시 계산해 보이며 불일치를 로그에 남긴다. OpportunityRegistry는 비교하지 않는다(EvaluationLedger를 부르면 순환이 생기므로).
- 중립: 캐시를 둘지 조회 때 계산할지는 기능 설계에서 성능 목표(목록 3초)를 보고 정한다. 성능이 충분하면 사본 없이 EvaluationLedger 조회만 쓰는 선택지도 남겨 둔다.
- 보안 영향: 없음(내부 파생값이며 외부로 나가지 않는다).

**Alternatives Rejected**
- 현재 결과를 EvaluationLedger가 소유: 기회 조회가 늘 평가 부품을 거쳐야 해 목록 조회가 무거워짐.
- 파생값 없이 매번 계산: 단순하지만 FR2.5가 파생값 보관을 전제하고 있고, 정렬·필터에 매번 계산이 들어감.

## ADR-008: 화면은 부품 하나(WebUI), HTTP API(WebApi)와 운영 명령(OperatorCommands)은 얇은 진입 부품

**Context** — 화면은 상세 화면 설계(S0~S6, 공통 틀, 테마, 쉬운 말 대응표, 다섯 상태, 접근성)를 그대로 구현한다. 운영자는 관리 화면 없이 명령 3개 이내로 일한다(US9.4). 접속 보호·세션·담당자명은 화면도 기록 부품도 아닌 경계 책임이다. 프로젝트 규칙상 이 세부는 추천안으로 정하고 기록만 남긴다.

**Decision** — WebUI는 React 부품 하나로 두고 화면별 분리는 하지 않는다(공통 틀·테마·상태 부품을 공유). WebApi는 FastAPI 진입 부품으로 접속 보호·세션·담당자명·오류 번역을 맡고, 재평가가 따르는 요청은 WorkflowRunner 흐름에 넘기며 업무 규칙은 두지 않는다. OperatorCommands는 명령줄 진입 부품으로 같은 업무 부품을 호출한다. 두 진입 부품은 서로를 호출하지 않는다.

**Consequences**
- 좋은 점: 화면·API·명령이 같은 업무 부품을 쓰므로 규칙이 한 곳이다. 계약 설계는 WebApi의 경로만 정하면 된다. 화면 담당 1명이 WebUI 전체를 맡기 쉽다.
- 나쁜 점: WebUI가 커지면 파일 수가 많아진다(폴더를 화면별로 나누되 부품은 하나로 본다).
- 중립: 작업 단위 나누기에서 WebUI를 화면 단위 작업으로 쪼갤 수 있다(부품 경계와 작업 단위는 다른 것).
- 보안 영향: 접속 보호(공용 비밀번호·세션)와 '보기 전용' 거부가 WebApi 한 곳에 있어 모든 화면·API 요청이 같은 검사를 거친다. 비밀번호는 환경 변수에서만 읽는다(FR14.2).

**Alternatives Rejected**
- 화면별 부품(목록 / 상세 / 대시보드 / 질문 목록): 공통 틀·테마·상태 부품이 중복되고 경계만 늘어남.
- 운영 명령을 WebApi 안의 숨은 경로로: 접속 보호·세션과 섞이고 "명령 3개 이내" 안내서를 만들기 어려움.

## ADR-009: 흐름 부품(WorkflowRunner): 평가 실행과 촉발 흐름 7개를 소유하고 한 흐름 = 한 트랜잭션

**Context** — ADR-006의 "진입 부품이 순서를 조정"은 WebApi와 OperatorCommands에 같은 순서 코드가 생기는 문제와, 촉발 경로(재접촉 저장·병합 확정·수집 뒤 평가)가 빠져 있던 문제, 그리고 한 요청 안에서 여러 부품이 SQLite를 쓸 때 트랜잭션 경계가 없던 문제가 검토(R-04)에서 지적됐다. 사용자가 이름 있는 부품으로 올리기로 결정했다.

**Decision** — WorkflowRunner를 15번째 부품으로 둔다. 업무 규칙은 두지 않고 ⓪ 평가 실행(뼈대 핵심 경로: 묶음 생성·스냅샷·RuleEngine·저장 → 공정 연결 갱신 → 질문 후보 전달) ① 근거 추출 ② 검수 전환 ③ 기한 체크 ④ 재접촉 저장 ⑤ 병합 확정 ⑥ 수집의 일곱 흐름에 대해 호출 순서·트랜잭션·되돌리기·교차 참조 존재 확인만 맡는다. 한 흐름은 한 SQLite 트랜잭션이며 중간 실패 시 업무 데이터 저장을 전부 되돌리고 사유를 돌려준다. 외부 호출(LLM·HTTP·파일/API 읽기)은 트랜잭션 밖에서 먼저 끝내고 결과만 안에서 저장한다. 트랜잭션 밖에 따로 남겨 되돌리지 않는 기록은 TransferLog(허용·거부), 호출 수·토큰 집계, IngestionRun의 실패 사유·건너뛴 행이다. WebApi와 OperatorCommands는 WorkflowRunner를 호출하고, WorkflowRunner는 CapabilityCatalog·SourceIngestion·OpportunityRegistry·EvidenceExtraction·EvaluationLedger를 호출한다.

**Consequences**
- 좋은 점: 흐름 7개가 한 파일에 표로 보여 비전공 팀이 "무엇이 무엇을 촉발하는지" 바로 읽는다. 부분 저장(평가는 됐는데 공정 연결은 안 됨)이 생기지 않는다.
- 나쁜 점: 긴 흐름(수집 50건 → 평가)이 한 트랜잭션이라 실패하면 전부 되돌아간다. 첫 버전 규모(기회 2,000건 이하)에서는 수용하고, 커지면 수집 흐름만 소스 단위로 나눈다.
- 중립: 부품 수가 15개가 됐다. 뼈대에서는 평가 흐름 하나만 구현하면 된다.
- 보안 영향: 외부 호출을 트랜잭션 밖에 두므로 전송 전 검사(TransferGuard)가 저장과 분리되어 "검사 실패 → 업무 데이터는 저장 안 됨"이 보장된다. 거부 사유는 TransferLog에 트랜잭션 밖으로 남아 감사(NFR5)에 쓰인다.

**Alternatives Rejected**
- 공용 흐름 함수를 이름 없는 파일로 두기: 사실상 15번째 모듈인데 부품 목록에 없어 책임·의존이 숨겨짐.
- 각 데이터 부품이 자기 뒤의 재평가를 직접 호출: 순환 의존(ADR-006에서 기각).
- 프로세스 안 이벤트 버스: 단순 구조 제약(CON-02)과 추적 어려움으로 기각.

## ADR-010: 사람 입력 중 평가 입력(기한 체크·순위 조정)은 평가 기록이 소유, 순위 조정은 이력 행

**Context** — 담당자의 "기한 내 대응 가능" 체크는 요구사항(FR4.7, FR7.1)이 담당자 기록이 아니라 평가 입력으로 정한 유일한 예외이고, 순위 수동 조정(FR4.12)도 원래 순위·사유·일시를 남겨야 한다. 사람의 기록은 보통 SalesRecords 소유인데, SalesRecords가 이미 EvaluationLedger를 부르므로 거꾸로 부르면 순환이 생긴다. 순위 조정을 EvaluationRun 속성으로 두면 "이전 평가를 덮어쓰지 않음"과 충돌한다(검토 R-07).

**Decision** — ReadinessCheck(기한 체크)와 RankAdjustment(순위 조정)는 EvaluationLedger가 소유한다. 순위 조정은 RankAdjustment 새 행(원래 순위·조정 순위·사유·조정자·일시)으로만 남기고 EvaluationRun은 바꾸지 않는다. 프로필은 기회마다 EvaluationRun에 기록하고(profile, profileChangeReason, previousEvalId), 묶음은 프로필별로 나누어 한 묶음에 신규 기회와 재접촉이 섞이지 않는다.

**Consequences**
- 좋은 점: 분류를 바꾸는 사람 입력이 평가 기록과 같은 곳에 있어 "이 분류가 왜 나왔는가"를 한 부품에서 설명한다. 순환 의존이 없다.
- 나쁜 점: 담당자 기록이 두 부품(SalesRecords, EvaluationLedger)에 나뉘어 활동 이력을 합칠 때 두 곳을 읽는다(이미 SalesRecords가 분류 이력을 EvaluationLedger에서 읽으므로 추가 의존은 없다).
- 중립: 체크·조정 모두 담당자명·시각을 저장하고 덮어쓰지 않는다.
- 보안 영향: 기한 체크는 분류를 바꾸는 유일한 담당자 입력이므로 담당자명이 비어 있거나 '보기 전용'이면 WebApi가 거부한다.

**Alternatives Rejected**
- SalesRecords가 소유하고 EvaluationLedger를 호출: 순환 의존.
- 순위 조정을 EvaluationRun 속성으로: 이전 값이 사라져 FR4.12·NFR5 위반.
- 묶음 하나에 두 프로필 혼합: 정렬·비교 규칙(FR4.11, 신규와 재접촉은 섞지 않음)과 충돌.

## ADR-011: 교차 부품 참조는 ID만 저장·외래 키 없음·존재 확인은 서버 검사, 같은 부품 안은 외래 키

**Context** — 엔티티 참조가 호출 방향과 거꾸로 가는 곳이 많다(QualificationScope → Customer/Opportunity, FieldEvidence·QualificationStatus·DiscoveryPath·Requirement·Signal → Evidence, OppProcessLink → EvaluationRun, ConfirmationQuestion → EvaluationRun). 하나의 SQLite에서 모두 외래 키를 걸면 테이블 수준 순환이 생기고 시드 데이터 투입 순서가 막힌다(검토 R-08). 한편 팀 데이터 설계서 6장은 "없는 대상을 가리키는 저장은 거부"를 원칙으로 둔다. 사용자가 둘 다 지키는 규칙을 결정했다.

**Decision** — 다른 부품의 엔티티를 가리키는 참조는 ID만 저장하고 DB 외래 키를 걸지 않는다. 존재 확인은 저장 전에 서버가 소유 부품 조회로 수행하며 없는 대상을 가리키는 저장은 거부한다. 담당은 저장 경로별로 정한다: 파일 투입은 OperatorCommands(가상 사례 묶음은 파일 안 투입 순서로), 흐름 ⓪~⑥은 WorkflowRunner, 단순 기록은 기록 부품(SalesRecords·ConfirmationDesk)이 이미 의존하는 OpportunityRegistry·EvaluationLedger 조회로 자기 안에서 확인한다(`components.md`의 서버 검사 담당 표). 이 검사는 데이터 사전에 "서버 검사" 항목으로 표시하고 테스트로 보장한다. 같은 부품 안의 참조(예: ProcessCapability → Process, ItemJudgment → EvaluationRun, QuestionOpportunityLink → ConfirmationQuestion)는 외래 키를 건다.

**Consequences**
- 좋은 점: 테이블 수준 순환이 없어 마이그레이션 순서가 자유롭고 부품 경계가 DB에서도 유지된다(시드 투입 순서는 존재 확인 때문에 Customer·Opportunity → 거산 값 → 근거 → 요구·신호 → 평가 순으로 지킨다). "없는 대상 거부" 원칙은 서버 검사로 계속 지켜진다.
- 나쁜 점: DB가 대신 막아 주지 않으므로 검사를 빠뜨리면 고아 참조가 생긴다. 데이터 사전의 서버 검사 목록과 그 테스트가 필수다.
- 중립: SQLite 연결마다 외래 키 검사 활성화(설계서 6장)는 같은 부품 안 참조에 그대로 적용한다. 기능 설계가 데이터 사전에서 두 종류를 구분한다.
- 보안 영향: 없음(참조 무결성 규칙이며 외부 노출과 무관).

**Alternatives Rejected**
- 모든 참조에 외래 키: 테이블 순환과 투입 순서 문제.
- 고객·기회 단위 자격 범위를 OpportunityRegistry로 이동: 자격 범위의 주인이 둘이 되어 '검수 완료만 근거' 규칙이 흩어짐.
- 존재 확인을 생략: 설계서 6장 원칙과 데이터 품질에 반함.
