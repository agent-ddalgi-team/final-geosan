"""역량 파일 검사와 투입(W1). 파일 하나를 한 트랜잭션으로 저장한다."""

from __future__ import annotations

from dataclasses import dataclass, field, replace
from pathlib import Path

from sqlalchemy import select
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from geosan.capability.models import (
    DeliveryRecord,
    Process,
    ProcessCapability,
    Qualification,
    QualificationScope,
    QualificationStatus,
)
from geosan.capability.queries import latest_review
from geosan.capability.review import append_review
from geosan.config.errors import FieldError, InputError, RunFailedError
from geosan.config.file_checks import check_capability_file
from geosan.config.loader import load_document
from geosan.config.paths import normalize_input_path
from geosan.config.schemas import CapabilityFile
from geosan.rules.codes import DatasetKind, ProcessCode
from geosan.storage.base import new_id
from geosan.storage.session import session_scope


@dataclass
class CapabilityImportResult:
    process_count: int = 0
    capability_count: int = 0
    qualification_count: int = 0
    pending_count: int = 0
    warnings: list[str] = field(default_factory=list)

    @property
    def summary(self) -> str:
        return (
            f"공정 {self.process_count}건, 역량 {self.capability_count}건, "
            f"자격 {self.qualification_count}건 저장. 검수 대기 {self.pending_count}건"
        )


def import_capability(
    path: Path | str, *, requested_by: str = "system", db_path: Path | str | None = None
) -> CapabilityImportResult:
    report = check_capability_file(normalize_input_path(path))
    if not report.ok:
        raise InputError("역량 파일에 오류가 있습니다.", fields=report.errors)
    if report.capability is None:
        raise RunFailedError("역량 파일 검사 결과가 없습니다.")
    document = load_document(report.path)
    try:
        with session_scope(db_path) as session:
            return _store(session, report.capability, requested_by)
    except InputError as exc:
        exc.fields = [
            replace(item, line=item.line or document.line_of(item.path)) for item in exc.fields
        ]
        raise
    except SQLAlchemyError as exc:
        raise RunFailedError("역량 파일을 저장하지 못했습니다.") from exc


