// 영업 홈 "오늘 할 일" 칸 아래 한 줄(#981, PM 결정 2026-11-28): 관심에 담고 검토 의견을 안 고른 회사가 있으면 알린다.
// 예: "관심에 담고 의견을 안 고른 회사 3곳 · 고르러 가기 →". 곳 수는 서버가 주는 영업 홈 건수(counts.NO_OPINION) 그대로다.
// 0곳이거나 서버가 값을 안 주면 줄을 그리지 않는다. 링크는 관심 기업 화면의 "의견 전" 보기(같은 기준 filter=NO_OPINION)로 간다.
import { Link } from 'react-router-dom';
import { dashboardTexts } from '../../labels/ko';
import { BOOKMARKS_PATH } from '../../paths';
import { opinionNudge, radius, typography } from '../../theme/tokens';

export default function NoOpinionNotice({ count }: { count: number | undefined }) {
  if (typeof count !== 'number' || count <= 0) return null;
  return (
    <p
      data-testid="dashboard-no-opinion-notice"
      style={{
        display: 'flex',
        flexWrap: 'wrap',
        alignItems: 'center',
        gap: '4px 12px',
        margin: 0,
        padding: '8px 12px',
        border: `1px solid ${opinionNudge.line}`,
        borderRadius: radius.controlSm,
        background: opinionNudge.bg,
        color: opinionNudge.fg,
        fontSize: typography.fontSizeSecondary,
      }}
    >
      <span>{dashboardTexts.noOpinionNotice(count)}</span>
      <Link
        to={`${BOOKMARKS_PATH}?filter=NO_OPINION`}
        data-testid="dashboard-no-opinion-link"
        style={{ marginLeft: 'auto', whiteSpace: 'nowrap' }}
      >
        {dashboardTexts.noOpinionLink} <span aria-hidden="true">→</span>
      </Link>
    </p>
  );
}
