// 경로: `/` 추천 목록. 근거 상세(`/opportunities/:oppId`)는 상세 화면을 만들 때 더한다.
import { Route, Routes } from 'react-router-dom';
import AppFrame from './components/frame/AppFrame';
import { frame } from './labels/ko';
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
    </Routes>
  );
}
