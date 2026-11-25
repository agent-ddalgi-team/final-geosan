"""영업 비서(#680)의 외부 AI 호출 어댑터(C9). 정해진 조회 글만 받아 답 글을 돌려준다.

AI는 DB를 읽지 않는다. 호출자(창구)가 프로그램으로 만든 조회 글과 질문 글을 넘기고, 여기서는
영업 기록 글의 문(`reserve_sales_records`: 스위치·지우기 검사·전송 기록·월 한도)을 거친 뒤
한 번만 부른다. 재시도는 없다. 받은 답은 저장하지 않는다(읽기 전용).
"""

from __future__ import annotations

import http.client
import json
import os
import time
from collections.abc import Callable, Sequence
from dataclasses import dataclass
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


class CoachSimilarAdvice(FileModel):
    """#915 비슷한 성사 사례를 근거로 한 제안 한 줄. caseRef("사례 S1")는 창구가 검증한다."""

    case_ref: str
    text: str


class CoachReading(FileModel):
    """영업 코치(#742)의 구조화된 응답: 답 채우기·다음 일정·피드백 1~3줄·요약 한 줄.

    #750: 같은 호출에서 다음 통화에 물어볼 것 0~3줄(next_call)도 받는다.
    #915: 비슷한 성사 사례를 근거로 한 제안 0~2줄(similar_advice)도 받는다. 사례가 없으면 빈 목록.
    """

    answers: list[CoachAnswer]
    next_schedule: CoachSchedule
    feedback: list[str]
    next_call: list[str]
    summary: str
    similar_advice: list[CoachSimilarAdvice]


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
    also_opp_ids: Sequence[str] = (),
) -> CoachReading:
    """지우기를 거친 메모·이전 기록 사본을 한 번 보내 정해진 모양으로 받는다(#742 영업 코치).

    문(스위치·지우기 재검사·전송 기록·월 한도)은 다른 영업 기록 글과 같고, 전송 기록 종류만
    SALES_COACH다(하루 한도를 따로 센다). 모양이 맞지 않으면 실패로 알린다(빈 결과로 넘기지
    않는다). 값 검증과 글 지우기는 호출자(창구)가 한다. #915: 비슷한 성사 사례로 함께 보낸
    회사들(also_opp_ids)에도 보낸 표시 행을 단다(영업 분석 #802와 같음).
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
        [opp for opp in also_opp_ids if opp != opp_id],
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
    response, ticket = _send(
        opp_id,
        texts,
        "\n\n".join(item.text for item in texts),
        options,
        requested_by,
        also_opp_ids,
        record_kind=record_kind,
    )
    return _answer_text(response), ticket


def _send(
    opp_id: str,
    texts: Sequence[ScrubbedRecordText],
    input_value: str | list,
    options: dict,
    requested_by: str,
    also_opp_ids: Sequence[str],
    *,
    record_kind: str,
) -> tuple[dict, SearchTicket]:
    """문(스위치·texts 다시 검사·전송 기록·월 한도)을 거쳐 한 번 부르고 응답 전체를 돌려준다.

    input_value는 texts로 만든 글(또는 #916 찾아보는 코치의 대화 목록)이다. 재시도는 없다.
    """
    deadline = time.monotonic() + TIMEOUT_SECONDS
    key = os.environ.get("OPENAI_API_KEY", "").strip()
    ticket = reserve_sales_records(opp_id, texts, bool(key), None, requested_by, record_kind)
    mark_sales_record_companies(also_opp_ids, ticket, requested_by, None)
    payload = {"model": ticket.llm.model, "store": False, "input": input_value, **options}
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
    return response, ticket


def _answer_text(response: dict) -> str:
    """끝난 응답의 답 글. 끝나지 않았거나 비었으면 실패로 알린다(빈 결과로 넘기지 않음)."""
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
    return answer


@dataclass(frozen=True)
class LookupResult:
    """#916 코치가 부른 도구 하나의 결과.

    items는 지운 사본(다음 호출 때 문이 다른 글과 함께 다시 검사한다), opp_ids는 값이 실린
    회사(전송 기록 표시 행), text는 AI에 돌려줄 글, label은 화면 "찾아본 것" 한 줄이다.
    인자가 틀리거나 모르는 도구면 items·opp_ids는 비고 text는 안내 글이다.
    """

    items: Sequence[ScrubbedRecordText]
    opp_ids: Sequence[str]
    text: str
    label: str


@dataclass(frozen=True)
class Lookup:
    tool: str
    label: str


def _carry(item: dict) -> dict | None:
    """다음 호출에 되돌려 보낼 앞 응답 항목. store false라 생각 기록은 암호화 사본만 보낸다."""
    kind = item.get("type")
    if kind == "function_call":
        return {key: item[key] for key in ("type", "call_id", "name", "arguments")}
    if kind == "reasoning":
        return item if item.get("encrypted_content") else None
    if kind == "message":
        return {"type": "message", "role": "assistant", "content": item.get("content", [])}
    return None


def coach_with_lookups(
    opp_id: str,
    texts: Sequence[ScrubbedRecordText],
    *,
    instructions: str,
    max_output_tokens: int,
    requested_by: str,
    also_opp_ids: Sequence[str],
    tools: Sequence[dict],
    lookup: Callable[[str, dict], LookupResult],
    max_rounds: int,
) -> tuple[CoachReading, list[Lookup]]:
    """#916 찾아보는 코치: AI가 도구를 고르면 lookup으로 실행해 돌려주고 다시 부른다.

    한 번에 도구 하나(parallel_tool_calls false), 도구는 max_rounds번까지, 마지막 호출은
    도구 없이(tool_choice none) 정해진 모양의 답만 받는다. 호출마다 문(_send)을 다시 거치며,
    그때까지 보낸 모든 지운 사본(처음 글 + 도구 결과)을 함께 다시 검사한다. 전송 종류는
    SALES_COACH. 중간 호출이 실패하면 전체 실패(앞 호출의 전송 기록은 남는다).
    """
    sent = list(texts)
    also = [opp for opp in also_opp_ids if opp != opp_id]
    conversation: list[dict] = [
        {"role": "user", "content": "\n\n".join(item.text for item in texts)}
    ]
    lookups: list[Lookup] = []
    for round_no in range(max_rounds + 1):
        last = round_no == max_rounds
        # 첫 호출은 지금 코치와 같은 글 하나, 그 뒤로는 대화 목록(처음 글 + 도구 주고받기).
        response, _ticket = _send(
            opp_id,
            sent,
            conversation[0]["content"] if round_no == 0 else list(conversation),
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
                "tools": list(tools),
                "tool_choice": "none" if last else "auto",
                "parallel_tool_calls": False,
                "include": ["reasoning.encrypted_content"],
            },
            requested_by,
            list(dict.fromkeys(also)),
            record_kind=SALES_COACH_KIND,
        )
        try:
            output = response["output"]
            calls = [item for item in output if item.get("type") == "function_call"]
        except (KeyError, TypeError, AttributeError):
            raise _failed("AI 답을 끝까지 받지 못했습니다.") from None
        if not calls:
            try:
                return CoachReading.model_validate_json(_answer_text(response)), lookups
            except ValueError:
                raise _failed("AI 답의 형식이 맞지 않습니다.") from None
        if last:
            # 도구를 끈 마지막 호출에서도 도구를 고르면 답이 없는 것이다.
            raise _failed("AI 답을 끝까지 받지 못했습니다.")
        conversation += [carried for item in output if (carried := _carry(item)) is not None]
        for call in calls:
            try:
                arguments = json.loads(call.get("arguments") or "{}")
            except ValueError:
                arguments = None
            if not isinstance(arguments, dict):
                result = LookupResult((), (), "도구 인자를 읽지 못했습니다.", "인자를 읽지 못함")
            else:
                result = lookup(str(call.get("name")), arguments)
            sent += result.items
            also += [opp for opp in result.opp_ids if opp != opp_id]
            lookups.append(Lookup(tool=str(call.get("name")), label=result.label))
            conversation.append(
                {"type": "function_call_output", "call_id": call["call_id"], "output": result.text}
            )
    raise _failed("AI 답을 끝까지 받지 못했습니다.")  # 위 고리의 마지막 호출이 늘 끝낸다.
