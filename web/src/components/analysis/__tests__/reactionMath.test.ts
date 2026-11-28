// #985 상대 반응 파이의 계산: 조각 각도 · "그 밖" 묶기 · 조각을 눌렀을 때 접촉 줄 고르기와 공정별(산업별) 세기.
// 숫자·회사 이름은 모두 가상이다.
import {
  REST_KEY,
  contactsOfSlice,
  countByPart,
  groupWithRest,
  inScope,
  namedIndustries,
  percentOf,
  pieSlices,
} from '../reactionMath';
import { REACTION_SAMPLE } from '../../../test/reactionSample';

describe('파이 조각 계산 (#985)', () => {
  it('Given 값 1·1·2 When 조각을 만들면 Then 12시부터 시계 방향으로 90°·90°·180°이고 몫의 합은 1이다', () => {
    const slices = pieSlices(
      [
        { key: 'a', value: 1 },
        { key: 'b', value: 1 },
        { key: 'c', value: 2 },
      ],
      100,
    );
    expect(slices.map((slice) => slice.key)).toEqual(['a', 'b', 'c']);
    expect(slices.map((slice) => slice.startDeg)).toEqual([0, 90, 180]);
    expect(slices.map((slice) => slice.sweepDeg)).toEqual([90, 90, 180]);
    expect(slices.reduce((sum, slice) => sum + slice.share, 0)).toBeCloseTo(1);
    // 첫 조각: 가운데(50,50) → 12시(50,1) → 시계 방향으로 3시(99,50)까지. 반지름은 한 변의 반에서 1을 뺀 49.
    expect(slices[0].path).toBe('M50.00 50.00 L50.00 1.00 A49.00 49.00 0 0 1 99.00 50.00 Z');
  });

  it('Given 반을 넘는 조각 When 길을 만들면 Then 큰 쪽 호로 그린다(large-arc 1)', () => {
    const slices = pieSlices(
      [
        { key: 'big', value: 3 },
        { key: 'small', value: 1 },
      ],
      100,
    );
    expect(slices[0].sweepDeg).toBe(270);
    expect(slices[0].path).toContain('A49.00 49.00 0 1 1');
    expect(slices[1].path).toContain('A49.00 49.00 0 0 1');
  });

  it('Given 0건인 값 When 조각을 만들면 Then 그 조각은 없고 나머지가 전체를 나눠 갖는다', () => {
    const slices = pieSlices(
      [
        { key: 'a', value: 3 },
        { key: 'zero', value: 0 },
        { key: 'b', value: 1 },
      ],
      100,
    );
    expect(slices.map((slice) => slice.key)).toEqual(['a', 'b']);
    expect(slices[1].startDeg).toBe(270);
  });

  it('Given 조각이 하나뿐 When 길을 만들면 Then 부채꼴이 아니라 온전한 원 하나다', () => {
    const slices = pieSlices(
      [
        { key: 'only', value: 5 },
        { key: 'zero', value: 0 },
      ],
      100,
    );
    expect(slices).toHaveLength(1);
    expect(slices[0].sweepDeg).toBe(360);
    expect(slices[0].share).toBe(1);
    expect(slices[0].path).toBe(
      'M1.00 50.00 a49.00 49.00 0 1 0 98.00 0 a49.00 49.00 0 1 0 -98.00 0 Z',
    );
  });

  it('Given 모두 0건 When 조각을 만들면 Then 조각이 없다', () => {
    expect(pieSlices([{ key: 'a', value: 0 }], 100)).toEqual([]);
    expect(pieSlices([], 100)).toEqual([]);
  });

  it('비율은 반올림한 %이고 합계가 0이면 0이다', () => {
    expect(percentOf(14, 34)).toBe(41);
    expect(percentOf(4, 11)).toBe(36);
    expect(percentOf(1, 0)).toBe(0);
  });
});

