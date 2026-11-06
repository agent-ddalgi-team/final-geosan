// 후보 가져오기 조건 칸의 선택지(공정 9종·지역·산업)를 어디서 받을지 정하는 자리(#316).
// 약속에는 받는 방법이 없어서 PM 결정을 기다린다(#316 댓글 2026-11-06, `/config/ui`에 선택지를 더하자는 제안).
// 정해질 때까지 null을 돌려주고, null이면 조건 칸과 단추를 그리지 않는다. 값을 코드에 직접 적지 않는다(설정 값이라서).
// 결정되면 이 함수 한 곳만 서버가 주는 값을 읽도록 바꾸면 된다.
import type { IngestOptions } from './IngestForm';

export function useIngestOptions(): IngestOptions | null {
  return null;
}
