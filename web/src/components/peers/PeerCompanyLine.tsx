// 비슷한 회사 한 줄(#269). 예: "코파스 · 전기아연도금 · 자동차 부품 · 접촉 · 11/06 전화 · 메모: 납기 걱정, 샘플 먼저 요청 — 박 이사".
// 회사 이름을 누르면 그 회사 상세로 간다. 거절이면 "거절 · 가격". 메모는 영업 메모와 같은 내부 전용이다.
import { Link } from 'react-router-dom';
import type { PeerCompany } from '../../api/types';
import { peersArea } from '../../labels/ko';
import { colors, typography } from '../../theme/tokens';
import StatusTag from '../common/StatusTag';
import { peerLastContactText, peerStageText, truncateNote } from './peersText';

export interface PeerCompanyLineProps {
  company: PeerCompany;
  /** 공정 코드 → 공정 이름. 없으면 코드를 그대로 보인다. */
  processNames: Record<string, string>;
  /** 담당자 키 → 이름. 없으면 키를 그대로 보인다. */
  personName: (key: string) => string;
}

export default function PeerCompanyLine({
  company,
  processNames,
  personName,
}: PeerCompanyLineProps) {
  const secondary = {
    color: colors.textSecondary,
    fontSize: typography.fontSizeSecondary,
  } as const;
  const processes = company.processCodes.map((code) => processNames[code] ?? code);
  const lastContact = peerLastContactText(company);
  const note = company.lastNote;

  return (
    <li
      data-testid="peer-company"
      style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}
    >
      <Link
        to={`/opportunities/${encodeURIComponent(company.oppId)}`}
        aria-label={peersArea.openCompanyLabel(company.name)}
        data-testid="peer-company-name"
        style={{ fontWeight: 600 }}
      >
        {company.name}
      </Link>
      {company.sameProcess ? (
        <StatusTag tone="neutral" data-testid="peer-same-process">
          {peersArea.sameProcess}
        </StatusTag>
      ) : null}
      {company.sameIndustry ? (
        <StatusTag tone="neutral" data-testid="peer-same-industry">
          {peersArea.sameIndustry}
        </StatusTag>
      ) : null}
      {processes.length > 0 ? (
        <span data-testid="peer-processes">{processes.join(', ')}</span>
      ) : null}
      {company.industries.length > 0 ? (
        <span data-testid="peer-industries" style={secondary}>
          {company.industries.join(', ')}
        </span>
      ) : null}
      <span data-testid="peer-stage">{peerStageText(company)}</span>
      <span data-testid="peer-last-contact" style={secondary}>
        {lastContact ?? peersArea.noContact}
      </span>
      {note ? (
        <span data-testid="peer-note">
          {peersArea.notePrefix} {truncateNote(note.text)}
          <span style={secondary}> — {personName(note.by)}</span>
        </span>
      ) : null}
    </li>
  );
}
