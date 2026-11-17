// 돈이 드는 단추(💰) 옆의 "이번 달 AI 사용 $3.20 / $20.00" 한 줄(#549 ③).
// 조건 없이 부른 GET /ingest/preview의 month를 그대로 보인다(외부 호출 없음, 0원). 화면에서 계산하지 않는다.
import { useEffect, useState } from 'react';
import { getMonthSpend } from '../../api/client';
import type { IngestMonth } from '../../api/types';
import { monthSpend } from '../../labels/ko';
import { colors, typography } from '../../theme/tokens';

type State = { status: 'loading' } | { status: 'ok'; month: IngestMonth } | { status: 'error' };

export default function MonthSpendLine() {
  const [state, setState] = useState<State>({ status: 'loading' });

  useEffect(() => {
    const controller = new AbortController();
    getMonthSpend(controller.signal)
      .then((envelope) => setState({ status: 'ok', month: envelope.data.month }))
      .catch(() => {
        if (!controller.signal.aborted) setState({ status: 'error' });
      });
    return () => controller.abort();
  }, []);

  if (state.status === 'loading') return null;
  return (
    <span
      data-testid="month-spend"
      style={{ color: colors.textSecondary, fontSize: typography.fontSizeSecondary }}
    >
      {state.status === 'ok'
        ? monthSpend.used(state.month.usedUsd, state.month.limitUsd)
        : monthSpend.failed}
    </span>
  );
}
