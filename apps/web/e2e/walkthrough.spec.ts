import { resolve } from 'node:path';
import type { Page } from '@playwright/test';
import { expect, expectAccessible, keepVideo, signIn, test } from './support/fixtures';

/**
 * The M3 story, recorded: a new user (pratham_test, emulator only) signs in, imports the three
 * kinds of file Kosh reads, all INVENTED fixtures, and looks at the result. Market data is mock.
 * Later projects (pages.spec.ts) reuse the account this leaves behind.
 */
const FIXTURES = resolve(__dirname, '../../../packages/parsers/fixtures');

async function importFile(page: Page, file: string, confirm: RegExp, done: RegExp) {
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Choose file' }).click();
  await (await chooser).setFiles(resolve(FIXTURES, file));
  const button = page.getByRole('button', { name: confirm });
  await expect(button).toBeEnabled({ timeout: 30_000 });
  await button.click();
  await expect(page.getByText(done).first()).toBeVisible({ timeout: 30_000 });
  await expect(button).toBeHidden();
}

test('walkthrough: sign in, import three files, explore the portfolio', async ({ page }) => {
  await test.step('sign in with an email link', async () => {
    await page.goto('/sign-in');
    await expectAccessible(page, 'sign-in');
    await signIn(page);
    await expect(
      page.getByRole('heading', { name: 'Dashboard', exact: true, level: 1 }),
    ).toBeVisible();
  });

  await test.step('import a Groww holdings statement (ISINs matched to tickers)', async () => {
    await page.getByRole('link', { name: 'Import' }).first().click();
    await expect(
      page.getByRole('heading', { name: 'Import', exact: true, level: 1 }),
    ).toBeVisible();
    await importFile(
      page,
      'groww-holdings/holdings.xlsx',
      /^Import Groww holdings$/,
      /Groww: 11 holdings added/,
    );
  });

  await test.step('import an INDmoney US holdings report', async () => {
    await importFile(
      page,
      'indmoney-us-holdings/holdings.xls',
      /^Import INDmoney.* holdings$/,
      /INDmoney.*: \d+ holdings? added/,
    );
  });

  await test.step('import a Kosh CSV of trades', async () => {
    await importFile(page, 'kosh-csv/sample.csv', /^Import \d+ rows$/, /\d+ rows? imported/);
    const history = page.getByRole('table').filter({ hasText: 'Rows added' });
    for (const source of ['Groww', 'INDmoney', 'kosh.csv']) {
      await expect(history.getByRole('row').filter({ hasText: source }).first()).toContainText(
        'Imported',
      );
    }
    await expect(page.getByText('Last imported').first()).toBeVisible();
    await expectAccessible(page, 'import');
  });

  await test.step('dashboard: value, returns, market comparison, allocation', async () => {
    await page.getByRole('link', { name: 'Dashboard' }).first().click();
    await expect(page.getByText('Current value', { exact: true })).toBeVisible();
    await expect(page.getByText('Compared with the market', { exact: true })).toBeVisible();
    await expect(page.getByText('Nifty 50', { exact: true })).toBeVisible({ timeout: 30_000 });
    await page.getByRole('radio', { name: 'Market cap' }).click();
    await expect(page.getByText('Large cap', { exact: true })).toBeVisible();
    await page.getByRole('radio', { name: 'Broker' }).click();
    await expect(page.getByText('Groww').first()).toBeVisible();
    await expectAccessible(page, 'dashboard');
  });

  await test.step('holdings: filter by broker, then open a share', async () => {
    await page.getByRole('link', { name: 'Holdings' }).first().click();
    await expect(
      page.getByRole('heading', { name: 'Holdings', exact: true, level: 1 }),
    ).toBeVisible();
    await expect(page.getByText('ITC LTD').filter({ visible: true }).first()).toBeVisible();
    await expectAccessible(page, 'holdings');
    await page.getByText('ITC LTD').filter({ visible: true }).first().click();
    await expect(page.getByText('Price history', { exact: true })).toBeVisible();
    await expect(page.getByText('Your average cost', { exact: true })).toBeVisible({
      timeout: 30_000,
    });
    await expectAccessible(page, 'holding page');
  });

  await test.step('privacy mode hides every amount; the dollar view converts', async () => {
    await page.keyboard.press('Shift+H');
    await expect(page.getByText('₹••••').first()).toBeVisible();
    await page.keyboard.press('Shift+H');
    await page.getByRole('button', { name: 'Show amounts in US dollars' }).click();
    await expect(page.getByText(/\$[\d,]+\.\d\d/).first()).toBeVisible();
    await page.getByRole('button', { name: 'Show amounts in US dollars' }).click();
  });

  await test.step('command palette finds a holding', async () => {
    await page.keyboard.press('Control+K');
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await page.keyboard.type('reliance');
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\/holdings\/IN_EQUITY%3ARELIANCE|\/holdings\/IN_EQUITY:RELIANCE/);
  });

  await keepVideo(page, 'walkthrough');
});
