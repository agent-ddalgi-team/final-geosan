// 상세 우측 상단 [다시 조사](#210, 서버 #304, 계약 C1 `POST /homepage`).
// 지금 주소로 다시 조사하고, 주소가 없는 회사는 서버가 홈페이지 찾기부터 한다(#596, PM 결정 2026-11-12).
// [맞음]·[고치기]는 담당자 할 일을 줄이려고 없앴다(#596). 읽기 거부 때 본문 붙여넣기 칸은 남긴다.
// 실패는 서버 문구를 그대로 보이고(문의 번호는 작게), 종류(kind)로는 모양만 가른다. 모달 없이 인라인이다.
//   ROBOTS_DISALLOW·TERMS_DISALLOW → 본문 붙여넣기 칸 열기 / LLM_LIMIT·SEARCH_LIMIT·USAGE_UNCONFIRMED·LLM_NOT_CONFIGURED → 조사 단추 잠금
//   STALE_VALUE → [새로 불러오기] / UNREACHABLE·TIMEOUT·LLM_FAILED·HOMEPAGE_NOT_FOUND → 단추 그대로(다시 시도 가능)
import { useEffect, useState } from 'react';
import { Button, Input } from 'antd';
import { ApiError, postHomepage } from '../../api/client';
import type { ErrorBody, HomepageRequest } from '../../api/types';
import { errorTexts, homepageControls } from '../../labels/ko';
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
const PASTE_KINDS = new Set(['ROBOTS_DISALLOW', 'TERMS_DISALLOW']);

const secondary = { color: colors.textSecondary, fontSize: typography.fontSizeSecondary } as const;

/**
 * 조사가 끝나면 상세를 새로 불러오는데, 그때 이 부품도 새로 그려져 안내가 사라진다.
 * 그래서 성공 안내는 여기에 맡겨 두었다가 새로 그려진 부품이 한 번 꺼내 보인다.
 */
const pendingNotices = new Map<string, string>();

export interface HomepageControlsProps {
  oppId: string;
  /** 성공했거나 [새로 불러오기]를 누르면 부른다. 상세 화면이 서버에서 다시 읽는다. */
  onReload: () => void;
  /**
   * 다시 조사를 제안할 때 조사한 지 며칠인지(#677). 단추 옆에 안내를 보이고 단추를 강조한다.
   * 알리기만 한다. 누르기 전에는 조사하지 않는다. 제안이 없으면 null.
   */
  suggestDays?: number | null;
}

type Busy = 'research' | null;

