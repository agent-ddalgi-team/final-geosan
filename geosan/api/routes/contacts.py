"""#980 상세 [상대 담당자 연락처]와 가린 메모 글 열기 창구(계약 C1, PM 결정 2026-11-28).

- 거산 담당자가 직접 적은 상대 회사 담당자의 이름·부서·번호만 둔다(자동 수집 없음).
- 목록·저장 응답에는 가린 값만 싣는다. 가리지 않은 값은 확인 문구에 체크한 기록 담당자가
  `.../reveal`을 부를 때만 주고, 그때마다 열람 기록(rec_contact_reveal)을 남긴다.
- 보기 전용 계정·담당자 키 없음은 목록도 못 본다(StaffDep가 403).
- 보관 기한(설정 personalContacts)이 다가오면 영업 홈에서 묻고, 담당자가 [지우기]나 [1년 더]를
  고른다. 저절로 지우지 않는다.
- 활동 이력에는 값 없이 "상대 담당자 연락처 추가"처럼만 적는다.
- 외부 AI·검색·엑셀·보고서·질문 목록·MCP·로그로 내보내지 않는다(C4).
"""

from __future__ import annotations

import re
from datetime import date, datetime, timedelta
from typing import Annotated, Literal

from fastapi import APIRouter, Path
from pydantic import Field
from sqlalchemy import select

from geosan.api.deps import SessionDep, StaffDep, runtime_for
from geosan.api.schemas import Envelope, Meta, _ApiModel, _RequestModel
from geosan.config.errors import AppError, FieldError, InputError, NotFoundError
from geosan.config.validators import CONTACT_PATTERNS
from geosan.evidence.transfer import KST
from geosan.opportunity.models import Opportunity
from geosan.records.models import ContactPerson, ContactReveal, Note
from geosan.records.program_note import add_program_note
from geosan.storage.base import new_id, utcnow

router = APIRouter()

NAME_MAX = 20
ROLE_MAX = 30
ACK_TEXT = "이 번호는 영업 목적으로만 쓰고 밖으로 옮기지 않겠습니다. 열람 기록이 남습니다."


class ContactRequest(_RequestModel):
    person_name: Annotated[str, Field(strict=True, max_length=NAME_MAX)] | None = None
    role: Annotated[str, Field(strict=True, max_length=ROLE_MAX)] | None = None
    phone: Annotated[str, Field(strict=True, max_length=40)]


class RevealRequest(_RequestModel):
    acknowledged: bool


class DeleteRequest(_RequestModel):
    reason: Literal["STAFF", "RETENTION"] = "STAFF"


class ContactPersonView(_ApiModel):
    contact_id: str
    person_name_masked: str | None
    role: str | None
    phone_masked: str
    created_by: str
    created_at: datetime
    updated_by: str | None = None
    updated_at: datetime | None = None
    retain_until: date
    retention_due: bool


class ContactList(_ApiModel):
    contacts: list[ContactPersonView]


class ContactSaved(_ApiModel):
    contact: ContactPersonView


class ContactRevealed(_ApiModel):
    contact_id: str
    person_name: str | None
    role: str | None
    phone: str


class ContactDeleted(_ApiModel):
    contact_id: str
    deleted_at: datetime


class NoteRevealed(_ApiModel):
    note_id: str
    text: str


def today_kst() -> date:
    return datetime.now(KST).date()


def _field_error(path: str, message: str) -> InputError:
    return InputError(message, fields=[FieldError(path=path, message=message)])


def format_phone(value: str) -> str | None:
    """숫자만 남겨 0으로 시작하는 9~11자리면 "010-1234-5678" 꼴. 아니면 None."""
    digits = re.sub(r"[^0-9]", "", value)
    if not re.fullmatch(r"0[0-9]{8,10}", digits):
        return None
    head = 2 if digits.startswith("02") else 3
    rest = digits[head:]
    if len(rest) not in (7, 8):
        return None
    return f"{digits[:head]}-{rest[:-4]}-{rest[-4:]}"


