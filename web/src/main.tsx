import React from 'react';
import ReactDOM from 'react-dom/client';
import { ConfigProvider } from 'antd';
import koKR from 'antd/locale/ko_KR';
import 'pretendard/dist/web/variable/pretendardvariable.css';
import { antdTheme } from './theme/tokens';
import App from './App';
import './styles.css';

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <ConfigProvider theme={antdTheme} locale={koKR}>
      <App />
    </ConfigProvider>
  </React.StrictMode>,
);
