// #981: 관심 기업 화면 맨 위 "의견 전" 띠. 곳 수는 목록 창구의 meta.total을 그대로 쓴다.
// "의견 전"은 영업 홈의 같은 이름 칸과 같은 기준(filter=NO_OPINION: 관심 + 의견 없음 + 영업 단계 전)으로 센다.
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import NoOpinionStrip, { NO_OPINION_FILTER } from '../NoOpinionStrip';
import { getOpportunities } from '../../../api/client';

vi.mock('../../../api/client', async (original) => ({
  ...(await original<typeof import('../../../api/client')>()),
  getOpportunities: vi.fn(),
}));

const list = vi.mocked(getOpportunities);
const answer = (total: number | undefined) =>
  ({ data: [], meta: { total } }) as unknown as Awaited<ReturnType<typeof getOpportunities>>;

// 중괄호로 감싼다: 화살표 함수가 가짜 함수를 그대로 돌려주면 Vitest가 그것을 "뒷정리 함수"로 알고 테스트 뒤에 한 번 더 부른다.
beforeEach(() => {
  list.mockReset();
});

it('Given 의견 전인 관심 기업 3곳 When 관심 기업 화면 Then 띠에 곳 수가 보이고 [의견 전만 보기]를 누르면 거르기를 부른다', async () => {
  list.mockResolvedValue(answer(3));
  const onShowOnly = vi.fn();
  render(<NoOpinionStrip filters={{}} reloadKey="a" onShowOnly={onShowOnly} />);
  expect(await screen.findByTestId('no-opinion-strip-text')).toHaveTextContent(
    '의견을 아직 안 고른 관심 기업 3곳',
  );
  // 한 줄만 읽는다: 관심 기업 + "의견 전" 조건(영업 홈 칸과 같은 filter=NO_OPINION). 의견 거르기는 비워 보낸다.
  expect(list).toHaveBeenCalledTimes(1);
  expect(list.mock.calls[0][0]).toBe(1);
  expect(list.mock.calls[0][1]).toBe(1);
  expect(list.mock.calls[0][3]).toEqual({
    bookmarked: 'true',
    opinion: null,
    filter: 'NO_OPINION',
  });
  expect(NO_OPINION_FILTER).toBe('NO_OPINION');
  fireEvent.click(screen.getByRole('button', { name: '의견 전만 보기' }));
  expect(onShowOnly).toHaveBeenCalledTimes(1);
});

/** 가짜 창구의 응답이 끝나 화면에 반영될 때까지 기다린다("안 보인다"를 응답 도착 뒤에 확인하려고). */
const settle = () =>
  act(async () => {
    await Promise.allSettled(list.mock.results.map((result) => result.value));
  });

it('Given 공정을 고른 관심 기업 화면 When 띠 Then 같은 조건에 "의견 전"만 더해 센다([의견 전만 보기]로 나오는 수와 같다)', async () => {
  list.mockResolvedValue(answer(2));
  render(
    <NoOpinionStrip
      filters={{ process: 'ZINC_PLATING', opinion: 'WORTH_REVIEW', sort: 'contact' }}
      reloadKey="a"
      onShowOnly={() => {}}
    />,
  );
  expect(await screen.findByTestId('no-opinion-strip-text')).toHaveTextContent('2곳');
  // 지금 고른 의견 거르기(영업 대상)는 빼고 "의견 전" 조건을 더해 센다. 공정·정렬은 그대로 간다.
  expect(list.mock.calls[0][3]).toEqual({
    process: 'ZINC_PLATING',
    sort: 'contact',
    bookmarked: 'true',
    opinion: null,
    filter: 'NO_OPINION',
  });
});

it('Given 다른 대시보드 칸 조건(접촉 중)으로 거른 관심 기업 화면 When 띠 Then 그 조건 대신 "의견 전" 조건으로 센다', async () => {
  list.mockResolvedValue(answer(4));
  render(
    <NoOpinionStrip
      filters={{ filter: 'IN_CONTACT', region: '아산시', bookmarked: 'true' }}
      reloadKey="a"
      onShowOnly={() => {}}
    />,
  );
  expect(await screen.findByTestId('no-opinion-strip-text')).toHaveTextContent('4곳');
  expect(list.mock.calls[0][3]).toEqual({
    region: '아산시',
    bookmarked: 'true',
    opinion: null,
    filter: 'NO_OPINION',
  });
});

it('Given 의견 전인 회사 0곳 When 관심 기업 화면 Then 띠를 그리지 않는다', async () => {
  list.mockResolvedValue(answer(0));
  render(<NoOpinionStrip filters={{}} reloadKey="a" onShowOnly={() => {}} />);
  await waitFor(() => expect(list).toHaveBeenCalled());
  await settle();
  expect(screen.queryByTestId('no-opinion-strip')).toBeNull();
});

it('Given 곳 수를 못 읽음 When 관심 기업 화면 Then 띠만 숨기고 오류를 띄우지 않는다', async () => {
  list.mockRejectedValue(new Error('network'));
  render(<NoOpinionStrip filters={{}} reloadKey="a" onShowOnly={() => {}} />);
  await waitFor(() => expect(list).toHaveBeenCalled());
  await settle();
  expect(screen.queryByTestId('no-opinion-strip')).toBeNull();
  expect(screen.queryByRole('alert')).toBeNull();
});

it('Given 목록을 다시 읽음 When reloadKey가 바뀜 Then 곳 수도 다시 읽는다(의견을 고르면 줄어든다)', async () => {
  list.mockResolvedValueOnce(answer(3)).mockResolvedValueOnce(answer(2));
  const view = render(<NoOpinionStrip filters={{}} reloadKey="a" onShowOnly={() => {}} />);
  expect(await screen.findByTestId('no-opinion-strip-text')).toHaveTextContent('3곳');
  view.rerender(<NoOpinionStrip filters={{}} reloadKey="b" onShowOnly={() => {}} />);
  await waitFor(() => expect(screen.getByTestId('no-opinion-strip-text')).toHaveTextContent('2곳'));
  expect(list).toHaveBeenCalledTimes(2);
});
