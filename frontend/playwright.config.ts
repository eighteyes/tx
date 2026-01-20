/**
 * Playwright E2E Test Configuration
 *
 * Assumes backend server is running on port 6000 (or TX_SERVER_PORT).
 * Run tests with: npx playwright test
 */

import { defineConfig, devices } from '@playwright/test';

const serverPort = process.env.TX_SERVER_PORT ?? '6000';
const baseURL = `http://localhost:${serverPort}`;

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: 'html',

  use: {
    baseURL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],

  /* Run local dev server before starting tests (optional) */
  // webServer: {
  //   command: 'npm run dev',
  //   url: baseURL,
  //   reuseExistingServer: !process.env.CI,
  // },
});
