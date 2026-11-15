import test from 'node:test';
import assert from 'node:assert/strict';
import { deflateSync } from 'node:zlib';
import { PDFDocument } from 'pdf-lib';
import { submitLongStayFirst, submitLongStaySecond, getLongStayInvitation, cleanupLongStayInvitations } from '../src/longstay-workflow.js';
import { getLongStayReview, decideLongStayReview } from '../src/longstay-review.js';
import { fillMutualAgreementPDF, generateMutualLeaseDraft } from '../src/longstay-lease.js';

function crc32(bytes) {
  let c=0xffffffff;
  for(const b of bytes){c^=b;for(let k=0;k<8;k++)c=c&1?(c>>>1)^0xedb88320:c>>>1;}
  return (c^0xffffffff)>>>0;
}
function chunk(type,data) {
  const kind=Buffer.from(type,'ascii'),len=Buffer.alloc(4),crc=Buffer.alloc(4);
  len.writeUInt32BE(data.length);crc.writeUInt32BE(crc32(Buffer.concat([kind,data])));
  return Buffer.concat([len,kind,data,crc]);
}
function samplePNG(){
  const width=32,height=32,raw=[];
  for(let y=0;y<height;y++){
    raw.push(0);
    for(let x=0;x<width;x++) {
      const v=(x*17+y*31+x*y*7)&255;
      raw.push(v,(v*19)&255,(v*37)&255,255);
    }
  }
  const ihdr=Buffer.alloc(13);ihdr.writeUInt32BE(width,0);ihdr.writeUInt32BE(height,4);ihdr[8]=8;ihdr[9]=6;
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',ihdr),chunk('IDAT',deflateSync(Buffer.from(raw))),chunk('IEND',Buffer.alloc(0))]);
}
const png=samplePNG();
const signature='data:image/png;base64,'+png.toString('base64');
assert.ok(signature.length>250);
function buildFirst({second=true,missingDocument=false,wrongRoom=false}={}){
 const f=new FormData();
 const fields={
  people:second?'Two people':'Just me',houseRules:'Yes',firstName:'TEST',lastName:'Applicant',
  email:'first@example.com',phone:'0400000001',occupation:'Student',
  workFromHome:'No',employer:'Test School',income:'450',
  secondEmail:second?'second@example.com':'',
  property:'NSW - Arncliffe Street, Wolli Creek',room:wrongRoom?'Master room with ensuite':'Room 2 (near kitchen)',
  moveIn:'2026-12-10',length:'6 months',weeklyRent:'450',
  payFrequency:'Every 2 weeks',linen:'No, I will use my own',
  declaration:'Yes',privacyConsent:'Yes',signature
 };
 for(const [key,value] of Object.entries(fields))f.append(key,value);
 f.append('photoId1',new File([png],'TEST-photo-id.png',{type:'image/png'}));
 if(!missingDocument)f.append('incomeProof1',new File([png],'TEST-income.png',{type:'image/png'}));
 return f;
}
function buildSecond(token){
 const f=new FormData();
 const fields={
  invitationToken:token,secondFirstName:'TEST SECOND',secondLastName:'Applicant',secondPhone:'0400000002',
  secondOccupation:'Casual employee',secondWorkFromHome:'Sometimes',secondEmployer:'Test Business',
  secondIncome:'550',secondDeclaration:'Yes',secondPrivacyConsent:'Yes',signature
 };
 for(const [key,value] of Object.entries(fields))f.append(key,value);
 f.append('secondId',new File([png],'TEST-second-id.png',{type:'image/png'}));
 f.append('secondIncomeProof',new File([png],'TEST-second-income.png',{type:'image/png'}));
 return f;
}
function makeRequest(path,form,method='POST') {
 return new Request('https://www.prohouse.com.au'+path,{
  method, ...(form?{body:form}:{}),
  headers:{Origin:'https://www.prohouse.com.au'}
 });
}
function mockEnv(){
 const rows=new Map(),reviews=new Map(),templates=new Map(),docs=new Map(),sent=[];
 return {
  rows,reviews,templates,docs,sent,
  env:{
   RESEND_API_KEY:'unit-test-value',APPLICATION_FROM_EMAIL:'ProHouse TEST <no-reply@prohouse.com.au>',
   PROHOUSE_ADMIN_EMAILS:'hi@prohouse.com.au',
   LONGSTAY_DB:{
    prepare(sql){
     const args={};
     return {bind(...p){args.values=p;return this;},
      async first(){
       if(sql.includes('SELECT COUNT(*) AS chunks FROM longstay_application_documents'))
         return {chunks:(docs.get(args.values[0])||new Map()).size};
       if(sql.includes('SELECT ciphertext FROM longstay_application_documents')){
         const b=docs.get(args.values[0])?.get(args.values[1]);
         return b?{ciphertext:[...b]}:null;
       }
       if(sql.includes('WHERE invite_hash'))return [...rows.values()].find(x=>x.invite_hash===args.values[0])||null;
       if(sql.includes('WHERE token_hash'))return [...reviews.values()].find(x=>x.token_hash===args.values[0])||null;
       if(sql.includes('SELECT template_bytes FROM longstay_lease_templates'))return templates.has(args.values[0])?
         {template_bytes:[...templates.get(args.values[0])]}:null;
       throw Error('Unexpected D1 SELECT '+sql);
      },
      async run(){
       const v=args.values||[];
       if(sql.startsWith('INSERT INTO longstay_application_documents')){
         let chunks=docs.get(v[0]);if(!chunks){chunks=new Map();docs.set(v[0],chunks);}
         chunks.set(v[1],v[2]);return {meta:{changes:1}};
       }
       if(sql.startsWith('DELETE FROM longstay_application_documents')){
         docs.delete(v[0]);return {meta:{changes:1}};
       }
       if(sql.startsWith('INSERT INTO longstay_lease_templates')){templates.set(v[0],v[1]);return {meta:{changes:1}}}
       if(sql.startsWith('INSERT INTO longstay_reviews')){
        const [reference,token_hash,status,first_email,second_email,summary_json,created_at,expires_at]=v;
        reviews.set(reference,{reference,token_hash,status,first_email,second_email,summary_json,created_at,expires_at});
        return {meta:{changes:1}};
       }
       if(sql.startsWith('DELETE FROM longstay_reviews')){reviews.delete(v[0]);return {meta:{changes:1}};}
       if(sql.startsWith("UPDATE longstay_reviews SET status=")){
        const [status,decision_at,reference,token_hash]=v;
        const row=reviews.get(reference);
        if(!row||row.status!=='pending'||row.token_hash!==token_hash)return {meta:{changes:0}};
        row.status=status;row.decision_at=decision_at;return {meta:{changes:1}};
       }
       if(sql.startsWith('INSERT INTO longstay_applications')) {
        const [reference,first_email,first_name,second_email,invite_hash,first_data,first_signature,status,created_at,expires_at]=v;
        rows.set(reference,{reference,first_email,first_name,second_email,invite_hash,first_data,first_signature,status,created_at,expires_at});
        return {meta:{changes:1}};
       }
       if(sql.startsWith('DELETE FROM longstay_applications')){rows.delete(v[0]);return {meta:{changes:1}}}
       if(sql.includes('SET first_email_id')){const row=rows.get(v[2]);row.first_email_id=v[0];row.first_summary_pages=v[1];return {meta:{changes:1}};}
       if(sql.includes('SET invitation_sent_at')){rows.get(v[1]).invitation_sent_at=v[0];return {meta:{changes:1}}}
       if(sql.includes("SET status='processing'")){const r=rows.get(v[0]);if(r?.status!=='invited')return {meta:{changes:0}};r.status='processing';return {meta:{changes:1}}}
       if(sql.includes("SET status='completed'")){const r=rows.get(v[1]);r.status='completed';r.first_data=null;r.first_signature=null;r.completed_at=v[0];return {meta:{changes:1}}}
       if(sql.includes("SET status='invited'")){rows.get(v[0]).status='invited';return {meta:{changes:1}}}
       throw Error('Unexpected D1 operation '+sql);
      }}
    }
   }
  }
 };
}
test('required photo ID and income proof are enforced without emailing',async()=>{
 const m=mockEnv(),original=globalThis.fetch;
 globalThis.fetch=async()=>{throw Error('Email should not have been called')};
 try{
  const r=await submitLongStayFirst(makeRequest('/api/longstay/application',buildFirst({missingDocument:true})),m.env);
  assert.equal(r.status,400);assert.match((await r.json()).message,/photo ID and proof of income/i);
  assert.equal(m.rows.size,0);
 }finally{globalThis.fetch=original}
});
test('property and room must match; invalid selection blocked',async()=>{
 const m=mockEnv();
 const r=await submitLongStayFirst(makeRequest('/api/longstay/application',buildFirst({wrongRoom:true})),m.env);
 assert.equal(r.status,400);
 assert.match((await r.json()).message,/room for your selected property/i);
});
test('two applicant lifecycle emails, PDF signatures and D1 cleanup',async()=>{
 const m=mockEnv(),original=globalThis.fetch;
 globalThis.fetch=async(url,options)=>{
  const u=String(url);
  if(u.includes('/emails/')&&u.endsWith('/attachments')){
   const first=m.sent.find(x=>x.subject.includes('[1/3 received]'));
   return Response.json({data:[{id:'file-pdf',filename:m.rows.values().next().value.reference+'-applicant-1.pdf',
      download_url:'https://testing.example/first.pdf'}]});
  }
  if(u==='https://testing.example/first.pdf'){
   const first=m.sent.find(x=>x.subject.includes('[1/3 received]'));
   return new Response(Buffer.from(first.attachments[0].content,'base64'),{status:200,headers:{'Content-Type':'application/pdf'}});
  }
  assert.equal(u,'https://api.resend.com/emails');
  const payload=JSON.parse(options.body);m.sent.push(payload);
  const id='00000000-0000-4000-8000-'+String(m.sent.length).padStart(12,'0');
  return Response.json({id});
 };
 try{
  const response=await submitLongStayFirst(makeRequest('/api/longstay/application',buildFirst()),m.env);
  assert.equal(response.status,200);
  const first=await response.json();assert.equal(first.status,'awaiting_second');
  assert.ok(first.reference.startsWith('LH-'));
  assert.equal(m.rows.size,1);
  const firstMail=m.sent.find(x=>x.subject.includes('[1/3 received]'));
  assert.ok(firstMail);assert.equal(firstMail.to[0],'hi@prohouse.com.au');
  assert.equal(firstMail.attachments.length,1); // single PDF contains summary, ID, income proof
  assert.ok((await PDFDocument.load(Buffer.from(firstMail.attachments[0].content,'base64'))).getPageCount()>=3);
  assert.ok(m.docs.get(first.reference)?.size>=1,'Encrypted PDF must be temporarily stored for joint application');
  const invite=m.sent.find(x=>x.subject.includes('Complete your ProHouse joint application'));
  assert.ok(invite);
  assert.deepEqual(invite.to,['second@example.com']);
  const match=invite.text.match(/#token=([a-f0-9]{64})/);assert.ok(match,'private invitation link missing');
  const token=match[1];
  assert.ok(!invite.text.includes('TEST-photo-id.png')); // no documents shared with second
  const get=await getLongStayInvitation(
    new Request('https://www.prohouse.com.au/api/longstay/invitation?token='+token),m.env);
  assert.equal(get.status,200);
  const preview=await get.json();
  assert.equal(preview.firstApplicant.room,'Room 2 (near kitchen)');
  assert.equal(preview.firstApplicant.income,undefined);
  assert.ok(!invite.text.includes('Occupation:'));
  assert.ok(!invite.text.includes('Work from home:'));
  assert.ok(!invite.text.includes('Employer or school:'));
  assert.ok(!invite.text.includes('Weekly income'));
  assert.ok(invite.text.includes('automatically deleted after 48 hours'));
  assert.ok(!invite.text.includes('expires in 48 hours'));
  assert.ok(!invite.text.includes('must submit their information and mandatory documents within 48 hours'));
  assert.ok(m.sent.find(x=>x.subject.startsWith('Second applicant invited')).text.includes('draft and stored documents will be deleted after 48 hours'));
  assert.ok(new Date(m.rows.get(first.reference).expires_at).getTime()-Date.now()<49*3600000);
  assert.equal(preview.invitedEmail,'second@example.com');
  assert.equal(m.rows.get(first.reference).first_data.includes('TEST-photo-id.png'),false);
  const secondReply=await submitLongStaySecond(makeRequest('/api/longstay/coapplicant',buildSecond(token)),m.env);
  assert.equal(secondReply.status,200);
  const final=await secondReply.json();assert.equal(final.status,'completed');
  const combined=m.sent.find(x=>x.subject.includes('[REVIEW REQUIRED] ProHouse joint'));
  assert.ok(combined);
  assert.equal(combined.attachments.length,1); // combined PDF contains all first+second evidence
  assert.ok((await PDFDocument.load(Buffer.from(combined.attachments[0].content,'base64'))).getPageCount()>=5);
  const reviewLink=combined.text.match(/#token=([a-f0-9]{64})/);
  assert.ok(reviewLink,'private review token missing');
  const review=await getLongStayReview(new Request('https://www.prohouse.com.au/api/longstay/review?token='+reviewLink[1]),m.env);
  assert.equal((await review.json()).status,'pending');
  const decided=await decideLongStayReview(new Request('https://www.prohouse.com.au/api/longstay/review',{
    method:'POST',headers:{'Content-Type':'application/json',Origin:'https://www.prohouse.com.au'},
    body:JSON.stringify({token:reviewLink[1],decision:'approved'})
  }),m.env);
  assert.equal((await decided.json()).status,'approved');
  assert.equal(m.reviews.get(first.reference).status,'approved');
  const approvalEmails=m.sent.filter(x=>x.subject.startsWith('Congratulations! Your ProHouse application is approved'));
  assert.equal(approvalEmails.length,2);
  assert.deepEqual(approvalEmails.map(x=>x.to[0]).sort(),['first@example.com','second@example.com']);
  assert.ok(approvalEmails.every(x=>x.text.includes('Your 24-hour countdown does NOT start')));
  assert.ok(approvalEmails.every(x=>x.text.toLowerCase().includes('schedule a, the last page')));
  assert.ok(approvalEmails.every(x=>x.text.includes('Commonwealth Bank')));
  assert.ok(approvalEmails.every(x=>x.text.includes('IF YOU WITHDRAW AFTER SIGNING AND PAYING')));
  assert.ok(approvalEmails.every(x=>x.text.includes('not an automatic non-refundable cancellation fee')));
  assert.ok(approvalEmails.every(x=>x.text.includes('BEFORE ProHouse will countersign')));
  const repeatDecision=await decideLongStayReview(new Request('https://www.prohouse.com.au/api/longstay/review',{
    method:'POST',headers:{'Content-Type':'application/json',Origin:'https://www.prohouse.com.au'},
    body:JSON.stringify({token:reviewLink[1],decision:'rejected'})
  }),m.env);
  assert.equal((await repeatDecision.json()).status,'approved');
  assert.equal(m.rows.get(first.reference).status,'completed');
  assert.equal(m.rows.get(first.reference).first_data,null);
  assert.equal(m.rows.get(first.reference).first_signature,null);
  assert.equal(m.docs.has(first.reference),false,'Temporary first-person PDF must be deleted after completion');
  assert.ok(m.sent.some(x=>x.subject.includes('Both applicants submitted')));
  assert.ok(m.sent.some(x=>x.subject.includes('Your ProHouse application is complete')));
  const repeat=await submitLongStaySecond(makeRequest('/api/longstay/coapplicant',buildSecond(token)),m.env);
  assert.equal((await repeat.json()).status,'completed');
 }finally{globalThis.fetch=original}
});
test('existing 48-hour invitation survives unavailable Resend attachment retrieval',async()=>{
 const m=mockEnv(),original=globalThis.fetch;
 globalThis.fetch=async(url,options)=>{
  const uri=String(url);
  if(uri.includes('/emails/')&&uri.endsWith('/attachments'))
   return Response.json({message:'Attachment retrieval unavailable'},{status:403});
  if(uri!=='https://api.resend.com/emails')throw Error('Unexpected network request '+uri);
  const payload=JSON.parse(options.body);m.sent.push(payload);
  return Response.json({id:'00000000-0000-4000-8000-'+String(m.sent.length).padStart(12,'0')});
 };
 try{
  const r=await submitLongStayFirst(makeRequest('/api/longstay/application',buildFirst()),m.env);
  assert.equal(r.status,200);
  const first=await r.json();
  const invite=m.sent.find(x=>x.subject.includes('Complete your ProHouse joint application'));
  assert.ok(invite);
  const token=invite.text.match(/#token=([a-f0-9]{64})/)[1];
  // Emulate an invitation sent before encrypted temporary storage was deployed.
  m.docs.delete(first.reference);
  const answer=await submitLongStaySecond(makeRequest('/api/longstay/coapplicant',buildSecond(token)),m.env);
  assert.equal(answer.status,200);
  const completed=await answer.json();
  assert.equal(completed.status,'completed');
  assert.equal(completed.documentsCombined,false);
  const originalMail=m.sent.find(x=>x.subject.includes('[1/3 received]'));
  const secondMail=m.sent.find(x=>x.subject.includes('[REVIEW REQUIRED: TWO PDF EMAILS]'));
  assert.ok(originalMail&&secondMail,'Admin must receive both separate PDF attachments');
  assert.match(secondMail.text,/FIRST-applicant ID and income files were delivered in the EARLIER ProHouse admin email/);
  assert.equal(originalMail.attachments.length,1);
  assert.equal(secondMail.attachments.length,1);
  assert.ok((await PDFDocument.load(Buffer.from(secondMail.attachments[0].content,'base64'))).getPageCount()>=3);
  assert.ok(m.reviews.get(first.reference),'Review link created even on fallback');
 }finally{globalThis.fetch=original;}
});
test('rent payment frequency accepts fortnightly, four weekly and calendar monthly, not weekly',async()=>{
 const m=mockEnv();
 const form=buildFirst({second:false});
 form.set('payFrequency','Every week');
 const r=await submitLongStayFirst(makeRequest('/api/longstay/application',form),m.env);
 assert.equal(r.status,400);
 assert.match((await r.json()).message,/payment frequency/);
});
test('expired incomplete joint draft is deleted with private encrypted PDF when invitation is opened',async()=>{
 const m=mockEnv(),savedFetch=globalThis.fetch;
 globalThis.fetch=async(url,options)=>{
  const q=String(url);
  if(q==='https://api.resend.com/emails'){const payload=JSON.parse(options.body);m.sent.push(payload);
   return Response.json({id:'00000000-0000-4000-8000-'+String(m.sent.length).padStart(12,'0')});}
  throw Error('Unexpected external request '+q);
 };
 try{
  const first=await submitLongStayFirst(makeRequest('/api/longstay/application',buildFirst()),m.env);
  assert.equal(first.status,200);
  const ref=(await first.json()).reference;
  const invite=m.sent.find(x=>x.subject.includes('Complete your ProHouse joint application'));
  const token=invite.text.match(/#token=([a-f0-9]{64})/)[1];
  assert.ok(m.docs.has(ref));
  const row=m.rows.get(ref);row.expires_at=new Date(Date.now()-60_000).toISOString();
  const result=await getLongStayInvitation(new Request('https://www.prohouse.com.au/api/longstay/invitation?token='+token),m.env);
  assert.equal(result.status,410);
  assert.match((await result.json()).message,/deleted after 48 hours/);
  assert.equal(m.rows.has(ref),false);
  assert.equal(m.docs.has(ref),false);
 }finally{globalThis.fetch=savedFetch;}
});
test('single applicant receives its confirmation and owner receives uploaded files',async()=>{
 const m=mockEnv(),original=globalThis.fetch;
 globalThis.fetch=async(_url,options)=>{m.sent.push(JSON.parse(options.body));return new Response('{}',{status:200});};
 try{
  const r=await submitLongStayFirst(makeRequest('/api/longstay/application',buildFirst({second:false})),m.env);
  assert.equal((await r.json()).status,'completed');
  assert.equal(m.rows.size,0);
  assert.equal(m.sent.length,2);
  assert.equal(m.sent[0].attachments.length,1);
  assert.ok((await PDFDocument.load(Buffer.from(m.sent[0].attachments[0].content,'base64'))).getPageCount()>=3);
  assert.ok(m.sent[0].text.includes('/operations/livewithus/review/#token='));
  assert.deepEqual(m.sent[1].to,['first@example.com']);
 }finally{globalThis.fetch=original}
});

test('approved applicant Schedule A merge produces exactly six pages without lease signatures',async()=>{
 const doc=await PDFDocument.create();
 for(let i=0;i<6;i++)doc.addPage([595.3,841.89]);
 const template=new Uint8Array(await doc.save());
 const data={
  people:'Two people',firstName:'Taylor',lastName:'Example',email:'taylor@example.com',
  phone:'0400000001',secondFirstName:'Jordan',secondLastName:'Example',
  secondEmail:'jordan@example.com',secondPhone:'0400000002',
  room:'Room 2 (near kitchen)',property:'NSW - Arncliffe Street, Wolli Creek'
 };
 const settings={
  fullAddress:'G01/52-62 Arncliffe Street, Wolli Creek NSW 2205',
  acceptedWeeklyRent:'450.00',rentFrequency:'Every 2 weeks',
  leaseStart:'2026-12-01',leaseEnd:'2027-05-31',cleaningBond:'450',
  holdingFund:'0',internet:'$30 per calendar month',electricity:'Equally split',
  water:'Equally split',bankDetails:'067 873 - 1998 7232',
  providerSigner:'ProHouse authorised agent'
 };
 const output=await fillMutualAgreementPDF(template,data,settings,'LH-TEST-0001');
 const result=await PDFDocument.load(output);
 assert.equal(result.getPageCount(),6);
 assert.ok(output.length>template.length);
 assert.equal(result.getTitle(),'Draft ProHouse mutual agreement - LH-TEST-0001');
 assert.match(result.getSubject(),/not signed/i);
});
test('staff draft endpoint requires an approved review token and confirmed financial fields',async()=>{
 const m=mockEnv(),original=globalThis.fetch;
 const token='a'.repeat(64),buffer=new TextEncoder().encode(token);
 const hash=[...new Uint8Array(await crypto.subtle.digest('SHA-256',buffer))].map(x=>x.toString(16).padStart(2,'0')).join('');
 const data={
  people:'Just me',firstName:'Taylor',lastName:'Example',email:'taylor@example.com',
  phone:'0400000001',room:'Room 1',property:'NSW - Arncliffe Street, Wolli Creek'
 };
 const future=new Date(Date.now()+86400000).toISOString();
 m.reviews.set('LH-TEST-0002',{reference:'LH-TEST-0002',token_hash:hash,status:'pending',
  expires_at:future,summary_json:JSON.stringify(data)});
 const doc=await PDFDocument.create();for(let i=0;i<6;i++)doc.addPage([595.3,841.89]);
 const template=new Uint8Array(await doc.save());
 const f=new FormData();
 const fields={
  token,fullAddress:'G01/52-62 Arncliffe Street, Wolli Creek NSW 2205',
  acceptedWeeklyRent:'450',rentFrequency:'Every 2 weeks',
  leaseStart:'2026-12-01',leaseEnd:'2027-05-31',
  cleaningBond:'450',holdingFund:'0',internet:'$30 per calendar month',
  electricity:'Equally split',water:'Equally split',bankDetails:'067 873 - 1998 7232',
  providerSigner:'ProHouse authorised agent'
 };
 for(const [key,value] of Object.entries(fields))f.set(key,value);
 f.set('template',new File([template],'Mutual Agreement.pdf',{type:'application/pdf'}));
 const request=()=>new Request('https://www.prohouse.com.au/api/longstay/lease-draft',{
  method:'POST',headers:{Origin:'https://www.prohouse.com.au'},body:f});
 const forbidden=await generateMutualLeaseDraft(request(),m.env);
 assert.equal(forbidden.status,403);
 m.reviews.get('LH-TEST-0002').status='approved';
 f.set('saveTemplate','Yes');
 const generated=await generateMutualLeaseDraft(request(),m.env);
 assert.equal(generated.status,200);
 assert.ok(m.templates.has('mutual-agreement-v10'));
 f.delete('template');
 const reused=await generateMutualLeaseDraft(request(),m.env);
 assert.equal(reused.status,200);
 assert.equal(generated.headers.get('content-type'),'application/pdf');
 const result=await PDFDocument.load(await generated.arrayBuffer());
 assert.equal(result.getPageCount(),6);
 f.set('acceptedWeeklyRent','');
 const incomplete=await generateMutualLeaseDraft(request(),m.env);
 assert.equal(incomplete.status,400);
 globalThis.fetch=original;
});
