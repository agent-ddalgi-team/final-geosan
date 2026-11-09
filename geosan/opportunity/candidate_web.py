"""#493: 조건 이름만 보내는 후보 웹 검색 부품(C4·C7·C9).

저장·판단·회사 등록 및 실행 흐름 연결은 #314 후속 작업이다.
오류를 빈 성공으로 바꾸지 않고, 본문·검색어를 전송 기록에 남기지 않는다.
"""

import hashlib
import http.client
import json
import os
from contextlib import nullcontext
from dataclasses import dataclass
from datetime import datetime, timedelta
from pathlib import Path

from sqlalchemy import select

from geosan.capability.models import Process
from geosan.config.app_settings import (
    DEFAULT_APP_SETTINGS_PATH,
    load_app_settings,
    read_app_settings,
)
from geosan.config.errors import AppError, InputError, NotFoundError
from geosan.evidence.openai_search import (
    MAX_TOOL_CALLS,
    _HttpError,
    _post_response,
    _search_count,
    _Usage,
)
from geosan.evidence.transfer import configuration_error, finish_search, reserve_candidate_search
from geosan.opportunity.candidate_web_results import (
    WebSearchCandidate,
    parse_search_results,
    safe_public_text,
)
from geosan.opportunity.models import IngestBatch
from geosan.storage.base import utcnow
from geosan.storage.session import session_scope

PROMPT_PATH = Path(__file__).resolve().parents[2] / "examples/prompts/candidate-search.md"


@dataclass(frozen=True)
class SearchContext:
    enabled: bool
    process_names: tuple[str, ...]
    regions: tuple[str, ...]
    industries: tuple[str, ...]
    blocked_domains: tuple[str, ...]
    maximum: int
    cache_days: int
    criteria_hash: str
    prompt: str


@dataclass(frozen=True)
class CandidateSearchResult:
    candidates: tuple[WebSearchCandidate, ...]
    dropped_count: int
    criteria_hash: str
    searched_at: datetime
    expires_at: datetime
    skipped_reason: str | None = None


def load_search_context(batch_id: str, db_path=None, *, session=None) -> SearchContext:
    """승인된 선택값과 공정 이름만 읽는다. 역량·거래·메모를 조회하지 않는다."""
    with nullcontext(session) if session is not None else session_scope(db_path) as session:
        batch = session.get(IngestBatch, batch_id)
        if batch is None:
            raise NotFoundError("후보 찾기 회차를 찾을 수 없습니다.")
        settings = read_app_settings(session) or load_app_settings(DEFAULT_APP_SETTINGS_PATH)
        if batch.status != "RUNNING" or batch.dataset_kind != settings.active_dataset_kind:
            raise InputError("진행 중인 회차와 현재 자료 묶음을 확인해 주세요.")
        criteria = batch.criteria
        if not isinstance(criteria, dict) or set(criteria) != {
            "processCodes",
            "regions",
            "industries",
        }:
            raise InputError("회차에는 고른 공정·지역·산업 조건만 있어야 합니다.")
        for values in criteria.values():
            if (
                not isinstance(values, list)
                or any(not isinstance(v, str) or not v.strip() for v in values)
                or len(set(values)) != len(values)
            ):
                raise InputError("찾기 조건의 이름 목록을 확인해 주세요.")
        processes = dict(
            session.execute(
                select(Process.code, Process.name).where(
                    Process.dataset_kind == settings.active_dataset_kind
                )
            ).all()
        )
        if (
            not criteria["processCodes"]
            or not set(criteria["processCodes"]) <= processes.keys()
            or not criteria["regions"]
            or not set(criteria["regions"]) <= set(settings.ingestion.regions)
            or not set(criteria["industries"]) <= set(settings.industries)
            or type(batch.max_candidates) is not int
            or not 1 <= batch.max_candidates <= settings.ingestion.max_candidates
        ):
            raise InputError("현재 설정에서 고를 수 있는 찾기 조건과 최대 건수를 확인해 주세요.")
        names = tuple(sorted(processes[code] for code in criteria["processCodes"]))
        regions, industries = (
            tuple(sorted(criteria["regions"])),
            tuple(sorted(criteria["industries"])),
        )
        if any(
            not name.strip() or not safe_public_text(name)
            for name in (*names, *regions, *industries)
        ):
            raise InputError("찾기 조건 이름에 사람 정보나 연락처를 넣을 수 없습니다.")
        config = settings.candidate_web_search
        maximum, dataset = batch.max_candidates, batch.dataset_kind
        model = settings.llm.model
    try:
        prompt = PROMPT_PATH.read_text(encoding="utf-8-sig")
    except (OSError, UnicodeError):
        raise InputError("후보 검색 지시문을 읽지 못했습니다.") from None
    if not prompt.strip():
        raise InputError("후보 검색 지시문이 비어 있습니다.")
    blocked = tuple(sorted(config.blocked_domains))
    fingerprint = json.dumps(
        [
            dataset,
            sorted(criteria["processCodes"]),
            names,
            regions,
            industries,
            maximum,
            blocked,
            prompt,
            model,
        ],
        ensure_ascii=False,
        separators=(",", ":"),
    )
    return SearchContext(
        config.enabled,
        names,
        regions,
        industries,
        blocked,
        maximum,
        config.cache_days,
        hashlib.sha256(fingerprint.encode()).hexdigest(),
        prompt,
    )


