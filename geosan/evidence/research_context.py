"""조사 한 건의 시간 한도와 호출 기록만 실행 문맥에 보관한다. DB 열은 더하지 않는다."""

import time
from contextlib import contextmanager
from contextvars import ContextVar
from dataclasses import dataclass, field


@dataclass
class ResearchContext:
    deadline: float
    log_ids: list[str] = field(default_factory=list)
    # #690: 이 조사의 AI 호출 행에 남길 요청자(전송 기록만). 근거·평가의 작성자는 바꾸지 않는다.
    transfer_requester: str | None = None


current_research: ContextVar[ResearchContext | None] = ContextVar("research", default=None)


@contextmanager
def research_context(transfer_requester: str | None = None):
    # C8·#218: 검색부터 저장·재평가까지 회사 한 곳 전체 60초.
    context = ResearchContext(time.monotonic() + 60, transfer_requester=transfer_requester)
    token = current_research.set(context)
    try:
        yield context
    finally:
        current_research.reset(token)
