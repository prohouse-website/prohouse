import { vendorIdentity, identitySummary, approvedIdentity, diditReady } from './vendor-identity.js';
import { PROHOUSE_DEFAULTS } from '../public/cleaners/prohouse-defaults.js';
import { terms } from './cleaner-terms.js';
const ROOT='/cleaners/';
const emailOK = s => typeof s==='string' && s.length<=254 && /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(s);
const cleanEmail=s=>String(s||'').trim().toLowerCase();
const encode=s=>Array.from(s,b=>b.toString(16).padStart(2,'0')).join('');
const random=()=>encode(crypto.getRandomValues(new Uint8Array(32)));
const hash=async s=>encode(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(s))));
const json=(data,status=200,extra={})=>Response.json(data,{status,headers:{'Cache-Control':'no-store','Referrer-Policy':'no-referrer',...extra}});
const cookie=(name,value,age)=>`${name}=${value}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${age}`;
const cookies=req=>Object.fromEntries((req.headers.get('cookie')||'').split(';').map(v=>v.trim().split('=')));
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const admin=(email,env)=>(env.PROHOUSE_ADMIN_EMAILS||'hi@prohouse.com.au').split(',').map(cleanEmail).includes(email);
const origin=req=>new URL(req.url).origin;
const stmt=(env,sql,...values)=>env.CLEANER_DB.prepare(sql).bind(...values);
const nonempty=(s,n=3000)=>typeof s==='string'&&s.trim().length>0&&s.length<=n;
const abnOK=s=>{const d=String(s||'').replace(/\s/g,'');if(!/^\d{11}$/.test(d))return false;const n=[...d].map(Number);n[0]--;return n.reduce((s,v,i)=>s+v*[10,1,3,5,7,9,11,13,15,17,19][i],0)%89===0;};
function rowsOK(rows,optionalRates=false) {return Array.isArray(rows)&&rows.length>0&&rows.length<=30&&rows.every(r=>r&&nonempty(r.service,500)&&nonempty(r.unit,80)&&(optionalRates&&String(r.rate??'').trim()===''||/^\d{1,7}(\.\d{1,2})?$/.test(String(r.rate??'').trim())&&Number(r.rate)>=0));}
const gstValues=['Not GST registered — no GST charged','GST registered — rates include GST','GST registered — rates exclude GST; add 10% GST'];
function scheduleErrors(p) {
 const errors={};p=p||{};
 if(!nonempty(p.legal,300))errors.legal='Enter the ProHouse contracting legal entity.';
 if(!abnOK(p.abn))errors.abn='ProHouse ABN is invalid. Enter the correct 11-digit ABN; it must pass the ABN checksum.';
 if(!nonempty(p.address,500))errors.address='Enter the ProHouse business address.';
 if(!nonempty(p.phone??PROHOUSE_DEFAULTS.phone,100))errors.phone='Enter the ProHouse contact phone number.';
 if(!emailOK(p.email??PROHOUSE_DEFAULTS.email))errors.email='Enter a valid ProHouse contact email address.';
 if(!nonempty(p.serviceAddress??PROHOUSE_DEFAULTS.serviceAddress,500))errors.serviceAddress='Enter the service address.';
 if(!nonempty(p.scope,12000))errors.scope='Enter the property, areas and service scope.';
 if(!rowsOK(p.rows,true))errors.rows='Each service needs a description and unit. ProHouse rates may be blank; any rate entered must be a non-negative AUD amount with at most two decimal places.';
 if(!gstValues.includes(p.gst))errors.gst='Select a GST treatment.';
 if(!/^\d{4}-\d{2}-\d{2}$/.test(p.start||'')||Number.isNaN(Date.parse(p.start)))errors.start='Select a valid start date.';
 if(!Number.isInteger(Number(p.paymentDays))||Number(p.paymentDays)<1||Number(p.paymentDays)>90)errors.paymentDays='Payment period must be a whole number from 1 to 90 calendar days.';
 if(!nonempty(p.insurance,2000))errors.insurance='Enter the insurance requirements.';
 return errors;
}
function cleanerOK(c) {return c&&['legal','entity','phone','address','accountName','bank','signature'].every(k=>nonempty(c[k],500))&&abnOK(c.abn)&&/^\d{6}$/.test(c.bsb)&&/^\d{5,10}$/.test(c.accountNumber)&&rowsOK(c.rows)&&gstValues.includes(c.gst)&&(!c.notes||nonempty(c.notes,5000));}
function record(row) {return {...row,data:JSON.parse(row.data)};}
function safeSchedule(p) {return {legal:p.legal.trim(),abn:p.abn.replace(/\s/g,''),address:p.address.trim(),phone:(p.phone??PROHOUSE_DEFAULTS.phone).trim(),email:cleanEmail(p.email??PROHOUSE_DEFAULTS.email),serviceAddress:(p.serviceAddress??PROHOUSE_DEFAULTS.serviceAddress).trim(),scope:p.scope.trim(),rows:p.rows.map(r=>({service:r.service.trim(),unit:r.unit.trim(),rate:String(r.rate??'').trim()})),gst:p.gst,start:p.start,paymentDays:Number(p.paymentDays),insurance:p.insurance.trim()};}
function safeCleaner(c,email) {return Object.fromEntries([...['legal','entity','phone','address','accountName','bank','signature','abn','bsb','accountNumber','notes'].map(k=>[k,String(c[k]||'').trim()]),['email',email],['rows',c.rows.map(r=>({service:r.service.trim(),unit:r.unit.trim(),rate:String(r.rate??'').trim()}))],['gst',c.gst]]);}
async function identity(req,env) {const t=cookies(req).ph_cleaner_session;if(!t||!/^[a-f0-9]{64}$/.test(t))return null;return stmt(env,'SELECT email FROM cleaner_sessions WHERE token_hash=? AND expires>?',await hash(t),Date.now()).first();}
function rates(rows) {return `<table><thead><tr><th>Service / inclusions</th><th>Unit</th><th>AUD rate</th></tr></thead><tbody>${rows.map(r=>`<tr><td>${esc(r.service)}</td><td>${esc(r.unit)}</td><td>${String(r.rate??'').trim()===''?'Vendor to propose':'$'+Number(r.rate).toFixed(2)}</td></tr>`).join('')}</tbody></table>`;}
export function agreementDocument(a) {const d=a.data,p=d.proposal,c=d.cleaner;return `<!doctype html><html lang="en"><meta charset="utf-8"><title>ProHouse agreement ${esc(a.id)}</title><style>body{font:15px/1.6 Arial;max-width:850px;margin:40px auto;padding:20px;color:#172333}h1,h2{line-height:1.2}h1{color:#b62965}table{border-collapse:collapse;width:100%}td,th{border:1px solid #ccc;padding:9px;text-align:left}p{white-space:pre-wrap;overflow-wrap:anywhere}small{color:#53616e}@media print{body{margin:0}}</style><h1>ProHouse Vendor Service Agreement</h1><p>Reference: ${esc(a.id)}\nStatus: ${esc(a.status)}\nTerms version: ${esc(d.termsVersion)}</p><h2>ProHouse service schedule</h2><p>${esc(p.legal)} trading as ProHouse\nABN ${esc(p.abn)}\n${esc(p.address)}\n${p.phone?'Phone: '+esc(p.phone)+'\n':''}${p.email?'Email: '+esc(p.email)+'\n':'Contact: hi@prohouse.com.au\n'}Starts ${esc(p.start)}\nPayment: ${esc(p.paymentDays)} calendar days after correct undisputed invoice</p><p>${p.serviceAddress?'Service address: '+esc(p.serviceAddress)+'\n':''}${esc(p.scope)}</p>${rates(p.rows)}<p>${esc(p.gst)}\nInsurance: ${esc(p.insurance)}</p>${c?`<h2>Vendor and final agreed rates</h2><p>Legal representative: ${esc(c.legal)}\nEntity: ${esc(c.entity)}\nABN: ${esc(c.abn)}\nAddress: ${esc(c.address)}\nEmail: ${esc(c.email)}\nPhone: ${esc(c.phone)}\nBank: ${esc(c.bank)}\nAccount name: ${esc(c.accountName)}\nBSB: ${esc(c.bsb)}\nAccount number: ${esc(c.accountNumber)}</p>${rates(c.rows)}<p>${esc(c.gst)}\n${esc(c.notes)}</p>`:''}<h2>Terms and conditions</h2>${d.terms.map(([h,t])=>`<h3>${esc(h)}</h3><p>${esc(t)}</p>`).join('')}<h2>Identity review</h2><p>${d.identityVerification?esc(d.identityVerification.method)+' · '+esc(d.identityVerification.signatory):'Pending / see ProHouse identity review'}</p><h2>Electronic signatures</h2><p>Vendor: ${esc(c?.signature||'Pending')}\nSigned at: ${esc(d.cleanerSignedAt||'Pending')}\nVerified email: ${esc(c?.email||'Pending')}\nProHouse: ${esc(d.prohouseSignature||'Pending')}\nSigned at: ${esc(d.prohouseSignedAt||'Pending')}\nVerified email: ${esc(d.prohouseEmail||'Pending')}</p><small>Timestamps above are UTC. Operating deadlines use Australia/Sydney.</small><h3>Agreement integrity</h3><p>Vendor signed content SHA-256: ${esc(d.signedContentHash||'Pending')}\nCompleted content SHA-256: ${esc(d.completedContentHash||'Pending')}</p><h3>Activity</h3>${d.audit.map(x=>`<p>${esc(x.event)} · ${esc(x.at)} · ${esc(x.by)}</p>`).join('')}</html>`;}
function mailRow(env,id,agreementId,kind,recipient,payload) {return stmt(env,'INSERT INTO cleaner_mail(id,agreement_id,kind,recipient,payload) VALUES(?,?,?,?,?)',id,agreementId,kind,recipient,JSON.stringify(payload));}
function attachment(html,name) {const bytes=new TextEncoder().encode(html);let out='';for(const b of bytes)out+=String.fromCharCode(b);return {filename:name,content:btoa(out)};}
async function sendMail(env,payload,key) {const res=await fetch('https://api.resend.com/emails',{method:'POST',headers:{Authorization:`Bearer ${env.RESEND_API_KEY}`,'Content-Type':'application/json','Idempotency-Key':key},body:JSON.stringify({from:env.CLEANER_FROM_EMAIL||env.SURVEY_FROM_EMAIL,to:[payload.to],reply_to:'hi@prohouse.com.au',subject:payload.subject,text:payload.text,...(payload.attachment?{attachments:[payload.attachment]}:{})})});if(!res.ok)throw Error(`Email provider status ${res.status}`);}
async function drain(env,agreementId) {const rows=await stmt(env,'SELECT * FROM cleaner_mail WHERE agreement_id=? AND sent_at IS NULL ORDER BY rowid LIMIT 20',agreementId).all();for(const m of rows.results){try{await sendMail(env,JSON.parse(m.payload),m.id);await stmt(env,'UPDATE cleaner_mail SET sent_at=?,last_error=NULL,attempts=attempts+1 WHERE id=?',new Date().toISOString(),m.id).run();}catch(e){await stmt(env,'UPDATE cleaner_mail SET attempts=attempts+1,last_error=? WHERE id=?',String(e.message).slice(0,120),m.id).run();}}}
async function status(env,id) {return (await stmt(env,'SELECT kind,recipient,sent_at,attempts,last_error FROM cleaner_mail WHERE agreement_id=? ORDER BY rowid',id).all()).results;}
function configured(env) {return env.CLEANER_DB&&env.RESEND_API_KEY&&(env.CLEANER_FROM_EMAIL||env.SURVEY_FROM_EMAIL);}
export async function cleanerPortal(req,env) {
 const path=new URL(req.url).pathname;
 const missing=[];
 if(!env.CLEANER_DB)missing.push('database');
 if(!env.RESEND_API_KEY)missing.push('email secret');
 if(!(env.CLEANER_FROM_EMAIL||env.SURVEY_FROM_EMAIL))missing.push('email sender');
 if(path==='/api/cleaners/status'&&req.method==='GET')return json({ready:configured(env)?true:false,missing});
 if(!configured(env))return json({error:!env.RESEND_API_KEY?'Sign-in is unavailable: this Cloudflare preview is missing its email sending secret (RESEND_API_KEY). No code has been sent. ProHouse must add it in this preview’s Cloudflare secret settings.':'Sign-in is unavailable: the portal’s '+missing.join(' and ')+' configuration is incomplete. No code has been sent.'},503);
 const write=req.method==='POST';
 if(write&&(req.headers.get('origin')!==origin(req)||(!path.endsWith('/identity/upload')&&!req.headers.get('content-type')?.startsWith('application/json'))))return json({error:'Invalid request origin or content type.'},403);
 let body={};if(write&&!path.endsWith('/identity/upload')){const raw=await req.text();if(raw.length>70000)return json({error:'Request too large.'},413);try{body=JSON.parse(raw);}catch{return json({error:'Invalid JSON.'},400);}}
 try {
 if(path==='/api/cleaners/auth/request'&&write) {
  const email=cleanEmail(body.email),role=body.role==='vendor'?'cleaner':body.role;if(!emailOK(email)||!['prohouse','cleaner'].includes(role))return json({error:'Enter a valid email and sign-in type.'},400);
  const allowed=admin(email,env)||(await stmt(env,'SELECT id FROM cleaner_agreements WHERE email=? LIMIT 1',email).first());
  const ip=await hash(req.headers.get('cf-connecting-ip')||'unknown'),now=Date.now();
  // One atomic SQL insert bounds email and IP sends, including concurrent requests.
  const id=random(),code=String(crypto.getRandomValues(new Uint32Array(1))[0]%100000000).padStart(8,'0');
  const inserted=await stmt(env,`INSERT INTO cleaner_login(id,email,code_hash,ip_hash,created,expires) SELECT ?,?,?,?,?,? WHERE (SELECT COUNT(*) FROM cleaner_login WHERE email=? AND created>?)<3 AND (SELECT COUNT(*) FROM cleaner_login WHERE ip_hash=? AND created>?)<10`,id,email,await hash(id+code),ip,now,now+600000,email,now-900000,ip,now-900000).run();
  if(!inserted.meta.changes)return json({error:'Too many sign-in attempts. Try again in 15 minutes.'},429);
  if(allowed&&(role==='prohouse'?admin(email,env):!admin(email,env))) {try {await sendMail(env,{to:email,subject:'Your ProHouse sign-in code',text:`Your ProHouse ${role} sign-in code is ${code}.\n\nIt expires in 10 minutes. Do not share this code. If you did not request it, ignore this email.\n\nSign in at ${origin(req)}${ROOT}`},'login-'+id);}catch {return json({error:'Sign-in email could not be sent. Try again shortly.'},502);}}
  return json({ok:true,message:'If this address has access, a sign-in code has been sent.'},200,{'Set-Cookie':cookie('ph_cleaner_challenge',id,600)});
 }
 if(path==='/api/cleaners/auth/verify'&&write) {
  const id=cookies(req).ph_cleaner_challenge;
  if(!id||!/^\d{8}$/.test(String(body.code)))return json({error:'Enter the eight-digit code from your email.'},400);
  const now=Date.now(),codeHash=await hash(id+String(body.code));
  const changed=await stmt(env,'UPDATE cleaner_login SET attempts=attempts+1,used=CASE WHEN code_hash=? THEN 1 ELSE 0 END WHERE id=? AND used=0 AND expires>? AND attempts<8 RETURNING email,used',codeHash,id,now).first();
  if(!changed?.used)return json({error:'Incorrect, expired or already used code. Request a new code.'},401);
  const session=random();await env.CLEANER_DB.batch([stmt(env,'INSERT INTO cleaner_sessions(token_hash,email,expires) VALUES(?,?,?)',await hash(session),changed.email,now+8*3600000),stmt(env,'DELETE FROM cleaner_sessions WHERE expires<?',now),stmt(env,'DELETE FROM cleaner_login WHERE expires<?',now-86400000)]);
  return json({ok:true},200,{'Set-Cookie':cookie('ph_cleaner_session',session,8*3600)});
 }
 const user=await identity(req,env);if(!user)return json({error:'Please sign in to continue.'},401);
 const isAdmin=admin(user.email,env);
 if(path==='/api/cleaners/auth/logout'&&write){await stmt(env,'DELETE FROM cleaner_sessions WHERE token_hash=?',await hash(cookies(req).ph_cleaner_session)).run();return json({ok:true},200,{'Set-Cookie':cookie('ph_cleaner_session','',0)});}
 if(path==='/api/cleaners/me'&&req.method==='GET')return json({email:user.email,role:isAdmin?'prohouse':'cleaner',terms,gstValues,diditAvailable:diditReady(env)});
 if(path==='/api/cleaners/agreements'&&req.method==='GET') {const rows=await stmt(env,isAdmin?'SELECT * FROM cleaner_agreements ORDER BY updated DESC':'SELECT * FROM cleaner_agreements WHERE email=? ORDER BY updated DESC',...(isAdmin?[]:[user.email])).all();return json({items:await Promise.all(rows.results.map(async a=>({...record(a),identity:await identitySummary(env,a.id),mail:isAdmin?await status(env,a.id):undefined})))});}
 if(path==='/api/cleaners/agreements'&&write) {
  if(!isAdmin)return json({error:'ProHouse access required.'},403);
  const email=cleanEmail(body.email),errors=scheduleErrors(body.proposal);
  if(!emailOK(email))errors.inviteEmail='Enter a valid vendor email address.';
  else if(admin(email,env))errors.inviteEmail='Use the vendor’s own email address. A ProHouse administrator email cannot also be the vendor on this agreement.';
  if(Object.keys(errors).length)return json({error:Object.values(errors).join(' '),fields:errors},400);
  const id=crypto.randomUUID(),now=new Date().toISOString(),data={proposal:safeSchedule(body.proposal),termsVersion:'2026-10-15.2',idRequired:true,terms,audit:[{event:'ProHouse sent service schedule and terms',at:now,by:user.email}]};
  const text=`ProHouse invites you to review a vendor service agreement.\n\nSign in with ${email} at ${origin(req)}${ROOT}?agreement=${id}\n\nReview all services, proposed rates and terms, enter your business and bank details, then sign. You may propose your own rates. ProHouse will review and countersign to accept. The agreement takes effect only after both signatures.\n\nReference: ${id}\nQuestions: hi@prohouse.com.au`;
  await env.CLEANER_DB.batch([stmt(env,'INSERT INTO cleaner_agreements(id,email,status,data,updated) VALUES(?,?,?,?,?)',id,email,'Awaiting cleaner',JSON.stringify(data),now),mailRow(env,id+'-invite',id,'Invitation',email,{to:email,subject:'ProHouse — vendor agreement for your review',text})]);
  await drain(env,id);return json({ok:true,id,mail:await status(env,id)},201);
 }
 const match=path.match(/^\/api\/cleaners\/agreements\/([0-9a-f-]{36})(?:\/(copy|sign|withdraw|retry-mail|identity(?:\/(?:upload|review|delete|start|refresh|file\/[a-f0-9-]{36}))?))?$/);if(!match)return json({error:'Not found.'},404);
 const a=await stmt(env,'SELECT * FROM cleaner_agreements WHERE id=?',match[1]).first();
 if(!a||(!isAdmin&&a.email!==user.email))return json({error:'Agreement not found.'},404);
 const action=match[2],d=JSON.parse(a.data);
 if(action?.startsWith('identity'))return vendorIdentity(req,env,a,user,isAdmin,action,body);
 if(action==='copy'&&req.method==='GET')return new Response(agreementDocument(record(a)),{headers:{'Content-Type':'text/html; charset=utf-8','Content-Disposition':`attachment; filename="ProHouse-Agreement-${a.id}.html"`,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'"}});
 if(!write)return json({error:'Method not allowed.'},405);
 if(action==='retry-mail') {if(!isAdmin)return json({error:'ProHouse access required.'},403);await drain(env,a.id);return json({ok:true,mail:await status(env,a.id)});}
 const now=new Date().toISOString();let next,queued=[];
 if(action==='sign'&&!isAdmin) {
  if(a.status!=='Awaiting cleaner')return json({error:'This agreement is locked. Ask ProHouse for a replacement if changes are needed.'},409);
  if(body.proposal||body.paymentDays!==undefined||body.cleaner?.paymentDays!==undefined||body.cleaner?.paymentTerms!==undefined)return json({error:'Vendors cannot change the ProHouse payment terms. Only service rates and inclusions may be proposed.'},400);
  if(d.idRequired){const proof=await identitySummary(env,a.id),front=proof.files.find(f=>f.slot==='front'),ready=front&&(front.document_type==='passport'||proof.files.some(f=>f.slot==='back'&&f.document_type===front.document_type));if(!ready&&proof.check?.provider_status!=='Approved')return json({error:'Upload your photo ID (both sides for a licence or national ID), or complete automatic identity verification, before signing.'},400);}
  if(body.consent!==true||!cleanerOK(body.cleaner))return json({error:'Complete business, valid ABN, banking, proposed pricing and signature fields, and accept electronic signing.'},400);
  d.cleaner=safeCleaner(body.cleaner,user.email);d.cleanerSignedAt=now;
  d.signedContentHash=await hash(JSON.stringify({proposal:d.proposal,terms:d.terms,cleaner:d.cleaner,cleanerSignedAt:now}));
  d.audit.push({event:'Vendor signed final proposed pricing and terms',at:now,by:user.email});next='Awaiting ProHouse';
  queued=[{id:a.id+'-review',kind:'Vendor signed',to:'hi@prohouse.com.au',subject:'Vendor signed — ProHouse countersignature required',text:`${d.cleaner.entity} has signed agreement ${a.id}.\n\nReview the vendor’s proposed rates, all terms and business details, then countersign at ${origin(req)}${ROOT}?agreement=${a.id}\n\nThe agreement is awaiting your acceptance.`}];
 } else if(action==='sign'&&isAdmin) {
  if(a.status!=='Awaiting ProHouse')return json({error:'The vendor must sign first, and completed agreements cannot be changed.'},409);
  if(body.consent!==true||!nonempty(body.signature,300))return json({error:'Enter your authorised signatory name and accept the final rates and terms.'},400);
  const expected=await hash(JSON.stringify({proposal:d.proposal,terms:d.terms,cleaner:d.cleaner,cleanerSignedAt:d.cleanerSignedAt}));
  if(expected!==d.signedContentHash)return json({error:'Signed record failed integrity verification. Contact ProHouse.'},409);
  if(d.idRequired){const verification=await approvedIdentity(env,a.id,d.cleaner.legal);if(!verification)return json({error:'Review and approve the vendor’s ID and signatory name, or retrieve an approved Didit result matching their name, before countersigning.'},409);d.identityVerification=verification;}
  d.prohouseSignature=body.signature.trim();d.prohouseSignedAt=now;d.prohouseEmail=user.email;d.audit.push({event:'ProHouse accepted vendor final rates and countersigned',at:now,by:user.email});
  d.completedContentHash=await hash(JSON.stringify(d));next='Completed';
  const copy=attachment(agreementDocument({...a,status:next,data:d}),'ProHouse-Agreement-'+a.id+'.html');
  queued=[...new Set([a.email,'hi@prohouse.com.au'])].map((to,i)=>({id:a.id+'-completed-'+i,kind:'Completed copy',to,subject:'Completed — your signed ProHouse vendor agreement',text:`Both parties have signed agreement ${a.id}.\n\nYour complete signed agreement is attached as an HTML document. Open it in your browser to read, print or save as PDF. It contains both signatures, timestamps and final agreed rates.\n\nA copy is also available after signing in at ${origin(req)}${ROOT}?agreement=${a.id}\n\nKeep this copy securely: it includes business and payment information.\nQuestions: hi@prohouse.com.au`,attachment:copy}));
 } else if(action==='withdraw'&&isAdmin) {
  if(!['Awaiting cleaner','Awaiting ProHouse'].includes(a.status))return json({error:'This agreement cannot be withdrawn. Completed contracts remain preserved.'},409);
  next='Withdrawn';d.audit.push({event:'ProHouse withdrew agreement; any revised terms require a new agreement',at:now,by:user.email});queued=[{id:a.id+'-withdrawn',kind:'Withdrawal',to:a.email,subject:'ProHouse agreement withdrawn',text:`Agreement ${a.id} has been withdrawn before completion. It has not taken effect. ProHouse will contact you if a replacement is required.\n\n${origin(req)}${ROOT}?agreement=${a.id}`}];
 }else return json({error:'Action not allowed.'},403);
 // Emails and status are committed in one D1 transaction; a stale concurrent signer cannot queue mail.
 const ops=queued.map(m=>stmt(env,`INSERT INTO cleaner_mail(id,agreement_id,kind,recipient,payload) SELECT ?,?,?,?,? WHERE EXISTS(SELECT 1 FROM cleaner_agreements WHERE id=? AND revision=?)`,m.id,a.id,m.kind,m.to,JSON.stringify({...m,to:m.to}),a.id,a.revision));
 ops.push(stmt(env,'UPDATE cleaner_agreements SET status=?,data=?,updated=?,revision=revision+1 WHERE id=? AND revision=?',next,JSON.stringify(d),now,a.id,a.revision));
 const results=await env.CLEANER_DB.batch(ops);if(!results.at(-1).meta.changes)return json({error:'Agreement changed. Reload before continuing.'},409);
 await drain(env,a.id);const delivery=await status(env,a.id);return json({ok:true,status:next,notificationPending:delivery.some(m=>!m.sent_at),mail:isAdmin?delivery:undefined});
 }catch {return json({error:'The portal could not complete this request. Please reload and retry. If already signed, your saved status will be shown.'},500);}
}
