// 후보 가져오기 조건 칸 선택지는 화면 설정 응답의 ingestOptions에서 읽는다(#316). 없으면 null이라 조건 칸을 그리지 않는다.
import { renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it } from 'vitest';
import type { ConfigUi } from '../../../api/types';
import configFixture from '../../../test/fixtures/config-ui.json';
import { FrameContext, type FrameValue } from '../../frame/FrameContext';
import { useIngestOptions } from '../useIngestOptions';

const BASE_CONFIG = configFixture.data as unknown as ConfigUi;

function frameWith(config: ConfigUi | null): FrameValue {
  return {
    config,
    staffKey: null,
    setStaffKey: () => {},
    canRecord: false,
    setBannerMeta: () => {},
    setPageTitle: () => {},
  };
}

function wrapperFor(config: ConfigUi | null) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <FrameContext.Provider value={frameWith(config)}>{children}</FrameContext.Provider>;
  };
}

describe('useIngestOptions (#316)', () => {
  it('설정 응답의 ingestOptions를 그대로 돌려준다: 공정 9종(기회 0건 포함)·지역·산업', () => {
    const { result } = renderHook(() => useIngestOptions(), { wrapper: wrapperFor(BASE_CONFIG) });
    expect(result.current).toBe(BASE_CONFIG.ingestOptions);
    expect(result.current?.processes).toHaveLength(9);
    expect(result.current?.processes[0]).toEqual({
      code: 'ZINC_PLATING',
      name: '아연도금(전기아연도금)',
    });
    expect(result.current?.regions).toEqual(['충남', '대전', '세종']);
    expect(result.current?.industries.length).toBeGreaterThan(0);
  });

  it('서버가 ingestOptions를 아직 주지 않으면 null이다', () => {
    const { ingestOptions: _omitted, ...withoutOptions } = BASE_CONFIG;
    void _omitted;
    const { result } = renderHook(() => useIngestOptions(), {
      wrapper: wrapperFor(withoutOptions as ConfigUi),
    });
    expect(result.current).toBeNull();
  });

  it('설정을 아직 못 받았으면 null이다', () => {
    const { result } = renderHook(() => useIngestOptions(), { wrapper: wrapperFor(null) });
    expect(result.current).toBeNull();
  });
});