def mask_phone(phone: str) -> str:
    """앞 번호만 남기고 나머지 숫자를 *로. 예: 010-****-****."""
    head, *rest = phone.split("-")
    return "-".join([head, *("*" * len(part) for part in rest)])


def mask_name(name: str | None) -> str | None:
    """첫 글자 + 나머지 글자 수만큼 ○. 예: 김○○."""
    if not name:
        return None
    return name[0] + "○" * (len(name) - 1) if len(name) > 1 else "○"


def _clean_text(value: str | None, *, path: str, label: str) -> str | None:
    if value is None:
        return None
    text = " ".join(value.split())
    if not text:
        return None
    if any(pattern.search(text) for _, pattern in CONTACT_PATTERNS) or re.search(
        r"[0-9]{3,}", text
    ):
        raise _field_error(path, f"{label}에는 번호·이메일을 적지 않습니다.")
    return text


def _checked(body: ContactRequest) -> tuple[str | None, str | None, str]:
    phone = format_phone(body.phone)
    if phone is None or re.search(r"[A-Za-z가-힣@]", body.phone):
        raise _field_error("phone", "0으로 시작하는 전화번호를 입력해 주세요. 예: 010-1234-5678")
    name = _clean_text(body.person_name, path="personName", label="이름")
    role = _clean_text(body.role, path="role", label="부서·직함")
    return name, role, phone


def _lock(session) -> None:
    connection = session.connection()
    if not connection.connection.driver_connection.in_transaction:
        connection.exec_driver_sql("BEGIN IMMEDIATE")


def _opportunity(session, opp_id: str) -> Opportunity:
    opportunity = session.get(Opportunity, opp_id)
    if opportunity is None:
        raise NotFoundError("회사를 찾지 못했습니다.")
    return opportunity


def _contact(session, opp_id: str, contact_id: str) -> ContactPerson:
    row = session.get(ContactPerson, contact_id)
    if row is None or row.opp_id != opp_id or row.deleted_at is not None:
        raise NotFoundError("상대 담당자 연락처가 없습니다.", "상세를 새로 불러와 주세요.")
    return row


def _notice_days(session) -> tuple[int, int]:
    settings = runtime_for(session).app_settings.personal_contacts
    return settings.retention_days, settings.notice_days


def retention_due(row: ContactPerson, notice_days: int, today: date | None = None) -> bool:
    return (today or today_kst()) >= row.retain_until - timedelta(days=notice_days)


def view(row: ContactPerson, notice_days: int) -> ContactPersonView:
    return ContactPersonView(
        contact_id=row.contact_id,
        person_name_masked=mask_name(row.person_name),
        role=row.role,
        phone_masked=mask_phone(row.phone or ""),
        created_by=row.created_by,
        created_at=row.created_at,
        updated_by=row.updated_by,
        updated_at=row.updated_at,
        retain_until=row.retain_until,
        retention_due=retention_due(row, notice_days),
    )


def _meta(opportunity: Opportunity, now: datetime | None = None) -> Meta:
    return Meta(
        updated_at=now or utcnow(),
        dataset_kind=opportunity.dataset_kind,
        has_virtual_data=opportunity.is_virtual,
    )


def _reveal_row(session, opportunity, staff, now, *, contact_id=None, note_id=None) -> None:
    session.add(
        ContactReveal(
            reveal_id=new_id("reveal"),
            opp_id=opportunity.opp_id,
            contact_id=contact_id,
            note_id=note_id,
            staff_key=staff,
            created_at=now,
            created_by=staff,
            dataset_kind=opportunity.dataset_kind,
            is_virtual=opportunity.is_virtual,
        )
    )


def _require_ack(body: RevealRequest) -> None:
    if body.acknowledged is not True:
        raise _field_error("acknowledged", "확인 문구에 체크해야 볼 수 있습니다.")


