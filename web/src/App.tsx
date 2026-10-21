// 라우터(/ , /opportunities/:oppId)와 목록·상세 화면은 이어서 채운다. 지금은 공통 틀만 연결한다.
import { BrowserRouter } from 'react-router-dom';
import AppFrame from './components/frame/AppFrame';
import { frame } from './labels/ko';

export default function App() {
  return (
    <BrowserRouter>
      <AppFrame title={frame.pageTitleList} />
    </BrowserRouter>
  );
}
