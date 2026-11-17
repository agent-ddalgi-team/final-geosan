// 상세 "기록 남기기" 맨 위의 "영업 코치 · 통화 전" 칸(#742, #750 PM 결정 2026-11-15).
// 지난 통화 뒤 영업 코치가 [보내기] 한 번에 함께 준 "다음 통화에 물어볼 것"을 AI 호출 없이 보인다.
// 예: "11/15 통화 뒤 코치 정리 · 다음 통화에 물어볼 것 — 견적에 넣을 수량을 물어보세요."
// 예전 [통화 준비 💰] 단추(#680)는 같은 기록으로 AI를 한 번 더 부르고 단추가 늘어 화면에서 뺐다.
// #847: 남긴 정리가 없으면 아무것도 보이지 않는다(전에는 "영업 코치 · 통화 전" 제목과 [보내기] 안내 한 줄이 늘 보였다).
// 정리가 있으면 "11/15 통화 뒤 코치 정리 · 다음 통화에 물어볼 것" 한 줄이 제목이다.
// 읽는 곳의 단추는 [목록으로]·[관심]·[다시 조사]뿐이라(#674) 구분 줄 아래, 전화 기록을 적는 칸 바로 위에 둔다.
import type { CallPrepNote } from '../../api/types';
import { coachTexts } from '../../labels/ko';
import { formatMonthDay } from '../../utils/time';

export default function CallPrep({ prep }: { prep: CallPrepNote | null }) {
  const lines = prep?.lines ?? [];
  if (!prep || lines.length === 0) return null;

  return (
    <div data-testid="call-prep" style={{ display: 'grid', gap: 4, marginBottom: 12 }}>
      <span data-testid="call-prep-date" style={{ fontWeight: 600 }}>
        {coachTexts.prepTitle(formatMonthDay(prep.at) ?? prep.at)}
      </span>
      <ul data-testid="call-prep-lines" style={{ margin: 0, paddingLeft: 20 }}>
        {lines.map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>
    </div>
  );
}