def _store(session: Session, model: CapabilityFile, requested_by: str) -> CapabilityImportResult:
    result = CapabilityImportResult()
    common = dict(
        dataset_kind=model.dataset_kind.value,
        is_virtual=model.dataset_kind == DatasetKind.VIRTUAL_REVIEWED,
        created_by=requested_by,
    )
    processes: dict[str, Process] = {}
    for item in model.processes:
        values = item.model_dump(exclude={"capabilities", "delivery_records"}, mode="json")
        if item.code == ProcessCode.BLACK_OXIDE:
            values["assumption_note"] = "흑착색=알카리흑착, 거산 확인 전(가정 A11)"
        process = _upsert(
            session, Process, {"code": item.code.value}, values, common, model, result
        )
        processes[item.code.value] = process
        result.process_count += 1
        for capability in item.capabilities:
            _upsert(
                session,
                ProcessCapability,
                dict(
                    process_id=process.process_id,
                    cap_kind=capability.cap_kind.value,
                    name=capability.name,
                ),
                capability.model_dump(mode="json"),
                common,
                model,
                result,
            )
            result.capability_count += 1
        for record in item.delivery_records:
            _upsert(
                session,
                DeliveryRecord,
                dict(
                    process_id=process.process_id,
                    industry=record.industry,
                    part_type=record.part_type,
                    period=record.period,
                ),
                record.model_dump(mode="json"),
                common,
                model,
                result,
            )
    for qualification_index, item in enumerate(model.qualifications):
        values = item.model_dump(exclude={"scopes", "statuses"}, mode="json")
        values.update(
            valid_from=item.valid_from, valid_to=item.valid_to, source_version=model.source_note
        )
        qualification = _upsert(
            session,
            Qualification,
            dict(official_name=item.official_name, number=item.number),
            values,
            common,
            model,
            result,
        )
        result.qualification_count += 1
        for scope_index, scope in enumerate(item.scopes):
            scope_path = f"qualifications[{qualification_index}].scopes[{scope_index}]"
            process_id = (
                processes[scope.process_code.value].process_id if scope.process_code else None
            )
            customer_id = None
            opp_id = None
            if scope.scope_kind != "PROCESS":
                # 파일은 고객 상호명을 받고, 존재를 확인한 뒤 고객 ID로 연결한다(C7·C6).
                from geosan.opportunity.models import Customer
                from geosan.opportunity.queries import normalize_name

                if scope.scope_kind == "CUSTOMER":
                    reference = normalize_name(scope.customer_ref or "")
                    customers = (
                        list(
                            session.scalars(
                                select(Customer)
                                .where(Customer.normalized_name == reference)
                                .limit(2)
                            )
                        )
                        if reference
                        else []
                    )
                    if len(customers) > 1:
                        raise InputError(
                            "자격을 연결할 고객을 하나로 정할 수 없습니다.",
                            fields=[
                                FieldError(
                                    path=f"{scope_path}.customerRef",
                                    message="같은 상호의 고객이 여러 건입니다. 확인해 주세요.",
                                )
                            ],
                        )
                    if customers:
                        customer_id = customers[0].customer_id
                elif scope.scope_kind == "OPPORTUNITY":
                    raise InputError(
                        "역량 파일에서는 기회 범위 자격을 받지 않습니다.",
                        fields=[
                            FieldError(
                                path=f"{scope_path}.scopeKind",
                                message=("특정 기회에만 쓰는 자격은 U4 검수 명령에서 등록합니다."),
                            )
                        ],
                    )
                if customer_id is None and opp_id is None:
                    raise InputError(
                        "자격 범위의 참조 대상을 찾을 수 없습니다.",
                        fields=[
                            FieldError(
                                path=f"{scope_path}.customerRef",
                                message="사례 파일로 먼저 등록한 고객의 상호명을 적어 주세요.",
                            )
                        ],
                    )
            keys = dict(
                qual_id=qualification.qual_id,
                scope_kind=scope.scope_kind,
                process_id=process_id,
                customer_id=customer_id,
                opp_id=opp_id,
                product_scope=None,
            )
            _upsert(
                session,
                QualificationScope,
                keys,
                dict(
                    applicability=scope.applicability.value,
                    basis=scope.basis,
                    review_status=scope.review_status.value,
                ),
                common,
                model,
                result,
            )
        for status in item.statuses:
            session.add(
                QualificationStatus(
                    status_id=new_id("qs"),
                    qual_id=qualification.qual_id,
                    **status.model_dump(),
                    **common,
                )
            )
            session.flush()
    session.flush()
    return result


def _upsert(session, cls, keys, values, common, model, result):
    query = select(cls).where(cls.dataset_kind == common["dataset_kind"])
    for key, value in keys.items():
        query = query.where(getattr(cls, key) == value)
    row = session.scalar(query)
    if row is None:
        pk = next(iter(cls.__table__.primary_key.columns)).name
        row = cls(**{pk: new_id("cap")}, **keys, **common)
        session.add(row)
        previous = None
    else:
        previous = latest_review(session, row, dataset_kind=common["dataset_kind"])
    requested_status = values["review_status"]
    review = model.review_defaults
    if (
        previous is not None
        and previous.review_status == "REVIEWED"
        and requested_status == "PENDING"
    ):
        requested_status = "REVIEWED"
        review = previous
        result.warnings.append(f"{cls.__tablename__}: 기존 검수 완료 상태를 유지했습니다.")
    for key, value in values.items():
        setattr(row, key, value)
    row.review_status = requested_status
    row.is_virtual = common["is_virtual"]
    session.flush()
    append_review(
        session,
        row,
        previous,
        requested_status,
        reviewer=review.reviewer,
        reviewed_at=review.reviewed_at,
        basis=review.basis,
        requested_by=common["created_by"],
    )
    result.pending_count += requested_status == "PENDING"
    return row
