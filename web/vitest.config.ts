import { defineConfig, mergeConfig } from 'vitest/config';
import viteConfig from './vite.config';

// 화면 테스트 러너(Vitest 2 + React Testing Library, jsdom). `npm test` = `vitest run`.
// 커버리지는 켜되 하한은 두지 않는다(숫자만 code-summary.md에 적음, 단위 테스트 지침 4장).
export default mergeConfig(
  viteConfig,
  defineConfig({
    test: {
      environment: 'jsdom',
      globals: true,
      setupFiles: ['./src/test/setup.ts'],
      include: ['src/**/*.test.{ts,tsx}', 'src/**/__tests__/**/*.{ts,tsx}'],
      coverage: {
        provider: 'v8',
        reporter: ['text', 'html'],
        include: ['src/**/*.{ts,tsx}'],
        exclude: ['src/test/**', 'src/main.tsx', 'src/vite-env.d.ts'],
      },
    },
  }),
);
