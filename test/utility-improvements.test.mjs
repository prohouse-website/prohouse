import test from 'node:test';
import assert from 'node:assert/strict';
import { PDFDocument } from 'pdf-lib';
import { utilityPDF } from '../src/utilities-pdf.js';
import { extractUtilityInvoice, normaliseUtilityExtraction } from '../src/utility-extraction.js';
const period={type:'water',amount:'360.00',start:'2026-10-01',end:'2026-11-05'};
const occupants=[
  {id:'a',name:'Tenant A',start:'2026-10-01',end:'2026-11-05'},
  {id:'b',name:'Tenant B',start:'2026-11-04',end:'2026-11-05'}
];
const makeBillRequest=body=>new Request('https://example.com/api/utilities/pdf',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
test('concise PDF for example fits on one A4 page',async()=>{
  const env={ASSETS:{fetch:async()=>new Response('',{status:404})}};
  const response=await utilityPDF(makeBillRequest({property:'Wolli Creek',tenants:occupants,bills:[period]}),env);
  assert.equal(response.status,200);
  const bytes=new Uint8Array(await response.arrayBuffer());
  const doc=await PDFDocument.load(bytes);
  assert.equal(doc.getPageCount(),1);
  assert.equal(doc.getPage(0).getWidth(),595.28);
});
test('long multi-tenant, multi-bill split creates a valid multi-page PDF',async()=>{
  const tenants=Array.from({length:60},(_,i)=>({
    id:String(i),name:'Resident '+i,start:'2026-01-01',end:'2026-12-31'
  }));
  const bills=Array.from({length:20},(_,i)=>({...period,id:'bill'+i,amount:'80.09'}));
  const env={ASSETS:{fetch:async()=>new Response('',{status:404})}};
  const response=await utilityPDF(makeBillRequest({tenants,bills}),env);
  assert.equal(response.status,200);
  const doc=await PDFDocument.load(await response.arrayBuffer());
  assert.ok(doc.getPageCount()>=2);
});
test('normalise extraction respects missing/inconsistent fields',()=>{
  const extracted=normaliseUtilityExtraction({answers:{
    amount:{value:360,confidence:.9,p_null:0},
    start:{value:'2026-10-01',confidence:.8},
    end:{value:'2026-11-05',confidence:.8},
    utility:{value:'water'}
  }},'Utility bill details');
  assert.equal(extracted.amount,'360.00');
  assert.equal(extracted.start,'2026-10-01');
  assert.equal(extracted.end,'2026-11-05');
  assert.equal(extracted.type,'water');
  assert.deepEqual(extracted.missing,[]);
  assert.equal(extracted.needsReview,true);
  const missing=normaliseUtilityExtraction({answers:{amount:{value:300},start:{value:'2026-11-05'},end:{value:'2026-10-01'}}},'');
  assert.deepEqual(missing.missing,['start','end']);
  assert.equal(missing.start,null);
});
test('read PDF bytes and use AI only after signed upload checks',async()=>{
  let conversions=0,inferences=0;
  const env={
    UTILITY_SCAN_LIMIT:{limit:async()=>({success:true})},
    AI:{
      toMarkdown:async doc=>{conversions++;assert.equal(doc.name,'utility-invoice.pdf');return [{format:'text',data:'Water supply 1 October 2026 to 5 November 2026 total payable $360.00'}];},
      run:async (model,options)=>{
        inferences++;
        assert.equal(model,'@cf/cloudflare/clairic');
        assert.equal(options.model,'clairic');
        return {answers:{
          amount:{value:360},start:{value:'2026-10-01'},end:{value:'2026-11-05'},utility:{value:'water'}
        }};
      }
    }
  };
  const form=new FormData();
  form.set('bill',new File(['%PDF-1.7\n'+'0'.repeat(100)],'water.pdf',{type:'application/pdf'}));
  const request=new Request('https://example.com/api/utilities/extract',{method:'POST',headers:{Origin:'https://example.com'},body:form});
  const response=await extractUtilityInvoice(request,env);
  assert.equal(response.status,200);
  const result=await response.json();
  assert.deepEqual([result.amount,result.start,result.end],['360.00','2026-10-01','2026-11-05']);
  assert.equal(conversions,1);assert.equal(inferences,1);
});
test('bad origin rejected before AI processing',async()=>{
  const form=new FormData();
  form.set('bill',new File(['%PDF-1.7\n'+'0'.repeat(100)],'bill.pdf',{type:'application/pdf'}));
  const request=new Request('https://example.com/api/utilities/extract',{method:'POST',headers:{Origin:'https://malicious.example'},body:form});
  const response=await extractUtilityInvoice(request,{});
  assert.equal(response.status,403);
});
