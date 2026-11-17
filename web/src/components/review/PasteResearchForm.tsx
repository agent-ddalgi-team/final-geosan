// 검토사항 자료 줄의 [붙여넣고 조사] 인라인 입력(#260, PM 결정 2026-11-04): 출처 주소 + 공개 본문.
// 서버는 기존 홈페이지 조사 요청(계약 C1 `POST /homepage`, url + pastedText)을 그대로 쓴다. 새 API는 없다.
// 붙여넣은 본문은 외부 AI로 나가므로 "공개 자료만" 안내를 항상 보인다. 모달 없이 줄 아래에 열린다.
// 실패는 서버 문구를 그대로 보이고(문의 번호는 작게), 종류(kind)로는 모양만 가른다.
//   LLM_LIMIT·SEARCH_LIMIT·USAGE_UNCONFIRMED·LLM_NOT_CONFIGURED → 조사 단추 잠금 / STALE_VALUE → [새로 불러오기]
//   그 밖(UNREACHABLE·TIMEOUT·LLM_FAILED·ROBOTS·TERMS)은 단추 그대로 두어 다시 시도할 수 있다.
import { useState } from 'react';
import { Button, Input } from 'antd';
import { ApiError, postHomepage } from '../../api/client';
import type { ErrorBody } from '../../api/types';
import { errorTexts, homepageControls, reviewArea } from '../../labels/ko';
import { colors, typography } from '../../theme/tokens';
import MonthSpendLine from '../common/MonthSpendLine';
import { useFrame } from '../frame/FrameContext';

/** 다시 눌러도 풀리지 않는 실패 종류. 조사 단추를 잠근다. */
const LOCKING_KINDS = new Set([
  'LLM_LIMIT',
  'SEARCH_LIMIT',
  'USAGE_UNCONFIRMED',
  'LLM_NOT_CONFIGURED',
]);

const secondary = { color: colors.textSecondary, fontSize: typography.fontSizeSecondary } as const;

export interface PasteResearchFormProps {
  oppId: string;
  /** 확정된 홈페이지 주소가 있으면 출처 칸에 미리 채운다. */
  defaultUrl: string | null;
  /** 조사가 끝났을 때 알린다. 성공 문구와 함께 부른다(상세를 새로 불러오게). */
  onDone: (notice: string) => void;
  /** 조사 중 여부가 바뀔 때 알린다(다른 줄의 단추를 잠그려고). */
  onBusyChange: (busy: boolean) => void;
  onCancel: () => void;
  /** [새로 불러오기](그 사이 정보가 바뀐 경우). */
  onReload: () => void;
}

export default function PasteResearchForm({
  oppId,
  defaultUrl,
  onDone,
  onBusyChange,
  onCancel,
  onReload,
}: PasteResearchFormProps) {
  const { staffKey, canRecord } = useFrame();
  const [urlText, setUrlText] = useState(defaultUrl ?? '');
  const [pasteText, setPasteText] = useState('');
  const [busy, setBusy] = useState(false);
  const [inputError, setInputError] = useState<string | null>(null);
  const [error, setError] = useState<ErrorBody | null>(null);

  const locked = error?.kind ? LOCKING_KINDS.has(error.kind) : false;
  const stale = error?.kind === 'STALE_VALUE';
  const disabled = !canRecord || !staffKey || busy;

  async function submit() {
    const url = urlText.trim();
    if (!/^https?:\/\/\S+$/.test(url)) {
      setInputError(reviewArea.pasteInvalidUrl);
      return;
    }
    if (!pasteText.trim()) {
      setInputError(reviewArea.pasteEmpty);
      return;
    }
    if (!staffKey) return;
    setInputError(null);
    setError(null);
    setBusy(true);
    onBusyChange(true);
    try {
      const envelope = await postHomepage(oppId, { url, pastedText: pasteText }, staffKey);
      const data = envelope.data;
      // 조사 응답이면 건수 문구, 아니면(맞음 응답 모양) 기본 문구. 이 요청은 항상 조사 응답을 받는다.
      const notice =
        'evidenceCount' in data
          ? homepageControls.researched(
              data.evidenceCount,
              data.requirementCandidateCount,
              data.questionCount,
            )
          : homepageControls.confirmed;
      onDone(notice);
    } catch (caught) {
      setError(
        caught instanceof ApiError
          ? caught.body
          : { message: errorTexts.network, nextAction: errorTexts.nextActionDefault, ref: '' },
      );
    } finally {
      setBusy(false);
      onBusyChange(false);
    }
  }

  return (
    <div
      data-testid="review-paste-editor"
      style={{ marginLeft: 28, display: 'grid', gap: 6, maxWidth: 560 }}
    >
      <label style={{ display: 'grid', gap: 4 }}>
        <span style={secondary}>{reviewArea.pasteUrlLabel}</span>
        <Input
          value={urlText}
          onChange={(event) => setUrlText(event.target.value)}
          placeholder={reviewArea.pasteUrlPlaceholder}
          disabled={busy}
          data-testid="review-paste-url"
        />
      </label>
      <label style={{ display: 'grid', gap: 4 }}>
        <span style={secondary}>{reviewArea.pasteTextLabel}</span>
        <Input.TextArea
          value={pasteText}
          onChange={(event) => setPasteText(event.target.value)}
          placeholder={reviewArea.pasteTextPlaceholder}
          rows={5}
          disabled={busy}
          data-testid="review-paste-text"
        />
      </label>
      <span style={secondary} data-testid="review-paste-hint">
        {reviewArea.pasteHint}
      </span>
      {inputError ? (
        <span role="alert" style={{ color: colors.error }} data-testid="review-paste-input-error">
          {inputError}
        </span>
      ) : null}
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8 }}>
        <Button
          type="primary"
          size="small"
          loading={busy}
          disabled={disabled || locked}
          onClick={() => void submit()}
          data-testid="review-paste-submit"
        >
          {reviewArea.pasteSubmit}
        </Button>
        <Button size="small" disabled={busy} onClick={onCancel} data-testid="review-paste-cancel">
          {reviewArea.pasteCancel}
        </Button>
        <MonthSpendLine />
        {busy ? (
          <span role="status" style={secondary} data-testid="review-paste-running">
            {reviewArea.pasteRunning}
          </span>
        ) : null}
      </div>
      {error ? (
        <div role="alert" style={{ color: colors.error }} data-testid="review-paste-error">
          <span data-testid="review-paste-error-message">
            {error.message} {error.nextAction}
          </span>
          {locked ? (
            <span style={secondary} data-testid="review-paste-locked">
              {' '}
              {reviewArea.pasteLocked}
            </span>
          ) : null}
          {stale ? (
            <Button type="link" size="small" onClick={onReload} data-testid="review-paste-reload">
              {reviewArea.pasteReload}
            </Button>
          ) : null}
          {error.ref ? (
            <span style={secondary} data-testid="review-paste-error-ref">
              {' '}
              {homepageControls.ref(error.ref)}
            </span>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
