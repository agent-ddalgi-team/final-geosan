// 관심 표시만 다시 읽기(#357). 메모·영업 기록·검토 의견을 저장하면 서버가 관심을 켜므로(자동 관심, 약속 v3 #356)
// 그 저장 뒤에 화면의 [관심] 단추를 서버 값으로 맞추는 데 쓴다.
// 관심만 주는 읽기 경로는 약속에 없어서 상세 응답의 `records.bookmark`를 쓴다. client.ts의 함수만 가져다 쓴다.
import { getOpportunityDetail } from './client';
import type { BookmarkRecord } from './types';

export async function readBookmark(
  oppId: string,
  signal?: AbortSignal,
): Promise<BookmarkRecord | null> {
  const envelope = await getOpportunityDetail(oppId, signal);
  return envelope.data.records.bookmark ?? null;
}
