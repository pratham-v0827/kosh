// BUG-031: Vercel ran the server functions on its project default, Node 26 (apps/web/package.json
// named no version). There, firebase-admin/auth failed to load (jwks-rsa require()s the ESM-only
// jose: ERR_REQUIRE_ESM), so every API route answered an empty HTTP 500. Kosh is developed and
// tested on the Node in .nvmrc; the deployed app must run that same major version.
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = fileURLToPath(new URL('../../..', import.meta.url));
const nvmrc = readFileSync(`${root}/.nvmrc`, 'utf8').trim();
const web = JSON.parse(readFileSync(`${root}/apps/web/package.json`, 'utf8')) as {
  engines?: { node?: string };
};

describe('server runtime Node version (BUG-031)', () => {
  it('apps/web pins the .nvmrc major (Vercel reads engines from the Root Directory)', () => {
    expect(nvmrc).toMatch(/^\d+$/);
    expect(web.engines?.node).toBe(`${nvmrc}.x`);
  });

  it('this Node is that major', () => {
    expect(process.versions.node.split('.')[0]).toBe(nvmrc);
  });

  it('firebase-admin/auth loads through require(), as the server function loads it', () => {
    const require = createRequire(`${root}/apps/web/package.json`);
    expect(() => require('firebase-admin/auth')).not.toThrow();
  });
});
