"""세션·트랜잭션 도우미 (계약 C2 '한 흐름 = 한 트랜잭션', 안정성 설계 3장).

```python
with session_scope() as session:
    ...  # 블록이 끝나면 커밋, 예외가 나면 되돌림(rollback) 뒤 예외를 그대로 올린다
```

흐름 함수(`workflows/`)는 세션 하나를 열고 그 안에서 모든 저장을 한다. 저장 실패를 조용히 삼키지
않는다.
"""

from __future__ import annotations

from collections.abc import Iterator
from contextlib import contextmanager
from pathlib import Path

from sqlalchemy.orm import Session, sessionmaker

from geosan.storage.engine import get_engine


def make_session_factory(db_path: Path | str | None = None) -> sessionmaker[Session]:
    return sessionmaker(bind=get_engine(db_path), expire_on_commit=False, future=True)


@contextmanager
def session_scope(db_path: Path | str | None = None) -> Iterator[Session]:
    """트랜잭션 하나. 성공하면 커밋, 예외면 되돌리고 다시 올린다."""
    session = make_session_factory(db_path)()
    try:
        with session.begin():
            yield session
    finally:
        session.close()
