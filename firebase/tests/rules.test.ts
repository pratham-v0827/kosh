import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';

// These tests prove the privacy guarantees in docs/PLAN.md §5.4:
// per-user isolation, admins never reach /users/**, and nobody reads broker tokens.

let env: RulesTestEnvironment;

const settings = {
  baseCurrency: 'INR',
  numberFormat: 'indian',
  theme: 'system',
  email: { enabled: false, frequency: 'weekly' },
};

beforeAll(async () => {
  env = await initializeTestEnvironment({
    projectId: 'demo-kosh-rules',
    firestore: {
      rules: readFileSync(resolve(import.meta.dirname, '../firestore.rules'), 'utf8'),
    },
  });
});

afterAll(async () => {
  await env?.cleanup();
});

beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await db.doc('users/alice').set({ settings, updatedAt: new Date(0) });
    await db.doc('users/alice/transactions/t1').set({ instrumentId: 'INE002A01018', qty: '10' });
    await db.doc('users/alice/book/current').set({ version: 1 });
    await db.doc('users/alice/connections/kite').set({ ciphertext: 'xxx' });
    await db.doc('users/bob').set({ settings, updatedAt: new Date(0) });
    await db.doc('userMeta/alice').set({ status: 'active', refreshCount: 3 });
    await db.doc('userMeta/bob').set({ status: 'active', refreshCount: 1 });
    await db.doc('instruments/INE002A01018').set({ name: 'Reliance Industries' });
    await db.doc('adminAudit/a1').set({ action: 'block' });
    await db
      .doc('users/alice/instruments/UNLISTED:acme')
      .set({ name: 'Acme', assetClass: 'UNLISTED' });
    await db
      .doc('users/alice/manualPrices/UNLISTED:acme')
      .set({ price: '310', asOf: '2026-11-09' });
  });
});

describe('snapshots, series and shared market data (M2)', () => {
  beforeEach(async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      const db = ctx.firestore();
      await db.doc('users/alice/snapshots/s1').set({ trigger: 'manual', totals: { value: '1' } });
      await db.doc('users/alice/series/2026').set({ d: { '2026-11-09': { v: 1 } } });
      await db.doc('prices/MUTUAL_FUND:120590').set({ price: '116.7', source: 'amfi-navall' });
      await db.doc('fx/USDINR').set({ rate: '93.9' });
      await db
        .doc('trackedInstruments/MUTUAL_FUND:120590')
        .set({ assetClass: 'MUTUAL_FUND', symbol: '120590' });
    });
  });

  it('owner reads own snapshots and series; nobody else (incl. admin) can', async () => {
    await assertSucceeds(alice().doc('users/alice/snapshots/s1').get());
    await assertSucceeds(alice().doc('users/alice/series/2026').get());
    await assertFails(bob().doc('users/alice/snapshots/s1').get());
    await assertFails(admin().collection('users/alice/snapshots').get());
  });

  it('snapshots are immutable from clients', async () => {
    await assertFails(
      alice()
        .doc('users/alice/snapshots/s1')
        .update({ totals: { value: '999' } }),
    );
    await assertFails(alice().doc('users/alice/snapshots/s1').delete());
  });

  it('signed-in users read public prices and FX; tracked instruments are server-only', async () => {
    await assertSucceeds(alice().doc('prices/MUTUAL_FUND:120590').get());
    await assertSucceeds(alice().doc('fx/USDINR').get());
    await assertFails(anon().doc('prices/MUTUAL_FUND:120590').get());
    await assertFails(alice().doc('trackedInstruments/MUTUAL_FUND:120590').get());
    await assertFails(alice().doc('prices/MUTUAL_FUND:120590').set({ price: '1' }));
  });
});

describe('shared provider budgets (M2.1)', () => {
  it('no client (user or admin) can read or tamper with the Alpha Vantage daily budget', async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await ctx
        .firestore()
        .doc('providerBudgets/alphavantage_2026-11-09')
        .set({ used: 3, limit: 25 });
    });
    await assertFails(alice().doc('providerBudgets/alphavantage_2026-11-09').get());
    await assertFails(alice().doc('providerBudgets/alphavantage_2026-11-09').set({ used: 0 }));
    await assertFails(admin().doc('providerBudgets/alphavantage_2026-11-09').get());
  });
});

