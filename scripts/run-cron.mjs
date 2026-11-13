#!/usr/bin/env node
// Run the daily job against a LOCAL dev server, following its cursor until every user is done.
// Usage: pnpm dev:all   (other terminal)   then   pnpm cron
// Also usable from a GitHub Actions schedule against a deployment (set APP_BASE_URL + CRON_SECRET).

const BASE = process.env.APP_BASE_URL ?? 'http://localhost:3000';
const SECRET =
  process.env.CRON_SECRET ?? (BASE.includes('localhost') ? 'local-dev-cron-secret' : undefined);
if (!SECRET) {
  console.error('Set CRON_SECRET (required for non-local targets).');
  process.exit(2);
}

let cursor = null;
let page = 0;
const totals = { processed: 0, skipped: 0, failed: 0 };
do {
  const url = new URL('/api/cron/daily', BASE);
  url.searchParams.set('chain', '0'); // this script drives the paging itself
  if (cursor) url.searchParams.set('cursor', cursor);
  const r = await fetch(url, { headers: { authorization: `Bearer ${SECRET}` } });
  const j = await r.json().catch(() => null);
  if (!r.ok) {
    console.error(`HTTP ${r.status}`, j);
    process.exit(1);
  }
  if (j.prices) console.log('prices:', JSON.stringify(j.prices));
  for (const k of Object.keys(totals)) totals[k] += j.users[k];
  cursor = j.users.nextCursor;
  page++;
} while (cursor);

console.log(`done in ${page} call(s):`, totals);
