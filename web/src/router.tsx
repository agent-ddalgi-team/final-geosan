// 경로: `/` 대시보드(첫 화면), `/opportunities` 추천 목록, `/opportunities/:oppId` 근거 상세, `/sales-analysis` 영업 분석(#608),
// `/opportunities/:oppId/report` 회사별 보고서(#565, 인쇄용이라 메뉴가 있는 공통 틀 없이 그린다).
import { Route, Routes } from 'react-router-dom';
import AppFrame from './components/frame/AppFrame';
import { frame } from './labels/ko';
import CompanyReportPage from './pages/CompanyReportPage';
import DashboardPage from './pages/DashboardPage';
import OpportunityDetailPage from './pages/OpportunityDetailPage';
import OpportunityListPage from './pages/OpportunityListPage';
import SalesAnalysisPage from './pages/SalesAnalysisPage';

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
      <Route
        path="/opportunities"
        element={
          <AppFrame title={frame.pageTitleList}>
            <OpportunityListPage />
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
