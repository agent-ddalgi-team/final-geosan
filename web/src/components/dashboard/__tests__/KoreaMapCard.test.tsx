// 영업 지역 지도 카드: 관심 기업의 시·군을 시·도로 바꿔 칠하고 시·군 가운데 근처에 색 점을 찍으며,
// 알 수 없는 곳·불러오기 실패는 지어내지 않고 알린다. getOpportunities는 가짜로 바꾼 확인이며 실제 서버 연결 확인이 아니다.
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { getOpportunities } from '../../../api/client';
import { distanceKm } from '../../../config/nearby';
import KoreaMapCard, { provinceOf, toneOf } from '../KoreaMapCard';

vi.mock('../../../api/client', () => ({ getOpportunities: vi.fn() }));
const mocked = vi.mocked(getOpportunities);

type Row = { region: string | null; status?: string | null; title?: string };

const reply = (rows: Row[]) =>
  Promise.resolve({
    data: rows.map((row, i) => ({
      oppId: `opp-${i}`,
      title: row.title ?? `회사${i} · 시험 건`,
      region: row.region,
      records: { outcome: row.status ? { status: row.status } : null },
    })),
    meta: { hasVirtualData: true, datasetKind: 'VIRTUAL_REVIEWED' },
  } as never);

describe('distanceKm', () => {
  it('서울↔부산은 약 325km, 같은 곳은 0km다', () => {
    expect(distanceKm([126.98, 37.57], [129.07, 35.13])).toBeGreaterThan(315);
    expect(distanceKm([126.98, 37.57], [129.07, 35.13])).toBeLessThan(335);
    expect(distanceKm([127.1, 36.8], [127.1, 36.8])).toBe(0);
  });
});

describe('provinceOf · toneOf', () => {
  it('시·군 이름을 시·도 코드로 바꾸고, 비었거나 모르면 null이다', () => {
    expect(provinceOf('당진시')).toBe('34');
    expect(provinceOf('아산시')).toBe('34');
    expect(provinceOf('수원시')).toBe('31');
    // 서버는 광역시·특별시면 "대전광역시"처럼 첫 단어를 그대로 준다(계약 C1).
    expect(provinceOf('대전광역시')).toBe('25');
    expect(provinceOf('서울특별시')).toBe('11');
    expect(provinceOf('세종특별자치시')).toBe('29');
    expect(provinceOf('광주광역시')).toBe('24');
    expect(provinceOf('광주시')).toBe('31'); // 경기도 광주시와 헷갈리지 않는다.
    expect(provinceOf(null)).toBeNull();
    expect(provinceOf('없는시')).toBeNull();
  });

  it('영업 결과를 점 색으로 바꾼다(없으면 관심)', () => {
    const tone = (status?: string) =>
      toneOf({ records: { outcome: status ? { status } : null } } as never);
    expect(tone()).toBe('interest');
    expect(tone('NOT_EXECUTED')).toBe('interest');
    expect(tone('IN_PROGRESS')).toBe('progress');
    expect(tone('SAMPLE_OR_REGISTRATION_APPROVED')).toBe('progress');
    expect(tone('WON')).toBe('won');
    expect(tone('ON_HOLD')).toBe('other');
    expect(tone('LOST')).toBe('other');
  });
});

