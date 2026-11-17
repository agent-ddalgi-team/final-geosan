// 다섯 상태 공통 부품(BR10.7, interaction-spec 1.1): 비어 있음 / 불러오는 중 / 정상 / 오류 / 일부.
// "일부"는 정상 화면 위에 알림(partialNotice)을 붙여 불러온 것과 못 불러온 것을 구분한다.
// 오류는 오류 코드 없이 쉬운 말 원인 + 다음 행동 + [다시 시도]이고, ref는 작게만 보인다.
import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { Alert, Button, Empty, Skeleton, Space } from 'antd';
import { ApiError } from '../../api/client';
import { errorTexts, states } from '../../labels/ko';
import { colors, spacing, typography } from '../../theme/tokens';

/** 불러오는 중이 이 시간(ms)을 넘으면 "조금 오래 걸리고 있습니다"를 덧붙인다. */
export const SLOW_LOADING_MS = 5000;

export type FiveState = 'loading' | 'empty' | 'error' | 'ready';

export interface FiveStatesProps {
  state: FiveState;
  children?: ReactNode;
  /** 비어 있음: 왜 비었는지 한 줄(필수 문구는 labels의 states에서 가져와 넘긴다). */
  emptyText?: string;
  /** 비어 있음: 다음 행동 버튼(있으면). */
  emptyAction?: ReactNode;
  /** 오류: 머리 문구(예: states.listError). */
  errorTitle?: string;
  /** 오류: 던져진 예외. ApiError면 서버가 준 쉬운 말과 다음 행동을 보인다. */
  error?: unknown;
  onRetry?: () => void;
  /** 불러오는 중 자리표시 개수(목록 3개). */
  skeletonCount?: number;
  /** 일부: 정상 화면 위의 알림(일부 소스 실패 등). */
  partialNotice?: ReactNode;
  'data-testid'?: string;
}

export default function FiveStates({
  state,
  children,
  emptyText,
  emptyAction,
  errorTitle,
  error,
  onRetry,
  skeletonCount = 3,
  partialNotice,
  'data-testid': testId = 'five-states',
}: FiveStatesProps) {
  const [slow, setSlow] = useState(false);

  useEffect(() => {
    if (state !== 'loading') return undefined;
    const timer = setTimeout(() => setSlow(true), SLOW_LOADING_MS);
    return () => {
      clearTimeout(timer);
      setSlow(false);
    };
  }, [state]);

  if (state === 'loading') {
    return (
      <div
        data-testid={`${testId}-loading`}
        aria-busy="true"
        aria-label={states.loading}
        style={{ display: 'grid', gap: spacing.cardGap }}
      >
        {Array.from({ length: skeletonCount }, (_, index) => (
          <Skeleton key={index} active paragraph={{ rows: 3 }} />
        ))}
        <div aria-live="polite" style={{ color: colors.textSecondary }}>
          {slow ? <span data-testid={`${testId}-slow`}>{states.loadingSlow}</span> : null}
        </div>
      </div>
    );
  }

  if (state === 'error') {
    const body = error instanceof ApiError ? error.body : null;
    return (
      <Alert
        type="error"
        showIcon
        data-testid={`${testId}-error`}
        message={errorTitle}
        description={
          <Space direction="vertical" size={8}>
            <span>{body?.message ?? errorTexts.network}</span>
            <span>{body?.nextAction ?? errorTexts.nextActionDefault}</span>
            {body?.ref && body.ref !== 'local' ? (
              <span
                data-testid={`${testId}-ref`}
                style={{ fontSize: typography.fontSizeSecondary, color: colors.textSecondary }}
              >
                {errorTexts.refPrefix} {body.ref}
              </span>
            ) : null}
            {onRetry ? (
              <Button onClick={onRetry} data-testid={`${testId}-retry-button`}>
                {states.retry}
              </Button>
            ) : null}
          </Space>
        }
      />
    );
  }

  if (state === 'empty') {
    return (
      <Empty
        data-testid={`${testId}-empty`}
        image={Empty.PRESENTED_IMAGE_SIMPLE}
        description={emptyText}
      >
        {emptyAction}
      </Empty>
    );
  }

  return (
    <>
      {partialNotice ? (
        <Alert
          type="warning"
          showIcon
          data-testid={`${testId}-partial`}
          message={partialNotice}
          style={{ marginBottom: spacing.cardGap }}
        />
      ) : null}
      {children}
    </>
  );
}
