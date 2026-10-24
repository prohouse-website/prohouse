import { test } from 'node:test';
import assert from 'node:assert/strict';
import { vendorAPI } from '../src/vendor-proxy.js';
const upstream = 'https://new-vendor-agreement-portal-prohouse.hi-07f.workers.dev';
const publicOrigin = 'https://www.prohouse.com.au';
test('forwards portal session and query without unrelated cookies', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async req => {
    assert.equal(req.url, upstream + '/api/vendors/me?test=1');
    assert.equal(req.headers.get('Cookie'), 'ph_cleaner_session=session');
    assert.equal(req.headers.get('Cloudflare-Workers-Version-Overrides'), null);
    return Response.json({ ok: true }, { headers: { 'Set-Cookie': 'ph_cleaner_session=new; Path=/; HttpOnly; Secure; SameSite=Strict' } });
  };
  try {
    const r = await vendorAPI(new Request(publicOrigin + '/api/vendors/me?test=1', { headers: { Cookie: 'other=private; ph_cleaner_session=session', 'Cloudflare-Workers-Version-Overrides': 'untrusted' } }), upstream);
    assert.equal(r.status, 200); assert.equal(r.headers.get('Cache-Control'), 'no-store');
    assert.match(r.headers.get('Set-Cookie'), /ph_cleaner_session=new/);
  } finally { globalThis.fetch = original; }
});
test('rejects cross-origin and missing-origin writes before contacting backend', async () => {
  for (const origin of ['https://untrusted.example', null]) {
    const headers = origin ? { Origin: origin } : {};
    const r = await vendorAPI(new Request(publicOrigin + '/api/vendors/auth/request', { method: 'POST', headers, body: '{}' }), upstream);
    assert.equal(r.status, 403);
  }
});
test('preserves valid POST body and translates origin for existing backend', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async req => {
    assert.equal(req.method, 'POST'); assert.equal(req.headers.get('Origin'), upstream);
    assert.equal(await req.text(), '{"code":"example"}');
    return new Response(null, { status: 302, headers: { Location: upstream + '/vendors/?agreement=example' } });
  };
  try {
    const r = await vendorAPI(new Request(publicOrigin + '/api/vendors/auth/verify', { method: 'POST', headers: { Origin: publicOrigin, 'Content-Type': 'application/json' }, body: '{"code":"example"}' }), upstream);
    assert.equal(r.headers.get('Location'), publicOrigin + '/vendors/?agreement=example');
  } finally { globalThis.fetch = original; }
});
test('returns a controlled response on backend outage', async () => {
  const original = globalThis.fetch; globalThis.fetch = async () => { throw Error('private detail'); };
  try {
    const r = await vendorAPI(new Request(publicOrigin + '/api/vendors/me'), upstream);
    assert.equal(r.status, 502); assert(!JSON.stringify(await r.json()).includes('private detail'));
  } finally { globalThis.fetch = original; }
});
