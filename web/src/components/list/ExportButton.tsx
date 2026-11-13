// 추천 목록 [엑셀 내려받기] 단추(#217). 지금 걸러 본 조건 그대로 서버에 보내 목록 전체를 내부용 엑셀로 받는다.
// 읽기라서 보기 전용·담당자 미선택도 쓸 수 있다(다른 목록 읽기와 같음). 모달 없이 단추 옆 한 줄로 결과를 알린다.
// 실패하면 서버가 준 쉬운 말·다음 행동·문의 번호를 보이고 파일은 저장하지 않는다.
import { useState } from 'react';
import { Button } from 'antd';
import { ApiError } from '../../api/client';
import type { ListFilters } from '../../api/client';
import { getListXlsx, saveFile } from '../../api/exportXlsx';
import { errorTexts, listExport } from '../../labels/ko';
import { colors, typography } from '../../theme/tokens';

export interface ExportButtonProps {
  /** 목록을 부를 때 쓴 조건 그대로(쪽 번호는 보내지 않는다. 엑셀은 전체를 담는다). */
  filters: ListFilters;
}

type Status =
  | { kind: 'idle' }
  | { kind: 'busy' }
  | { kind: 'done'; fileName: string }
  | { kind: 'error'; message: string; nextAction: string; ref: string | null };

export default function ExportButton({ filters }: ExportButtonProps) {
  const [status, setStatus] = useState<Status>({ kind: 'idle' });

  const download = async () => {
    setStatus({ kind: 'busy' });
    try {
      const file = await getListXlsx(filters);
      saveFile(file);
      setStatus({ kind: 'done', fileName: file.fileName });
    } catch (caught: unknown) {
      const body = caught instanceof ApiError ? caught.body : null;
      setStatus({
        kind: 'error',
        message: body?.message ?? errorTexts.network,
        nextAction: body?.nextAction ?? errorTexts.nextActionDefault,
        ref: body && body.ref !== 'local' ? body.ref : null,
      });
    }
  };

  return (
    <div
      data-testid="list-export"
      style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8 }}
    >
      <Button
        size="small"
        onClick={() => void download()}
        loading={status.kind === 'busy'}
        disabled={status.kind === 'busy'}
        title={listExport.hint}
        data-testid="list-export-button"
      >
        {listExport.button}
      </Button>
      {status.kind === 'done' ? (
        <span
          role="status"
          data-testid="list-export-done"
          style={{ color: colors.textSecondary, fontSize: typography.fontSizeSecondary }}
        >
          {listExport.done(status.fileName)}
        </span>
      ) : null}
      {status.kind === 'error' ? (
        <span
          role="alert"
          data-testid="list-export-error"
          style={{ fontSize: typography.fontSizeSecondary }}
        >
          {listExport.failed} {status.message} {status.nextAction}
          {status.ref ? ` (${errorTexts.refPrefix} ${status.ref})` : ''}
        </span>
      ) : null}
    </div>
  );
}
