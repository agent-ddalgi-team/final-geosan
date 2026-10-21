# 규모 설계 (Scalability Design) — U1 뼈대 (u1-skeleton)

규모 요구(`../nfr-requirements/scalability-requirements.md` NFR3.x)는 "상한 안에서 확실히 돈다"입니다. 수평 확장·분할·자동 확장은 설계하지 않으며(범위 밖, CON-02), 상한을 지키는 데이터 접근 방식과 상한을 넘을 때 무엇이 먼저 보이는지를 적습니다.

## 1. 확장 방식: 없음(의도)

- 단일 프로세스·단일 SQLite 파일·WAL. 프로세스를 둘 이상 띄우지 않는다(쓰기 충돌). 서버와 명령은 같은 파일을 쓰며, 명령은 짧은 트랜잭션으로 끝나 서버 요청을 5초 넘게 막지 않는다.
- 수직 확장(더 큰 노트북·호스팅)만 가능하다. 11월 호스팅 선택(U8)에서 메모리 512MB·디스크 1GB 기준으로 고른다.

## 2. 데이터 접근 설계 (상한을 지키는 방법)

| 요구 | 설계 |
|---|---|
| 목록 쪽 단위(NFR3.10) | 순위 범위 조회 `originalRank BETWEEN a AND b` + 색인 (batchId, originalRank). 총 건수는 묶음에 저장(populationSpec 건수)해 COUNT를 피함 |
| 전체 평가 선형(NFR3.11) | 거산 값 스냅샷은 묶음당 1회, 기회별 조회는 기회 ID 색인으로, 저장은 묶음 단위 일괄(executemany) |
| 스냅샷 64KB(NFR3.12) | 근거는 인용 문장·출처·등급만, 거산 값은 ID·검수 상태·숫자 범위만 넣는다. 스냅샷 JSON은 압축하지 않는다(디버깅 우선, 2,000건 × 64KB = 128MB 상한 안) |
| 색인(NFR3.13) | eval_run(oppId, runStatus, createdAt), eval_run(batchId, originalRank), rec_review_opinion(oppId, version), cap_process(datasetKind, code), cap_qualification(datasetKind, officialName, number), opp_opportunity(caseId), q_question(targetKind, targetId), 자식 행(oppId, supersededAt) |
| 파일 투입 독립(NFR3.14) | 파일 1개 = 트랜잭션 1개, 투입 명령은 파일을 순서대로 처리하고 실패한 파일만 보고 |

## 3. 상한 감시

- 명령 `evaluate`는 끝날 때 기회 수·평가 수·DB 파일 크기를 로그로 남긴다. 기회 1,500건·평가 7,500건·DB 400MB(상한의 75%)를 넘으면 WARNING "규모 상한에 가까움"을 출력한다.
- 상한을 넘는 요청(사례 파일 256KB 초과, 기회당 근거 50건 초과)은 투입 검사기가 거부한다.

## 4. 상한을 넘을 때 (범위 밖, 메모)

- 영향 기회만 재평가(ID 기반 찾기) → EvaluationLedger 개선 항목(도메인 설계).
- SUPERSEDED 평가의 스냅샷을 별도 테이블로 옮기기.
- 모두 11/13 중간 점검 뒤에 판단.

## 상류 문서와의 연결

- 규모 요구 NFR3.1~3.14; 성능 요구 NFR2.5; 제약 CON-02.
- 기능 명세 W3·W5; 계약 C6(WAL·busy_timeout).