export default function HomepageControls({
  oppId,
  onReload,
  suggestDays = null,
}: HomepageControlsProps) {
  const { staffKey, canRecord, config } = useFrame();
  const [busy, setBusy] = useState<Busy>(null);
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteText, setPasteText] = useState('');
  const [pasteError, setPasteError] = useState<string | null>(null);
  const [error, setError] = useState<ErrorBody | null>(null);
  const [notice, setNotice] = useState<string | null>(() => pendingNotices.get(oppId) ?? null);

  useEffect(() => {
    pendingNotices.delete(oppId);
  }, [oppId]);

  const locked = error?.kind ? LOCKING_KINDS.has(error.kind) : false;
  const stale = error?.kind === 'STALE_VALUE';
  const disabled = !canRecord || busy !== null;
  // #719: 서버가 조사용 AI가 꺼져 있다고 알려 주면 누르기 전에 잠근다(눌러도 설정 오류만 나온다).
  // 값을 안 주는 옛 응답이거나 설정을 아직 못 읽었으면 지금처럼 눌리게 둔다.
  const aiOff = config?.research?.aiEnabled === false;
  const researchDisabled = disabled || locked || aiOff;

  async function send(body: HomepageRequest, kind: Exclude<Busy, null>) {
    if (!staffKey) return;
    setBusy(kind);
    setError(null);
    setNotice(null);
    try {
      const envelope = await postHomepage(oppId, body, staffKey);
      const data = envelope.data;
      if ('evidenceCount' in data) {
        pendingNotices.set(
          oppId,
          homepageControls.researched(
            data.evidenceCount,
            data.requirementCandidateCount,
            data.questionCount,
          ),
        );
      }
      onReload();
    } catch (caught) {
      const body =
        caught instanceof ApiError
          ? caught.body
          : { message: errorTexts.network, nextAction: errorTexts.nextActionDefault, ref: '' };
      setError(body);
      if (body.kind && PASTE_KINDS.has(body.kind)) setPasteOpen(true);
    } finally {
      setBusy(null);
    }
  }

  function submitPaste() {
    if (!pasteText.trim()) {
      setPasteError(homepageControls.pasteEmpty);
      return;
    }
    setPasteError(null);
    void send({ pastedText: pasteText }, 'research');
  }

  return (
    <div data-testid="homepage-controls" style={{ display: 'grid', gap: 8, justifyItems: 'end' }}>
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          justifyContent: 'flex-end',
          gap: 8,
        }}
      >
        {suggestDays !== null ? (
          <span style={{ color: colors.text }} data-testid="homepage-suggest-again">
            {homepageControls.suggestAgain(suggestDays)}
          </span>
        ) : null}
        <Button
          type={suggestDays !== null ? 'primary' : 'default'}
          disabled={researchDisabled}
          loading={busy === 'research' && !pasteOpen}
          onClick={() => void send({}, 'research')}
          data-testid="homepage-rerun-button"
        >
          {homepageControls.rerunButton}
        </Button>
        {aiOff ? (
          <span style={secondary} data-testid="homepage-ai-off">
            {homepageControls.aiOff}
          </span>
        ) : null}
        {canRecord ? <MonthSpendLine /> : null}
        {!canRecord ? (
          <span style={secondary} data-testid="homepage-pick-staff">
            {homepageControls.pickStaffFirst}
          </span>
        ) : null}
        {busy === 'research' ? (
          <span role="status" style={secondary} data-testid="homepage-running">
            {homepageControls.running}
          </span>
        ) : null}
        {notice ? (
          <span role="status" style={secondary} data-testid="homepage-notice">
            {notice}
          </span>
        ) : null}
      </div>

      {pasteOpen ? (
        <div style={{ display: 'grid', gap: 4 }} data-testid="homepage-paste-form">
          <label style={{ display: 'grid', gap: 4 }}>
            <span style={secondary}>{homepageControls.pasteLabel}</span>
            <Input.TextArea
              value={pasteText}
              onChange={(event) => setPasteText(event.target.value)}
              placeholder={homepageControls.pastePlaceholder}
              rows={5}
              disabled={busy !== null}
              data-testid="homepage-paste-input"
            />
          </label>
          {pasteError ? (
            <span role="alert" style={{ color: colors.error }} data-testid="homepage-paste-error">
              {pasteError}
            </span>
          ) : null}
          <div>
            <Button
              size="small"
              type="primary"
              disabled={researchDisabled}
              loading={busy === 'research'}
              onClick={submitPaste}
              data-testid="homepage-paste-submit"
            >
              {homepageControls.runWithPaste}
            </Button>
          </div>
        </div>
      ) : null}

      {error ? (
        <div role="alert" style={{ color: colors.error }} data-testid="homepage-error">
          <span data-testid="homepage-error-message">
            {error.message} {error.nextAction}
          </span>
          {locked ? (
            <span style={secondary} data-testid="homepage-locked">
              {' '}
              {homepageControls.locked}
            </span>
          ) : null}
          {stale ? (
            <Button
              type="link"
              size="small"
              onClick={onReload}
              data-testid="homepage-reload-button"
            >
              {homepageControls.reload}
            </Button>
          ) : null}
          {error.ref ? (
            <span style={secondary} data-testid="homepage-error-ref">
              {' '}
              {homepageControls.ref(error.ref)}
            </span>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
