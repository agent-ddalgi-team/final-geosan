// 후보 가져오기 조건 칸의 선택지(공정 9종·지역·산업)를 화면 설정 응답(`/config/ui`)의 `ingestOptions`에서 읽는다(#316, PM 결정 2026-11-08, 약속 C1 #424).
// 서버가 아직 이 칸을 주지 않으면 null을 돌려주고, null이면 조건 칸과 단추를 그리지 않는다. 값을 코드에 직접 적지 않는다(설정 값이라서).
import { useFrame } from '../frame/FrameContext';
import type { IngestOptions } from './IngestForm';

export function useIngestOptions(): IngestOptions | null {
  const { config } = useFrame();
  return config?.ingestOptions ?? null;
}
