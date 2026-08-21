import { defineConfig, devices } from '@playwright/test';
import process from 'node:process';

export default defineConfig({
  testDir: './e2e',
  // Removes the QA_ONLY E2E records the specs create, so repeated runs cannot
  // inflate the inactive registry lists in a local QA database.
  globalTeardown: './e2e/global-teardown.js',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  reporter: process.env.CI ? [['github'], ['list']] : [['list']],
  use: {
    baseURL: 'http://127.0.0.1:5173',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  webServer: [
    {
      command: 'cd ../backend && node scripts/dev-seed-qa.js && node index.js',
      url: 'http://127.0.0.1:3000/api/health',
      reuseExistingServer: Boolean(process.env.PLAYWRIGHT_REUSE_SERVERS),
      timeout: 120_000,
    },
    {
      command: 'node ./node_modules/vite/bin/vite.js --host 127.0.0.1 --port 5173',
      url: 'http://127.0.0.1:5173/login',
      reuseExistingServer: Boolean(process.env.PLAYWRIGHT_REUSE_SERVERS),
      timeout: 120_000,
      env: {
        VITE_API_PROXY_TARGET: 'http://127.0.0.1:3000',
      },
    },
  ],
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
