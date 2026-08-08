import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 30_000,
  workers: 1,
  globalSetup: './tests/e2e/fixtures/chrome-state.ts',
  webServer: {
    command:
      'node --experimental-strip-types tests/e2e/fixtures/provider-server.ts',
    url: 'http://127.0.0.1:4173/health',
    reuseExistingServer: false,
    timeout: 30_000
  },
  use: {
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure'
  }
});
