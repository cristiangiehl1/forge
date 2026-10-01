import { defineConfig, devices } from '@playwright/test'

// A port of its own, so the tests never collide with `pnpm dev` (5173).
const PORT = 5273
const VIEWPORT = { width: 1400, height: 900 }

export default defineConfig({
  testDir: './tests',
  outputDir: './test-results',
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: [
    ['list'],
    ['html', { open: 'never', outputFolder: 'playwright-report' }],
  ],
  use: {
    baseURL: `http://localhost:${PORT}`,
    viewport: VIEWPORT,
    // The point of this suite is to be watched: keep a trace, a video and a
    // screenshot of every test, and let SLOWMO slow a headed run down.
    trace: 'on',
    video: 'on',
    screenshot: 'on',
    launchOptions: { slowMo: Number(process.env.SLOWMO ?? 0) },
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'], viewport: VIEWPORT },
    },
  ],
  webServer: {
    command: `pnpm --filter @forge/web exec vite --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: !process.env.CI,
    cwd: '../..',
    timeout: 60_000,
  },
})
