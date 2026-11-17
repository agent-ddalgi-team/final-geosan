"""C8 검수 전환. 복사·검수·활성 묶음 변경·재평가를 한 번에 확정한다."""

import logging

import typer

from geosan.capability.review import (
    copy_confirmed_dataset,
    resolve_review_target,
    transition_review,
)
from geosan.config.app_settings import set_active_dataset_kind
from geosan.config.errors import AppError, InputError, RunFailedError, exit_code_for
from geosan.config.registry import active_dataset_kind
from geosan.config.validators import find_contact
from geosan.storage.engine import database_path
from geosan.storage.session import session_scope
from geosan.workflows.flow_evaluate import evaluate_in_session, today_in_seoul

logger = logging.getLogger(__name__)
_LABELS = {
    "cap_process": "공정",
    "cap_process_capability": "세부 역량",
    "cap_delivery_record": "실적",
    "cap_qualification": "자격",
    "cap_qualification_scope": "범위",
}


def run_review_set(
    target: list[str],
    *,
    all_values: bool,
    reviewer: str | None,
    basis: str | None,
    no_evaluate: bool = False,
    echo=typer.echo,
) -> int:
    try:
        if not reviewer or not reviewer.strip() or not basis or not basis.strip():
            raise InputError("검수자(--by)와 확인 근거(--basis)를 모두 입력해 주세요.")
        if find_contact(reviewer) or find_contact(basis):
            raise InputError("검수자와 확인 근거에는 연락처를 넣을 수 없습니다.")
        if all_values:
            if target != ["REVIEWED"]:
                raise InputError("전체 전환은 --all REVIEWED로만 실행할 수 있습니다.")
        elif len(target) != 3 or target[2] not in ("REVIEWED", "RECHECK") or no_evaluate:
            raise InputError(
                "대상 종류·ID·REVIEWED 또는 RECHECK를 넣어 주세요. "
                "--no-evaluate는 --all에만 씁니다."
            )
        if not database_path().is_file():
            raise InputError("데이터베이스가 없습니다. 먼저 geosan init-db를 실행해 주세요.")
        reviewer, basis = reviewer.strip(), basis.strip()
        with session_scope() as session:
            session.connection().exec_driver_sql("BEGIN IMMEDIATE")
            active = active_dataset_kind(session)
            if all_values:
                if active == "COMPANY_CONFIRMED":
                    raise InputError("이미 COMPANY_CONFIRMED 묶음이 있습니다. 덮어쓰지 않습니다.")
                if active != "BROCHURE":
                    raise InputError("전체 전환은 활성 묶음이 BROCHURE일 때만 가능합니다.")
                counts = copy_confirmed_dataset(
                    session, reviewer=reviewer, basis=basis, reviewed_at=today_in_seoul()
                )
                set_active_dataset_kind(session, "COMPANY_CONFIRMED", updated_by=reviewer)
                summary = ", ".join(
                    f"{label} {counts[table]}건" for table, label in _LABELS.items()
                )
                summary += " 복사, 활성 묶음 COMPANY_CONFIRMED로 전환"
            else:
                value = resolve_review_target(session, target[0], target[1], active.value)
                transition_review(
                    session,
                    value,
                    target[2],
                    reviewer=reviewer,
                    basis=basis,
                    reviewed_at=today_in_seoul(),
                )
                summary = f"검수 상태를 {target[2]}로 저장"
            if no_evaluate:
                summary += "; 재평가 생략(--no-evaluate). geosan evaluate를 실행해 주세요."
            else:
                evaluated = evaluate_in_session(session, None, reviewer)
                if not evaluated.ok:
                    raise evaluated.error or RunFailedError("재평가를 저장하지 못했습니다.")
                summary += f"; {evaluated.summary}, 재평가 완료"
        echo(summary)
        return 0
    except Exception as exc:
        error = (
            exc
            if isinstance(exc, AppError)
            else RunFailedError("검수 전환에 실패해 변경을 되돌렸습니다.")
        )
        logger.error("검수 전환 실패: ref=%s type=%s", error.ref, type(exc).__name__)
        echo(f"{error.message} {error.next_action} (문의 번호: {error.ref})")
        return exit_code_for(error)
