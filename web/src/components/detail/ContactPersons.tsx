// #980(PM 결정 2026-11-28) 상세 [상대 담당자 연락처].
// 거산 담당자가 직접 적은 상대 회사 담당자의 이름·부서·번호. 서버는 가린 값만 주고("김○○ · 010-****-****"),
// [보기] → 확인 문구 체크 → [확인하고 보기]를 거쳐야 원래 값을 준다(열람 기록이 남는다). 받은 값은 이 화면에서만
// 보이고 저장하지 않는다. 보기 전용 계정·담당자 미선택이면 목록을 부르지 않는다(서버도 403).
// 보관 1년이 다가오면 줄에 [지우기]·[1년 더 보관]이 같이 보인다. 저절로 지우지 않는다.
import { useEffect, useState } from 'react';
import { Button, Input, Popconfirm, Space } from 'antd';
import {
  ApiError,
  deleteContact,
  getContacts,
  keepContact,
  postContact,
  revealContact,
  updateContact,
} from '../../api/client';
import type { ContactPersonRevealed, ContactPersonView } from '../../api/types';
import { contactPersonsTexts as texts, errorTexts, revealTexts } from '../../labels/ko';
import { colors, homePalette, typography } from '../../theme/tokens';
import { useFrame } from '../frame/FrameContext';
import RevealConfirm from './RevealConfirm';

const secondary = { color: colors.textSecondary, fontSize: typography.fontSizeSecondary } as const;

interface Draft {
  personName: string;
  role: string;
  phone: string;
}

const EMPTY: Draft = { personName: '', role: '', phone: '' };

function message(caught: unknown, prefix: string): string {
  const detail = caught instanceof ApiError ? caught.body.message : errorTexts.network;
  return `${prefix} (${detail})`;
}

function DraftForm({
  draft,
  saving,
  onChange,
  onSave,
  onCancel,
}: {
  draft: Draft;
  saving: boolean;
  onChange: (draft: Draft) => void;
  onSave: () => void;
  onCancel: () => void;
}) {
  return (
    <div data-testid="contact-form" style={{ display: 'grid', gap: 6 }}>
      <Space wrap size={8}>
        <Input
          aria-label={texts.nameLabel}
          placeholder={texts.namePlaceholder}
          maxLength={20}
          value={draft.personName}
          disabled={saving}
          onChange={(event) => onChange({ ...draft, personName: event.target.value })}
          style={{ width: 140 }}
          data-testid="contact-name-input"
        />
        <Input
          aria-label={texts.roleLabel}
          placeholder={texts.rolePlaceholder}
          maxLength={30}
          value={draft.role}
          disabled={saving}
          onChange={(event) => onChange({ ...draft, role: event.target.value })}
          style={{ width: 160 }}
          data-testid="contact-role-input"
        />
        <Input
          aria-label={texts.phoneLabel}
          placeholder={texts.phonePlaceholder}
          maxLength={20}
          value={draft.phone}
          disabled={saving}
          onChange={(event) => onChange({ ...draft, phone: event.target.value })}
          style={{ width: 160 }}
          data-testid="contact-phone-input"
        />
      </Space>
      <Space size={8}>
        <Button
          size="small"
          type="primary"
          disabled={saving || draft.phone.trim() === ''}
          loading={saving}
          onClick={onSave}
          data-testid="contact-save-button"
        >
          {texts.save}
        </Button>
        <Button size="small" disabled={saving} onClick={onCancel} data-testid="contact-cancel">
          {texts.cancel}
        </Button>
      </Space>
    </div>
  );
}

