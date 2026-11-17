// 상세 "한눈에 › 공정" 옆 [고치기](#847, PM 결정 2026-11-17).
// 거산 쪽 확인 질문을 통화에서 묻는 대신, 나중에 확인해 다르면 여기서 고친다.
// 누르면 그 자리에서 거산 공정 목록이 체크칸으로 펴지고, 고른 목록이 그 회사의 확정 공정 전체가 된다.
// 저장하면 서버가 다시 평가하므로 상세를 새로 불러오게 알린다. 모달 없음.
import { useState } from 'react';
import { Button, Checkbox, Space } from 'antd';
import { ApiError, postProcesses } from '../../api/client';
import { errorTexts, processFixTexts as texts } from '../../labels/ko';
import { colors, typography } from '../../theme/tokens';
import { useFrame } from '../frame/FrameContext';

const secondary = { color: colors.textSecondary, fontSize: typography.fontSizeSecondary } as const;

export interface ProcessOption {
  code: string;
  name: string;
}

export interface ProcessFixProps {
  oppId: string;
  /** 지금 확정 공정 코드. */
  current: string[];
  /** 거산 공정 목록(질문 파일의 공정 고르기 보기). 비어 있으면 [고치기]를 잠근다. */
  options: ProcessOption[];
  onSaved: () => void;
}

export default function ProcessFix({ oppId, current, options, onSaved }: ProcessFixProps) {
  const { staffKey, canRecord } = useFrame();
  const [picked, setPicked] = useState<string[] | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const editing = picked !== null;
  const unchanged =
    picked !== null &&
    picked.length === current.length &&
    picked.every((code) => current.includes(code));

  async function save() {
    if (!staffKey || !picked || picked.length === 0) return;
    setSaving(true);
    setError(null);
    try {
      await postProcesses(oppId, picked, staffKey);
      setPicked(null);
      onSaved();
    } catch (caught) {
      const detail = caught instanceof ApiError ? caught.body.message : errorTexts.network;
      setError(`${texts.saveFailed} (${detail})`);
    } finally {
      setSaving(false);
    }
  }

  if (!editing) {
    return (
      <>
        {' '}
        <Button
          size="small"
          disabled={!canRecord || options.length === 0}
          onClick={() => {
            setError(null);
            setPicked(current.filter((code) => options.some((option) => option.code === code)));
          }}
          data-testid="process-edit-button"
        >
          {texts.edit}
        </Button>
      </>
    );
  }
  return (
    <div data-testid="process-edit" style={{ display: 'grid', gap: 8, marginTop: 8 }}>
      <Checkbox.Group
        aria-label={texts.groupLabel}
        value={picked}
        onChange={(values) =>
          setPicked(options.map((option) => option.code).filter((code) => values.includes(code)))
        }
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
          disabled={saving || picked.length === 0 || unchanged}
          loading={saving}
          onClick={() => void save()}
          data-testid="process-save-button"
        >
          {texts.save}
        </Button>
        <Button
          size="small"
          disabled={saving}
          onClick={() => {
            setPicked(null);
            setError(null);
          }}
          data-testid="process-cancel-button"
        >
          {texts.cancel}
        </Button>
      </Space>
      {error ? (
        <span role="alert" style={{ color: colors.error }} data-testid="process-save-error">
          {error}
        </span>
      ) : null}
    </div>
  );
}
