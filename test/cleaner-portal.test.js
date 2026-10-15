import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { cleanerPortal } from '../src/cleaner-portal.js';
import worker from '../src/worker.js';
const hash=async s=>Buffer.from(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(s))).toString('hex');
const base='https://www.prohouse.com.au';
function database(){const db=new DatabaseSync(':memory:');db.exec(readFileSync(new URL('../migrations/0001_cleaner_portal.sql',import.meta.url),'utf8'));db.exec(readFileSync(new URL('../migrations/0002_vendor_identity.sql',import.meta.url),'utf8'));db.exec(readFileSync(new URL('../migrations/0003_service_evidence.sql',import.meta.url),'utf8'));const prepare=sql=>({sql,values:[],bind(...values){this.values=values.map(v=>v instanceof ArrayBuffer?new Uint8Array(v):v);return this;},async run(){const r=db.prepare(this.sql).run(...this.values);return {meta:{changes:Number(r.changes)}};},async first(){return db.prepare(this.sql).get(...this.values)||null;},async all(){return {results:db.prepare(this.sql).all(...this.values)};}});return {prepare,async batch(ops){db.exec('BEGIN');try{const r=[];for(const o of ops)r.push(await o.run());db.exec('COMMIT');return r;}catch(e){db.exec('ROLLBACK');throw e;}},raw:db};}
function context(){return {CLEANER_DB:database(),RESEND_API_KEY:'test-key',CLEANER_FROM_EMAIL:'ProHouse <agreements@prohouse.com.au>'};}
async function request(env,path,body,session='',origin=base){const req=new Request(base+'/api/cleaners/'+path,{method:body===undefined?'GET':'POST',headers:{...(body===undefined?{}:{'content-type':'application/json',origin}),'cookie':session,'cf-connecting-ip':'192.0.2.1'},...(body===undefined?{}:{body:JSON.stringify(body)})});return cleanerPortal(req,env);}
async function login(env,email,role,mails){const r=await request(env,'auth/request',{email,role});assert.equal(r.status,200);const challenge=r.headers.get('set-cookie').split(';')[0];const mail=mails.at(-1);assert.equal(mail.to[0],email);const code=mail.text.match(/code is (\d{8})/)[1];const v=await request(env,'auth/verify',{code},challenge);assert.equal(v.status,200);return {cookie:v.headers.get('set-cookie').split(';')[0],code,challenge};}
const pdfText=bytes=>execFileSync('pdftotext',['-','-'],{input:bytes}).toString();
// Other lifecycle tests seed an already authenticated Didit outcome. Provider trust is tested separately.
async function uploadAndReview(env,id){env.CLEANER_DB.raw.prepare("INSERT INTO vendor_id_checks(agreement_id,session_id,provider_status,provider_name,checked_at) VALUES(?,?,'Approved','Test Cleaner',?) ON CONFLICT(agreement_id) DO UPDATE SET provider_status='Approved',provider_name='Test Cleaner'").run(id,'fixture-session',new Date().toISOString());}
const proposal={legal:'ProHouse Pty Ltd',abn:'51824753556',address:'Sydney NSW',scope:'Room 1 + bathroom + shared kitchen; replenish supplies and send photos.',rows:[{service:'Room turnover',unit:'Per clean',rate:'80.00'}],gst:'Not GST registered — no GST charged',start:'2026-10-20',paymentDays:7,insurance:'Legally required insurance.'};
const cleaner={legal:'Test Cleaner',entity:'Test Cleaning',abn:'51824753556',phone:'0400000000',address:'Sydney',accountName:'Test Cleaning',bank:'Test Bank',bsb:'123456',accountNumber:'123456789',rows:[{service:'Room turnover',unit:'Per clean',rate:'90.00'}],gst:'Not GST registered — no GST charged',signature:'Test Cleaner',notes:'Supplies included'};
test('full portal lifecycle, privacy, locked signatures and email retries',async t=>{
 const env=context(),mails=[];let fail=false;const realFetch=globalThis.fetch;
 globalThis.fetch=async(url,options)=>{assert.equal(url,'https://api.resend.com/emails');if(fail)return new Response('outage',{status:503});mails.push(JSON.parse(options.body));return Response.json({id:'email-'+mails.length});};
 try {
 const admin=await login(env,'hi@prohouse.com.au','prohouse',mails);
 let id,cleanerSession;
 await t.test('anonymous, cross-origin and unauthorised creation blocked',async()=>{
  assert.equal((await request(env,'agreements')).status,401);
  assert.equal((await request(env,'agreements',{email:'cleaner@example.com',proposal},admin.cookie,'https://evil.test')).status,403);
  assert.equal((await request(env,'agreements',{email:'cleaner@example.com',proposal:{...proposal,abn:'11111111111'}},admin.cookie)).status,400);
 });
 await t.test('invitation stores exact services and sends cleaner link',async()=>{
  const r=await request(env,'agreements',{email:'Cleaner@example.com',proposal},admin.cookie);assert.equal(r.status,201);id=(await r.json()).id;assert.ok(mails.at(-1).text.includes('/cleaners/?agreement='+id));assert.equal(mails.at(-1).to[0],'cleaner@example.com');
  cleanerSession=await login(env,'cleaner@example.com','cleaner',mails);
  assert.equal((await request(env,'auth/verify',{code:cleanerSession.code},cleanerSession.challenge)).status,401);
 });
 await t.test('separate roles; cleaner only sees own agreements',async()=>{
  assert.equal((await request(env,'agreements',{email:'another@example.com',proposal},cleanerSession.cookie)).status,403);
  const second=await request(env,'agreements',{email:'another@example.com',proposal},admin.cookie);const otherId=(await second.json()).id;
  const list=await (await request(env,'agreements',undefined,cleanerSession.cookie)).json();assert.equal(list.items.length,1);assert.equal(list.items[0].email,'cleaner@example.com');
  assert.equal((await request(env,'agreements/'+otherId+'/copy',undefined,cleanerSession.cookie)).status,404);
  assert.equal((await request(env,'agreements/'+otherId+'/sign',{cleaner,consent:true},cleanerSession.cookie)).status,404);
  assert.equal((await request(env,'agreements/'+id+'/sign',{signature:'Brian',consent:true},admin.cookie)).status,409);
 });
 await t.test('cleaner signs own proposed rate; sends ProHouse notification',async()=>{
  await uploadAndReview(env,id,admin.cookie,cleanerSession.cookie);
  const r=await request(env,'agreements/'+id+'/sign',{cleaner:{...cleaner,email:'spoof@example.com'},consent:true},cleanerSession.cookie);assert.equal(r.status,200);assert.equal((await r.json()).status,'Awaiting ProHouse');assert.equal(mails.at(-1).to[0],'hi@prohouse.com.au');assert.ok(mails.at(-1).text.includes('proposed rates'));
  assert.equal((await request(env,'agreements/'+id+'/sign',{cleaner,consent:true},cleanerSession.cookie)).status,409);
  const list=await (await request(env,'agreements',undefined,admin.cookie)).json();const a=list.items.find(a=>a.id===id);assert.equal(a.data.cleaner.email,'cleaner@example.com');assert.equal(a.data.cleaner.rows[0].rate,'90.00');assert.match(a.data.signedContentHash,/^[a-f0-9]{64}$/);
 });
 await t.test('countersign completes even if mail provider fails; immutable copies queued',async()=>{
  fail=true;const r=await request(env,'agreements/'+id+'/sign',{signature:'Brian Nguyen',consent:true},admin.cookie);assert.equal(r.status,200);const d=await r.json();assert.equal(d.status,'Completed');assert.equal(d.mail.filter(x=>!x.sent_at).length,2);
  assert.equal((await request(env,'agreements/'+id+'/sign',{signature:'Changed',consent:true},admin.cookie)).status,409);
  assert.equal((await request(env,'agreements/'+id+'/withdraw',{},admin.cookie)).status,409);
  assert.equal((await request(env,'agreements/'+id+'/retry-mail',{},cleanerSession.cookie)).status,403);
  fail=false;const retry=await (await request(env,'agreements/'+id+'/retry-mail',{},admin.cookie)).json();assert.ok(retry.mail.every(x=>x.sent_at));
  for(const mail of mails.slice(-2)){assert.ok(mail.attachments[0].filename.endsWith('.pdf'));const html=pdfText(Buffer.from(mail.attachments[0].content,'base64'));assert.ok(html.includes('Test Cleaner'));assert.ok(html.includes('Brian Nguyen'));assert.ok(html.includes('$90.00'));assert.ok(html.includes('before 9:00 PM'));assert.ok(html.includes('Completed content SHA-256'));}
  const count=mails.length;await request(env,'agreements/'+id+'/retry-mail',{},admin.cookie);assert.equal(mails.length,count);
  const copy=await request(env,'agreements/'+id+'/copy',undefined,cleanerSession.cookie);assert.equal(copy.status,200);assert.equal(copy.headers.get('content-type'),'application/pdf');assert.ok(pdfText(Buffer.from(await copy.arrayBuffer())).includes('Brian Nguyen'));
 });
 await t.test('sign-in throttling, unknown accounts and expired sessions',async()=>{
  const count=mails.length;for(let i=0;i<3;i++)assert.equal((await request(env,'auth/request',{email:'unknown@example.com',role:'cleaner'})).status,200);
  assert.equal(mails.length,count);assert.equal((await request(env,'auth/request',{email:'unknown@example.com',role:'cleaner'})).status,429);
  await request(env,'auth/logout',{},admin.cookie);assert.equal((await request(env,'me',undefined,admin.cookie)).status,401);
 });
 }finally{globalThis.fetch=realFetch;}
});
test('worker preserves guest website routes and adds portal security headers',async()=>{
 const env={ASSETS:{fetch:async()=>new Response('<h1>Asset</h1>',{headers:{'Content-Type':'text/html'}})}};
 const home=await worker.fetch(new Request(base+'/'),env);assert.equal(home.status,200);
 const portal=await worker.fetch(new Request(base+'/cleaners/'),env);assert.equal(portal.status,200);assert.equal(portal.headers.get('x-robots-tag'),'noindex, nofollow');assert.ok(portal.headers.get('content-security-policy').includes("frame-ancestors 'none'"));
 assert.equal((await worker.fetch(new Request(base+'/cleaners'),env)).status,302);
 assert.equal((await worker.fetch(new Request(base+'/api/cleaners/me'),env)).status,503);
 assert.equal((await worker.fetch(new Request(base+'/api/something'),env)).status,404);
 const survey=await worker.fetch(new Request(base+'/survey'),env);assert.equal(survey.status,301);assert.equal(survey.headers.get('location'),base+'/review/');
});
test('signature hash prevents countersigning modified cleaner content; withdrawal notifies',async()=>{
 const env=context(),mails=[],old=globalThis.fetch;globalThis.fetch=async(u,o)=>{mails.push(JSON.parse(o.body));return Response.json({id:'test'});};
 try{const owner=await login(env,'hi@prohouse.com.au','prohouse',mails);const create=await request(env,'agreements',{email:'cleaner@example.com',proposal},owner.cookie);const id=(await create.json()).id;const session=await login(env,'cleaner@example.com','cleaner',mails);
 await uploadAndReview(env,id,owner.cookie,session.cookie);
 await request(env,'agreements/'+id+'/sign',{cleaner,consent:true},session.cookie);
 const row=env.CLEANER_DB.raw.prepare('SELECT data FROM cleaner_agreements WHERE id=?').get(id);const data=JSON.parse(row.data);data.cleaner.rows[0].rate='10';env.CLEANER_DB.raw.prepare('UPDATE cleaner_agreements SET data=? WHERE id=?').run(JSON.stringify(data),id);
 assert.equal((await request(env,'agreements/'+id+'/sign',{signature:'Brian',consent:true},owner.cookie)).status,409);
 assert.equal((await request(env,'agreements/'+id+'/withdraw',{},owner.cookie)).status,200);assert.ok(mails.at(-1).subject.includes('withdrawn'));assert.equal((await request(env,'agreements/'+id+'/sign',{cleaner,consent:true},session.cookie)).status,409);
 }finally{globalThis.fetch=old;}
});

