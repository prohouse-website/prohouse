import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { summariseBilledDays } from '../src/bill-day-summary.js';
import { calculateUtilitySplit } from '../public/assets/bill-math.js';
import { PDFDocument } from 'pdf-lib';
import { utilityPDF } from '../src/utilities-pdf.js';

const mkTenant=(id,start,end)=>({id,name:'Tenant '+id,start,end});
const mkBill=(id,start,end,amount='100')=>({id,type:'water',amount,start,end});
const calculate=(tenants,bills)=>calculateUtilitySplit({tenants,bills});
const env={ASSETS:{fetch:async()=>new Response('',{status:404})}};
const request=(payload)=>new Request('https://example.com/api/utilities/pdf',
  {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});

test('bill from 1 Oct to 5 Nov has 36 days; tenants present 36 and 2 billed days',()=>{
  const tenants=[mkTenant('A','2026-10-01','2026-11-05'),mkTenant('B','2026-11-04','2026-11-05')];
  const report=calculate(tenants,[mkBill('water','2026-10-01','2026-11-05','360')]);
  const days=summariseBilledDays(report);
  assert.equal(days.billedDays,36);
  assert.equal(days.tenantDays.get('A'),36);
  assert.equal(days.tenantDays.get('B'),2);
  assert.equal(report.bills[0].days,36);
});
test('multiple overlapping bills count unique days, not bill-day sums',()=>{
  const tenants=[mkTenant('A','2026-10-01','2026-10-10'),mkTenant('B','2026-10-04','2026-10-06')];
  const bills=[mkBill('water','2026-10-01','2026-10-05'),mkBill('gas','2026-10-03','2026-10-10')];
  const days=summariseBilledDays(calculate(tenants,bills));
  assert.equal(days.billedDays,10);
  assert.equal(days.tenantDays.get('A'),10);
  assert.equal(days.tenantDays.get('B'),3);
});
test('separate bill periods and stays outside the periods count only their intersection',()=>{
  const tenants=[mkTenant('A','2026-09-15','2026-10-03'),mkTenant('B','2026-11-01','2026-11-05')];
  const bills=[mkBill('water','2026-10-01','2026-10-05'),mkBill('gas','2026-11-03','2026-11-05')];
  const days=summariseBilledDays(calculate(tenants,bills));
  assert.equal(days.billedDays,8);
  assert.equal(days.tenantDays.get('A'),3);
  assert.equal(days.tenantDays.get('B'),3);
  assert.equal(days.vacantDays,2);
});
test('simple PDF remains single-page after showing days and bill totals',async()=>{
  const tenants=[mkTenant('A','2026-10-01','2026-11-05'),mkTenant('B','2026-11-04','2026-11-05')];
  const response=await utilityPDF(request({tenants,bills:[mkBill('water','2026-10-01','2026-11-05','360')]}),env);
  assert.equal(response.status,200,response.status===200?'':await response.clone().text());
  const doc=await PDFDocument.load(await response.arrayBuffer());
  assert.equal(doc.getPageCount(),1);
  const source=readFileSync(new URL('../src/utilities-pdf.js',import.meta.url),'utf8');
  assert.match(source,/daySummary.billedDays/);
  assert.match(source,/b\.days\+' day'/);
  assert.match(source,/daySummary.tenantDays.get\(resident.id\)/);
  assert.match(source,/stayDays\+' stayed \/ '\+billedDays\+' billed days'/);
});
