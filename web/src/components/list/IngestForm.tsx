// 후보 가져오기 조건 칸(#316, 결정 2026-11-05): 공정(1개 이상)·지역·산업을 고르고 [새 후보 가져오기]를 누른다.
// 선택지는 밖에서 넘겨받는다(설정 값이라 코드에 직접 쓰지 않는다). 모달 없이 인라인이다.
// 누르면 서버가 회차를 만든 직후 바로 응답하고(POST /ingest), 진행은 목록 머리 수집 요약이 서버에서 다시 읽어 보인다.
// 보기 전용(viewer)이면 통째로 숨기고, 담당자를 고르기 전에는 잠근다. 이미 가져오는 중이면 잠근다.
import { useState } from 'react';
import { Button } from 'antd';
import { ApiError, postIngest } from '../../api/client';
import type { IngestRequest } from '../../api/types';
import { candidateSearch, errorTexts } from '../../labels/ko';
import { colors, typography } from '../../theme/tokens';
import { useFrame, VIEWER_KEY } from '../frame/FrameContext';

/** 조건 칸의 선택지. 서버 설정(공정 목록·`ingestion.regions`·`industries`)에서 온 값이다. */
export interface IngestOptions {
  processes: { code: string; name: string }[];
  regions: string[];
  industries: string[];
}

export interface IngestFormProps {
  options: IngestOptions;
  /** 서버가 지금 가져오는 중이라고 알리면 true(meta.latestIngest.status RUNNING). 단추를 잠근다. */
  running: boolean;
  /** 요청이 받아들여졌거나 이미 가져오는 중(409)이면 부른다. 목록이 서버에서 진행을 다시 읽는다. */
  onStarted: () => void;
}

type Notice = { kind: 'ok' | 'error'; text: string } | null;

function toggled(list: string[], value: string): string[] {
  return list.includes(value) ? list.filter((v) => v !== value) : [...list, value];
}

const fieldsetStyle = { border: 0, margin: 0, padding: 0, minWidth: 0 } as const;
const legendStyle = {
  padding: 0,
  marginBottom: 4,
  color: colors.textSecondary,
  fontSize: typography.fontSizeSecondary,
} as const;

interface CheckGroupProps {
  legend: string;
  hint: string;
  items: { value: string; label: string }[];
  selected: string[];
  onToggle: (value: string) => void;
  testId: string;
}

function CheckGroup({ legend, hint, items, selected, onToggle, testId }: CheckGroupProps) {
  return (
    <fieldset style={fieldsetStyle} data-testid={testId}>
      <legend style={legendStyle}>
        {legend} <span style={{ color: colors.textDimmed }}>· {hint}</span>
      </legend>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 16px' }}>
        {items.map((item) => (
          <label key={item.value} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <input
              type="checkbox"
              checked={selected.includes(item.value)}
              onChange={() => onToggle(item.value)}
              data-testid={`${testId}-${item.value}`}
            />
            {item.label}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

export default function IngestForm({ options, running, onStarted }: IngestFormProps) {
  const { staffKey, canRecord } = useFrame();
  const [processes, setProcesses] = useState<string[]>([]);
  const [regions, setRegions] = useState<string[]>([]);
  const [industries, setIndustries] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);

  // 보기 전용 계정에는 단추 자체를 보이지 않는다(실수 방지, FR14.1).
  if (staffKey === VIEWER_KEY) return null;

  async function submit() {
    if (!staffKey || !canRecord || processes.length === 0) return;
    // 서버에는 화면에서 고른 순서가 아니라 선택지 순서대로 보낸다(같은 조건이면 같은 요청).
    const order = <T,>(all: T[], picked: string[], key: (item: T) => string) =>
      all.map(key).filter((value) => picked.includes(value));
    const body: IngestRequest = {
      processCodes: order(options.processes, processes, (p) => p.code),
      ...(regions.length > 0 ? { regions: order(options.regions, regions, (r) => r) } : {}),
      ...(industries.length > 0
        ? { industries: order(options.industries, industries, (i) => i) }
        : {}),
    };
    setSubmitting(true);
    setNotice(null);
    try {
      await postIngest(body, staffKey);
      setNotice({ kind: 'ok', text: candidateSearch.started });
      onStarted();
    } catch (caught) {
      if (caught instanceof ApiError) {
        if (caught.status === 409) {
          // 다른 사람이 먼저 눌렀다. 진행 표시를 다시 읽어 지금 상태를 보인다.
          setNotice({ kind: 'error', text: candidateSearch.alreadyRunning });
          onStarted();
        } else if (caught.status === 503) {
          setNotice({ kind: 'error', text: candidateSearch.sourceFailed });
        } else if (caught.status === 400) {
          setNotice({
            kind: 'error',
            text: `${candidateSearch.invalidCondition} (${caught.body.message})`,
          });
        } else if (caught.status === 403) {
          setNotice({ kind: 'error', text: candidateSearch.pickStaffFirst });
        } else {
          setNotice({
            kind: 'error',
            text: `${candidateSearch.startFailed} (${caught.body.message})`,
          });
        }
      } else {
        setNotice({
          kind: 'error',
          text: `${candidateSearch.startFailed} (${errorTexts.network})`,
        });
      }
    } finally {
      setSubmitting(false);
    }
  }

  const disabled = !canRecord || submitting || running || processes.length === 0;
  const hint = !canRecord
    ? candidateSearch.pickStaffFirst
    : running
      ? candidateSearch.alreadyRunning
      : processes.length === 0
        ? candidateSearch.processHint
        : null;

  return (
    <form
      aria-label={candidateSearch.formTitle}
      data-testid="ingest-form"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
      style={{ display: 'grid', gap: 12, marginBottom: 16 }}
    >
      <CheckGroup
        legend={candidateSearch.processLabel}
        hint={candidateSearch.processHint}
        items={options.processes.map((p) => ({ value: p.code, label: p.name }))}
        selected={processes}
        onToggle={(value) => setProcesses((prev) => toggled(prev, value))}
        testId="ingest-process"
      />
      {options.regions.length > 0 ? (
        <CheckGroup
          legend={candidateSearch.regionLabel}
          hint={candidateSearch.regionHint}
          items={options.regions.map((r) => ({ value: r, label: r }))}
          selected={regions}
          onToggle={(value) => setRegions((prev) => toggled(prev, value))}
          testId="ingest-region"
        />
      ) : null}
      {options.industries.length > 0 ? (
        <CheckGroup
          legend={candidateSearch.industryLabel}
          hint={candidateSearch.industryHint}
          items={options.industries.map((i) => ({ value: i, label: i }))}
          selected={industries}
          onToggle={(value) => setIndustries((prev) => toggled(prev, value))}
          testId="ingest-industry"
        />
      ) : null}
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 12 }}>
        <Button
          htmlType="submit"
          type="primary"
          disabled={disabled}
          loading={submitting}
          data-testid="ingest-submit"
        >
          {submitting ? candidateSearch.fetching : candidateSearch.fetchButton}
        </Button>
        {hint ? (
          <span
            data-testid="ingest-hint"
            style={{ color: colors.textSecondary, fontSize: typography.fontSizeSecondary }}
          >
            {hint}
          </span>
        ) : null}
        {notice ? (
          <span
            role={notice.kind === 'error' ? 'alert' : 'status'}
            data-testid="ingest-notice"
            style={{ color: notice.kind === 'error' ? colors.error : colors.textSecondary }}
          >
            {notice.text}
          </span>
        ) : null}
      </div>
    </form>
  );
}
