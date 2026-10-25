import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { inclusiveStayDays } from '../public/assets/bill-dates.js';
const read = path => readFileSync(new URL('../'+path,import.meta.url),'utf8');

test('inclusive stay days are accurate across months, leap years and a same-day stay',()=>{
  assert.equal(inclusiveStayDays('2026-10-01','2026-11-05'),36);
  assert.equal(inclusiveStayDays('2026-11-04','2026-11-05'),2);
  assert.equal(inclusiveStayDays('2026-01-01','2026-01-01'),1);
  assert.equal(inclusiveStayDays('2024-02-28','2024-03-01'),3);
  assert.equal(inclusiveStayDays('2026-11-05','2026-11-04'),null);
  assert.equal(inclusiveStayDays('2026-02-30','2026-03-01'),null);
  assert.equal(inclusiveStayDays('','2026-03-01'),null);
});

test('public Share Bill page is canonical and indexable without an unnecessary standalone day counter',()=>{
  const html=read('public/operations/sharebill/index.html');
  assert.match(html,/<title>Free Share Bill Calculator/);
  assert.match(html,/<h1>SHARE BILL\.<br><em>CALCULATOR\./);
  assert.match(html,/<meta name="robots" content="index,follow">/);
  assert.match(html,/<link rel="canonical" href="https:\/\/www\.prohouse\.com\.au\/operations\/sharebill\/">/);
  for(const token of ['/assets/bill-calculator.js','href="/operations/"','id="tenants-list"','id="add-tenant"'])
    assert.ok(html.includes(token),'Missing '+token);
  for(const removed of ['QUICK TOOL / CALENDAR DAY COUNTER','How many days stayed?','id="counter-from"','id="counter-through"','id="counter-days"'])
    assert.equal(html.includes(removed),false,'Redundant counter remains: '+removed);
});

test('initial resident field is empty and there is a way to add tenants',()=>{
  const js=read('public/assets/bill-calculator.js');
  const init=js.match(/const data = \{[\s\S]*?\};/);
  assert.ok(init);
  assert.match(init[0],/tenants: \[newTenant\(\)\]/);
  assert.doesNotMatch(init[0],/Tenant A|Tenant B/);
  assert.match(js,/newTenant\('',bounds\.start,bounds\.end\)/);
  assert.match(js,/formattedStayDays\(t\.start,t\.end\)/);
});

test('public Operations Portal shortcut, sitemap and legacy redirects are configured',()=>{
  const portal=read('public/operations/index.html');
  const home=read('public/index.html');
  const sitemap=read('public/sitemap.xml');
  const worker=read('src/worker.js');
  for(const path of ['/operations/','/operations/sharebill/']){
    assert.ok(sitemap.includes('https://www.prohouse.com.au'+path));
  }
  assert.match(home,/href="\/operations\/">Operations Portal/);
  assert.match(portal,/href="\/operations\/sharebill\/"/);
  assert.match(worker,/path === '\/bill-calculator\/'/);
  assert.match(worker,/\/operations\/sharebill\/' \+ url\.search/);
});
