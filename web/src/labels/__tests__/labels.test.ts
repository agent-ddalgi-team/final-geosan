// 쉬운 말 대응표: 코드표 밖 코드 방어, 분류 11개 모두 문구 있음.
import {
  classificationLabels,
  classificationTone,
  contactMethodLabels,
  contactResultLabels,
  labelFor,
  noteKindLabels,
  outcomeStatusLabels,
  reviewItemKindLabels,
  reviewItemSourceLabels,
  scoreStateLabels,
} from '../ko';

describe('labels', () => {
  it('영업 단계·접촉 방법과 결과·검토사항을 약속한 순서의 쉬운 말로 읽는다', () => {
    expect(Object.values(outcomeStatusLabels)).toEqual([
      '미접촉',
      '접촉',
      '견적·샘플',
      '보류',
      '성사',
      '거절',
    ]);
    expect(Object.values(contactMethodLabels)).toEqual(['전화', '메일', '방문']);
    expect(Object.values(contactResultLabels)).toEqual(['연결됨', '부재', '거절']);
    expect(Object.values(noteKindLabels)).toEqual(['메모', '자료 조사']);
    // 앞의 세 가지는 처음 약속한 그대로이고, 뒤는 약속 요약에 더해진 종류다(#319 2026-11-06 PM 결정 한 가지,
    // AI 점수 제안 #286·#498 2026-11-05 저녁 PM 결정으로 코드표 reviewItemKind에 더한 두 가지, 쉬운 말은 PM 이슈 본문 그대로).
    expect(Object.values(reviewItemKindLabels)).toEqual([
      'AI 확인 질문',
      '자료 못 찾음',
      '자료 부족',
      '표면처리를 직접 하는 회사일 수 있음',
      'AI 제안 점수 입력',
      'AI 제안 공정 연결',
    ]);
    expect(Object.values(reviewItemSourceLabels)).toEqual(['AI 조사', '사례 파일', '평가 규칙']);
  });

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
