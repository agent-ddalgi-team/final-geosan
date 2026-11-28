// 기업 상세 둘째 줄 오른쪽 "담당자 연락처" 칸(#996, PM 결정 2026-11-29).
// 회사 대표번호(값 · 출처 · 담당자 확인 · [고치기]) · 대표명(값 · 출처 · [넣기/고치기]) · 상대 담당자 줄들을 한 칸에 모은다.
// 대표번호 · 대표명은 전에 "한눈에 › 어떤 회사"에 있던 줄 그대로이고(#980), 상대 담당자 줄은 `ContactPersons`가 그린다
// (가림 · [보기] · 보관 기한 · [+ 연락처 추가]). 값도 고치기 부품도 없는 줄은 그리지 않는다.
import type { ReactNode } from 'react';
import type { DetailHeader } from '../../api/types';
import {
  companyFieldFixTexts,
  companySourceTexts,
  companySummary,
  contactPersonsTexts as texts,
} from '../../labels/ko';
import { colors, detailLayout, detailTheme, typography } from '../../theme/tokens';
import { formatMonthDay } from '../../utils/time';
import { useFrame } from '../frame/FrameContext';
import CompanyFieldFix from './CompanyFieldFix';

const secondary = { color: colors.textSecondary, fontSize: typography.fontSizeSecondary } as const;

function isHttpUrl(value: string | null | undefined): value is string {
  return Boolean(value) && /^https?:\/\/\S+$/.test(value as string);
}

function Row({ label, testId, children }: { label: string; testId: string; children: ReactNode }) {
  return (
    <div
      data-testid={testId}
      style={{
        display: 'grid',
        gridTemplateColumns: '84px minmax(0, 1fr)',
        columnGap: 10,
        alignItems: 'baseline',
        padding: '7px 0',
        borderTop: `1px solid ${colors.borderSecondary}`,
      }}
    >
      <dt style={{ color: colors.textDimmed, fontSize: detailLayout.smallFont }}>{label}</dt>
      <dd
        style={{
          margin: 0,
          minWidth: 0,
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'baseline',
          gap: '2px 8px',
        }}
      >
        {children}
      </dd>
    </div>
  );
}

export interface ContactCardProps {
  header: DetailHeader;
  /** 대표번호 · 대표명 [고치기]에 쓴다. 없으면 고치기 단추 없이 값만 보인다. */
  fix?: { oppId: string; onSaved: () => void };
  /** 상대 담당자 줄들(`ContactPersons`). */
  children?: ReactNode;
}

export default function ContactCard({ header, fix, children }: ContactCardProps) {
  const { config } = useFrame();
  const phone = header.mainPhone ?? null;
  const representative = header.representativeName?.trim() || null;
  const telHref =
    phone && /^[0-9+()\-\s]+$/.test(phone) ? `tel:${phone.replace(/[^0-9+]/g, '')}` : null;
  const phoneSourceUrl = isHttpUrl(header.mainPhoneSourceUrl) ? header.mainPhoneSourceUrl : null;
  const phoneConfirmedName =
    config?.staff.find((entry) => entry.key === header.mainPhoneConfirmedBy)?.displayName ??
    header.mainPhoneConfirmedBy ??
    '';

  return (
    <section
      aria-labelledby="detail-contacts-heading"
      data-testid="detail-contacts-card"
      style={{
        display: 'grid',
        gap: 12,
        alignContent: 'start',
        padding: detailLayout.cardPadding,
        background: colors.bgContainer,
        border: `1px solid ${detailTheme.border}`,
        borderRadius: detailTheme.radius,
        boxSizing: 'border-box',
      }}
    >
      <h2
        id="detail-contacts-heading"
        style={{ margin: 0, fontSize: detailLayout.cardTitleSize, fontWeight: 700 }}
      >
        {texts.title}
      </h2>
      <dl style={{ margin: 0 }}>
        {phone || fix ? (
          <Row label={texts.mainPhoneRow} testId="company-phone">
            {!phone ? (
              <span style={secondary} data-testid="company-phone-none">
                {companyFieldFixTexts.none}
              </span>
            ) : telHref ? (
              <a href={telHref} data-testid="company-phone-link">
                {phone}
              </a>
            ) : (
              <span>{phone}</span>
            )}
            {phone && phoneSourceUrl ? (
              <span style={secondary}>
                {companySummary.phoneSource}:{' '}
                <a
                  href={phoneSourceUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  data-testid="company-phone-source"
                >
                  {companySummary.phoneSourceHomepage} ↗
                </a>
              </span>
            ) : phone && header.mainPhoneSource && header.mainPhoneSource !== 'HOMEPAGE' ? (
              // #980: 팩토리온 공장조회·담당자 입력도 출처를 보인다.
              <span style={secondary} data-testid="company-phone-source">
                {companySummary.phoneSource}: {companySourceTexts.phone[header.mainPhoneSource]}
              </span>
            ) : null}
            {phone ? (
              <span style={secondary} data-testid="company-phone-status">
                {header.mainPhoneConfirmedAt
                  ? companySummary.phoneConfirmed(
                      formatMonthDay(header.mainPhoneConfirmedAt) ?? '',
                      phoneConfirmedName,
                    )
                  : companySummary.phoneUnconfirmed}
              </span>
            ) : null}
            {fix ? (
              <CompanyFieldFix
                oppId={fix.oppId}
                field="mainPhone"
                value={phone}
                onSaved={fix.onSaved}
              />
            ) : null}
          </Row>
        ) : null}
        {/* #980(PM 결정 2026-11-28): 회사 대표명. 공장등록 조회에서 오거나 담당자가 적는다. */}
        {representative || fix ? (
          <Row label={companyFieldFixTexts.representativeLabel} testId="company-representative">
            {representative ? (
              <span data-testid="company-representative-name">{representative}</span>
            ) : (
              <span style={secondary}>{companyFieldFixTexts.none}</span>
            )}
            {representative && header.representativeNameSource ? (
              <span style={secondary} data-testid="company-representative-source">
                {companySummary.phoneSource}:{' '}
                {companySourceTexts.representative[header.representativeNameSource]}
              </span>
            ) : null}
            {fix ? (
              <CompanyFieldFix
                oppId={fix.oppId}
                field="representativeName"
                value={representative}
                onSaved={fix.onSaved}
              />
            ) : null}
          </Row>
        ) : null}
        {children ? (
          <Row label={texts.personsRow} testId="detail-contact-persons">
            <div style={{ flex: '1 1 100%', minWidth: 0 }}>{children}</div>
          </Row>
        ) : null}
      </dl>
    </section>
  );
}
