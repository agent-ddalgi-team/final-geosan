"""영업 비서(#680)의 외부 AI 호출 어댑터(C9). 정해진 조회 글만 받아 답 글을 돌려준다.

AI는 DB를 읽지 않는다. 호출자(창구)가 프로그램으로 만든 조회 글과 질문 글을 넘기고, 여기서는
영업 기록 글의 문(`reserve_sales_records`: 스위치·지우기 검사·전송 기록·월 한도)을 거친 뒤
한 번만 부른다. 재시도는 없다. 받은 답은 저장하지 않는다(읽기 전용).
"""

from __future__ import annotations

import http.client
import os
import time
from collections.abc import Sequence
from typing import Literal

from geosan.config.errors import AppError
from geosan.config.schemas import FileModel
from geosan.evidence.extraction import _post
from geosan.evidence.openai_search import _HttpError, _Usage
from geosan.evidence.reader import remaining
from geosan.evidence.sales_record_gate import (
    SALES_ANALYSIS_KIND,
    SALES_COACH_KIND,
    SALES_RECORD_KIND,
    ScrubbedRecordText,
    mark_sales_record_companies,
    reserve_sales_records,
    scrub_sales_record,
)
from geosan.evidence.transfer import SearchTicket, configuration_error, finish_search

TIMEOUT_SECONDS = 60  # C9 LLMAdapter 전체 호출 한도


def _failed(message: str) -> AppError:
    return AppError(message, "잠시 뒤 다시 물어봐 주세요.", status=503, kind="LLM_FAILED")


class MemoProposal(FileModel):
    """메모 읽기(#720)에서 AI가 주는 변경 제안 하나. 값이 목록에 있는지는 창구가 검증한다."""

    kind: Literal["PROCESS", "INDUSTRY", "NEXT_SCHEDULE"]
    values: list[str]
    date: str | None
    quote: str


class MemoReading(FileModel):
    """메모 읽기(#720)의 구조화된 응답: 한 줄 요약과 변경 제안 0개 이상."""

    summary: str
    proposals: list[MemoProposal]


class CoachAnswer(FileModel):
    """영업 코치(#742)에서 AI가 채운 꼬리 질문 답 하나. 질문·보기가 있는지는 창구가 검증한다."""

    question_id: str
    answer_ids: list[str]
    quote: str


class CoachSchedule(FileModel):
    """영업 코치가 읽은 다음 일정. actionId는 "다음 할 일은?"의 보기 id."""

    action_id: str | None
    date: str | None


class CoachReading(FileModel):
    """영업 코치(#742)의 구조화된 응답: 답 채우기·다음 일정·피드백 1~3줄·요약 한 줄.

    #750: 같은 호출에서 다음 통화에 물어볼 것 0~3줄(next_call)도 받는다.
    """

    answers: list[CoachAnswer]
    next_schedule: CoachSchedule
    feedback: list[str]
    next_call: list[str]
    summary: str


class AskSuggestion(FileModel):
    """질문에 답하기(#774)에서 AI가 답과 함께 준 할 일 제안 하나. 값 검증은 창구가 한다."""

    company: str
    action_id: str
    date: str


class AskReading(FileModel):
    """질문에 답하기(#774)의 구조화된 응답: 답 글과 할 일 제안 0개 이상."""

    answer: str
    suggestions: list[AskSuggestion]


