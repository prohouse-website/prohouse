import test from 'node:test';
import assert from 'node:assert/strict';
import { utilityPDF } from '../src/utilities-pdf.js';

const env={ASSETS:{fetch:async()=>new Response('not found',{status:404})}};
const endpoint='https://www.prohouse.com.au/api/utilities/pdf';
function request(payload){
 return new Request(endpoint,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});
}
test('real PDF export provides a readable PDF with cent-reconciled breakdowns',async()=>{
 const response=await utilityPDF(request({
  property:'Wolli Creek Example',
  tenants:[{id:'A',name:'Tenant A',start:'2026-10-01',end:'2026-11-05'},{id:'B',name:'Tenant B',start:'2026-11-04',end:'2026-11-05'}],
  bills:[{id:'water',type:'water',amount:'360.00',start:'2026-10-01',end:'2026-11-05'}]
 }),env);
 assert.equal(response.status,200);
 assert.match(response.headers.get('Content-Type'),/application\/pdf/);
 assert.equal(response.headers.get('Cache-Control'),'private, no-store');
 const bytes=new Uint8Array(await response.arrayBuffer());
 assert.ok(bytes.length>2000);
 assert.equal(new TextDecoder().decode(bytes.slice(0,5)),'%PDF-');
});
test('reject invalid bill data from PDF endpoint without leaking internals',async()=>{
 const response=await utilityPDF(request({
  tenants:[{id:'A',name:'Tenant A',start:'2026-10-01',end:'2026-11-05'}],
  bills:[{type:'water',amount:'-10',start:'2026-10-01',end:'2026-11-05'}]
 }),env);
 assert.equal(response.status,400);
 assert.match((await response.json()).error,/bill amount/);
});
