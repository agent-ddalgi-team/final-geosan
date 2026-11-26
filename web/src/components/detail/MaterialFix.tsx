// 상세 "한눈에 › 소재" 옆 [고치기](#958, PM 결정 2026-11-26).
// 회사를 직접 넣었거나 조사가 소재를 못 찾았을 때, 통화에서 들은 부품 소재를 넣는다.
// 소재는 회사당 하나이고 서버가 확정 공정 모두에 적용한 뒤 다시 평가한다. 공정이 정해지기 전이면
// [고치기]를 눌러도 고르는 칸 대신 "공정을 먼저 골라 주세요"를 보인다. 모달 없음.
import { useState } from 'react';
import { Button, Radio, Space } from 'antd';
import { ApiError, postMaterial } from '../../api/client';
import { errorTexts, materialFixTexts as texts } from '../../labels/ko';
import { colors, typography } from '../../theme/tokens';
import { useFrame } from '../frame/FrameContext';

const secondary = { color: colors.textSecondary, fontSize: typography.fontSizeSecondary } as const;

export interface MaterialOption {
  code: string;
  name: string;
}

export interface MaterialFixProps {
  oppId: string;
  /** 지금 소재 코드(확정 공정에 적용된 것). 없으면 null. */
  current: string | null;
  /** 확정 공정이 있는가. 없으면 고르는 칸 대신 안내를 보인다. */
  hasProcess: boolean;
  /** 거산 처리 소재(GET /config materialOptions). 비어 있으면 [고치기]를 잠근다. */
  options: MaterialOption[];
  onSaved: () => void;
}

export default function MaterialFix({
  oppId,
  current,
  hasProcess,
  options,
  onSaved,
}: MaterialFixProps) {
  const { staffKey, canRecord } = useFrame();
  const [open, setOpen] = useState(false);
  const [picked, setPicked] = useState<string | null>(current);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    if (!staffKey || !picked) return;
    setSaving(true);
    setError(null);
    try {
      await postMaterial(oppId, picked, staffKey);
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
      <>
        {' '}
        <Button
          size="small"
          disabled={!canRecord || options.length === 0}
          onClick={() => {
            setError(null);
            setPicked(current);
            setOpen(true);
          }}
          data-testid="material-edit-button"
        >
          {texts.edit}
        </Button>
      </>
    );
  }
  const close = (
    <Button
      size="small"
      disabled={saving}
      onClick={() => {
        setOpen(false);
        setError(null);
      }}
      data-testid="material-cancel-button"
    >
      {texts.cancel}
    </Button>
  );
  if (!hasProcess) {
    return (
      <div data-testid="material-need-process" style={{ display: 'grid', gap: 8, marginTop: 8 }}>
        <span style={secondary}>{texts.needProcess}</span>
        <div>{close}</div>
      </div>
    );
  }
  return (
    <div data-testid="material-edit" style={{ display: 'grid', gap: 8, marginTop: 8 }}>
      <Radio.Group
        aria-label={texts.groupLabel}
        value={picked}
        onChange={(event) => setPicked(event.target.value as string)}
        options={options.map((option) => ({
          label: option.name,
          value: option.code,
          disabled: saving,
        }))}
      />
      <span style={secondary}>{texts.hint}</span>
      <Space wrap size={8}>
        <Button
          size="small"
          type="primary"
          disabled={saving || !picked || picked === current}
          loading={saving}
          onClick={() => void save()}
          data-testid="material-save-button"
        >
          {texts.save}
        </Button>
        {close}
      </Space>
      {error ? (
        <span role="alert" style={{ color: colors.error }} data-testid="material-save-error">
          {error}
        </span>
      ) : null}
    </div>
  );
}