def ask_with_suggestions(
    opp_id: str,
    texts: Sequence[ScrubbedRecordText],
    *,
    instructions: str,
    max_output_tokens: int,
    requested_by: str,
    also_opp_ids: Sequence[str] = (),
) -> AskReading:
    """질문에 답하기(#774): 한 번 보내 답 글과 할 일 제안을 정해진 모양으로 받는다.

    문(스위치·지우기 재검사·전송 기록·월 한도)은 ask_sales_assistant와 같다. 모양이 맞지 않으면
    실패로 알린다(빈 결과로 넘기지 않는다). 답 글은 지우기를 한 번 더 거쳐 돌려주고, 제안 값
    검증은 호출자(창구)가 한다.
    """
    answer = _request(
        opp_id,
        texts,
        {
            "instructions": instructions,
            "max_output_tokens": max_output_tokens,
            "text": {
                "format": {
                    "type": "json_schema",
                    "name": "sales_ask_answer",
                    "strict": True,
                    "schema": AskReading.model_json_schema(by_alias=True),
                }
            },
        },
        requested_by,
        also_opp_ids,
    )
    try:
        reading = AskReading.model_validate_json(answer)
    except ValueError:
        raise _failed("AI 답의 형식이 맞지 않습니다.") from None
    text = scrub_sales_record(reading.answer).text.strip()
    if not text:
        raise _failed("AI 답을 끝까지 받지 못했습니다.")
    return reading.model_copy(update={"answer": text})


def ask_sales_assistant(
    opp_id: str,
    texts: Sequence[ScrubbedRecordText],
    *,
    instructions: str,
    max_output_tokens: int,
    requested_by: str,
    also_opp_ids: Sequence[str] = (),
) -> str:
    """지우기를 거친 글 묶음을 한 번 보내 답 글을 받는다.

    opp_id: 호출 1행(사용량·비용)을 다는 회사. also_opp_ids: 값이 함께 실린 나머지 회사
    (회사마다 표시 1행). 걸리면 문이 거부 기록을 남기고 오류를 내며 아무것도 보내지 않는다.
    돌려주는 답은 전화·이메일·사람 이름 지우기를 한 번 더 거친 글이다.
    """
    answer = _request(
        opp_id,
        texts,
        {"instructions": instructions, "max_output_tokens": max_output_tokens},
        requested_by,
        also_opp_ids,
    )
    return scrub_sales_record(answer).text


def read_sales_memo(
    opp_id: str,
    texts: Sequence[ScrubbedRecordText],
    *,
    instructions: str,
    max_output_tokens: int,
    requested_by: str,
) -> MemoReading:
    """지우기를 거친 메모 사본을 한 번 보내 정해진 모양(요약 + 변경 제안)으로 받는다(#720).

    문(스위치·지우기 재검사·전송 기록·월 한도)은 ask_sales_assistant와 같다. 모양이 맞지 않으면
    실패로 알린다(빈 결과로 넘기지 않는다). 값 검증과 글 지우기는 호출자(창구)가 한다.
    """
    answer = _request(
        opp_id,
        texts,
        {
            "instructions": instructions,
            "max_output_tokens": max_output_tokens,
            "text": {
                "format": {
                    "type": "json_schema",
                    "name": "sales_memo_reading",
                    "strict": True,
                    "schema": MemoReading.model_json_schema(by_alias=True),
                }
            },
        },
        requested_by,
        (),
    )
    try:
        return MemoReading.model_validate_json(answer)
    except ValueError:
        raise _failed("AI 답의 형식이 맞지 않습니다.") from None


def coach_sales_memo(
    opp_id: str,
    texts: Sequence[ScrubbedRecordText],
    *,
    instructions: str,
    max_output_tokens: int,
    requested_by: str,
) -> CoachReading:
    """지우기를 거친 메모·이전 기록 사본을 한 번 보내 정해진 모양으로 받는다(#742 영업 코치).

    문(스위치·지우기 재검사·전송 기록·월 한도)은 다른 영업 기록 글과 같고, 전송 기록 종류만
    SALES_COACH다(하루 한도를 따로 센다). 모양이 맞지 않으면 실패로 알린다(빈 결과로 넘기지
    않는다). 값 검증과 글 지우기는 호출자(창구)가 한다.
    """
    answer = _request(
        opp_id,
        texts,
        {
            "instructions": instructions,
            "max_output_tokens": max_output_tokens,
            "text": {
                "format": {
                    "type": "json_schema",
                    "name": "sales_coach_reading",
                    "strict": True,
                    "schema": CoachReading.model_json_schema(by_alias=True),
                }
            },
        },
        requested_by,
        (),
        record_kind=SALES_COACH_KIND,
    )
    try:
        return CoachReading.model_validate_json(answer)
    except ValueError:
        raise _failed("AI 답의 형식이 맞지 않습니다.") from None