def _request(context, model):
    conditions = {"processNames": context.process_names, "regions": context.regions}
    if context.industries:
        conditions["industries"] = context.industries
    prompt = context.prompt.replace("{최대 건수}", str(context.maximum)).replace(
        "{막는 사이트 목록: 설정 candidateWebSearch.blockedDomains}",
        ", ".join(context.blocked_domains),
    )
    return {
        "model": model,
        "store": False,
        "tools": [
            {"type": "web_search", "filters": {"blocked_domains": list(context.blocked_domains)}}
        ],
        "include": ["web_search_call.action.sources"],
        "max_tool_calls": MAX_TOOL_CALLS,
        "tool_choice": "required",
        "instructions": prompt,
        "input": json.dumps(conditions, ensure_ascii=False),
    }


def _failure():
    return AppError(
        "후보 웹 검색 응답을 확인하지 못했습니다.",
        "문의 번호와 함께 운영자에게 확인해 주세요.",
        status=503,
        kind="LLM_FAILED",
    )


def search_candidates(batch_id: str, *, db_path=None) -> CandidateSearchResult:
    """실제 HTTP 전송 부품. 재사용 자료 조회·저장과 회차 완료는 호출자가 맡는다."""
    context = load_search_context(batch_id, db_path)
    started = utcnow()

    def result(candidates=(), dropped=0, skipped=None):
        return CandidateSearchResult(
            candidates,
            dropped,
            context.criteria_hash,
            started,
            started if skipped else started + timedelta(days=context.cache_days),
            skipped,
        )

    if not context.enabled:
        return result(skipped="DISABLED")
    api_key = os.environ.get("OPENAI_API_KEY", "").strip()
    for attempt in range(2):
        current = load_search_context(batch_id, db_path)
        if not current.enabled or current.criteria_hash != context.criteria_hash:
            raise InputError("검색 중 찾기 조건이나 설정이 바뀌었습니다. 다시 시작해 주세요.")
        try:
            ticket = reserve_candidate_search(batch_id, bool(api_key), db_path)
        except AppError as error:
            if error.kind == "SEARCH_LIMIT":
                return result(skipped="DAILY_LIMIT")
            raise
        try:
            response = _post_response(_request(context, ticket.llm.model), api_key)
        except _HttpError as error:
            if error.status in (400, 401, 403, 404, 429):
                finish_search(ticket, 0, 0, 0, db_path)
            if error.status == 429 and attempt == 0:
                continue
            if error.status in (401, 403, 404):
                raise configuration_error() from None
            raise _failure() from None
        except (OSError, http.client.HTTPException, ValueError):
            # 과금 여부를 모르는 실패는 미확정으로 남겨 월 한도 우회를 막는다.
            raise _failure() from None
        try:
            usage = _Usage.model_validate(response["usage"])
            count = _search_count(response)
            if count < 1:
                raise ValueError("검색 사용량 미확인")
        except (KeyError, TypeError, ValueError, AttributeError):
            raise _failure() from None
        finish_search(ticket, usage.input_tokens, usage.output_tokens, count, db_path)
        try:
            candidates, dropped = parse_search_results(
                response, context.blocked_domains, context.maximum
            )
        except (KeyError, TypeError, ValueError, AttributeError):
            raise _failure() from None
        return result(candidates, dropped)
    raise AssertionError("검색 재시도 횟수")
