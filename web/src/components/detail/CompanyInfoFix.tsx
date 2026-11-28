// 상세 "한눈에 › 위치" 줄의 주소·회사 이름 [고치기](#958, PM 결정 2026-11-26. #996 전에는 "한눈에 › 어떤 회사").
// 회사를 직접 넣을 때(#948) 주소·이름을 잘못 적었으면 여기서 고친다. 주소는 모든 회사,
// 회사 이름은 직접 넣은 회사만(공장 자료 회사는 등록된 공식 이름). 누르면 그 자리에 입력칸이 열린다. 모달 없음.
import { useState } from 'react';
import { Button, Input, Space } from 'antd';
import { ApiError, postCompanyInfo } from '../../api/client';
import { companyInfoFixTexts as texts, errorTexts } from '../../labels/ko';
import { colors, typography } from '../../theme/tokens';
import { useFrame } from '../frame/FrameContext';

const secondary = { color: colors.textSecondary, fontSize: typography.fontSizeSecondary } as const;

export interface CompanyInfoFixProps {
  oppId: string;
  address: string | null;
  companyName: string;
  /** 직접 넣은 회사(discoverySource STAFF_ADDED)만 회사 이름을 고친다. */
  canRename: boolean;
  onSaved: () => void;
}

type Field = 'address' | 'name';

export default function CompanyInfoFix({
  oppId,
  address,
  companyName,
  canRename,
  onSaved,
}: CompanyInfoFixProps) {
  const { staffKey, canRecord } = useFrame();
  const [field, setField] = useState<Field | null>(null);
  const [value, setValue] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const current = field === 'name' ? companyName : (address ?? '');
  const trimmed = value.trim();

  function open(next: Field) {
    setError(null);
    setField(next);
    setValue(next === 'name' ? companyName : (address ?? ''));
  }

  async function save() {
    if (!staffKey || !field || trimmed === '') return;
    setSaving(true);
    setError(null);
    try {
      await postCompanyInfo(
        oppId,
        field === 'name' ? { companyName: trimmed } : { address: trimmed },
        staffKey,
      );
      setField(null);
      onSaved();
    } catch (caught) {
      const detail = caught instanceof ApiError ? caught.body.message : errorTexts.network;
      setError(`${texts.saveFailed} (${detail})`);
    } finally {
      setSaving(false);
    }
  }

  if (!field) {
    return (
      <Space wrap size={8} data-testid="company-info-buttons">
        <Button
          size="small"
          type="link"
          style={{ padding: '0 4px', height: 'auto' }}
          disabled={!canRecord}
          onClick={() => open('address')}
          data-testid="company-address-edit-button"
        >
          {address ? texts.editAddress : texts.addAddress}
        </Button>
        {canRename ? (
          <Button
            size="small"
            type="link"
            style={{ padding: '0 4px', height: 'auto' }}
            disabled={!canRecord}
            onClick={() => open('name')}
            data-testid="company-name-edit-button"
          >
            {texts.editName}
          </Button>
        ) : null}
      </Space>
    );
  }
  const label = field === 'name' ? texts.nameLabel : texts.addressLabel;
  return (
    <div data-testid="company-info-edit" style={{ display: 'grid', gap: 8 }}>
      <Input
        aria-label={label}
        value={value}
        maxLength={field === 'name' ? 200 : 300}
        disabled={saving}
        onChange={(event) => setValue(event.target.value)}
        data-testid="company-info-input"
      />
      <span style={secondary}>
        {field === 'name' ? texts.nameHint : texts.addressHint} {texts.contactWarning}
      </span>
      <Space wrap size={8}>
        <Button
          size="small"
          type="primary"
          disabled={saving || trimmed === '' || trimmed === current}
          loading={saving}
          onClick={() => void save()}
          data-testid="company-info-save-button"
        >
          {texts.save}
        </Button>
        <Button
          size="small"
          disabled={saving}
          onClick={() => {
            setField(null);
            setError(null);
          }}
          data-testid="company-info-cancel-button"
        >
          {texts.cancel}
        </Button>
      </Space>
      {error ? (
        <span role="alert" style={{ color: colors.error }} data-testid="company-info-error">
          {error}
        </span>
      ) : null}
    </div>
  );
}