describe('per-user instruments and manual prices (M1)', () => {
  it('owner can read their own instruments and manual prices', async () => {
    await assertSucceeds(alice().collection('users/alice/instruments').get());
    await assertSucceeds(alice().doc('users/alice/manualPrices/UNLISTED:acme').get());
  });

  it('other users and admins cannot read them, and nobody can write them from a client', async () => {
    await assertFails(bob().collection('users/alice/instruments').get());
    await assertFails(admin().doc('users/alice/manualPrices/UNLISTED:acme').get());
    await assertFails(alice().doc('users/alice/manualPrices/UNLISTED:acme').set({ price: '1' }));
    await assertFails(alice().doc('users/alice/instruments/X').set({ name: 'x' }));
  });

  it('owner can set an email weekday but not a server-managed nextDueAt', async () => {
    const ts = (await import('firebase/compat/app')).default.firestore.FieldValue.serverTimestamp();
    await assertSucceeds(
      alice()
        .doc('users/alice')
        .update({
          settings: { ...settings, email: { enabled: true, frequency: 'weekly', weekday: 3 } },
          updatedAt: ts,
        }),
    );
    await assertFails(
      alice()
        .doc('users/alice')
        .update({
          settings: {
            ...settings,
            email: { enabled: true, frequency: 'weekly', nextDueAt: new Date() },
          },
          updatedAt: ts,
        }),
    );
    await assertFails(
      alice()
        .doc('users/alice')
        .update({
          settings: { ...settings, email: { enabled: true, frequency: 'daily' } },
          updatedAt: ts,
        }),
    );
  });
});

const alice = () => env.authenticatedContext('alice').firestore();
const bob = () => env.authenticatedContext('bob').firestore();
const admin = () => env.authenticatedContext('root', { role: 'admin' }).firestore();
const blockedAlice = () => env.authenticatedContext('alice', { blocked: true }).firestore();
const anon = () => env.unauthenticatedContext().firestore();

describe('per-user isolation', () => {
  it('owner can read their own profile, book and transactions', async () => {
    await assertSucceeds(alice().doc('users/alice').get());
    await assertSucceeds(alice().doc('users/alice/book/current').get());
    await assertSucceeds(alice().collection('users/alice/transactions').get());
  });

  it("another user cannot read someone else's data", async () => {
    await assertFails(bob().doc('users/alice').get());
    await assertFails(bob().doc('users/alice/transactions/t1').get());
    await assertFails(bob().collection('users/alice/transactions').get());
  });

  it('unauthenticated clients read nothing', async () => {
    await assertFails(anon().doc('users/alice').get());
    await assertFails(anon().doc('instruments/INE002A01018').get());
    await assertFails(anon().doc('userMeta/alice').get());
  });

  it('a blocked user cannot read even their own data', async () => {
    await assertFails(blockedAlice().doc('users/alice').get());
    await assertFails(blockedAlice().doc('users/alice/book/current').get());
  });
});

describe('admin privacy boundary', () => {
  it('admin cannot read any user profile or financial data', async () => {
    await assertFails(admin().doc('users/alice').get());
    await assertFails(admin().doc('users/alice/transactions/t1').get());
    await assertFails(admin().doc('users/alice/book/current').get());
    await assertFails(admin().collection('users').get());
  });

  it('admin can read and list non-personal metadata and the audit log', async () => {
    await assertSucceeds(admin().doc('userMeta/alice').get());
    await assertSucceeds(admin().collection('userMeta').get());
    await assertSucceeds(admin().collection('adminAudit').get());
  });

  it('non-admins cannot list userMeta or read the audit log', async () => {
    await assertSucceeds(alice().doc('userMeta/alice').get()); // own metadata only
    await assertFails(alice().doc('userMeta/bob').get());
    await assertFails(alice().collection('userMeta').get());
    await assertFails(alice().collection('adminAudit').get());
  });

  it('nobody can write metadata or audit entries from a client', async () => {
    await assertFails(admin().doc('userMeta/alice').update({ status: 'blocked' }));
    await assertFails(admin().collection('adminAudit').add({ action: 'forged' }));
  });
});

