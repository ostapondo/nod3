import { defineConfig, devices } from '@playwright/test'
import path from 'node:path'

/**
 * Absolute, because `npm run -w` starts the server with the workspace as cwd.
 * `__dirname` rather than `import.meta`: Playwright transpiles this config to
 * CommonJS before loading it.
 */
export const E2E_DATA = path.resolve(__dirname, 'data-e2e')

/**
 * Dedicated ports. Sharing 3000/4000 with a running `npm run dev` meant either
 * reusing a server pointed at your real ./data — silently testing the wrong
 * thing — or refusing to start. Its own ports make the suite independent of
 * whatever you have open.
 */
const API_PORT = 4100
const WEB_PORT = 3100

/**
 * The UI is where the untested surface area lives — three pages that only
 * render after client-side fetches, so server-rendered HTML proves nothing.
 * These specs boot the real stack and drive a real browser.
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : [['list']],
  timeout: 60_000,

  use: {
    baseURL: `http://localhost:${WEB_PORT}`,
    trace: 'on-first-retry',
    // Grant the mic and feed it a synthetic source so the interview room can be
    // driven without a human in front of a real microphone.
    permissions: ['microphone'],
    launchOptions: {
      args: [
        '--use-fake-ui-for-media-stream',
        '--use-fake-device-for-media-stream',
        '--autoplay-policy=no-user-gesture-required',
      ],
    },
  },

  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],

  globalSetup: './e2e/seed.ts',

  webServer: [
    {
      command: 'npm run dev:server',
      url: `http://localhost:${API_PORT}/api/health`,
      reuseExistingServer: false,
      timeout: 60_000,
      env: {
        NOD3_DATA: E2E_DATA,
        PORT: String(API_PORT),
        WEB_ORIGIN: `http://localhost:${WEB_PORT}`,
      },
    },
    {
      command: 'npm run dev:web',
      url: `http://localhost:${WEB_PORT}`,
      reuseExistingServer: false,
      timeout: 120_000,
      env: { NEXT_PUBLIC_API: `http://localhost:${API_PORT}`, PORT: String(WEB_PORT) },
    },
  ],
})
