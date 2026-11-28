// #980(PM 결정 2026-11-28): 가린 번호를 여는 확인 문구. 체크해야 [확인하고 보기]가 눌린다.
// 서버도 확인(acknowledged true) 없이는 값을 주지 않고, 열 때마다 열람 기록을 남긴다.
// 받은 값은 이 화면에서만 보이고 저장하지 않는다(새로고침하면 다시 가림). 모달 없이 그 자리에 연다.
import { useState } from 'react';
import { Button, Checkbox, Space } from 'antd';
import { ApiError } from '../../api/client';
import { errorTexts, revealTexts as texts } from '../../labels/ko';
import { colors, typography } from '../../theme/tokens';

export interface RevealConfirmProps {
  /** 확인 문구에 체크하고 누르면 부른다. 실패하면 오류를 던진다. */
  onReveal: () => Promise<void>;
  onCancel: () => void;
  testId?: string;
}

export default function RevealConfirm({
  onReveal,
  onCancel,
  testId = 'reveal',
}: RevealConfirmProps) {
  const [checked, setChecked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function reveal() {
    setBusy(true);
    setError(null);
    try {
      await onReveal();
    } catch (caught) {
      const detail = caught instanceof ApiError ? caught.body.message : errorTexts.network;
      setError(`${texts.failed} (${detail})`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div data-testid={`${testId}-confirm`} style={{ display: 'grid', gap: 6, marginTop: 4 }}>
      <Checkbox
        checked={checked}
        disabled={busy}
        onChange={(event) => setChecked(event.target.checked)}
        data-testid={`${testId}-ack`}
      >
        <span style={{ fontSize: typography.fontSizeSecondary }}>{texts.acknowledge}</span>
      </Checkbox>
      <Space size={8}>
        <Button
          size="small"
          type="primary"
          disabled={!checked || busy}
          loading={busy}
          onClick={() => void reveal()}
          data-testid={`${testId}-open-button`}
        >
          {texts.confirm}
        </Button>
        <Button size="small" disabled={busy} onClick={onCancel} data-testid={`${testId}-cancel`}>
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
