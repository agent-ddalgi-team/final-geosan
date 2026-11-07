// 상세 머리 홈페이지 줄의 단추(#210, 서버 #304, 계약 C1 `POST /homepage`): [맞음]·[고치기]·[다시 조사].
// [맞음]은 외부 호출 없이 확인 상태만 저장한다. [고치기]는 주소를 바꿔 조사하고, [다시 조사]는 지금 주소로 다시 조사한다.
// 실패는 서버 문구를 그대로 보이고(문의 번호는 작게), 종류(kind)로는 모양만 가른다. 모달 없이 인라인이다.
//   ROBOTS_DISALLOW·TERMS_DISALLOW → 본문 붙여넣기 칸 열기 / LLM_LIMIT·SEARCH_LIMIT·USAGE_UNCONFIRMED·LLM_NOT_CONFIGURED → 조사 단추 잠금
//   STALE_VALUE → [새로 불러오기] / UNREACHABLE·TIMEOUT·LLM_FAILED → 단추 그대로(다시 시도 가능)
import { useEffect, useState } from 'react';
import { Button, Input } from 'antd';
import { ApiError, postHomepage } from '../../api/client';
import type { ErrorBody, HomepageRequest, HomepageStatus } from '../../api/types';
import { errorTexts, homepageControls } from '../../labels/ko';
import { colors, typography } from '../../theme/tokens';
import { useFrame } from '../frame/FrameContext';

/** 다시 눌러도 풀리지 않는 실패 종류. 조사 단추를 잠근다([맞음]은 외부 호출이 없어 그대로 누를 수 있다). */
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
  /** http(s)로 확인된 지금 홈페이지 주소. 없으면 [맞음]·[다시 조사]는 없고 [주소 넣기]만 있다. */
  homepageUrl: string | null;
  status?: HomepageStatus | null;
  /** 성공했거나 [새로 불러오기]를 누르면 부른다. 상세 화면이 서버에서 다시 읽는다. */
  onReload: () => void;
}

type Busy = 'confirm' | 'research' | null;

export default function HomepageControls({
  oppId,
  homepageUrl,
  status,
  onReload,
}: HomepageControlsProps) {
  const { staffKey, canRecord } = useFrame();
  const [busy, setBusy] = useState<Busy>(null);
  const [editing, setEditing] = useState(false);
  const [urlText, setUrlText] = useState(homepageUrl ?? '');
  const [urlError, setUrlError] = useState<string | null>(null);
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
  const researchDisabled = disabled || locked;
  const showConfirm = homepageUrl !== null && status !== 'CONFIRMED';

  async function send(body: HomepageRequest, kind: Exclude<Busy, null>) {
    if (!staffKey) return;
    setBusy(kind);
    setError(null);
    setNotice(null);
    try {
      const envelope = await postHomepage(oppId, body, staffKey);
      const data = envelope.data;
      pendingNotices.set(
        oppId,
        'evidenceCount' in data
          ? homepageControls.researched(
              data.evidenceCount,
              data.requirementCandidateCount,
              data.questionCount,
            )
          : homepageControls.confirmed,
      );
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

  function submitUrl() {
    const value = urlText.trim();
    if (!/^https?:\/\/\S+$/.test(value)) {
      setUrlError(homepageControls.invalidUrl);
      return;
    }
    setUrlError(null);
    void send({ url: value }, 'research');
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
    <div data-testid="homepage-controls" style={{ display: 'grid', gap: 8 }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8 }}>
        {showConfirm ? (
          <Button
            size="small"
            disabled={disabled}
            loading={busy === 'confirm'}
            onClick={() => void send({ confirmOnly: true }, 'confirm')}
            data-testid="homepage-confirm-button"
          >
            {homepageControls.confirmButton}
          </Button>
        ) : null}
        <Button
          size="small"
          disabled={researchDisabled}
          onClick={() => {
            setUrlText(homepageUrl ?? '');
            setUrlError(null);
            setEditing((open) => !open);
          }}
          data-testid="homepage-edit-button"
        >
          {homepageUrl ? homepageControls.editButton : homepageControls.addButton}
        </Button>
        {homepageUrl ? (
          <Button
            size="small"
            disabled={researchDisabled}
            loading={busy === 'research' && !editing && !pasteOpen}
            onClick={() => void send({}, 'research')}
            data-testid="homepage-rerun-button"
          >
            {homepageControls.rerunButton}
          </Button>
        ) : null}
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

      {editing ? (
        <div style={{ display: 'grid', gap: 4 }} data-testid="homepage-edit-form">
          <label style={{ display: 'grid', gap: 4 }}>
            <span style={secondary}>{homepageControls.urlLabel}</span>
            <Input
              value={urlText}
              onChange={(event) => setUrlText(event.target.value)}
              onPressEnter={submitUrl}
              placeholder={homepageControls.urlPlaceholder}
              disabled={busy !== null}
              data-testid="homepage-url-input"
            />
          </label>
          {urlError ? (
            <span role="alert" style={{ color: colors.error }} data-testid="homepage-url-error">
              {urlError}
            </span>
          ) : null}
          <div style={{ display: 'flex', gap: 8 }}>
            <Button
              size="small"
              type="primary"
              disabled={researchDisabled}
              loading={busy === 'research'}
              onClick={submitUrl}
              data-testid="homepage-url-submit"
            >
              {homepageControls.runWithUrl}
            </Button>
            <Button size="small" onClick={() => setEditing(false)} disabled={busy !== null}>
              {homepageControls.cancel}
            </Button>
          </div>
        </div>
      ) : null}

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
