// 목록 머리 수집 요약의 실패 사유·건너뜀 안내(#442). 서버가 준 사유를 그대로(실패) 또는 쉬운 말로(건너뜀) 보인다.
// 서버 응답은 가짜로 만든 값이며 실제 서버 연결 확인이 아니다.
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { LatestIngest } from '../../../api/types';
import { candidateSearch } from '../../../labels/ko';
import IngestSummary, { failureText, skippedNotices } from '../IngestSummary';

const DONE: LatestIngest = {
  batchId: 'batch-1',
  status: 'DONE',
  scannedCount: 3672,
  pickedCount: 12,
  researchDoneCount: 12,
};

function show(ingest: LatestIngest) {
  return render(<IngestSummary ingest={ingest} />);
}

describe('수집 요약 · 실패 사유(#442)', () => {
  it('서버가 실패 사유를 주면 고정 문구 대신 그 문장을 그대로 보인다', () => {
    show({
      ...DONE,
      status: 'FAILED',
      failureReason: '오늘 웹 검색 한도에 걸려 일부만 찾았습니다.',
    });
    const failed = screen.getByTestId('ingest-failed');
    expect(failed).toHaveTextContent('오늘 웹 검색 한도에 걸려 일부만 찾았습니다.');
    expect(failed).not.toHaveTextContent(candidateSearch.failed);
  });

  it('실패 사유가 없거나 비어 있거나 공백뿐이면 기존 고정 문구를 보인다', () => {
    for (const failureReason of [undefined, null, '', '   ']) {
      expect(failureText({ ...DONE, status: 'FAILED', failureReason })).toBe(
        candidateSearch.failed,
      );
    }
  });

  it('실패 사유는 앞뒤 공백을 떼고 보인다', () => {
    expect(
      failureText({ ...DONE, status: 'FAILED', failureReason: '  다시 시도해 주세요.  ' }),
    ).toBe('다시 시도해 주세요.');
  });
});

describe('수집 요약 · 건너뜀 안내(#442)', () => {
  // 문장은 약속 C1에 정해진 그대로다(웹 검색 #313, 단지 조회 #323).
  it('웹 검색이 하루 한도에 걸렸으면 "오늘 웹 검색 한도 도달"을 알린다', () => {
    show({ ...DONE, webSkippedReason: 'DAILY_LIMIT' });
    expect(screen.getByTestId('ingest-skipped')).toHaveTextContent('오늘 웹 검색 한도 도달');
    // 건수 줄은 그대로 보인다.
    expect(screen.getByTestId('ingest-counts')).toHaveTextContent('훑어본 공장 3,672곳');
  });

  it('단지 조회가 하루 한도나 조회 실패로 건너뛰어지면 같은 한 문장을 알린다', () => {
    for (const reason of ['DAILY_LIMIT', 'SOURCE_ERROR'] as const) {
      const { unmount } = show({ ...DONE, complexListSkippedReason: reason });
      expect(screen.getByTestId('ingest-skipped')).toHaveTextContent(
        '산단공 조회를 다 못 불러옴 · 파일 목록으로 찾음',
      );
      unmount();
    }
  });

  it('웹 검색과 단지 조회가 모두 건너뛰어졌으면 두 줄을 모두 보인다', () => {
    show({ ...DONE, webSkippedReason: 'DAILY_LIMIT', complexListSkippedReason: 'SOURCE_ERROR' });
    const notices = screen.getAllByTestId('ingest-skipped');
    expect(notices).toHaveLength(2);
    expect(notices[0]).toHaveTextContent('오늘 웹 검색 한도 도달');
    expect(notices[1]).toHaveTextContent('산단공 조회를 다 못 불러옴 · 파일 목록으로 찾음');
  });

  it('꺼 둔 것(DISABLED)은 안내할 일이 아니라서 보이지 않는다', () => {
    show({ ...DONE, webSkippedReason: 'DISABLED', complexListSkippedReason: 'DISABLED' });
    expect(screen.queryByTestId('ingest-skipped')).not.toBeInTheDocument();
    expect(skippedNotices({ ...DONE, webSkippedReason: 'DISABLED' })).toEqual([]);
  });

  it('건너뛴 일이 없으면(null·없음) 안내가 보이지 않는다', () => {
    show({ ...DONE, webSkippedReason: null, complexListSkippedReason: null });
    expect(screen.queryByTestId('ingest-skipped')).not.toBeInTheDocument();
    expect(skippedNotices(DONE)).toEqual([]);
  });

  it('서버가 모르는 코드를 주면 코드 글자를 그대로 보이지 않고 뺀다', () => {
    const unknown = {
      ...DONE,
      webSkippedReason: 'SOMETHING_NEW',
    } as unknown as LatestIngest;
    show(unknown);
    expect(screen.queryByTestId('ingest-skipped')).not.toBeInTheDocument();
    expect(screen.getByTestId('ingest-summary')).not.toHaveTextContent('SOMETHING_NEW');
  });

  it('실패한 회차에서는 실패 사유만 보이고 건너뜀 안내는 붙지 않는다', () => {
    show({
      ...DONE,
      status: 'FAILED',
      failureReason: '다시 시도해 주세요.',
      webSkippedReason: 'DAILY_LIMIT',
    });
    expect(screen.getByTestId('ingest-failed')).toHaveTextContent('다시 시도해 주세요.');
    expect(screen.queryByTestId('ingest-skipped')).not.toBeInTheDocument();
  });

  it('쉬운 말 대응표에는 안내하기로 한 이유 코드만 있다(DISABLED는 없다)', () => {
    expect(Object.keys(candidateSearch.webSkipped).sort()).toEqual(['DAILY_LIMIT']);
    expect(Object.keys(candidateSearch.complexListSkipped).sort()).toEqual([
      'DAILY_LIMIT',
      'SOURCE_ERROR',
    ]);
  });
});
