import { resolve } from 'node:path';
import { expect, keepVideo, signIn, test } from './support/fixtures';

/**
 * The one LIVE run: real free price sources instead of mock data. It sends a handful of requests
 * (ISIN lookups and quotes for the invented Groww fixture's shares, the USD rate, index history),
 * so run it by hand, rarely: `pnpm --filter @kosh/web e2e:live`.
 */
const FIXTURES = resolve(__dirname, '../../../packages/parsers/fixtures');

test('live prices: a Groww statement is matched and priced by the real sources', async ({
  page,
}) => {
  await signIn(page);
  await page.getByRole('link', { name: 'Import' }).first().click();
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Choose file' }).click();
  await (await chooser).setFiles(resolve(FIXTURES, 'groww-holdings/holdings.xlsx'));
  const confirm = page.getByRole('button', { name: /^Import Groww holdings$/ });
  await expect(confirm).toBeEnabled({ timeout: 60_000 });
  await confirm.click();
  await expect(page.getByText(/Groww: \d+ holdings? added/).first()).toBeVisible({
    timeout: 60_000,
  });

  await page.getByRole('link', { name: 'Dashboard' }).first().click();
  // Live quotes replace the statement's closing prices once they arrive.
  await expect(page.getByText(/Yahoo Finance \(unofficial\) · \d+/)).toBeVisible({
    timeout: 90_000,
  });
  await expect(page.getByText('Compared with the market')).toBeVisible();
  await keepVideo(page, 'live-prices');
});
