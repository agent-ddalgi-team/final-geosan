import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// 빌드 결과는 web/dist. `geosan serve`가 이 폴더를 정적 파일로 내보낸다(한 덩어리 실행).
// 개발 중(`npm run dev`)에는 /api 요청을 로컬 서버(127.0.0.1:8000)로 넘긴다.
// VITE_USE_FIXTURES=1 이면 서버 없이 src/test/fixtures의 가짜 응답을 쓴다(src/api/client.ts).
export default defineConfig({
  plugins: [react()],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: false,
  },
  server: {
    port: 5173,
    strictPort: false,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:8000',
        changeOrigin: false,
      },
    },
  },
});