function ContactRow({
  oppId,
  contact,
  staffKey,
  onChanged,
}: {
  oppId: string;
  contact: ContactPersonView;
  staffKey: string;
  onChanged: () => void;
}) {
  const [asking, setAsking] = useState(false);
  const [shown, setShown] = useState<ContactPersonRevealed | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run(action: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await action();
      onChanged();
    } catch (caught) {
      setError(message(caught, texts.saveFailed));
    } finally {
      setBusy(false);
    }
  }

  const name = shown ? shown.personName : contact.personNameMasked;
  const phone = shown ? shown.phone : contact.phoneMasked;
  const telHref = shown ? `tel:${shown.phone.replace(/[^0-9]/g, '')}` : null;
  return (
    <li data-testid="contact-row" style={{ padding: '2px 0' }}>
      {draft ? (
        <DraftForm
          draft={draft}
          saving={busy}
          onChange={setDraft}
          onCancel={() => setDraft(null)}
          onSave={() =>
            void run(async () => {
              await updateContact(
                oppId,
                contact.contactId,
                {
                  personName: draft.personName.trim() || null,
                  role: draft.role.trim() || null,
                  phone: draft.phone.trim(),
                },
                staffKey,
              );
              setDraft(null);
              setShown(null);
            })
          }
        />
      ) : (
        <span style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'baseline' }}>
          <strong data-testid="contact-name">{name ?? '—'}</strong>
          {contact.role ? <span style={secondary}>{contact.role}</span> : null}
          {telHref ? (
            <a href={telHref} data-testid="contact-phone">
              {phone}
            </a>
          ) : (
            <span data-testid="contact-phone">{phone}</span>
          )}
          {shown ? (
            <Button
              size="small"
              type="link"
              onClick={() => setShown(null)}
              data-testid="contact-hide"
            >
              {revealTexts.hideAgain}
            </Button>
          ) : (
            <Button
              size="small"
              type="link"
              disabled={asking}
              onClick={() => setAsking(true)}
              data-testid="contact-reveal-button"
            >
              {revealTexts.open}
            </Button>
          )}
          <Button
            size="small"
            type="link"
            disabled={busy || !shown}
            title={shown ? undefined : texts.editNeedsReveal}
            onClick={() =>
              shown &&
              setDraft({
                personName: shown.personName ?? '',
                role: shown.role ?? '',
                phone: shown.phone,
              })
            }
            data-testid="contact-edit-button"
          >
            {texts.edit}
          </Button>
          <Popconfirm
            title={texts.removeConfirm}
            okText={texts.remove}
            cancelText={texts.cancel}
            onConfirm={() =>
              void run(() =>
                deleteContact(
                  oppId,
                  contact.contactId,
                  contact.retentionDue ? 'RETENTION' : 'STAFF',
                  staffKey,
                ),
              )
            }
          >
            <Button size="small" type="link" danger disabled={busy} data-testid="contact-delete">
              {texts.remove}
            </Button>
          </Popconfirm>
          <span style={secondary} data-testid="contact-retain">
            {texts.retainUntil(contact.retainUntil)}
          </span>
        </span>
      )}
      {asking && !shown ? (
        <RevealConfirm
          testId="contact-reveal"
          onCancel={() => setAsking(false)}
          onReveal={async () => {
            const envelope = await revealContact(oppId, contact.contactId, staffKey);
            setShown(envelope.data);
            setAsking(false);
          }}
        />
      ) : null}
      {contact.retentionDue && !draft ? (
        <div
          data-testid="contact-retention-due"
          style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 4 }}
        >
          <span style={{ color: homePalette.yellowText }}>{texts.retentionDue}</span>
          <Button
            size="small"
            disabled={busy}
            onClick={() => void run(() => keepContact(oppId, contact.contactId, staffKey))}
            data-testid="contact-keep"
          >
            {texts.keep}
          </Button>
        </div>
      ) : null}
      {error ? (
        <span role="alert" style={{ color: colors.error }} data-testid="contact-error">
          {error}
        </span>
      ) : null}
    </li>
  );
}

export interface ContactPersonsProps {
  oppId: string;
  /** 제목(예: "상대 담당자 연락처"). 주면 제목 옆 같은 줄에 연락처를 잇는다(PM 요청 11/28, 공간 활용). */
  title?: string;
  /** 저장·지우기 뒤 활동 이력을 다시 읽게 한다. */
  onChanged?: () => void;
}

