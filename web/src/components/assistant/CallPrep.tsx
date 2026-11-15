// 상세 "기록 남기기" 맨 위의 "영업 코치 · 통화 전" 칸(#742, #750 PM 결정 2026-11-15).
// 지난 통화 뒤 영업 코치가 [보내기] 한 번에 함께 준 "다음 통화에 물어볼 것"을 AI 호출 없이 보인다.
// 예: "11/15 통화 뒤 코치 정리 · 다음 통화에 물어볼 것 — 견적에 넣을 수량을 물어보세요."
// 예전 [통화 준비 💰] 단추(#680)는 같은 기록으로 AI를 한 번 더 부르고 단추가 늘어 화면에서 뺐다.
// 영업 기록 스위치가 꺼져 있고 남긴 정리도 없으면 아무것도 보이지 않는다.
// 읽는 곳의 단추는 [목록으로]·[관심]·[다시 조사]뿐이라(#674) 구분 줄 아래, 전화 기록을 적는 칸 바로 위에 둔다.
import { assistantConfigOf } from '../../api/assistant';
import type { CallPrepNote } from '../../api/types';
import { coachTexts } from '../../labels/ko';
import { colors, typography } from '../../theme/tokens';
import { formatMonthDay } from '../../utils/time';
import { useFrame } from '../frame/FrameContext';

const secondary = { color: colors.textSecondary, fontSize: typography.fontSizeSecondary } as const;

export default function CallPrep({ prep }: { prep: CallPrepNote | null }) {
  const { config } = useFrame();
  const enabled = assistantConfigOf(config)?.enabled === true;
  const lines = prep?.lines ?? [];
  if (!enabled && lines.length === 0) return null;

  return (
    <div data-testid="call-prep" style={{ display: 'grid', gap: 4, marginBottom: 12 }}>
      <span data-testid="call-prep-title" style={{ fontWeight: 600 }}>
        {coachTexts.beforeCallTitle}
      </span>
      {prep && lines.length > 0 ? (
        <>
          <span data-testid="call-prep-date" style={secondary}>
            {coachTexts.prepTitle(formatMonthDay(prep.at) ?? prep.at)}
          </span>
          <ul data-testid="call-prep-lines" style={{ margin: 0, paddingLeft: 20 }}>
            {lines.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </>
      ) : (
        <span data-testid="call-prep-none" style={secondary}>
          {coachTexts.prepNone}
        </span>
      )}
    </div>
  );
}