describe('KoreaMapCard', () => {
  beforeEach(() => mocked.mockReset());

  it('시·도 17곳이 그려지고, 시·군을 아는 회사마다 단계 색 점이 찍히며 칠해진 시·도와 곳수를 알린다', async () => {
    mocked.mockReturnValueOnce(
      reply([
        { region: '당진시', status: 'IN_PROGRESS', title: '명화금속 · 직결나사' },
        { region: '아산시' },
        { region: null },
      ]),
    );
    render(<KoreaMapCard />);
    expect(await screen.findByText(/3곳 중 위치를 아는 2곳이 점으로 보입니다/)).toBeInTheDocument();
    expect(screen.getByTestId('korea-map-note')).toHaveTextContent('위치를 모르는 1곳');
    expect(screen.getByTestId('korea-map-hq')).toBeInTheDocument();
    expect(screen.getByTestId('korea-map').querySelectorAll('path')).toHaveLength(17);
    expect(screen.getByTestId('korea-map-province-34')).toHaveAttribute('data-has', 'true');
    expect(screen.getByTestId('korea-map-province-11')).toHaveAttribute('data-has', 'false');
    expect(screen.getByTestId('korea-map-note')).toHaveTextContent('충남 2곳');
    const dots = screen.getAllByTestId('korea-map-dot');
    expect(dots).toHaveLength(2); // 주소를 모르는 회사는 점이 없다.
    expect(dots.map((d) => d.getAttribute('data-tone'))).toEqual(['progress', 'interest']);
    expect(dots[0]).toHaveAttribute(
      'aria-label',
      expect.stringMatching(/^명화금속, 충남 당진시, 진행 중, 본사에서 약 \d+km$/),
    );
    // 범례에 색별 곳수가 글자로도 나온다.
    expect(screen.getByTestId('korea-map-legend')).toHaveTextContent('관심 1');
    expect(screen.getByTestId('korea-map-legend')).toHaveTextContent('진행 중 1');
    expect(mocked.mock.calls[0][1]).toBe(50);
    expect(mocked.mock.calls[0][3]).toEqual({ bookmarked: 'true' });
  });

  it('점에 마우스를 올리면(또는 키보드로 가면) 회사·위치·본사와의 거리·단계가 작은 팝업으로 보이고, 벗어나면 사라진다', async () => {
    mocked.mockReturnValueOnce(
      reply([{ region: '당진시', status: 'IN_PROGRESS', title: '명화금속 · 직결나사' }]),
    );
    render(<KoreaMapCard />);
    const dot = await screen.findByTestId('korea-map-dot');
    expect(screen.queryByTestId('korea-map-popup')).not.toBeInTheDocument();
    await userEvent.hover(dot);
    const popup = screen.getByTestId('korea-map-popup');
    expect(popup).toHaveAttribute('role', 'tooltip');
    expect(popup).toHaveTextContent('명화금속');
    expect(popup).toHaveTextContent('위치: 충남 당진시 근처');
    expect(popup).toHaveTextContent(/본사에서 약 \d+km\(직선\)/);
    expect(popup).toHaveTextContent('진행 중');
    await userEvent.unhover(dot);
    expect(screen.queryByTestId('korea-map-popup')).not.toBeInTheDocument();
    await userEvent.tab();
    // 키보드로 점에 닿아도 같은 내용이 보인다.
    dot.focus();
    expect(await screen.findByTestId('korea-map-popup')).toHaveTextContent('명화금속');
  });

  it('같은 시·군에 회사가 둘이면 점이 겹치지 않게 조금 떨어져 찍힌다', async () => {
    mocked.mockReturnValueOnce(reply([{ region: '당진시' }, { region: '당진시' }]));
    render(<KoreaMapCard />);
    const dots = await screen.findAllByTestId('korea-map-dot');
    expect(dots).toHaveLength(2);
    expect([dots[0].getAttribute('cx'), dots[0].getAttribute('cy')]).not.toEqual([
      dots[1].getAttribute('cx'),
      dots[1].getAttribute('cy'),
    ]);
  });

  it('본사(천안시)에서 멀리 있는 회사도 위치를 알면 모두 점으로 보이고, 팝업에 본사와의 거리가 적힌다', async () => {
    mocked.mockReturnValueOnce(
      reply([
        { region: '아산시' },
        { region: '구미시', title: '코파스 · 볼트' },
        { region: '포항시' },
      ]),
    );
    render(<KoreaMapCard />);
    expect(await screen.findByText(/3곳 중 위치를 아는 3곳이 점으로 보입니다/)).toBeInTheDocument();
    expect(screen.getAllByTestId('korea-map-dot')).toHaveLength(3);
    // 멀어도 그 시·도(경북)가 칠해진다.
    expect(screen.getByTestId('korea-map-province-37')).toHaveAttribute('data-has', 'true');
    // 반경 점선 원은 그리지 않는다(본사 표시만).
    expect(screen.getByTestId('korea-map-hq').querySelectorAll('circle')).toHaveLength(1);
    await userEvent.hover(screen.getAllByTestId('korea-map-dot')[1]);
    expect(screen.getByTestId('korea-map-popup')).toHaveTextContent(/본사에서 약 1\d\dkm\(직선\)/);
  });

  it('관심 기업이 없으면 칠한 곳이 없다는 안내를 보인다', async () => {
    mocked.mockReturnValueOnce(reply([]));
    render(<KoreaMapCard />);
    expect(await screen.findByText(/칠한 곳이 없습니다/)).toBeInTheDocument();
    expect(screen.queryAllByTestId('korea-map-dot')).toHaveLength(0);
  });

  it('위치를 아는 회사가 하나도 없으면 점을 찍지 않고 0곳이라고 알린다(위치를 지어내지 않는다)', async () => {
    mocked.mockReturnValueOnce(reply([{ region: null }, { region: null }]));
    render(<KoreaMapCard />);
    expect(await screen.findByText(/위치를 모르는 2곳은 표시하지 않음/)).toBeInTheDocument();
    expect(screen.queryAllByTestId('korea-map-dot')).toHaveLength(0);
  });

  it('불러오지 못해도 지도는 보이고 못 불러왔다고 알린다', async () => {
    mocked.mockRejectedValueOnce(new Error('network'));
    render(<KoreaMapCard />);
    expect(await screen.findByText(/위치를 불러오지 못했습니다/)).toBeInTheDocument();
    expect(screen.getByTestId('korea-map')).toBeInTheDocument();
    expect(screen.getByTestId('korea-map-province-34')).toHaveAttribute('data-has', 'false');
  });
});
