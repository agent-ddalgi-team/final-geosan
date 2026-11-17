// 비슷한 회사 줄에서 공정 코드·담당자 키를 쉬운 이름으로 바꾸는 표(설정에서 읽는다). 없으면 코드·키를 그대로 보인다.
import { useFrame } from '../frame/FrameContext';

export function usePeerNames() {
  const { config } = useFrame();
  const processNames: Record<string, string> = Object.fromEntries(
    (config?.ingestOptions?.processes ?? []).map((item) => [item.code, item.name]),
  );
  const personName = (key: string) =>
    config?.staff.find((entry) => entry.key === key)?.displayName ?? key;
  return { processNames, personName };
}