describe('broker tokens', () => {
  it('connections are unreadable by every client, including the owner and admins', async () => {
    await assertFails(alice().doc('users/alice/connections/kite').get());
    await assertFails(alice().collection('users/alice/connections').get());
    await assertFails(admin().doc('users/alice/connections/kite').get());
  });
});

describe('writes go through the server', () => {
  it('owner cannot write ledger, book or snapshots directly', async () => {
    await assertFails(alice().doc('users/alice/transactions/t2').set({ qty: '1' }));
    await assertFails(alice().doc('users/alice/book/current').set({ version: 99 }));
    await assertFails(alice().doc('users/alice/snapshots/s1').set({ totals: {} }));
    await assertFails(alice().doc('users/alice').delete());
  });

  it('owner can update valid settings only', async () => {
    const ok = alice()
      .doc('users/alice')
      .update({
        settings: { ...settings, numberFormat: 'international', theme: 'dark' },
        updatedAt: (
          await import('firebase/compat/app')
        ).default.firestore.FieldValue.serverTimestamp(),
      });
    await assertSucceeds(ok);
  });

  it('rejects unknown settings keys, bad values and extra top-level fields', async () => {
    const ts = (await import('firebase/compat/app')).default.firestore.FieldValue.serverTimestamp();
    await assertFails(
      alice()
        .doc('users/alice')
        .update({ settings: { ...settings, isAdmin: true }, updatedAt: ts }),
    );
    await assertFails(
      alice()
        .doc('users/alice')
        .update({ settings: { ...settings, baseCurrency: 'USD' }, updatedAt: ts }),
    );
    await assertFails(
      alice().doc('users/alice').update({ settings, updatedAt: ts, role: 'admin' }),
    );
  });

  it('public reference data is read-only', async () => {
    await assertSucceeds(alice().doc('instruments/INE002A01018').get());
    await assertFails(alice().doc('instruments/INE002A01018').set({ name: 'x' }));
    await assertFails(alice().doc('prices/INE002A01018').set({ price: '1' }));
  });
});

// ---------- Phase 3 security audit (docs/audits/phase3-security.md) ----------
describe('bulk access and client-writable fields (SEC-012)', () => {
  const serverTs = async () =>
    (await import('firebase/compat/app')).default.firestore.FieldValue.serverTimestamp();

  it('nobody can list all users or query across users', async () => {
    await assertFails(alice().collection('users').get());
    await assertFails(alice().collectionGroup('transactions').get());
    await assertFails(alice().collectionGroup('book').get());
    await assertFails(alice().collectionGroup('snapshots').get());
    await assertFails(alice().collection('userMeta').get());
    await assertFails(alice().collection('userMeta').where('status', '==', 'active').get());
  });

  it('server-only collections are closed to every client', async () => {
    for (const path of [
      'health/ping',
      'metrics/daily_2026-11-09',
      'rateLimits/x',
      'oauthTokens/x',
    ]) {
      await assertFails(alice().doc(path).get());
      await assertFails(alice().doc(path).set({ x: 1 }));
    }
  });

  it('the staleness setting accepts only small per-asset-class day counts', async () => {
    const ts = await serverTs();
    await assertSucceeds(
      alice()
        .doc('users/alice')
        .update({
          settings: { ...settings, staleness: { CRYPTO: 2, UNLISTED: 90 } },
          updatedAt: ts,
        }),
    );
    // unknown keys, non-numbers and huge values would let a client bloat its own document
    await assertFails(
      alice()
        .doc('users/alice')
        .update({ settings: { ...settings, staleness: { junk: 1 } }, updatedAt: ts }),
    );
    await assertFails(
      alice()
        .doc('users/alice')
        .update({
          settings: { ...settings, staleness: { CRYPTO: 'x'.repeat(100_000) } },
          updatedAt: ts,
        }),
    );
    await assertFails(
      alice()
        .doc('users/alice')
        .update({ settings: { ...settings, staleness: { CRYPTO: 100_000 } }, updatedAt: ts }),
    );
  });
});
