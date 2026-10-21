// 러너 확인용 최소 테스트(Step 6). 항상 참인 테스트가 아니라 대응표·가짜 응답이 실제로 동작하는지 본다.
import { render, screen } from '@testing-library/react';
import App from '../App';
import { classificationLabels, labelFor } from '../labels/ko';
import listFixture from './fixtures/opportunities-apjeong.json';

describe('러너 확인', () => {
  it('쉬운 말 대응표에 분류 11개가 모두 있고 코드표 밖 코드는 코드 그대로 돌려준다', () => {
    expect(Object.keys(classificationLabels)).toHaveLength(11);
    expect(labelFor(classificationLabels, 'CONTACT_URGENT')).toBe('지금 바로 연락 검토');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(labelFor(classificationLabels, 'NOT_A_CODE')).toBe('NOT_A_CODE');
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });

  it('A정밀 가짜 응답은 순위 1·CONTACT_URGENT·점수 81이다', () => {
    const [card] = listFixture.data;
    expect(card.rank).toBe(1);
    expect(card.classificationCode).toBe('CONTACT_URGENT');
    expect(card.scoreDisplay).toBe('81');
  });

  it('최소 화면이 내부용 띠를 보인다', () => {
    render(<App />);
    expect(screen.getByRole('status')).toHaveTextContent('내부용');
  });
});
