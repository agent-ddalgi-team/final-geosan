// 상세 "기록 남기기" 맨 위의 [통화 준비 💰] 단추(#680): 누르면 그 아래에 한두 문장과 물어볼 것 2~3개가 펴진다.
// 예: "지금 도금을 외주로 주는지부터 확인해 보세요. - 외주처를 바꿀 생각이 있나요? …"
// 서버는 이 회사의 고른 값과 비슷한 회사(같은 공정·산업)의 건수 요약만 AI에 보낸다. 메모 글은 보내지 않고 아무 값도 바꾸지 않는다.
// 읽는 곳의 단추는 [목록으로]·[관심]·[다시 조사]뿐이라(#674) 구분 줄 아래, 전화 기록을 적는 칸 바로 위에 둔다.
// 설정을 못 읽었거나 스위치가 꺼져 있으면 단추를 보이지 않는다(꺼짐 안내는 대시보드 질문 칸 자리에 있다).
import { useState } from 'react';
import { Button } from 'antd';
import { assistantConfigOf, postCallPrep } from '../../api/assistant';
import type { AssistantAnswer } from '../../api/assistant';
import { ApiError } from '../../api/client';
import { assistantTexts as texts, errorTexts } from '../../labels/ko';
import { colors, typography } from '../../theme/tokens';
import { useFrame } from '../frame/FrameContext';
import AssistantAnswerBox from './AssistantAnswerBox';

const secondary = { color: colors.textSecondary, fontSize: typography.fontSizeSecondary } as const;

export default function CallPrep({ oppId }: { oppId: string }) {
  const { config, staffKey, canRecord } = useFrame();
  const settings = assistantConfigOf(config);
  const [asking, setAsking] = useState(false);
  const [answer, setAnswer] = useState<AssistantAnswer | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (!settings?.enabled) return null;

  const prepare = async () => {
    if (!staffKey || !canRecord || asking) return;
    setAsking(true);
    setError(null);
    setAnswer(null);
    try {
      const envelope = await postCallPrep(oppId, staffKey);
      setAnswer(envelope.data);
    } catch (caught) {
      const detail = caught instanceof ApiError ? caught.body.message : errorTexts.network;
      setError(`${texts.callPrepFailed} (${detail})`);
    } finally {
      setAsking(false);
    }
  };

  return (
    <div data-testid="call-prep" style={{ display: 'grid', gap: 8, marginBottom: 12 }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8 }}>
        <Button
          data-testid="call-prep-button"
          onClick={prepare}
          loading={asking}
          disabled={!canRecord}
        >
          {texts.callPrepButton}
        </Button>
        <span data-testid="call-prep-hint" style={secondary}>
          {canRecord ? texts.callPrepHint : texts.pickStaffFirst}
        </span>
      </div>
      {error ? (
        <p data-testid="call-prep-error" role="alert" style={{ margin: 0, color: colors.error }}>
          {error}
        </p>
      ) : null}
      {answer ? <AssistantAnswerBox answer={answer} /> : null}
    </div>
  );
}