def analyze_sales(
    opp_id: str,
    texts: Sequence[ScrubbedRecordText],
    *,
    instructions: str,
    max_output_tokens: int,
    requested_by: str,
    schema_name: str,
    schema: dict,
    also_opp_ids: Sequence[str] = (),
) -> tuple[str, SearchTicket]:
    """영업 분석 피드백(#824): 숫자 표 글 묶음을 한 번 보내 정해진 모양의 답 글(JSON)을 받는다.

    문(스위치·지우기 재검사·전송 기록·월 한도)은 다른 영업 기록 글과 같고 전송 종류만
    SALES_ANALYSIS다(하루 한도를 따로 센다). 호출 1행은 opp_id에 달고, #802(11/20)부터 회사별
    맥락 글을 함께 보내므로 그 회사들(also_opp_ids)에도 보낸 표시 행을 단다. 모양 검증·저장은
    호출자(창구)가 한다.
    """
    return _request_with_ticket(
        opp_id,
        texts,
        {
            "instructions": instructions,
            "max_output_tokens": max_output_tokens,
            "text": {
                "format": {
                    "type": "json_schema",
                    "name": schema_name,
                    "strict": True,
                    "schema": schema,
                }
            },
        },
        requested_by,
        [opp for opp in also_opp_ids if opp != opp_id],
        record_kind=SALES_ANALYSIS_KIND,
    )


def _request(
    opp_id: str,
    texts: Sequence[ScrubbedRecordText],
    options: dict,
    requested_by: str,
    also_opp_ids: Sequence[str],
    *,
    record_kind: str = SALES_RECORD_KIND,
) -> str:
    """문을 거쳐 한 번만 부르고 답 글(지우기 전)을 돌려준다. 재시도는 없다."""
    return _request_with_ticket(
        opp_id, texts, options, requested_by, also_opp_ids, record_kind=record_kind
    )[0]


def _request_with_ticket(
    opp_id: str,
    texts: Sequence[ScrubbedRecordText],
    options: dict,
    requested_by: str,
    also_opp_ids: Sequence[str],
    *,
    record_kind: str = SALES_RECORD_KIND,
) -> tuple[str, SearchTicket]:
    """_request와 같고, 전송 기록 표(모델·비용을 읽을 행)도 함께 돌려준다(#824)."""
    deadline = time.monotonic() + TIMEOUT_SECONDS
    key = os.environ.get("OPENAI_API_KEY", "").strip()
    ticket = reserve_sales_records(opp_id, texts, bool(key), None, requested_by, record_kind)
    mark_sales_record_companies(also_opp_ids, ticket, requested_by, None)
    payload = {
        "model": ticket.llm.model,
        "store": False,
        "input": "\n\n".join(item.text for item in texts),
        **options,
    }
    try:
        response = _post(payload, key, deadline)
    except _HttpError as exc:
        if exc.status in (400, 401, 403, 404, 429):
            finish_search(ticket, 0, 0, 0, None)
        if exc.status in (401, 403, 404):
            raise configuration_error() from None
        raise _failed("AI 답변 요청이 실패했습니다.") from None
    except (OSError, http.client.HTTPException, ValueError):
        remaining(deadline)
        raise _failed("AI 응답을 받지 못했습니다.") from None
    try:
        usage = _Usage.model_validate(response["usage"])
    except (KeyError, TypeError, ValueError):
        raise _failed("AI 사용 기록을 확인하지 못했습니다.") from None
    finish_search(ticket, usage.input_tokens, usage.output_tokens, 0, None)
    try:
        if response["status"] != "completed":
            raise ValueError
        answer = "\n".join(
            part["text"]
            for item in response["output"]
            if item["type"] == "message"
            for part in item["content"]
            if part["type"] == "output_text"
        ).strip()
        if not answer:
            raise ValueError
    except (KeyError, TypeError, ValueError):
        raise _failed("AI 답을 끝까지 받지 못했습니다.") from None
    return answer, ticket
