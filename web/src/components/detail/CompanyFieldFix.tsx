// #980(PM 결정 2026-11-28) 상세 "한눈에 › 어떤 회사"의 대표번호·대표명 [고치기].
// 누르면 그 자리에 입력칸이 열린다(모달 없음). 빈 칸으로 저장하면 지운다(지운 값은 자동으로 다시 채우지 않는다).
// 서버가 대표번호는 지역번호로 시작하는지, 대표명은 숫자·@가 없는지 본다(휴대폰은 [상대 담당자 연락처]로 안내).
import { useState } from 'react';
import { Button, Input, Space } from 'antd';
import { ApiError, postCompanyInfo } from '../../api/client';
import { companyFieldFixTexts as texts, errorTexts } from '../../labels/ko';
import { colors, typography } from '../../theme/tokens';
import { useFrame } from '../frame/FrameContext';

const secondary = { color: colors.textSecondary, fontSize: typography.fontSizeSecondary } as const;

export interface CompanyFieldFixProps {
  oppId: string;
  field: 'mainPhone' | 'representativeName';
  value: string | null;
  onSaved: () => void;
}

export default function CompanyFieldFix({ oppId, field, value, onSaved }: CompanyFieldFixProps) {
  const { staffKey, canRecord } = useFrame();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const label = field === 'mainPhone' ? texts.phoneLabel : texts.representativeLabel;
  const testId = field === 'mainPhone' ? 'company-phone-fix' : 'company-representative-fix';

  async function save() {
    if (!staffKey) return;
    setSaving(true);
    setError(null);
    try {
      await postCompanyInfo(oppId, { [field]: draft.trim() }, staffKey);
      setOpen(false);
      onSaved();
    } catch (caught) {
      const detail = caught instanceof ApiError ? caught.body.message : errorTexts.network;
      setError(`${texts.saveFailed} (${detail})`);
    } finally {
      setSaving(false);
    }
  }

  if (!open) {
    return (
      <Button
        size="small"
        type="link"
        style={{ padding: '0 4px', height: 'auto' }}
        disabled={!canRecord}
        onClick={() => {
          setError(null);
          setDraft(value ?? '');
          setOpen(true);
        }}
        data-testid={`${testId}-button`}
      >
        {value ? texts.edit : texts.add}
      </Button>
    );
  }
  return (
    <div data-testid={`${testId}-edit`} style={{ display: 'grid', gap: 6, width: '100%' }}>
      <Input
        aria-label={label}
        value={draft}
        maxLength={field === 'mainPhone' ? 20 : 20}
        disabled={saving}
        onChange={(event) => setDraft(event.target.value)}
        data-testid={`${testId}-input`}
      />
      <span style={secondary}>
        {field === 'mainPhone' ? texts.phoneHint : texts.representativeHint} {texts.clearHint}
      </span>
      <Space size={8}>
        <Button
          size="small"
          type="primary"
          disabled={saving || draft.trim() === (value ?? '')}
          loading={saving}
          onClick={() => void save()}
          data-testid={`${testId}-save`}
        >
          {texts.save}
        </Button>
        <Button
          size="small"
          disabled={saving}
          onClick={() => {
            setOpen(false);
            setError(null);
          }}
          data-testid={`${testId}-cancel`}
        >
          {texts.cancel}
        </Button>
      </Space>
      {error ? (
        <span role="alert" style={{ color: colors.error }} data-testid={`${testId}-error`}>
          {error}
        </span>
      ) : null}
    </div>
  );
}
