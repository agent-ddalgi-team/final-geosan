// 상세 "회사 소개 · 산업군" 칩(#646): AI가 제안한 산업군을 [확정]하거나 [고치기]로 바꾼다.
// 예: "자동차 부품 (AI 제안) [확정] [고치기]" → 확정하면 "자동차 부품 ✓ 담당자 확정 [고치기]".
// 초록 ✓는 사람이 확인한 값(사례 파일·담당자 확정)에만 붙는다(PM 결정 2026-11-13).
// 저장하면 서버가 꼬리 질문의 산업 확정(#652)과 같은 칸에 적고 활동 이력에 한 줄을 남긴다. 다시 평가하지 않는다.
// 적는 것이라 구분 줄 아래(적는 곳)에 둔다. 모달 없이 인라인이고, 담당자를 고르기 전·보기 전용은 단추가 잠긴다.
import { useState } from 'react';
import { Button, Checkbox, Space } from 'antd';
import { ApiError, postIndustries } from '../../api/client';
import type { OpportunityDetail } from '../../api/types';
import { errorTexts, industryChips as texts } from '../../labels/ko';
import { colors, statusPalette, typography } from '../../theme/tokens';
import { useFrame } from '../frame/FrameContext';
import { MAX_INDUSTRIES } from '../records/ChoiceQuestion';
import DetailSection from './DetailSection';

export interface IndustryChipsProps {
  oppId: string;
  header: Pick<OpportunityDetail['header'], 'industries' | 'industriesSource'>;
  /** 저장이 끝나면 부른다. 상세 화면이 상세와 활동 이력을 새로 불러온다. */
  onSaved: () => void;
}

const secondary = { color: colors.textSecondary, fontSize: typography.fontSizeSecondary } as const;

export default function IndustryChips({ oppId, header, onSaved }: IndustryChipsProps) {
  const { staffKey, canRecord, config } = useFrame();
  const industries = header.industries ?? [];
  const source = header.industriesSource ?? null;
  const confirmed = source === 'CASE_FILE' || source === 'STAFF';
  const options = config?.ingestOptions?.industries ?? [];

  const [picked, setPicked] = useState<string[] | null>(null);
  const [saving, setSaving] = useState<'confirm' | 'edit' | null>(null);
  const [error, setError] = useState<string | null>(null);

  const editing = picked !== null;
  const full = (picked?.length ?? 0) >= MAX_INDUSTRIES;
  // 이미 사람이 확인한 값과 똑같이 고르면 바뀌는 것이 없어 [저장]을 잠근다.
  const unchanged =
    confirmed &&
    picked !== null &&
    picked.length === industries.length &&
    picked.every((name) => industries.includes(name));

  async function save(kind: 'confirm' | 'edit', values: string[]) {
    if (!staffKey || values.length === 0) return;
    setSaving(kind);
    setError(null);
    try {
      await postIndustries(oppId, values, staffKey);
      setPicked(null);
      onSaved();
    } catch (caught) {
      const detail = caught instanceof ApiError ? caught.body.message : errorTexts.network;
      setError(`${texts.saveFailed} (${detail})`);
    } finally {
      setSaving(null);
    }
  }

  return (
    <DetailSection id="detail-industries" title={texts.title}>
      <div
        data-testid="industry-chips"
        style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8 }}
      >
        {industries.length === 0 ? (
          <span data-testid="industry-chips-none">{texts.none}</span>
        ) : (
          industries.map((name) => (
            <span
              key={name}
              role="img"
              aria-label={confirmed ? texts.confirmedAria(name) : texts.aiAria(name)}
              data-testid="industry-chip"
              data-mark={confirmed ? 'confirmed' : 'ai'}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 4,
                padding: '0 10px',
                borderRadius: 999,
                background: (confirmed ? statusPalette.ok : statusPalette.neutral).bg,
                color: (confirmed ? statusPalette.ok : statusPalette.neutral).fg,
                fontWeight: confirmed ? 600 : 400,
              }}
            >
              <span aria-hidden="true">{confirmed ? `${name} ✓` : `${name} ${texts.aiMark}`}</span>
            </span>
          ))
        )}
        {confirmed && industries.length > 0 ? (
          <span style={secondary} data-testid="industry-chips-source">
            {texts.source[source]}
          </span>
        ) : null}
        {!editing ? (
          <Space wrap size={8}>
            {!confirmed && industries.length > 0 ? (
              <Button
                size="small"
                type="primary"
                disabled={!canRecord || saving !== null}
                loading={saving === 'confirm'}
                onClick={() => void save('confirm', industries)}
                data-testid="industry-confirm-button"
              >
                {texts.confirm}
              </Button>
            ) : null}
            <Button
              size="small"
              disabled={!canRecord || saving !== null || options.length === 0}
              onClick={() => {
                setError(null);
                // 목록에 없는 옛 값은 고를 수 없으므로 처음 고른 값에서 뺀다.
                setPicked(industries.filter((name) => options.includes(name)));
              }}
              data-testid="industry-edit-button"
            >
              {texts.edit}
            </Button>
          </Space>
        ) : null}
      </div>
      {editing ? (
        <div data-testid="industry-edit" style={{ display: 'grid', gap: 8 }}>
          <Checkbox.Group
            aria-label={texts.groupLabel}
            value={picked}
            onChange={(values) =>
              // 화면에 보이는 순서(설정 순서)로 맞춘다. 서버도 설정 순서로 저장한다.
              setPicked(options.filter((name) => values.includes(name)))
            }
            options={options.map((name) => ({
              label: name,
              value: name,
              disabled: saving !== null || (full && !picked.includes(name)),
            }))}
          />
          <span style={secondary} data-testid="industry-edit-hint">
            {texts.editHint(MAX_INDUSTRIES)}
          </span>
          <Space wrap size={8}>
            <Button
              size="small"
              type="primary"
              disabled={picked.length === 0 || unchanged || saving !== null}
              loading={saving === 'edit'}
              onClick={() => void save('edit', picked)}
              data-testid="industry-save-button"
            >
              {texts.save}
            </Button>
            <Button
              size="small"
              disabled={saving !== null}
              onClick={() => {
                setPicked(null);
                setError(null);
              }}
              data-testid="industry-cancel-button"
            >
              {texts.cancel}
            </Button>
          </Space>
        </div>
      ) : (
        <span style={secondary} data-testid="industry-chips-hint">
          {!canRecord ? texts.pickStaffFirst : options.length === 0 ? texts.noOptions : texts.hint}
        </span>
      )}
      {error ? (
        <span role="alert" data-testid="industry-chips-error" style={{ color: colors.error }}>
          {error}
        </span>
      ) : null}
    </DetailSection>
  );
}
