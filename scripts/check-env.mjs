#!/usr/bin/env node
// Validate a deployment's environment WITHOUT printing any values.
// Usage: pnpm check-env            (reads apps/web/.env.local if present, plus the process env)
//        pnpm check-env --file path/to/.env
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const args = process.argv.slice(2);
const fileArg = args.includes('--file') ? args[args.indexOf('--file') + 1] : 'apps/web/.env.local';
const file = resolve(process.cwd(), fileArg);

const env = { ...process.env };
if (existsSync(file)) {
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*(#.*)?$/.exec(line);
    if (m && !line.trim().startsWith('#')) env[m[1]] ??= m[2].replace(/^"(.*)"$/, '$1');
  }
  console.log(`Reading ${fileArg} (+ process environment)\n`);
} else {
  console.log(`No ${fileArg}; checking the process environment only\n`);
}

const errors = [];
const warnings = [];
const ok = (msg) => console.log(`  ✓ ${msg}`);
const req = (name, why) => {
  if (!env[name]) errors.push(`${name} is required — ${why}`);
  else ok(`${name} set`);
};

console.log('Firebase web app (public)');
req('NEXT_PUBLIC_FIREBASE_API_KEY', 'Firebase console → Project settings → Your apps');
req('NEXT_PUBLIC_FIREBASE_PROJECT_ID', 'your Firebase project id');
req('NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN', '<project-id>.firebaseapp.com');
const pid = env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
if (pid?.startsWith('demo-'))
  errors.push(
    'NEXT_PUBLIC_FIREBASE_PROJECT_ID is a demo (emulator-only) id; use your real project',
  );
if (
  pid &&
  env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN &&
  !env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN.includes(pid)
) {
  warnings.push(
    'NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN does not contain the project id (fine only for a custom auth domain)',
  );
}
if (env.NEXT_PUBLIC_USE_EMULATORS === 'true')
  errors.push('NEXT_PUBLIC_USE_EMULATORS=true is for local development only');

console.log('\nServer');
req(
  'FIREBASE_SERVICE_ACCOUNT_JSON_BASE64',
  'Project settings → Service accounts → Generate new private key, then base64',
);
if (env.FIREBASE_SERVICE_ACCOUNT_JSON_BASE64) {
  try {
    const sa = JSON.parse(
      Buffer.from(env.FIREBASE_SERVICE_ACCOUNT_JSON_BASE64, 'base64').toString('utf8'),
    );
    if (!sa.private_key || !sa.client_email) throw new Error('missing fields');
    ok('service account decodes');
    if (pid && sa.project_id !== pid)
      errors.push(
        'service account belongs to a different project than NEXT_PUBLIC_FIREBASE_PROJECT_ID',
      );
  } catch {
    errors.push('FIREBASE_SERVICE_ACCOUNT_JSON_BASE64 is not base64 of a service-account JSON');
  }
}
for (const v of ['FIRESTORE_EMULATOR_HOST', 'FIREBASE_AUTH_EMULATOR_HOST']) {
  if (env[v])
    errors.push(`${v} must NOT be set in production (the server would accept unsigned tokens)`);
}
req('APP_BASE_URL', 'your public https URL');
if (env.APP_BASE_URL && !/^https:\/\/[^/]+$/.test(env.APP_BASE_URL))
  warnings.push('APP_BASE_URL should be https://host with no trailing slash');
req('CRON_SECRET', 'random value for /api/cron/* (Vercel sends it automatically)');
if (
  env.CRON_SECRET &&
  (env.CRON_SECRET.length < 32 || env.CRON_SECRET === 'local-dev-cron-secret')
) {
  errors.push('CRON_SECRET must be a long random value (≥ 32 chars), not the local one');
}

console.log('\nPrices (all free)');
const yahoo = (env.ENABLE_UNOFFICIAL_YAHOO ?? 'true').toLowerCase() !== 'false';
ok(`Yahoo Finance (unofficial): ${yahoo ? 'ON' : 'off'} — NSE, BSE fallback, US`);
ok(
  `Alpha Vantage (free key, BSE): ${env.ALPHAVANTAGE_API_KEY ? 'configured' : 'not set (BSE falls back to Yahoo)'}`,
);
ok(
  `Finnhub / Twelve Data (free keys, US): ${env.FINNHUB_API_KEY || env.TWELVEDATA_API_KEY ? 'configured' : 'not set (US uses Yahoo)'}`,
);
if (!yahoo && !env.ALPHAVANTAGE_API_KEY)
  warnings.push('No automatic source for Indian stocks: they will need manual prices');

console.log('\nExposure');
const leaked = Object.keys(env).filter(
  (k) =>
    k.startsWith('NEXT_PUBLIC_') &&
    /SECRET|PRIVATE|SERVICE_ACCOUNT|TOKEN|PASSWORD|ALPHAVANTAGE|FINNHUB|TWELVEDATA|CRON/.test(k),
);
if (leaked.length)
  errors.push(
    `These look like secrets but are NEXT_PUBLIC_ (shipped to browsers): ${leaked.join(', ')}`,
  );
else ok('no secret-looking NEXT_PUBLIC_ variables');

console.log('');
for (const w of warnings) console.log(`  ! ${w}`);
for (const e of errors) console.log(`  ✗ ${e}`);
console.log(
  errors.length
    ? `\n${errors.length} problem(s). See docs/self-hosting.md.`
    : '\nEnvironment looks good.',
);
process.exit(errors.length ? 1 : 0);
