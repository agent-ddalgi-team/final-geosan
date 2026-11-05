// 상세 머리의 거래 관계 줄(#266): "거래 관계: 확인 전  [거래 없음] [거래 중]".
// 누르면 서버가 저장·이력·재평가를 한 번에 하고(#265), 화면은 상세를 새로 불러온다. 모달 없이 인라인이다.
// 담당자를 고르기 전·보기 전용은 단추가 잠기고, 평가가 낡았으면(409) 새로 불러오라고 안내한다.
import { useState } from 'react';
import { Button, Space } from 'antd';
import { ApiError, postRelation } from '../../api/client';
import type { RelationStatus } from '../../api/types';
import { errorTexts, relationControl } from '../../labels/ko';
import { colors, typography } from '../../theme/tokens';
import { useFrame } from '../frame/FrameContext';

const ORDER: RelationStatus[] = ['NEW_CONFIRMED', 'EXISTING_CONFIRMED', 'UNCONFIRMED'];

export interface RelationControlProps {
  oppId: string;
  /** 지금 보고 있는 평가 ID. 없으면(평가 전) 단추를 잠근다. */
  evalId: string | null;
  status: RelationStatus;
  /** 서버가 주는 지난 접촉 요약(예: "기존 (2024년 아연도금 견적)"). 없으면 생략. */
  note?: string | null;
  /** 마지막으로 바꾼 날(YYYY-MM-DD)과 담당자 키. 바꾼 적이 없으면 생략. */
  confirmedAt?: string | null;
  confirmedBy?: string | null;
  /** 저장이 끝났거나 새로 불러오기를 누르면 부른다. 상세 화면이 서버에서 다시 읽는다. */
  onChanged: () => void;
}

function monthDay(value: string): string {
  const [, month, day] = value.split('-');
  return month && day ? `${Number(month)}/${Number(day)}` : value;
}

export default function RelationControl({
  oppId,
  evalId,
  status,
  note,
  confirmedAt,
  confirmedBy,
  onChanged,
}: RelationControlProps) {
  const { staffKey, canRecord, config } = useFrame();
  const [saving, setSaving] = useState<RelationStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [stale, setStale] = useState(false);

  const confirmedName = config?.staff.find((entry) => entry.key === confirmedBy)?.displayName;
  const parts: string[] = [relationControl.state[status]];
  if (confirmedAt) {
    if (confirmedName ?? confirmedBy) parts.push((confirmedName ?? confirmedBy) as string);
    parts.push(monthDay(confirmedAt));
  }

  async function change(next: RelationStatus) {
    if (!staffKey || !evalId) return;
    setSaving(next);
    setError(null);
    setStale(false);
    try {
      await postRelation(oppId, { relationStatus: next, evalId }, staffKey);
      onChanged();
    } catch (caught) {
      if (caught instanceof ApiError && caught.status === 409) {
        setStale(true);
        setError(relationControl.stale);
      } else {
        const detail = caught instanceof ApiError ? caught.body.message : errorTexts.network;
        setError(`${relationControl.saveFailed} (${detail})`);
      }
    } finally {
      setSaving(null);
    }
  }

  const locked = !canRecord || !evalId;

  return (
    <span
      data-testid="detail-relation"
      style={{ display: 'inline-flex', flexWrap: 'wrap', alignItems: 'center', gap: 8 }}
    >
      <span data-testid="detail-relation-text">
        {relationControl.title}: {parts.join(' · ')}
        {note ? <span style={{ color: colors.textSecondary }}> · {note}</span> : null}
      </span>
      <Space wrap size={8} role="group" aria-label={relationControl.title}>
        {ORDER.filter((value) => value !== status).map((value) => (
          <Button
            key={value}
            size="small"
            disabled={locked || (saving !== null && saving !== value)}
            loading={saving === value}
            onClick={() => void change(value)}
            data-testid={`relation-button-${value}`}
          >
            {relationControl.action[value]}
          </Button>
        ))}
      </Space>
      <span
        data-testid="detail-relation-hint"
        style={{ color: colors.textSecondary, fontSize: typography.fontSizeSecondary }}
      >
        {canRecord ? relationControl.hint : relationControl.pickStaffFirst}
      </span>
      {error ? (
        <span role="alert" data-testid="detail-relation-error" style={{ color: colors.error }}>
          {error}
          {stale ? (
            <>
              {' '}
              <Button
                type="link"
                size="small"
                onClick={onChanged}
                data-testid="relation-reload-button"
              >
                {relationControl.reload}
              </Button>
            </>
          ) : null}
        </span>
      ) : null}
    </span>
  );
}
