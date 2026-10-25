// 쉬운 말 대응표: 코드표 밖 코드 방어, 분류 11개 모두 문구 있음.
import { classificationLabels, classificationTone, labelFor, scoreStateLabels } from '../ko';

describe('labels', () => {
  it('코드표 밖 코드는 코드 그대로 돌려주고 콘솔에 경고를 남긴다(빈 글자를 보이지 않는다)', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(labelFor(classificationLabels, 'SOMETHING_NEW')).toBe('SOMETHING_NEW');
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toContain('SOMETHING_NEW');
    // 서버가 준 대응표가 있으면 그것을 먼저 쓰고 경고하지 않는다.
    expect(labelFor(classificationLabels, 'SOMETHING_NEW', { SOMETHING_NEW: '새 분류' })).toBe(
      '새 분류',
    );
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });

  it('분류 11개가 모두 비어 있지 않은 쉬운 말과 색 조합을 가진다', () => {
    const codes = Object.keys(classificationLabels);
    expect(codes).toHaveLength(11);
    for (const code of codes) {
      expect(classificationLabels[code as keyof typeof classificationLabels].trim()).not.toBe('');
      expect(classificationTone[code as keyof typeof classificationTone]).toBeDefined();
    }
  });

  it('점수 항목 상태 7가지(BR4.5)가 모두 쉬운 말을 가져 표에 영문 코드가 보이지 않는다', () => {
    const states = [
      'CONFIRMED',
      'STRONG',
      'WEAK',
      'MISMATCH',
      'NO_BONUS',
      'NO_SIGNAL',
      'UNAVAILABLE',
    ];
    for (const state of states) {
      expect(scoreStateLabels[state]?.trim()).toBeTruthy();
      expect(scoreStateLabels[state]).not.toBe(state);
    }
  });
});