export default function ContactPersons({ oppId, title, onChanged }: ContactPersonsProps) {
  const { staffKey, canRecord } = useFrame();
  const [version, setVersion] = useState(0);
  const [result, setResult] = useState<{
    key: string;
    contacts?: ContactPersonView[];
    error?: string;
  } | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const key = `${oppId}:${staffKey ?? ''}:${version}`;

  useEffect(() => {
    if (!canRecord || !staffKey) return;
    const controller = new AbortController();
    getContacts(oppId, staffKey, controller.signal)
      .then((envelope) => setResult({ key, contacts: envelope.data.contacts }))
      .catch((caught: unknown) => {
        if (!controller.signal.aborted)
          setResult({ key, error: message(caught, texts.loadFailed) });
      });
    return () => controller.abort();
  }, [oppId, staffKey, canRecord, key]);

  function changed() {
    setVersion((n) => n + 1);
    onChanged?.();
  }

  const heading = title ? (
    <h3 style={{ margin: 0, fontSize: typography.fontSize, fontWeight: 600, whiteSpace: 'nowrap' }}>
      {title}
    </h3>
  ) : null;
  const rowStyle = {
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'baseline',
    columnGap: 16,
    rowGap: 4,
  } as const;
  if (!canRecord || !staffKey) {
    return (
      <div style={rowStyle}>
        {heading}
        <p style={{ ...secondary, margin: 0 }} data-testid="contacts-hidden">
          {staffKey ? texts.viewerHidden : texts.pickStaffFirst}
        </p>
      </div>
    );
  }
  const current = result?.key === key ? result : null;
  const contacts = current?.contacts ?? [];

  async function add(next: Draft) {
    if (!staffKey) return;
    setSaving(true);
    setSaveError(null);
    try {
      await postContact(
        oppId,
        {
          personName: next.personName.trim() || null,
          role: next.role.trim() || null,
          phone: next.phone.trim(),
        },
        staffKey,
      );
      setDraft(null);
      changed();
    } catch (caught) {
      setSaveError(message(caught, texts.saveFailed));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div data-testid="contacts" style={{ display: 'grid', gap: 6 }}>
      {/* 제목 왼쪽, 연락처 오른쪽 두 칸(PM 요청 11/28: 안내 문장은 빼고 공간 활용). */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: heading ? 'auto minmax(0, 1fr)' : 'minmax(0, 1fr)',
          columnGap: 20,
          alignItems: 'baseline',
        }}
      >
        {heading}
        <div style={{ display: 'grid', gap: 2 }}>
          {current?.error ? (
            <span role="alert" style={{ color: colors.error }} data-testid="contacts-error">
              {current.error}
            </span>
          ) : current && contacts.length === 0 ? (
            <span style={secondary} data-testid="contacts-empty">
              {texts.empty}
            </span>
          ) : null}
          {contacts.length > 0 ? (
            <ul
              style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 2 }}
              data-testid="contacts-list"
            >
              {contacts.map((contact) => (
                <ContactRow
                  key={`${contact.contactId}:${contact.updatedAt ?? ''}:${contact.retainUntil}`}
                  oppId={oppId}
                  contact={contact}
                  staffKey={staffKey}
                  onChanged={changed}
                />
              ))}
            </ul>
          ) : null}
          {draft ? null : (
            <div>
              <Button
                size="small"
                type="link"
                style={{ padding: 0 }}
                onClick={() => setDraft(EMPTY)}
                data-testid="contact-add-button"
              >
                + {texts.add}
              </Button>
            </div>
          )}
        </div>
      </div>
      {draft ? (
        <DraftForm
          draft={draft}
          saving={saving}
          onChange={setDraft}
          onCancel={() => {
            setDraft(null);
            setSaveError(null);
          }}
          onSave={() => void add(draft)}
        />
      ) : null}
      {saveError ? (
        <span role="alert" style={{ color: colors.error }} data-testid="contact-save-error">
          {saveError}
        </span>
      ) : null}
    </div>
  );
}
