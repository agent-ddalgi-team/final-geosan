// "부재" 낱말(#985, PM 결정 2026-11-29): 메모가 그 낱말 하나와 같을 때만 AI 없이 저장한다.
import { ABSENT_WORDS, isAbsentMemo } from '../absentWords';

describe('부재 낱말 알아보기 (#985 나)', () => {
  it.each([
    ['CALL', '부재'],
    ['CALL', '연락 안 됨'],
    ['CALL', '안 받음'],
    ['CALL', '통화 안 됨'],
    ['CALL', '전화 안 받음'],
    ['EMAIL', '답 없음'],
    ['EMAIL', '회신 없음'],
    ['VISIT', '못 만남'],
    ['VISIT', '부재'],
  ] as const)('Given 종류 %s When 메모가 "%s"뿐 Then 부재다', (method, memo) => {
    expect(isAbsentMemo(method, memo)).toBe(true);
  });

  it('Given 앞뒤 빈칸 · 끝의 마침표 · 다른 띄어쓰기 When 견주면 Then 같은 낱말로 본다', () => {
    expect(isAbsentMemo('CALL', '  부재.  ')).toBe(true);
    expect(isAbsentMemo('CALL', '연락안됨')).toBe(true);
    expect(isAbsentMemo('CALL', '전화  안  받음..')).toBe(true);
    expect(isAbsentMemo('EMAIL', '답없음.')).toBe(true);
  });

  it('Given 다른 말이 섞인 메모 When 견주면 Then 부재가 아니다(영업 코치에게 보낸다)', () => {
    expect(isAbsentMemo('CALL', '부재. 내일 다시 전화')).toBe(false);
    expect(isAbsentMemo('CALL', '부재중 메시지 남김')).toBe(false);
    expect(isAbsentMemo('CALL', '담당자 부재')).toBe(false);
    expect(isAbsentMemo('CALL', '')).toBe(false);
    expect(isAbsentMemo('CALL', ' . ')).toBe(false);
  });

  it('Given 종류마다 낱말이 다름 When 다른 종류의 낱말을 적으면 Then 부재가 아니다', () => {
    expect(isAbsentMemo('CALL', '답 없음')).toBe(false);
    expect(isAbsentMemo('EMAIL', '부재')).toBe(false);
    expect(isAbsentMemo('VISIT', '안 받음')).toBe(false);
  });

  it('낱말 목록은 PM 결정 그대로다', () => {
    expect(ABSENT_WORDS).toEqual({
      CALL: ['부재', '연락 안 됨', '안 받음', '통화 안 됨', '전화 안 받음'],
      EMAIL: ['답 없음', '회신 없음'],
      VISIT: ['못 만남', '부재'],
    });
  });
});
