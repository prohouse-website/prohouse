import test from 'node:test';
import assert from 'node:assert/strict';
import { PDFDocument } from 'pdf-lib';
import { calculateUtilitySplit } from '../public/assets/bill-math.js';
import { billDateBounds, syncTenantsToBills } from '../public/assets/bill-dates.js';
import { utilityPDF } from '../src/utilities-pdf.js';

const bill=(id,type,amount,start='2026-10-01',end='2026-11-05',label='')=>({id,type,label,amount,start,end});
const tenants=[
  {id:'a',name:'Tenant A',start:'2026-10-01',end:'2026-11-05'},
  {id:'b',name:'Tenant B',start:'2026-11-04',end:'2026-11-05'}
];
const endpoint='https://example.com/api/utilities/pdf';
function formRequest(report,attachments=[]){
  const form=new FormData();form.set('report',JSON.stringify(report));
  for(const item of attachments)form.append('invoice_'+item.id,item.file,item.file.name);
  return new Request(endpoint,{method:'POST',body:form});
}
test('Other bills require a label and display that label in allocation output',()=>{
  assert.throws(()=>calculateUtilitySplit({tenants,bills:[bill('wifi','other','72')]}),/Name each Other bill/);
  const r=calculateUtilitySplit({tenants,bills:[bill('wifi','other','72','2026-10-01','2026-11-05','Internet')]});
  assert.equal(r.bills[0].name,'Internet');
  assert.equal(r.summary.find(x=>x.id==='a').bills[0].name,'Internet');
});
test('bill date bounds follow multiple invoices; edits on tenants remain independent',()=>{
  const entries=[bill('water','water','360','2026-10-01','2026-11-05'),
    bill('gas','gas','70','2026-09-28','2026-11-10')];
  const residents=[{name:'A',start:'',end:'',manualStart:false,manualEnd:false},
    {name:'B',start:'2026-10-16',end:'2026-10-25',manualStart:true,manualEnd:true}];
  assert.deepEqual(billDateBounds(entries),{start:'2026-09-28',end:'2026-11-10'});
  syncTenantsToBills(residents,entries);
  assert.deepEqual([residents[0].start,residents[0].end],['2026-09-28','2026-11-10']);
  assert.deepEqual([residents[1].start,residents[1].end],['2026-10-16','2026-10-25']);
  syncTenantsToBills(residents,entries,{force:true});
  assert.deepEqual([residents[1].start,residents[1].end],['2026-09-28','2026-11-10']);
});
test('export attaches original invoice PDF after summary without modifying invoice pages',async()=>{
  const invoice=await PDFDocument.create();
  const p1=invoice.addPage([450,600]);
  p1.drawText('Invoice attached original', {x:50,y:550});
  invoice.addPage([450,600]);
  const file=new File([await invoice.save()], 'original-water-bill.pdf',{type:'application/pdf'});
  const req=formRequest({property:'Wolli Creek',tenants,bills:[bill('bill-1','water','360')]},
      [{id:'bill-1',file}]);
  const env={ASSETS:{fetch:async()=>new Response('not found',{status:404})}};
  const response=await utilityPDF(req,env);
  assert.equal(response.status,200,await response.text().catch(()=>'')); // response clone? body consumed on failure only
  const pdf=await PDFDocument.load(await response.arrayBuffer());
  assert.equal(pdf.getPageCount(),3);
  assert.deepEqual(pdf.getPage(1).getSize(),{width:450,height:600});
  assert.deepEqual(pdf.getPage(2).getSize(),{width:450,height:600});
});
test('export attaches invoice images after summary',async()=>{
  const file=new File([Uint8Array.from([137,80,78,71,13,10,26,10,0])], 'broken.png',{type:'image/png'});
  // PNG signature passes, but PDF generator rejects corrupt image instead of silently omitting.
  const response=await utilityPDF(formRequest({tenants,bills:[bill('bill-1','water','360')]},[{id:'bill-1',file}]),
    {ASSETS:{fetch:async()=>new Response('',{status:404})}});
  assert.equal(response.status,400);
  assert.match((await response.json()).error,/Could not include attached image/i);
});