test('configuration status identifies missing email without permitting a send',async()=>{
 const env=context();delete env.RESEND_API_KEY;
 const status=await request(env,'status');assert.equal(status.status,200);assert.deepEqual(await status.json(),{ready:false,missing:['email secret']});
 const login=await request(env,'auth/request',{email:'hi@prohouse.com.au',role:'prohouse'});assert.equal(login.status,503);assert.match((await login.json()).error,/RESEND_API_KEY/);
 assert.equal(env.CLEANER_DB.raw.prepare('SELECT COUNT(*) AS n FROM cleaner_login').get().n,0);
});
test('optional ProHouse prices remain blank until cleaner supplies final prices',async()=>{
 const env=context(),mails=[],old=globalThis.fetch;globalThis.fetch=async(u,o)=>{mails.push(JSON.parse(o.body));return Response.json({id:'test'});};
 try {
  const owner=await login(env,'hi@prohouse.com.au','prohouse',mails);
  const blankOffer={...proposal,rows:[{service:'Bedroom and bathroom',unit:'Per clean',rate:''},{service:'Kitchen touch-up',unit:'Per visit',rate:'0'}]};
  const result=await request(env,'agreements',{email:'cleaner@example.com',proposal:blankOffer},owner.cookie);assert.equal(result.status,201);const id=(await result.json()).id;
  const copy=pdfText(Buffer.from(await (await request(env,'agreements/'+id+'/copy',undefined,owner.cookie)).arrayBuffer()));assert.ok(copy.includes('Vendor to propose'));assert.ok(copy.includes('$0.00'));
  const row=env.CLEANER_DB.raw.prepare('SELECT data FROM cleaner_agreements WHERE id=?').get(id);assert.equal(JSON.parse(row.data).proposal.rows[0].rate,'');
  const session=await login(env,'cleaner@example.com','cleaner',mails);
  const unsigned=await request(env,'agreements/'+id+'/sign',{cleaner:{...cleaner,rows:blankOffer.rows},consent:true},session.cookie);assert.equal(unsigned.status,400);
  await uploadAndReview(env,id,owner.cookie,session.cookie);
  const signed=await request(env,'agreements/'+id+'/sign',{cleaner:{...cleaner,rows:[{service:'Bedroom and bathroom',unit:'Per clean',rate:'85'},{service:'Kitchen touch-up',unit:'Per visit',rate:'20'}]},consent:true},session.cookie);assert.equal(signed.status,200);
  assert.equal((await request(env,'agreements/'+id+'/sign',{signature:'Brian Nguyen',consent:true},owner.cookie)).status,200);
  const finalCopy=pdfText(Buffer.from(mails.at(-1).attachments[0].content,'base64'));assert.ok(finalCopy.includes('$85.00'));assert.ok(finalCopy.includes('$20.00'));
 }finally{globalThis.fetch=old;}
});
test('creation identifies the exact invalid fields and does not send invitations',async()=>{
 const env=context(),mails=[],old=globalThis.fetch;globalThis.fetch=async(u,o)=>{mails.push(JSON.parse(o.body));return Response.json({id:'test'});};
 try {
  const owner=await login(env,'hi@prohouse.com.au','prohouse',mails),count=mails.length;
  const bad=await request(env,'agreements',{email:'cleaner@example.com',proposal:{...proposal,abn:'11111111111'}},owner.cookie);assert.equal(bad.status,400);const data=await bad.json();assert.deepEqual(Object.keys(data.fields),['abn']);assert.ok(data.error.includes('checksum'));
  const same=await request(env,'agreements',{email:'hi@prohouse.com.au',proposal},owner.cookie);assert.equal(same.status,400);assert.ok((await same.json()).fields.inviteEmail.includes('own email'));
  const noService=await request(env,'agreements',{email:'cleaner@example.com',proposal:{...proposal,rows:[{service:'',unit:'Per clean',rate:''}]}},owner.cookie);assert.equal(noService.status,400);assert.ok((await noService.json()).fields.rows);
  const negative=await request(env,'agreements',{email:'cleaner@example.com',proposal:{...proposal,rows:[{service:'Cleaning',unit:'Per clean',rate:'-5'}]}},owner.cookie);assert.equal(negative.status,400);
  assert.equal(mails.length,count);
 }finally{globalThis.fetch=old;}
});
test('Didit-only identity, 30-day notice, safety terms, PDF and private service photos',async()=>{
 const env=context(),mails=[],old=globalThis.fetch;globalThis.fetch=async(u,o)=>{mails.push(JSON.parse(o.body));return Response.json({id:'test'});};
 try{
  const owner=await login(env,'hi@prohouse.com.au','prohouse',mails);
  const created=await request(env,'agreements',{email:'vendor@example.com',proposal},owner.cookie),id=(await created.json()).id;
  const vendor=await login(env,'vendor@example.com','vendor',mails);
  assert.equal((await request(env,'agreements/'+id+'/sign',{cleaner,consent:true},vendor.cookie)).status,400);
  assert.equal((await request(env,'agreements/'+id+'/identity/review',{name:'Test Cleaner',consent:true},owner.cookie)).status,410);
  const raw=(path,session,bytes,date='2026-10-20')=>cleanerPortal(new Request(base+'/api/cleaners/agreements/'+id+'/'+path+'?date='+date+'&caption=Room%201',{method:'POST',headers:{Origin:base,Cookie:session,'Content-Type':'image/jpeg'},body:bytes}),env);
  const bytes=new Uint8Array(64);bytes.set([255,216,255,224]);
  assert.equal((await raw('identity/upload',vendor.cookie,bytes)).status,410);
  assert.equal((await raw('evidence/upload',vendor.cookie,bytes)).status,403);
  const list=await (await request(env,'agreements',undefined,vendor.cookie)).json(),d=list.items[0].data;
  assert.equal(d.termsVersion,'2026-10-15.3');assert.equal(d.identityMethod,'didit');
  const text=JSON.stringify(d.terms);for(const str of ['30 calendar days','rate increase','tailgating','windows locked','police officer','lawful power of entry','photo evidence','departure day','after-cleaning','WhatsApp'])assert.ok(text.includes(str),str);
  assert.doesNotMatch(text,/(?:0423|\+61\s*423)/);assert.ok(!text.includes('28 days'));
  assert.equal((await request(env,'agreements/'+id+'/sign',{cleaner:{...cleaner,paymentDays:60},consent:true},vendor.cookie)).status,400);
  await uploadAndReview(env,id);
  assert.equal((await request(env,'agreements/'+id+'/sign',{cleaner,consent:true},vendor.cookie)).status,200);
  assert.equal((await request(env,'agreements/'+id+'/sign',{signature:'Brian Nguyen',consent:true},owner.cookie)).status,200);
  const mail=mails.at(-1),pdf=Buffer.from(mail.attachments[0].content,'base64');assert.equal(pdf.subarray(0,5).toString(),'%PDF-');assert.ok(pdfText(pdf).includes('Didit ID, liveness and face match'));
  assert.equal((await raw('evidence/upload',owner.cookie,bytes)).status,403);
  assert.equal((await raw('evidence/upload',vendor.cookie,bytes,'2026-02-30')).status,400);
  assert.equal((await raw('evidence/upload',vendor.cookie,new Uint8Array(64))).status,415);
  const saved=await raw('evidence/upload',vendor.cookie,bytes);assert.equal(saved.status,201);const file=(await saved.json()).id;
  const other=await request(env,'agreements',{email:'other@example.com',proposal},owner.cookie),otherId=(await other.json()).id;
  assert.equal((await request(env,'agreements/'+otherId+'/evidence/file/'+file,undefined,vendor.cookie)).status,404);
  const image=await request(env,'agreements/'+id+'/evidence/file/'+file,undefined,owner.cookie);assert.equal(image.status,200);assert.equal((await image.arrayBuffer()).byteLength,64);assert.equal(image.headers.get('cache-control'),'no-store');
  assert.equal((await (await request(env,'agreements',undefined,owner.cookie)).json()).items.find(a=>a.id===id).evidence.length,1);
 }finally{globalThis.fetch=old;}
});
test('Didit result must be fetched server-side with matching session and all three checks',async()=>{
 const env={...context(),DIDIT_API_KEY:'test-provider',DIDIT_WORKFLOW_ID:'workflow-test'},mails=[],old=globalThis.fetch;let decision,providerCalls=0;
 globalThis.fetch=async(url,options)=>{if(url==='https://api.resend.com/emails'){mails.push(JSON.parse(options.body));return Response.json({id:'test'});}assert.equal(options.headers['x-api-key'],'test-provider');if(url.endsWith('/v3/session/')){providerCalls++;return Response.json({session_id:'session-test',url:'https://verify.didit.me/session/session-test'});}return Response.json(decision);};
 try{
  const owner=await login(env,'hi@prohouse.com.au','prohouse',mails);const created=await request(env,'agreements',{email:'vendor@example.com',proposal},owner.cookie),id=(await created.json()).id;
  const vendor=await login(env,'vendor@example.com','vendor',mails);
  assert.equal((await request(env,'agreements/'+id+'/identity/start',{consent:false},vendor.cookie)).status,400);
  assert.equal((await request(env,'agreements/'+id+'/identity/start',{consent:true},vendor.cookie)).status,200);
  assert.equal((await request(env,'agreements/'+id+'/identity/start',{consent:true},vendor.cookie)).status,200);assert.equal(providerCalls,1);
  decision={session_id:'wrong',vendor_data:id,workflow_id:'workflow-test',status:'Approved'};
  assert.equal((await request(env,'agreements/'+id+'/identity/refresh',{},vendor.cookie)).status,409);
  decision={session_id:'session-test',vendor_data:id,workflow_id:'workflow-test',status:'Approved',id_verifications:[{status:'Approved',full_name:'Test Cleaner'}]};
  let result=await (await request(env,'agreements/'+id+'/identity/refresh',{},vendor.cookie)).json();assert.equal(result.check.provider_status,'In Review');
  decision.liveness_checks=[{status:'Approved'}];decision.face_matches=[{status:'Approved'}];
  result=await (await request(env,'agreements/'+id+'/identity/refresh',{},vendor.cookie)).json();assert.equal(result.check.provider_status,'Approved');
  assert.equal((await request(env,'agreements/'+id+'/sign',{cleaner,consent:true},vendor.cookie)).status,200);
  assert.equal((await request(env,'agreements/'+id+'/sign',{signature:'Brian Nguyen',consent:true},owner.cookie)).status,200);
  const data=JSON.parse(env.CLEANER_DB.raw.prepare('SELECT data FROM cleaner_agreements WHERE id=?').get(id).data);assert.ok(data.identityVerification.method.includes('Didit'));
 }finally{globalThis.fetch=old;}
});