@router.get("/opportunities/{oppId}/contacts", response_model=Envelope[ContactList])
def list_contacts(
    opp_id: Annotated[str, Path(alias="oppId")], session: SessionDep, staff: StaffDep
):
    opportunity = _opportunity(session, opp_id)
    _, notice = _notice_days(session)
    rows = session.scalars(
        select(ContactPerson)
        .where(ContactPerson.opp_id == opp_id, ContactPerson.deleted_at.is_(None))
        .order_by(ContactPerson.created_at, ContactPerson.contact_id)
    )
    return Envelope[ContactList](
        data=ContactList(contacts=[view(row, notice) for row in rows]), meta=_meta(opportunity)
    )


@router.post("/opportunities/{oppId}/contacts", response_model=Envelope[ContactSaved])
def add_contact(
    opp_id: Annotated[str, Path(alias="oppId")],
    body: ContactRequest,
    session: SessionDep,
    staff: StaffDep,
):
    name, role, phone = _checked(body)
    _lock(session)
    opportunity = _opportunity(session, opp_id)
    retention, notice = _notice_days(session)
    now = utcnow()
    row = ContactPerson(
        contact_id=new_id("contact"),
        opp_id=opp_id,
        person_name=name,
        role=role,
        phone=phone,
        retain_until=today_kst() + timedelta(days=retention),
        version=1,
        created_at=now,
        created_by=staff,
        dataset_kind=opportunity.dataset_kind,
        is_virtual=opportunity.is_virtual,
    )
    session.add(row)
    add_program_note(session, opportunity, "상대 담당자 연락처 추가", staff=staff, now=now)
    session.flush()
    return Envelope[ContactSaved](
        data=ContactSaved(contact=view(row, notice)), meta=_meta(opportunity, now)
    )


@router.post("/opportunities/{oppId}/contacts/{contactId}", response_model=Envelope[ContactSaved])
def update_contact(
    opp_id: Annotated[str, Path(alias="oppId")],
    contact_id: Annotated[str, Path(alias="contactId")],
    body: ContactRequest,
    session: SessionDep,
    staff: StaffDep,
):
    name, role, phone = _checked(body)
    _lock(session)
    opportunity = _opportunity(session, opp_id)
    row = _contact(session, opp_id, contact_id)
    _, notice = _notice_days(session)
    now = utcnow()
    if (row.person_name, row.role, row.phone) != (name, role, phone):
        row.person_name, row.role, row.phone = name, role, phone
        row.updated_at, row.updated_by = now, staff
        row.version += 1
        add_program_note(session, opportunity, "상대 담당자 연락처 고침", staff=staff, now=now)
    session.flush()
    return Envelope[ContactSaved](
        data=ContactSaved(contact=view(row, notice)), meta=_meta(opportunity, now)
    )


@router.post(
    "/opportunities/{oppId}/contacts/{contactId}/reveal", response_model=Envelope[ContactRevealed]
)
def reveal_contact(
    opp_id: Annotated[str, Path(alias="oppId")],
    contact_id: Annotated[str, Path(alias="contactId")],
    body: RevealRequest,
    session: SessionDep,
    staff: StaffDep,
):
    _require_ack(body)
    _lock(session)
    opportunity = _opportunity(session, opp_id)
    row = _contact(session, opp_id, contact_id)
    now = utcnow()
    _reveal_row(session, opportunity, staff, now, contact_id=row.contact_id)
    session.flush()
    return Envelope[ContactRevealed](
        data=ContactRevealed(
            contact_id=row.contact_id,
            person_name=row.person_name,
            role=row.role,
            phone=row.phone or "",
        ),
        meta=_meta(opportunity, now),
    )


@router.post(
    "/opportunities/{oppId}/contacts/{contactId}/delete", response_model=Envelope[ContactDeleted]
)
def delete_contact(
    opp_id: Annotated[str, Path(alias="oppId")],
    contact_id: Annotated[str, Path(alias="contactId")],
    session: SessionDep,
    staff: StaffDep,
    body: DeleteRequest | None = None,
):
    reason = body.reason if body else "STAFF"
    _lock(session)
    opportunity = _opportunity(session, opp_id)
    row = _contact(session, opp_id, contact_id)
    now = utcnow()
    row.person_name = row.role = row.phone = None
    row.deleted_at, row.deleted_by, row.deleted_reason = now, staff, reason
    row.version += 1
    text = "상대 담당자 연락처 지움" + ("(보관 1년)" if reason == "RETENTION" else "")
    add_program_note(session, opportunity, text, staff=staff, now=now)
    session.flush()
    return Envelope[ContactDeleted](
        data=ContactDeleted(contact_id=row.contact_id, deleted_at=now),
        meta=_meta(opportunity, now),
    )


