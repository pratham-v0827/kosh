import { randomBytes } from 'node:crypto';
import { defineConfig, devices } from '@playwright/test';

/**
 * End-to-end walkthrough against the LOCAL Firebase emulators (offline project demo-kosh), as the
 * emulator-only user pratham_test. The app runs as a production build on port 3100 next to any
 * `pnpm dev` on 3000. Market data is invented (KOSH_MOCK_PRICES), except in the live run.
 *
 *   pnpm --filter @kosh/web e2e          recorded walkthrough + page checks (mock prices)
 *   pnpm --filter @kosh/web e2e:live     one run against the real free price sources
 */
const PORT = 3100;
export const BASE_URL = `http://127.0.0.1:${PORT}`;
const ci = Boolean(process.env.CI);

/** `live`: real free price sources instead of mock data (playwright.live.config.ts). */
export function e2eConfig(live: boolean) {
  // Read by global setup and teardown (same process).
  process.env.KOSH_E2E_LIVE = live ? '1' : '0';
  const appEnv: Record<string, string> = {
    NEXT_PUBLIC_USE_EMULATORS: 'true',
    NEXT_PUBLIC_FIREBASE_PROJECT_ID: 'demo-kosh',
    NEXT_PUBLIC_FIREBASE_API_KEY: 'demo-api-key',
    NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN: 'demo-kosh.firebaseapp.com',
    FIRESTORE_EMULATOR_HOST: '127.0.0.1:8080',
    FIREBASE_AUTH_EMULATOR_HOST: '127.0.0.1:9099',
    APP_BASE_URL: BASE_URL,
    // Random per run: the daily job is not called by these tests.
    CRON_SECRET: randomBytes(24).toString('hex'),
    KOSH_MOCK_PRICES: live ? 'false' : 'true',
    NEXT_TELEMETRY_DISABLED: '1',
  };

  return defineConfig({
    testDir: './e2e',
    outputDir: './test-results',
    fullyParallel: false,
    workers: 1, // one emulator user, one story
    forbidOnly: ci,
    retries: 0, // a flaky run is a failed run
    timeout: 90_000,
    expect: {
      timeout: 15_000,
      toHaveScreenshot: { maxDiffPixelRatio: 0.01, animations: 'disabled', caret: 'hide' },
    },
    // Font rendering differs by OS: baselines are per platform, and CI does not compare them until
    // it has its own (see e2e/README.md).
    snapshotPathTemplate: '{testDir}/__screenshots__/{platform}/{arg}{ext}',
    ignoreSnapshots: ci,
    reporter: ci ? [['list'], ['html', { open: 'never' }]] : [['list']],
    globalSetup: './e2e/global-setup.ts',
    globalTeardown: './e2e/global-teardown.ts',
    use: {
      baseURL: BASE_URL,
      locale: 'en-IN',
      timezoneId: 'Asia/Kolkata',
      trace: 'retain-on-failure',
      video: 'on',
      reducedMotion: 'reduce',
    },
    projects: live
      ? [
          {
            name: 'live',
            testMatch: /live\.spec\.ts/,
            use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 800 } },
          },
        ]
      : [
          {
            name: 'walkthrough',
            testMatch: /walkthrough\.spec\.ts/,
            use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 800 } },
          },
          {
            name: 'pages',
            testMatch: /pages\.spec\.ts/,
            dependencies: ['walkthrough'],
            use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 800 } },
          },
          {
            name: 'pages-mobile',
            testMatch: /pages\.spec\.ts/,
            dependencies: ['walkthrough'],
            use: { ...devices['Pixel 7'], viewport: { width: 360, height: 780 } },
          },
        ],
    webServer: [
      {
        // Reuses emulators that are already running (pnpm dev:all); starts them otherwise.
        command: 'pnpm --dir ../.. emulators',
        url: 'http://127.0.0.1:8080',
        reuseExistingServer: true,
        timeout: 180_000,
        stdout: 'ignore',
      },
      {
        command: `pnpm exec next build && pnpm exec next start -H 127.0.0.1 -p ${PORT}`,
        url: BASE_URL,
        env: appEnv,
        reuseExistingServer: false,
        timeout: 600_000,
      },
    ],
  });
}

export default e2eConfig(false);
