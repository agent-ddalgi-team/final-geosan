# 마이그레이션 (Alembic) — 접두사별 파일 규칙

`geosan init-db`가 `migrations/versions/`의 파일을 순서대로 적용해 SQLite 테이블을 만든다(다시 실행해도 안전).

## 파일 이름과 번호

- 이름은 `<접두사>_<번호>_<설명>.py` (예: `rec_002_bookmark.py`). 접두사는 테이블 소유 부품(계약 C6):
  `cfg_`(설정) `cap_`(거산 역량) `opp_`(고객·기회) `ev_`(근거) `eval_`(평가) `q_`(질문) `rec_`(기록),
  뒤 단위가 더하는 `src_` `tg_` `web_`.
- 단위마다 **자기 접두사 테이블만** 만들고 고친다. 기존 열을 지우거나 뜻을 바꾸는 것은 깨는 변경(PM 확인).
- 뼈대(U1)의 첫 묶음 7개는 한 줄로 이어진다: `cfg_001 → cap_001 → opp_001 → ev_001 → eval_001 → q_001 → rec_001`.
  새 파일의 `down_revision`은 `alembic heads`로 본 **현재 머리**로 둔다.
- 모든 마이그레이션은 `downgrade()`를 가진다(안정성 설계 6장).
- 시각 열은 시간대를 잃지 않도록 UTC ISO 8601 **문자열(String 40)** 로 저장한다(`geosan.storage.base.UtcDateTime`).

## 새 마이그레이션 만들기

```bash
source .venv/bin/activate
export GEOSAN_DB_PATH=./data/geosan.db      # 비교 대상 DB (없으면 init-db 먼저)
alembic revision --autogenerate -m "bookmark" --rev-id rec_002
# 생성된 migrations/versions/rec_002_bookmark.py를 열어 자기 접두사 테이블만 남기고 확인한다.
```

## 머리가 둘일 때

두 사람이 각자 마이그레이션을 더해 합칠 때 `alembic heads`가 둘을 보이면, 합치는 사람이 한 번 실행한다:

```bash
geosan db merge-heads      # migrations/versions/merge_00N_merge_heads.py 생성
geosan init-db             # 적용 확인
```

PR 체크리스트의 "약속 파일을 바꿨나요?" 항목에 새 테이블·열을 적는다(C6 추가 변경).
