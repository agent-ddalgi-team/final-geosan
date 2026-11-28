// #948 [거래처 후보 › 새 후보 발굴 패널 › 맨 위] "이름으로 회사 넣기"(PM 결정 2026-11-26).
// 거산이 이미 진행 중인 회사를 이름으로 찾아(GET /companies/lookup, 0원) AI 고르기 없이 바로
// 관심 기업으로 넣는다(POST /companies). 이미 목록에 있는 회사는 새로 넣지 않고 [열기]로 보낸다.
// 공장 자료에 없으면 이름(과 아는 주소)만으로 넣는다. 담당자가 아는 홈페이지를 적으면 AI가 찾지 않고
// 그 주소를 읽는다. 보기 전용(viewer)에게는 그리지 않는다.
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Button, Input } from 'antd';
import type { CSSProperties } from 'react';
import { ApiError, lookupCompanies, postCompany } from '../../api/client';
import type { CompanyAdded, CompanyLookup } from '../../api/types';
import { companyAdd } from '../../labels/ko';
import { choiceChip, colors, radius } from '../../theme/tokens';
import { useFrame, VIEWER_KEY } from '../frame/FrameContext';

const MANUAL = '__manual__';

type Found = { name: string; data: CompanyLookup; virtual: boolean };
type Notice = { kind: 'ok'; added: CompanyAdded } | { kind: 'error'; text: string } | null;

export interface CompanyAddBoxProps {
  /** 넣은 뒤 목록을 다시 읽게 한다. */
  onAdded?: () => void;
}

/**
 * 고르는 줄 한 칸. 고른 줄은 다른 선택 단추와 같은 모양이다(#972): 강조 연한 바탕 + 강조 테두리 + 강조 글자 굵게.
 * (#947의 "강조색 바탕 + 흰 글자"를 대신한다.)
 */
function rowStyle(selected: boolean): CSSProperties {
  const chip = selected ? choiceChip.selected : choiceChip.idle;
  return {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    margin: '6px 0',
    padding: '8px 12px',
    borderRadius: radius.control,
    border: `1px solid ${chip.border}`,
    background: chip.bg,
    color: selected ? chip.fg : undefined,
    fontWeight: selected ? choiceChip.selected.fontWeight : undefined,
    cursor: 'pointer',
  };
}

function detailPath(oppId: string) {
  return `/opportunities/${encodeURIComponent(oppId)}`;
}

