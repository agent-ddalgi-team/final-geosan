// [관심] 단추(#357): 목록 카드와 상세 머리에서 같은 부품을 쓴다. 관심은 영업 단계가 아니라 켜고 끄는 표시다(약속 v3 #356).
// 꺼짐 "관심" / 켜짐 "관심 기업"을 글자·색·굵기와 aria-pressed로 알린다. 팀이 함께 쓰는 값이다.
// 기록(메모·영업 기록·검토 의견)이 있는 회사는 서버가 끄기를 422로 거부하고, 그때 서버 문구를 단추 옆에 그대로 보인다.
// 담당자를 고르기 전·보기 전용은 단추가 잠긴다.
import { useState } from 'react';
import { Button } from 'antd';
import { ApiError, putBookmark } from '../../api/client';
import type { BookmarkRecord } from '../../api/types';
import { bookmarkTexts, errorTexts, recordsArea } from '../../labels/ko';
import { colors, typography } from '../../theme/tokens';
import { useFrame } from '../frame/FrameContext';

export interface BookmarkButtonProps {
  oppId: string;
  /** 서버가 가진 관심 표시. 한 번도 켠 적이 없으면 null. */
  bookmark: BookmarkRecord | null;
  /** 켜거나 끄는 저장이 끝나면 서버가 돌려준 값을 알린다. */
  onChanged: (bookmark: BookmarkRecord) => void;
}

/** 서버가 끄기를 거부했을 때는 두 문장(이유, 다음 할 일)을 그대로, 그 밖의 실패는 한 줄로 보인다. */
type Problem =
  { refused: true; message: string; nextAction: string } | { refused: false; text: string };

export default function BookmarkButton({ oppId, bookmark, onChanged }: BookmarkButtonProps) {
  const { staffKey, canRecord } = useFrame();
  const [saving, setSaving] = useState(false);
  const [problem, setProblem] = useState<Problem | null>(null);
  const active = bookmark?.active === true;

  async function toggle() {
    if (!staffKey) return;
    setSaving(true);
    setProblem(null);
    try {
      const envelope = await putBookmark(
        oppId,
        { active: !active, expectedVersion: bookmark?.version ?? null },
        staffKey,
      );
      onChanged(envelope.data);
    } catch (caught) {
      if (caught instanceof ApiError && caught.status === 422) {
        setProblem({
          refused: true,
          message: caught.body.message,
          nextAction: caught.body.nextAction,
        });
      } else {
        const detail = caught instanceof ApiError ? caught.body.message : errorTexts.network;
        setProblem({ refused: false, text: `${recordsArea.saveFailed} (${detail})` });
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <span
      data-testid="bookmark-area"
      style={{ display: 'inline-flex', flexWrap: 'wrap', alignItems: 'center', gap: 8 }}
    >
      <Button
        type={active ? 'primary' : 'default'}
        aria-pressed={active}
        disabled={!canRecord}
        loading={saving}
        onClick={() => void toggle()}
        style={{ fontWeight: active ? 700 : 400 }}
        data-testid="bookmark-button"
      >
        {active ? bookmarkTexts.on : bookmarkTexts.off}
      </Button>
      {!canRecord ? (
        <span
          data-testid="bookmark-pick-staff-text"
          style={{ color: colors.textSecondary, fontSize: typography.fontSizeSecondary }}
        >
          {bookmarkTexts.pickStaffFirst}
        </span>
      ) : null}
      {problem ? (
        <span
          role="alert"
          data-testid="bookmark-error"
          style={{ color: colors.error, display: 'inline-grid', gap: 2 }}
        >
          {problem.refused ? (
            <>
              <span data-testid="bookmark-refused-message">{problem.message}</span>
              <span data-testid="bookmark-refused-next">{problem.nextAction}</span>
            </>
          ) : (
            problem.text
          )}
        </span>
      ) : null}
    </span>
  );
}