describe('"그 밖"으로 묶기 (#985)', () => {
  const items = (counts: number[]) =>
    counts.map((count, index) => ({ answerId: `A${index + 1}`, count }));

  it('Given 6가지 When 6칸으로 묶으면 Then 그대로 6조각이다(그 밖 없음)', () => {
    const groups = groupWithRest(items([6, 5, 4, 3, 2, 1]), 6);
    expect(groups.map((group) => group.key)).toEqual(['A1', 'A2', 'A3', 'A4', 'A5', 'A6']);
    expect(groups.some((group) => group.rest)).toBe(false);
  });

  it('Given 8가지 When 6칸으로 묶으면 Then 앞 5가지 + "그 밖"(6번째부터의 합)이다', () => {
    const groups = groupWithRest(items([8, 7, 6, 5, 4, 3, 2, 1]), 6);
    expect(groups).toHaveLength(6);
    expect(groups.slice(0, 5).map((group) => group.count)).toEqual([8, 7, 6, 5, 4]);
    expect(groups[5]).toEqual({
      key: REST_KEY,
      answerIds: ['A6', 'A7', 'A8'],
      count: 6,
      rest: true,
    });
  });

  it('Given 0건인 줄 When 묶으면 Then 조각으로 만들지 않는다', () => {
    const groups = groupWithRest(items([3, 0, 1]), 6);
    expect(groups.map((group) => group.key)).toEqual(['A1', 'A3']);
  });
});

describe('조각을 눌렀을 때 접촉 줄 고르기 (#985)', () => {
  const { contacts } = REACTION_SAMPLE;
  const named = namedIndustries(contacts);

  it('Given 전체 When 걸린 부분 "가격"을 고르면 Then 부정적이고 가격을 고른 접촉 4건이 최근 순 그대로다', () => {
    const rows = contactsOfSlice(contacts, 'bad', ['PRICE']);
    expect(rows.map((row) => row.name)).toEqual([
      'R테크(가상)',
      'M정밀(가상)',
      'K산업(가상)',
      'T기계(가상)',
    ]);
  });

  it('Given 반응 "긍정적" When 고르면 Then 좋게 본 부분을 안 고른 접촉도 든다(좋게 본 부분 조각에는 안 든다)', () => {
    expect(contactsOfSlice(contacts, 'reaction', ['POSITIVE']).map((row) => row.name)).toEqual([
      'H금속(가상)',
      'S전자(가상)',
    ]);
    expect(contactsOfSlice(contacts, 'good', ['QUALITY_CERT']).map((row) => row.name)).toEqual([
      'H금속(가상)',
    ]);
  });

  it('Given 산업 한 줄을 골라 보는 중 When 접촉을 고르면 Then 그 산업이 적힌 접촉만, "미확정" 줄은 산업이 없는 접촉만 든다', () => {
    const car = contacts.filter((row) =>
      inScope(row, { kind: 'industry', industry: '자동차 부품' }, named),
    );
    expect(car.map((row) => row.oppId)).toEqual(['opp-r', 'opp-m', 'opp-k', 'opp-k', 'opp-h']);
    const none = contacts.filter((row) =>
      inScope(row, { kind: 'industry', industry: '미확정' }, named),
    );
    expect(none.map((row) => row.name)).toEqual(['T기계(가상)']);
  });

  it('Given 공정 한 줄 When 접촉을 고르면 Then 그 공정이 적힌 접촉만, 공정 미확정 줄(null)은 공정이 없는 접촉만 든다', () => {
    const nickel = contacts.filter((row) =>
      inScope(row, { kind: 'process', processCode: 'NICKEL_PLATING' }, named),
    );
    expect(nickel.map((row) => row.name)).toEqual(['R테크(가상)', 'H금속(가상)', 'S전자(가상)']);
    const none = contacts.filter((row) =>
      inScope(row, { kind: 'process', processCode: null }, named),
    );
    expect(none.map((row) => row.name)).toEqual(['T기계(가상)']);
    expect(contacts.filter((row) => inScope(row, null, named))).toHaveLength(contacts.length);
  });

  it('Given 고른 접촉 줄 When 공정별로 세면 Then 많은 순이고, 공정이 둘인 회사는 두 줄에, 없는 회사는 null 줄에 센다', () => {
    const order = ['ZINC_PLATING', 'NICKEL_PLATING', null];
    expect(countByPart(contactsOfSlice(contacts, 'bad', ['PRICE']), 'process', order)).toEqual([
      { key: 'ZINC_PLATING', count: 2 },
      { key: 'NICKEL_PLATING', count: 1 },
      { key: null, count: 1 },
    ]);
    // 건수가 같으면 서버 표의 줄 순서(order)대로.
    expect(
      countByPart(contactsOfSlice(contacts, 'good', ['QUALITY_CERT']), 'industry', [
        '자동차 부품',
        '기계·설비',
      ]),
    ).toEqual([
      { key: '자동차 부품', count: 1 },
      { key: '기계·설비', count: 1 },
    ]);
  });
});
