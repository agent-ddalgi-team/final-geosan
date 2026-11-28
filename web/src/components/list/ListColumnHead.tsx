// 거래처 후보 표 줄의 열 머리 한 줄(#981 시안 "2-수정안"): 회사 · 품목 / 추천 근거 · 검토사항 / 점수 · 적합도 · 관심 · 의견.
// 묶음("근거 있음 ○곳" 등)마다 한 줄씩 보인다. 열 너비는 줄(.cand-row)과 같은 값이라 열이 가지런하다.
// 눈으로 보는 길잡이라 화면 낭독기에는 숨기고(목록 구조는 ol/li 그대로), 줄 안 칸마다 숨은 이름표가 같은 말을 읽어 준다.
// 좁은 화면에서는 styles.css가 이 줄을 숨기고 칸 안 이름표를 보인다.
import { listTable } from '../../labels/ko';
import { listTheme, typography } from '../../theme/tokens';

export default function ListColumnHead() {
  const { columns } = listTable;
  return (
    <div
      className="cand-head"
      data-testid="list-column-head"
      style={{
        padding: '8px 0',
        borderBottom: `1px solid ${listTheme.rowLine}`,
        color: listTheme.headFg,
        fontSize: typography.fontSizeSecondary,
      }}
    >
      <span>{columns.company}</span>
      <span>{columns.reason}</span>
      <span style={{ textAlign: 'right' }}>{columns.actions}</span>
    </div>
  );
}
