import React from 'react';
import ReactDOM from 'react-dom/client';
import { ConfigProvider } from 'antd';
import koKR from 'antd/locale/ko_KR';
import 'pretendard/dist/web/variable/pretendardvariable.css';
// 영문·숫자 글꼴(#898 참고 그림). 한글은 위 Pretendard가 그린다.
import '@fontsource-variable/urbanist';
import { antdTheme } from './theme/tokens';
import App from './App';
import { applyFontScale, readFontScale } from './components/frame/fontScale';
import './styles.css';

// #926: 기억한 글자 크기를 첫 그림 전에 적용한다(접속 화면 포함, 깜빡임 없이).
applyFontScale(readFontScale());

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <ConfigProvider theme={antdTheme} locale={koKR}>
      <App />
    </ConfigProvider>
  </React.StrictMode>,
);
