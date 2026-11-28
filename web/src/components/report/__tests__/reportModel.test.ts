// 회사별 보고서 모델(#972에서 더한 값): 점수 합계 줄, 근거 묶음 개수, 단계 그림에 넘길 값, "확인 필요" 칸 수.
// 서버를 부르지 않고 사례 응답 파일로만 확인한다.
import type { OpportunityDetail } from '../../../api/types';
import detailFixture from '../../../test/fixtures/opportunity-detail-apjeong.json';
import { reportModelOf } from '../reportModel';

const fixture = detailFixture.data as unknown as OpportunityDetail;
const TODAY = '2026-11-27';

describe('reportModelOf — 새 모양에 쓰는 값 (#972)', () => {
  it('Given 점수 8항목 When 모델을 만들면 Then 합계는 서버 점수 글자에서, 배점 합·상태별 개수·받은 항목 수·가장 크게 비는 곳은 항목에서 센다', () => {
    const model = reportModelOf(fixture, true, null, TODAY);
    const items = fixture.scores!.items;
    // A정밀 사례: 서버 점수 글자 "77점 · 7/8", 배점 합 100.
    expect(model.scoreSummary).toEqual({
      total: 77,
      max: items.reduce((sum, item) => sum + item.weight, 0),
      states: [
        { state: 'CONFIRMED', count: 6 },
        { state: 'NO_SIGNAL', count: 1 },
        { state: 'UNAVAILABLE', count: 1 },
      ],
      earned: 6,
      // 신규 수주(0 / 8)가 8점으로 가장 크게 빈다. 값이 없는 항목(관심)은 "확인 필요"라 여기서 세지 않는다.
      biggestGap: { label: '신규 수주·제품 출시·사업 확대', score: 0, weight: 8 },
    });
    expect(model.scoreSummary!.max).toBe(100);
  });

  it('Given "참고 50점 · 3/8"처럼 참고가 붙은 점수 글자 When 모델을 만들면 Then 합계 숫자만 읽는다', () => {
    const model = reportModelOf(
      { ...fixture, header: { ...fixture.header, scoreDisplay: '참고 50점 · 3/8' } },
      true,
      null,
      TODAY,
    );
    expect(model.scoreSummary!.total).toBe(50);
    expect(model.glance.scoreText).toBe('참고 50점 · 3/8');
  });

  it('Given 점수가 아직 없는 회사 When 모델을 만들면 Then 합계 줄 값은 없고, 점수 글자를 읽을 수 없으면 합계만 비운다', () => {
    const none = reportModelOf(
      { ...fixture, header: { ...fixture.header, scoreDisplay: '--' }, scores: null },
      true,
      null,
      TODAY,
    );
    expect(none.scoreSummary).toBeNull();
    const unreadable = reportModelOf(
      { ...fixture, header: { ...fixture.header, scoreDisplay: '--' } },
      true,
      null,
      TODAY,
    );
    expect(unreadable.scoreSummary!.total).toBeNull();
    expect(unreadable.scoreSummary!.max).toBe(100);
  });

  it('Given 모든 항목이 만점 When 모델을 만들면 Then 가장 크게 비는 곳은 없다', () => {
    const items = fixture.scores!.items.map((item) => ({ ...item, score: item.weight }));
    const model = reportModelOf(
      { ...fixture, scores: { ...fixture.scores!, items } },
      true,
      null,
      TODAY,
    );
    expect(model.scoreSummary!.biggestGap).toBeNull();
    expect(model.scoreSummary!.earned).toBe(items.length);
  });

  it('Given 묶음이 섞인 근거 When 모델을 만들면 Then 근거마다 묶음 코드가 실리고 묶음별 개수를 처음 나온 순서대로 센다', () => {
    const [first, second] = fixture.evidence;
    const model = reportModelOf(
      {
        ...fixture,
        evidence: [
          first,
          second,
          { ...second, evidenceId: 'ev-3' },
          { ...first, evidenceId: 'ev-4' },
        ],
      },
      true,
      null,
      TODAY,
    );
    expect(model.evidence.map((row) => row.group)).toEqual([
      'SIGNAL',
      'PRODUCT',
      'PRODUCT',
      'SIGNAL',
    ]);
    expect(model.evidenceGroups).toEqual([
      { code: 'SIGNAL', count: 2 },
      { code: 'PRODUCT', count: 2 },
    ]);
  });

  it('Given 주소·홈페이지·한 줄 소개·공정·산업이 빈 회사 When 모델을 만들면 Then "확인 필요" 칸 수를 센다', () => {
    const full = reportModelOf(
      {
        ...fixture,
        header: {
          ...fixture.header,
          homepageUrl: 'https://example.invalid/apjeong',
          industries: ['기계·설비'],
          industriesSource: 'CASE_FILE',
        },
      },
      true,
      null,
      TODAY,
    );
    expect(full.glance.needCheckCount).toBe(0);
    const empty = reportModelOf(
      {
        ...fixture,
        header: {
          ...fixture.header,
          address: null,
          homepageUrl: null,
          summaryLine: null,
          industries: [],
        },
        processLinks: [],
        reviewItems: [],
      },
      true,
      null,
      TODAY,
    );
    expect(empty.glance.needCheckCount).toBe(5);
  });

  it('Given 담당자 키·일정 글이 실린 영업 기록 When 모델을 만들면 Then 단계 그림에 넘길 값에는 단계·거절 이유 코드와 답 번호·접촉 수만 있다', () => {
    const model = reportModelOf(
      {
        ...fixture,
        records: {
          ...fixture.records,
          outcome: {
            status: 'LOST',
            lostReasonCode: 'PRICE',
            nextScheduleAt: '2026-11-20',
            nextScheduleNote: '견적 보내기 — 구매팀 이 대리',
            version: 3,
            updatedBy: 'park-lee',
            updatedAt: '2026-11-12T09:00:00+09:00',
          },
          contactCount: { total: 3, call: 2, email: 0, visit: 1 },
          salesStep: {
            code: null,
            since: '2026-11-12',
            overridden: true,
            known: [
              {
                questionId: 'plating',
                question: '지금 도금은?',
                answerId: 'OUTSOURCE',
                answer: '외주 줌',
                at: '2026-11-12',
                by: 'park-lee',
              },
            ],
            openQuestions: ['switch'],
          },
        },
      },
      true,
      null,
      TODAY,
    );
    expect(model.progress).toEqual({
      salesStep: {
        code: null,
        since: null,
        overridden: false,
        known: [
          {
            questionId: 'plating',
            answerId: 'OUTSOURCE',
            question: '',
            answer: '',
            at: '',
            by: '',
          },
        ],
        openQuestions: [],
      },
      outcome: {
        version: 0,
        updatedBy: '',
        updatedAt: '',
        status: 'LOST',
        lostReasonCode: 'PRICE',
      },
      contactTotal: 3,
    });
    const progressText = JSON.stringify(model.progress);
    for (const secret of ['park-lee', '견적 보내기', '2026-11-20', '외주 줌']) {
      expect(progressText).not.toContain(secret);
    }
  });

  it('Given 영업 기록이 없는 회사 When 모델을 만들면 Then 단계 그림 값은 비어 있다', () => {
    const model = reportModelOf(fixture, true, null, TODAY);
    expect(model.progress).toEqual({ salesStep: null, outcome: null, contactTotal: 0 });
  });
});
