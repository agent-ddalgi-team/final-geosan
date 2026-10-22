// 경로: `/` 추천 목록, `/opportunities/:oppId` 근거 상세.
import { Route, Routes } from 'react-router-dom';
import AppFrame from './components/frame/AppFrame';
import { frame } from './labels/ko';
import OpportunityDetailPage from './pages/OpportunityDetailPage';
import OpportunityListPage from './pages/OpportunityListPage';

export default function AppRoutes() {
  return (
    <Routes>
      <Route
        path="/"
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
    </Routes>
  );
}