@router.post(
    "/opportunities/{oppId}/contacts/{contactId}/keep", response_model=Envelope[ContactSaved]
)
def keep_contact(
    opp_id: Annotated[str, Path(alias="oppId")],
    contact_id: Annotated[str, Path(alias="contactId")],
    session: SessionDep,
    staff: StaffDep,
):
    _lock(session)
    opportunity = _opportunity(session, opp_id)
    row = _contact(session, opp_id, contact_id)
    retention, notice = _notice_days(session)
    if not retention_due(row, notice):
        raise AppError(
            "아직 보관 기한 전입니다.",
            "기한이 다가오면 영업 홈에서 다시 묻습니다.",
            status=409,
            kind="STALE_VALUE",
        )
    now = utcnow()
    row.retain_until = today_kst() + timedelta(days=retention)
    row.updated_at, row.updated_by = now, staff
    row.version += 1
    add_program_note(session, opportunity, "상대 담당자 연락처 1년 더 보관", staff=staff, now=now)
    session.flush()
    return Envelope[ContactSaved](
        data=ContactSaved(contact=view(row, notice)), meta=_meta(opportunity, now)
    )


@router.post("/notes/{noteId}/reveal", response_model=Envelope[NoteRevealed])
def reveal_note(
    note_id: Annotated[str, Path(alias="noteId")],
    body: RevealRequest,
    session: SessionDep,
    staff: StaffDep,
):
    _require_ack(body)
    _lock(session)
    note = session.get(Note, note_id)
    if note is None or note.cancelled_at is not None:
        raise NotFoundError("메모를 찾지 못했습니다.", "상세를 새로 불러와 주세요.")
    opportunity = _opportunity(session, note.opp_id)
    now = utcnow()
    _reveal_row(session, opportunity, staff, now, note_id=note.note_id)
    session.flush()
    return Envelope[NoteRevealed](
        data=NoteRevealed(note_id=note.note_id, text=note.text), meta=_meta(opportunity, now)
    )


RETENTION_DUE_KIND = "CONTACT_RETENTION_DUE"


def retention_due_row(session, settings, staff_key: str | None, today: date):
    """영업 홈 "오늘 확인할 것"의 보관 기한 줄(#980). 받는 사람이 아니거나 없으면 None.

    그 연락처를 적은 담당자와 운영 담당이 받는다(보기 전용 제외). 회사마다 한 줄이고 날짜는
    그 회사에서 가장 이른 보관 기한이다. 이름·번호는 싣지 않는다.
    """
    from geosan.api.operations import is_operations_staff
    from geosan.dashboard.queries import TodayCheckItem, TodayCheckRow
    from geosan.opportunity.models import Customer

    if staff_key is None or not settings.is_recording_staff(staff_key):
        return None
    notice = settings.personal_contacts.notice_days
    query = (
        select(ContactPerson.opp_id, Customer.name, ContactPerson.retain_until)
        .join(Opportunity, Opportunity.opp_id == ContactPerson.opp_id)
        .join(Customer, Customer.customer_id == Opportunity.customer_id)
        .where(
            ContactPerson.deleted_at.is_(None),
            ContactPerson.retain_until <= today + timedelta(days=notice),
        )
        .order_by(ContactPerson.retain_until, Customer.name)
    )
    if not is_operations_staff(settings, staff_key):
        query = query.where(ContactPerson.created_by == staff_key)
    seen: dict[str, TodayCheckItem] = {}
    for opp_id, name, until in session.execute(query):
        seen.setdefault(opp_id, TodayCheckItem(opp_id, name, until))
    if not seen:
        return None
    return TodayCheckRow(kind=RETENTION_DUE_KIND, count=len(seen), items=list(seen.values()))
