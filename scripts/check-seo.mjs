import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const base = 'https://www.prohouse.com.au';
const publicDir = resolve('public');
const sitemap = readFileSync(resolve(publicDir, 'sitemap.xml'), 'utf8');
const urls = [...sitemap.matchAll(/<loc>(.*?)<\/loc>/g)].map(match => match[1]);
assert(urls.length > 0, 'Sitemap must contain public pages');
assert.equal(new Set(urls).size, urls.length, 'Sitemap contains duplicate URLs');
// Keep historical Google result URLs mapped to the corresponding current content.
const legacyRedirects = {
  "/about-us/contact-us": "/contact/",
  "/owner-and-investor": "/owners/",
  "/policies/complaint-policy": "/complaints/",
  "/policies/customer-service-commitment": "/policies/"
};
const redirectRules = readFileSync(resolve(publicDir, '_redirects'), 'utf8')
  .split(/\r?\n/).map(line => line.trim()).filter(line => line && !line.startsWith('#'))
  .map(line => line.split(/\s+/));
for (const [source, target] of Object.entries(legacyRedirects)) {
  assert(existsSync(resolve(publicDir, '.' + target, 'index.html')), `Missing redirect destination: ${target}`);
  for (const path of [source, source + '/']) {
    const rule = redirectRules.find(([from]) => from === path);
    assert(rule && rule[1] === target && rule[2] === '301', `Missing permanent redirect: ${path} -> ${target}`);
    if (process.argv.includes('--live')) {
      const response = await fetch(base + path, { redirect: 'manual', signal: AbortSignal.timeout(20000) });
      assert.equal(response.status, 301, `Expected permanent live redirect: ${path}`);
      assert.equal(new URL(response.headers.get('location'), base).href, base + target, `Wrong live destination: ${path}`);
    }
  }
}
for (const url of urls) {
  assert(url.startsWith(base + '/'), `Unexpected sitemap host: ${url}`);
  const path = new URL(url).pathname;
  assert(path.endsWith('/'), `Canonical URL must end in a slash: ${url}`);
  assert(!/^\/(G015262|survey|review)(\/|$)/.test(path), `Guest-only page in sitemap: ${url}`);
  const file = resolve(publicDir, '.' + path, 'index.html');
  const html = readFileSync(file, 'utf8');
  assert.equal([...html.matchAll(/<title>/g)].length, 1, `Expected one title: ${url}`);
  assert.equal([...html.matchAll(/<h1(?:\s[^>]*)?>/g)].length, 1, `Expected one main heading: ${url}`);
  assert.equal([...html.matchAll(/name="description"/g)].length, 1, `Expected one meta description: ${url}`);
  assert(html.includes(`<link rel="canonical" href="${url}">`), `Canonical mismatch: ${url}`);
  assert(!/<meta[^>]+name="robots"[^>]+content="[^"]*noindex/.test(html), `Public page is noindex: ${url}`);
  const schemas = [...html.matchAll(/<script type="application\/ld\+json">(.*?)<\/script>/gs)];
  assert(schemas.length, `Missing structured data: ${url}`);
  for (const [, content] of schemas) JSON.parse(content);
  for (const [, asset] of html.matchAll(/(?:src|href)="(\/assets\/[^"?#]+)/g)) {
    assert(existsSync(resolve(publicDir, '.' + asset)), `Missing asset ${asset} on ${url}`);
  }
  for (const [, target] of html.matchAll(/href="(\/[^"?#]*)/g)) {
    assert(existsSync(resolve(publicDir, '.' + target)) || existsSync(resolve(publicDir, '.' + target, 'index.html')), `Broken internal link ${target} on ${url}`);
  }
  if (process.argv.includes('--live')) {
    const response = await fetch(url, { signal: AbortSignal.timeout(20000) });
    assert.equal(response.status, 200, `Live page returned ${response.status}: ${url}`);
    const live = await response.text();
    assert(live.includes(`<link rel="canonical" href="${url}">`), `Live canonical mismatch: ${url}`);
    assert(live.includes('name="description"'), `Missing live meta description: ${url}`);
  }
}
console.log(`SEO health checks passed for ${urls.length} public pages${process.argv.includes('--live') ? ' and their live URLs' : ''}.`);