export default function CompanyAddBox({ onAdded }: CompanyAddBoxProps) {
  const { staffKey, canRecord } = useFrame();
  const [name, setName] = useState('');
  const [found, setFound] = useState<Found | null>(null);
  const [searching, setSearching] = useState(false);
  const [picked, setPicked] = useState<string | null>(null);
  const [address, setAddress] = useState('');
  const [homepage, setHomepage] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);

  if (staffKey === VIEWER_KEY) return null;

  async function search() {
    const query = name.trim();
    if (query.length < 2) {
      setNotice({ kind: 'error', text: companyAdd.nameTooShort });
      return;
    }
    setSearching(true);
    setNotice(null);
    setPicked(null);
    try {
      const envelope = await lookupCompanies(query);
      setFound({
        name: query,
        data: envelope.data,
        virtual: envelope.meta.hasVirtualData === true,
      });
    } catch {
      setFound(null);
      setNotice({ kind: 'error', text: companyAdd.lookupFailed });
    } finally {
      setSearching(false);
    }
  }

  async function submit() {
    if (!staffKey || !canRecord || found === null || picked === null) return;
    const url = homepage.trim() || undefined;
    const body =
      picked === MANUAL
        ? { companyName: found.name, address: address.trim() || undefined, homepageUrl: url }
        : { rowId: picked, homepageUrl: url };
    setSubmitting(true);
    setNotice(null);
    try {
      const envelope = await postCompany(body, staffKey);
      setNotice({ kind: 'ok', added: envelope.data });
      setFound(null);
      setPicked(null);
      setName('');
      setAddress('');
      setHomepage('');
      onAdded?.();
    } catch (caught) {
      if (caught instanceof ApiError && caught.body.kind === 'BOOKMARK_EXCLUDED') {
        setNotice({ kind: 'error', text: companyAdd.excluded });
      } else {
        const message = caught instanceof ApiError ? caught.body.message : String(caught);
        setNotice({ kind: 'error', text: companyAdd.failed(message) });
      }
    } finally {
      setSubmitting(false);
    }
  }

  const factories = found?.data.factories ?? [];
  const existing = found?.data.existing ?? [];

  return (
    <section className="prospect-form" data-testid="company-add" aria-label={companyAdd.title}>
      <strong>{companyAdd.title}</strong>
      <p style={{ color: colors.textSecondary, margin: '4px 0 8px' }}>{companyAdd.hint}</p>
      <div style={{ display: 'flex', gap: 8 }}>
        <Input
          aria-label={companyAdd.nameLabel}
          placeholder={companyAdd.namePlaceholder}
          value={name}
          maxLength={50}
          onChange={(event) => setName(event.target.value)}
          onPressEnter={() => void search()}
          data-testid="company-add-name"
        />
        <Button onClick={() => void search()} loading={searching} data-testid="company-add-search">
          {searching ? companyAdd.searching : companyAdd.search}
        </Button>
      </div>

      {found !== null ? (
        <div data-testid="company-add-results" style={{ marginTop: 8 }}>
          {found.virtual ? (
            <p style={{ color: colors.textSecondary }}>{companyAdd.virtualNote}</p>
          ) : null}
          {existing.length > 0 ? (
            <div data-testid="company-add-existing">
              <div>{companyAdd.existingTitle}</div>
              <ul style={{ margin: '4px 0 8px', paddingLeft: 18 }}>
                {existing.map((item) => (
                  <li key={item.oppId}>
                    {item.companyName}
                    {item.address ? ` · ${item.address}` : ''}
                    {item.bookmarked ? ` · ${companyAdd.existingBookmarked}` : ''}{' '}
                    <Link to={detailPath(item.oppId)}>{companyAdd.open}</Link>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
            <legend>{companyAdd.factoriesTitle}</legend>
            {factories.length === 0 ? (
              <p style={{ color: colors.textSecondary }}>{companyAdd.factoriesEmpty}</p>
            ) : null}
            {factories.map((item) =>
              item.oppId ? (
                <div key={item.rowId} style={{ ...rowStyle(false), cursor: 'default' }}>
                  <span style={{ color: colors.textSecondary }}>
                    {item.companyName} · {item.address} · {companyAdd.alreadyListed}
                  </span>
                  <Link to={detailPath(item.oppId)} style={{ marginLeft: 'auto' }}>
                    {companyAdd.open}
                  </Link>
                </div>
              ) : (
                <label
                  key={item.rowId}
                  style={rowStyle(picked === item.rowId)}
                  data-testid={`company-add-row-${item.rowId}`}
                  data-picked={picked === item.rowId ? 'true' : undefined}
                >
                  <input
                    type="radio"
                    name="company-add-pick"
                    value={item.rowId}
                    checked={picked === item.rowId}
                    onChange={() => setPicked(item.rowId)}
                  />
                  <span>
                    {item.companyName} · {item.address}
                    {item.product ? ` · ${item.product}` : ''}
                  </span>
                  {picked === item.rowId ? (
                    <span style={{ marginLeft: 'auto' }}>{companyAdd.picked}</span>
                  ) : null}
                </label>
              ),
            )}
            {found.data.truncated ? (
              <p style={{ color: colors.textSecondary }}>{companyAdd.truncated}</p>
            ) : null}
            <label
              style={rowStyle(picked === MANUAL)}
              data-testid="company-add-row-manual"
              data-picked={picked === MANUAL ? 'true' : undefined}
            >
              <input
                type="radio"
                name="company-add-pick"
                value={MANUAL}
                checked={picked === MANUAL}
                onChange={() => setPicked(MANUAL)}
                data-testid="company-add-manual"
              />
              <span>{companyAdd.manualOption(found.name)}</span>
              {picked === MANUAL ? (
                <span style={{ marginLeft: 'auto' }}>{companyAdd.picked}</span>
              ) : null}
            </label>
          </fieldset>
          {picked === MANUAL ? (
            <Input
              aria-label={companyAdd.addressLabel}
              placeholder={companyAdd.addressPlaceholder}
              value={address}
              maxLength={300}
              onChange={(event) => setAddress(event.target.value)}
              style={{ marginTop: 4 }}
              data-testid="company-add-address"
            />
          ) : null}
          <label style={{ display: 'block', marginTop: 8 }}>
            {companyAdd.homepageLabel}
            <Input
              placeholder={companyAdd.homepagePlaceholder}
              value={homepage}
              maxLength={500}
              onChange={(event) => setHomepage(event.target.value)}
              data-testid="company-add-homepage"
            />
          </label>
          <p style={{ color: colors.textSecondary, margin: '4px 0' }}>
            {companyAdd.homepageHint} {companyAdd.contactWarning}
          </p>
          <Button
            type="primary"
            disabled={!canRecord || picked === null || submitting}
            loading={submitting}
            onClick={() => void submit()}
            data-testid="company-add-submit"
          >
            {submitting ? companyAdd.submitting : companyAdd.submit}
          </Button>
          {picked === null ? (
            <span style={{ color: colors.textSecondary, marginLeft: 8 }}>
              {companyAdd.pickFirst}
            </span>
          ) : null}
        </div>
      ) : null}

      {notice?.kind === 'ok' ? (
        <p role="status" data-testid="company-add-done" style={{ marginTop: 8 }}>
          {notice.added.created ? companyAdd.added : companyAdd.alreadyThere}{' '}
          {notice.added.researchQueued
            ? `${companyAdd.researchStarted} `
            : notice.added.created
              ? `${companyAdd.researchNotStarted} `
              : null}
          <Link to={detailPath(notice.added.oppId)}>{companyAdd.openDetail}</Link>
        </p>
      ) : null}
      {notice?.kind === 'error' ? (
        <p
          role="alert"
          data-testid="company-add-error"
          style={{ color: colors.error, marginTop: 8 }}
        >
          {notice.text}
        </p>
      ) : null}
    </section>
  );
}
