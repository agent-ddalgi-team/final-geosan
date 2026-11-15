// 경로: `/` 대시보드(첫 화면), `/opportunities` 신규 거래처 찾기(#762 전 이름 "영업 후보 목록"),
// `/bookmarks` 관심 기업(#762), `/opportunities/:oppId` 근거 상세, `/sales-analysis` 영업 분석(#608),
// `/opportunities/:oppId/report` 회사별 보고서(#565, 인쇄용이라 메뉴가 있는 공통 틀 없이 그린다).
import { Navigate, Route, Routes, useSearchParams } from 'react-router-dom';
import AppFrame from './components/frame/AppFrame';
import { frame } from './labels/ko';
import CompanyReportPage from './pages/CompanyReportPage';
import DashboardPage from './pages/DashboardPage';
import OpportunityDetailPage from './pages/OpportunityDetailPage';
import OpportunityListPage from './pages/OpportunityListPage';
import SalesAnalysisPage from './pages/SalesAnalysisPage';
import { BOOKMARKS_PATH, LIST_PATH } from './paths';

/** 예전 관심 기업 보기 주소(`/opportunities?bookmarked=true&opinion=…`)는 새 화면으로 옮긴다(#762). */
function ListRoute() {
  const [params] = useSearchParams();
  if (params.get('bookmarked') === 'true') {
    const rest = new URLSearchParams(params);
    rest.delete('bookmarked');
    const query = rest.toString();
    return <Navigate to={`${BOOKMARKS_PATH}${query ? `?${query}` : ''}`} replace />;
  }
  return (
    <AppFrame title={frame.pageTitleList}>
      <OpportunityListPage />
    </AppFrame>
  );
}

export default function AppRoutes() {
  return (
    <Routes>
      <Route
        path="/"
        element={
          <AppFrame title={frame.pageTitleDashboard}>
            <DashboardPage />
          </AppFrame>
        }
      />
      <Route path={LIST_PATH} element={<ListRoute />} />
      <Route
        path={BOOKMARKS_PATH}
        element={
          <AppFrame title={frame.pageTitleBookmarks}>
            <OpportunityListPage view="bookmarks" />
          </AppFrame>
        }
      />
      <Route
        path="/opportunities/:oppId"
        element={
          <AppFrame title={frame.pageTitleDetail}>
            <OpportunityDetailPage />
          </AppFrame>
        }
      />
      <Route path="/opportunities/:oppId/report" element={<CompanyReportPage />} />
      <Route
        path="/sales-analysis"
        element={
          <AppFrame title={frame.pageTitleSalesAnalysis}>
            <SalesAnalysisPage />
          </AppFrame>
        }
      />
    </Routes>
  );
}
