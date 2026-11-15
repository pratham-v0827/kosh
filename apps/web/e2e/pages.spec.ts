import type { Page } from '@playwright/test';
import { expect, expectAccessible, keepVideo, signIn, test } from './support/fixtures';

/**
 * Every signed-in page, on the account the walkthrough left behind: accessible (axe, WCAG 2.2
 * AA), no horizontal scrolling, and unchanged from its screenshot baseline. Runs at desktop and
 * phone width (projects "pages" and "pages-mobile").
 *
 * Masked in screenshots: what changes with the calendar (dates, returns that age by the day, the
 * exchange-rate date, charts drawn up to today), not the amounts, which mock prices keep fixed.
 */
// Written without backslashes on purpose: Windows shells have mangled them in this file before.
const DATE =
  /[0-9]{1,2} (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)|[0-9]{4}-[0-9]{2}-[0-9]{2}| ago|just now/;
const volatile = (page: Page) => [
  page.locator('[data-volatile]'),
  page.getByText(DATE),
  page.locator('.recharts-responsive-container'),
  page.locator('[data-sonner-toaster]'),
];

const PAGES: { path: string; name: string; ready: (p: Page) => Promise<void> }[] = [
  {
    path: '/dashboard',
    name: 'dashboard',
    ready: async (p) => {
      await expect(p.getByText('Nifty 50', { exact: true })).toBeVisible({ timeout: 30_000 });
    },
  },
  {
    path: '/holdings',
    name: 'holdings',
    ready: async (p) => {
      await expect(p.getByText('ITC LTD').filter({ visible: true }).first()).toBeVisible();
    },
  },
  {
    path: '/holdings/IN_EQUITY%3AITC',
    name: 'holding-itc',
    ready: async (p) => {
      await expect(p.getByText('Your average cost', { exact: true })).toBeVisible({
        timeout: 30_000,
      });
    },
  },
  {
    path: '/import',
    name: 'import',
    ready: async (p) => {
      await expect(p.getByText('Import history', { exact: true })).toBeVisible();
      await expect(p.getByText('Last imported').first()).toBeVisible();
    },
  },
  {
    path: '/history',
    name: 'history',
    ready: async (p) => {
      await expect(p.getByRole('heading', { level: 1 })).toBeVisible();
    },
  },
  {
    path: '/settings',
    name: 'settings',
    ready: async (p) => {
      await expect(
        p.getByRole('heading', { name: 'Settings', exact: true, level: 1 }),
      ).toBeVisible();
    },
  },
];

for (const { path, name, ready } of PAGES) {
  test(`${name}: accessible, fits the screen, matches its baseline`, async ({ page }, info) => {
    await signIn(page);
    await page.goto(path);
    await ready(page);
    await expectAccessible(page, name);
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow, 'horizontal scroll').toBeLessThanOrEqual(0);
    await expect(page).toHaveScreenshot(`${info.project.name}-${name}.png`, {
      fullPage: true,
      mask: volatile(page),
    });
    await keepVideo(page, `${info.project.name}-${name}`);
  });
}

test('dashboard in dark mode: accessible and matches its baseline', async ({ page }, info) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  await signIn(page);
  await expect(page.getByText('Nifty 50', { exact: true })).toBeVisible({ timeout: 30_000 });
  await expectAccessible(page, 'dashboard (dark)');
  await expect(page).toHaveScreenshot(`${info.project.name}-dashboard-dark.png`, {
    fullPage: true,
    mask: volatile(page),
  });
  await keepVideo(page, `${info.project.name}-dashboard-dark`);
});
