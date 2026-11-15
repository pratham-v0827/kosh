import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import AxeBuilder from '@axe-core/playwright';
import { test as base, expect, type Page } from '@playwright/test';
import { E2E_USER, latestSignInLink, signInLinkCount } from './emulator';

/** Recordings land here; the folder is git-ignored (repo root /artifacts/). */
export const VIDEO_DIR = resolve(__dirname, '../../../../artifacts/videos/m3');

interface Problem {
  kind: 'console' | 'pageerror' | 'requestfailed' | 'http';
  text: string;
}

/**
 * A Firestore listen channel or an in-flight request cancelled because the page navigated away
 * is not a failure: the browser reports it as ERR_ABORTED. Anything else is.
 */
const isNavigationAbort = (failure: string | undefined) => failure === 'net::ERR_ABORTED';

export const test = base.extend<{ problems: Problem[] }>({
  problems: [
    async ({ page }, use, testInfo) => {
      const problems: Problem[] = [];
      page.on('console', (m) => {
        if (m.type() === 'error') problems.push({ kind: 'console', text: m.text() });
      });
      page.on('pageerror', (e) => problems.push({ kind: 'pageerror', text: e.message }));
      page.on('requestfailed', (r) => {
        const failure = r.failure()?.errorText;
        if (!isNavigationAbort(failure)) {
          problems.push({ kind: 'requestfailed', text: `${failure} ${r.method()} ${r.url()}` });
        }
      });
      // BUG-025: Google's sign-in helper must load only when someone chooses Google sign-in,
      // which these tests never do.
      page.on('request', (r) => {
        if (new URL(r.url()).hostname === 'apis.google.com') {
          problems.push({ kind: 'http', text: `Google sign-in helper loaded: ${r.url()}` });
        }
      });
      page.on('response', (r) => {
        if (r.status() >= 400) {
          problems.push({ kind: 'http', text: `${r.status()} ${r.request().method()} ${r.url()}` });
        }
      });
      await use(problems);
      // Zero console errors and zero failed requests, on every test.
      expect(problems, `console errors or failed requests in "${testInfo.title}"`).toEqual([]);
    },
    { auto: true },
  ],
});

export { expect };

/** Sign in as pratham_test through the real email-link flow (the link is read from the emulator). */
export async function signIn(page: Page, next = '/dashboard') {
  const before = await signInLinkCount(E2E_USER.email);
  await page.goto(`/sign-in?next=${encodeURIComponent(next)}`);
  await page.getByLabel('Email').fill(E2E_USER.email);
  await page.getByRole('button', { name: 'Email me a sign-in link' }).click();
  await expect(page.getByRole('status')).toContainText(E2E_USER.email);
  await expect.poll(() => signInLinkCount(E2E_USER.email)).toBeGreaterThan(before);
  const link = await latestSignInLink(E2E_USER.email);
  await page.goto(link!);
  await page.waitForURL((u) => u.pathname === next, { timeout: 30_000 });
}

/** WCAG 2.2 A and AA, as axe checks them. */
export async function expectAccessible(page: Page, label: string) {
  const { violations } = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
    .analyze();
  const summary = violations.map((v) => ({
    id: v.id,
    impact: v.impact,
    help: v.help,
    targets: v.nodes.slice(0, 5).map((n) => n.target.join(' ')),
  }));
  expect(summary, `accessibility violations on ${label}`).toEqual([]);
}

/** Keep this test's video under artifacts/videos/m3/<name>.webm. */
export async function keepVideo(page: Page, name: string) {
  const video = page.video();
  if (!video) return;
  mkdirSync(VIDEO_DIR, { recursive: true });
  await page.close();
  await video.saveAs(resolve(VIDEO_DIR, `${name}.webm`));
}
