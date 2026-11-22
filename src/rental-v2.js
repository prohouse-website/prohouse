import {PDFDocument,StandardFonts,rgb} from 'pdf-lib';
import {RENTAL_CLAUSES} from './rental-v2-clauses.js';

// Designed for the existing Cloudflare Worker (LONGSTAY_DB + RESEND_API_KEY).
// No landlord-issued agreement becomes active without a legal review and explicit
// RENTAL_V2_SENDING_ENABLED=true configuration.
const HEAD={'Cache-Control':'no-store, private','Content-Security-Policy':"default-src 'none'; frame-ancestors 'none'",'X-Content-Type-Options':'nosniff','X-Robots-Tag':'noindex, nofollow','Referrer-Policy':'no-referrer'};
const reply=(code,message,extra={})=>Response.json({message,...extra},{status:code,headers:HEAD});
const clean=(v,n=220)=>typeof v==='string'?v.trim().slice(0,n):'';
const email=v=>/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)&&v.length<=254;
const now=()=>new Date().toISOString();
const plus=(m)=>new Date(Date.now()+m*60_000).toISOString();
const token=()=>Array.from(crypto.getRandomValues(new Uint8Array(32)),n=>n.toString(16).padStart(2,'0')).join('');
const hex=b=>Array.from(new Uint8Array(b),x=>x.toString(16).padStart(2,'0')).join('');
const hash=v=>crypto.subtle.digest('SHA-256',new TextEncoder().encode(String(v))).then(hex);
const bearer=req=>(req.headers.get('Authorization')||'').replace(/^Bearer /i,'').trim();
const validToken=t=>/^[a-f0-9]{64}$/.test(t);
const db=env=>{if(!env.LONGSTAY_DB)throw Error('LONGSTAY_DB is not configured.');return env.LONGSTAY_DB};
const APP_ORIGIN=req=>new URL(req.url).origin;
const PAYMENT_NOTICE_VERSION='2026-11-22';
function paymentNotice(s){const rent=Number(s.rent||0),fund=Number(s.holding||0),cleaning=Number(s.bond||0);return [
 'PAYMENT AND MOVE-IN ACKNOWLEDGMENT',
 'Within 24 hours after the owner or agent countersigns, the guest agrees to pay one week of rent in advance (AUD '+rent.toFixed(2)+'), credited toward rent payable, subject to applicable law.',
 'Before move-in, the guest must arrange the refundable security/holding amount specified in Schedule A (AUD '+fund.toFixed(2)+'), subject to applicable statutory bond limits, required lodgement and the appropriate bond-payment process. It is not an additional bond on top of another security bond.',
 'Any separately listed refundable cleaning amount (AUD '+cleaning.toFixed(2)+') is payable only if lawful for this occupancy type and jurisdiction. It must not cause the total security collected to exceed a statutory cap.',
 'Bank transfers, including payments from Commonwealth Bank, can be delayed by security checks. Some first-time payments may be held for up to 24 hours; other transfer types can take longer. Please pay early or use an approved alternative such as another bank or an over-the-counter bank deposit where available.',
 'A transfer receipt alone does not prove ProHouse received cleared funds. Keys and move-in access are provided only after all lawfully required amounts have been received or lodged through the required bond authority and verified. Failure to pay by a deadline will be managed in accordance with applicable law and does not automatically void an executed agreement.'
 ].join('\n');}

async function throttle(req,env,context){
 if(!env.LONGSTAY_FORM_LIMIT)return true;
 const ip=req.headers.get('CF-Connecting-IP')||'unknown';
 const r=await env.LONGSTAY_FORM_LIMIT.limit({key:'rental-v2:'+context+':'+ip});
 return !!r.success;
}
function isOwnOrigin(req){const v=req.headers.get('Origin');return !v||v===new URL(req.url).origin}
function calculateEnd(start,period){if(!/^\d{4}-\d{2}-\d{2}$/.test(start)||!['3 months','6 months','12 months'].includes(period))return '';const [year,month,day]=start.split('-').map(Number);const first=new Date(Date.UTC(year,month-1,day));if(!Number.isFinite(first.getTime())||first.toISOString().slice(0,10)!==start)return '';const end=new Date(Date.UTC(year,month-1+parseInt(period,10),day-1));return end.toISOString().slice(0,10)}
function scanFields(schedule){
 if(!schedule||typeof schedule!=='object'||Array.isArray(schedule))throw Error('Schedule A is required.');
 const keys=['property','area','noaccess','rent','frequency','start','period','end','bond','holding','internet','utilities','payid','bank','provider','owneremail'];
 const s=Object.fromEntries(keys.map(k=>[k,clean(schedule[k],350)]));
 for(const k of keys.filter(x=>!['noaccess','bond','holding','bank','end'].includes(x)))if(!s[k])throw Error('Schedule A is incomplete: '+k);
 if(!email(s.owneremail))throw Error('Owner email is invalid.');
 if(!/^\d{1,6}(?:\.\d{1,2})?$/.test(s.rent)||+s.rent<=0)throw Error('Weekly rent must be positive AUD.');
 for(const k of ['bond','holding'])if(s[k]&&!/^\d{1,6}(?:\.\d{1,2})?$/.test(s[k]))throw Error('Invalid amount: '+k);
 if(!['Fortnightly','Every 4 weeks','Calendar monthly'].includes(s.frequency))throw Error('Invalid rent frequency.');
 if(!/^\d{4}-\d{2}-\d{2}$/.test(s.start)||new Date(s.start+'T00:00:00Z').toISOString().slice(0,10)!==s.start)throw Error('Invalid start date.');
 if(!['Guest chooses','3 months','6 months','12 months'].includes(s.period))throw Error('Select a 3, 6 or 12-month period or let the guest choose.');
 const computed=calculateEnd(s.start,s.period);
 if(s.period==='Guest chooses'){s.end='';}else if(!computed)throw Error('Could not calculate the agreement end date.');else s.end=computed;
 return s;
}
function chosen(ids){
 if(!Array.isArray(ids))throw Error('Clause list required.');
 const distinct=new Set(ids);
 const library=new Set(RENTAL_CLAUSES.map(c=>c.id));
 if(distinct.size!==ids.length||ids.some(x=>!library.has(x)))throw Error('Unknown or repeated clauses.');
 return RENTAL_CLAUSES.filter(c=>distinct.has(c.id)&&!c.heading).map(c=>({id:c.id,section:c.section,text:c.text}));
}
async function emailSend(env,to,subject,body,attachments=[]){
 if(!env.RESEND_API_KEY)throw Error('RESEND_API_KEY missing.');
 const payload={from:env.APPLICATION_FROM_EMAIL||'ProHouse Rental <no-reply@prohouse.com.au>',to:Array.isArray(to)?to:[to],subject,text:body};
 if(attachments.length)payload.attachments=attachments;
 const r=await fetch('https://api.resend.com/emails',{method:'POST',headers:{Authorization:'Bearer '+env.RESEND_API_KEY,'Content-Type':'application/json'},body:JSON.stringify(payload)});
 if(!r.ok)throw Error('Email delivery failed ('+r.status+').');
}
async function owner(req,env){
 const t=bearer(req);if(!validToken(t))return false;
 const row=await db(env).prepare("SELECT token_hash FROM rental_v2_auth WHERE token_hash=? AND role='owner_session' AND expires_at>?").bind(await hash(t),now()).first();
 return !!row;
}
async function agreement(env,id){return db(env).prepare('SELECT * FROM rental_v2_agreements WHERE id=?').bind(id).first()}
function safe(row,admin=false){
 const obj={id:row.id,status:row.status,clauses:JSON.parse(row.clauses_json),schedule:JSON.parse(row.schedule_json),guestEmail:row.guest_email,sentAt:row.sent_at,deadlineAt:row.deadline_at,guestSignedAt:row.guest_signed_at,providerSignedAt:row.provider_signed_at,identityStatus:row.identity_status};
 if(admin){obj.guestName=row.guest_full_name;obj.guestDob=row.guest_dob;obj.guestPhone=row.guest_phone;obj.verifiedName=row.verified_name;obj.verifiedDob=row.verified_dob;obj.identityCheckedAt=row.identity_checked_at;obj.diditSessionId=row.identity_session_id;}
 return obj;
}
async function guest(req,env){
 const t=bearer(req);if(!validToken(t))return null;
 const row=await db(env).prepare('SELECT * FROM rental_v2_agreements WHERE guest_token_hash=?').bind(await hash(t)).first();
 return row||null;
}
async function apiBody(req){if((req.headers.get('Content-Length')|0)>160000)throw Error('Request too large.');return req.json()}
const dataUrl=v=>/^data:image\/png;base64,[A-Za-z0-9+/=]{150,300000}$/.test(v||'');
const identityOutcome=(v,guestName,guestDob)=>{
 const verified=v.approved&&!!v.name&&namesEqual(v.name,guestName)&&(!v.dob||v.dob===guestDob);
 const inReview=/^in review$/i.test(v.status||'');
 return {approved:verified,inReview,status:verified?'Approved':v.approved?'Name or DOB mismatch':inReview?'In Review':v.status||'Pending'};
};
const namesEqual=(a,b)=>String(a||'').normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^\p{L}\p{N}]/gu,'')===String(b||'').normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^\p{L}\p{N}]/gu,'');
function checkExpiry(row){return row.status==='sent'&&row.deadline_at&&row.deadline_at<=now()}
function normalizeDidit(d){
 const z=d?.decision||d||{};
 const statuses=[z.status,d?.status].filter(Boolean).map(String);
 const approved=statuses.some(x=>x.toUpperCase()==='APPROVED');
 const ids=z.id_verifications||[],live=z.liveness_checks||[],faces=z.face_matches||[];
 const identity=ids[0]||{};
 return {approved:approved&&ids.length>0&&live.length>0&&faces.length>0,
   name:clean(identity.full_name||identity.fullName),dob:clean(identity.date_of_birth||identity.birth_date||identity.dob,30),status:clean(z.status||d.status,40)};
}
async function didit(env,path,data){
 const r=await fetch('https://verification.didit.me/v3/'+path,{method:data?'POST':'GET',headers:{'x-api-key':String(env.DIDIT_API_KEY||'').trim(),'Content-Type':'application/json'},...(data?{body:JSON.stringify(data)}:{}),signal:AbortSignal.timeout(15000)});
 if(!r.ok){
  let detail='Unknown provider response';
  try{
   const body=await r.json();
   const top=body?.detail||body?.message||body?.error||body?.code;
   const value=top||Object.fromEntries(Object.entries(body||{}).filter(([key])=>['workflow_id','vendor_data','callback','callback_method','non_field_errors','errors'].includes(key)));
   detail=typeof value==='string'?value:JSON.stringify(value);
  }catch{}
  detail=detail.replace(/[\\w.+-]+@[\\w.-]+\\.[A-Za-z]{2,}/g,'[redacted-email]').replace(/[A-Za-z0-9_=-]{45,}/g,'[redacted-token]').slice(0,400);
  console.warn('Didit rental session failure',{status:r.status,endpoint:data?'create-session':'decision'});
  if(data&&env.LONGSTAY_DB)try{await env.LONGSTAY_DB.prepare('INSERT INTO longstay_didit_api_errors(endpoint,http_status,detail,occurred_at) VALUES(?,?,?,?)').bind('rental-v2-create-session',r.status,detail,now()).run();}catch{}
  if(r.status===403)throw Error('Didit rejected session creation (HTTP 403). The Didit API key needs Sessions write permission and must belong to the application owning this workflow.');
  if(r.status===401)throw Error('Didit rejected the API key (HTTP 401). ProHouse must replace its Didit API key.');
  if(r.status===400||r.status===422)throw Error('Didit rejected the workflow configuration (HTTP '+r.status+'). ProHouse needs to check the workflow ID and the Live/Sandbox application settings.');
  throw Error('Didit service returned HTTP '+r.status+'. Contact ProHouse.');
 }
 return r.json();
}
function pdfSafe(s){return String(s??'').replace(/[\u2012-\u2015]/g,'-').replace(/[^\x20-\x7e]/g,'?')}
function wrap(text,font,size,width){
 const lines=[];for(const part of pdfSafe(text).split(/\n/)){let buf='';for(const w of part.split(/\s+/)){if(!w)continue;if(buf&&font.widthOfTextAtSize(buf+' '+w,size)>width){lines.push(buf);buf='';}if(font.widthOfTextAtSize(w,size)>width){let tail=w;while(tail){let n=tail.length;while(n>1&&font.widthOfTextAtSize(tail.slice(0,n),size)>width)n--;if(buf){lines.push(buf);buf='';}lines.push(tail.slice(0,n));tail=tail.slice(n);}continue;}buf+=(buf?' ':'')+w;}lines.push(buf);}return lines;
}
const b64=u=>{let s='';for(let i=0;i<u.length;i+=8000)s+=String.fromCharCode(...u.subarray(i,i+8000));return btoa(s)};
async function identityReceiptPDF(row){
 const d=await PDFDocument.create(),p=d.addPage([595,842]);const f=await d.embedFont(StandardFonts.Helvetica),bold=await d.embedFont(StandardFonts.HelveticaBold);let y=790;
 for(const [k,v] of [['PROHOUSE IDENTITY VERIFICATION RECEIPT',''],['Agreement reference',row.id],['Guest-entered legal name',row.guest_full_name],['Guest-entered DOB',row.guest_dob],['Guest phone',row.guest_phone],['Guest email',row.guest_email],['Didit verified legal name',row.verified_name],['Didit verified DOB',row.verified_dob||'Not returned'],['Didit decision',row.identity_status],['Didit session ID',row.identity_session_id],['Checked on (UTC)',row.identity_checked_at],['Evidence source','Didit hosted verification; this is a summary, NOT a copy of identity document']]){
 const text=pdfSafe((v?k+': '+v:k));for(const line of wrap(text,f,10,500)){p.drawText(line||' ',{x:45,y,font:k.startsWith('PROHOUSE')?bold:f,size:k.startsWith('PROHOUSE')?15:10});y-=18;}y-=7;
 }return new Uint8Array(await d.save());
}
async function documentPDF(row,completed){
 const d=await PDFDocument.create();const regular=await d.embedFont(StandardFonts.Helvetica),bold=await d.embedFont(StandardFonts.HelveticaBold);
 d.setTitle('ProHouse Mutual Rental Agreement '+row.id);d.setAuthor('ProHouse');
 const clauses=JSON.parse(row.clauses_json),s=JSON.parse(row.schedule_json);
 let p,y;const newpage=()=>{p=d.addPage([595,842]);y=780;p.drawText('PROHOUSE / RENTAL AGREEMENT',{x:46,y:806,font:bold,size:10,color:rgb(.16,.36,.23)})};
 function write(t,head=false){const font=head?bold:regular,size=head?13:9.5,leading=head?19:14;for(const line of wrap(t,font,size,503)){if(y<75)newpage();p.drawText(line||' ',{x:46,y,font,size,color:rgb(.11,.16,.21)});y-=leading;}y-=head?9:6}
 newpage();write('Mutual Rental Agreement',true);
 write('Reference '+row.id+' | '+(completed?'BOTH PARTIES SIGNED':'DRAFT / NOT COMPLETED'));
 write('SCHEDULE A',true);
 for(const [k,label] of [['provider','Provider'],['owneremail','Provider email'],['property','Property'],['area','Rented area'],['noaccess','No-access areas'],['rent','Weekly rent AUD'],['frequency','Payment frequency'],['start','Start date'],['period','Rental period'],['end','End date'],['bond','Cleaning bond AUD'],['holding','Holding fund AUD'],['internet','Internet'],['utilities','Electricity, gas and water'],['payid','PayID'],['bank','Bank BSB/account']])write(label+': '+(s[k]||'Not specified'));
 write('Guest: '+(row.guest_full_name||'(not signed)')+' | '+row.guest_email);
 write(paymentNotice(s));
 write('AGREED TERMS',true);
 let last='';let n=0;const names={'1':'Before rental period','2':'During rental period','3':'After rental period','4':'Special terms and conditions','5':'Termination and eviction'};
 for(const c of clauses){if(last!==c.section){last=c.section;write(names[last]||'Terms',true)}write((++n)+'. '+c.text)}
 if(y<230)newpage();write('EXECUTION RECORD',true);
 write('Guest full legal name: '+(row.guest_full_name||'Pending'));
 write('Payment terms acknowledgment version: '+PAYMENT_NOTICE_VERSION+' | '+(row.guest_signed_at?'Guest acknowledged before signing':'Pending'));
 write('Guest signed (UTC): '+(row.guest_signed_at||'Pending'));
 write('Didit status: '+(row.identity_status||'Pending')+' | Session: '+(row.identity_session_id||'Pending'));
 write('Provider signed (UTC): '+(row.provider_signed_at||'Pending'));
 write('Agreement content SHA-256: '+(row.content_sha256||'Recorded in portal'));
 for(const [value,title] of [[row.guest_signature,'Guest signature'],[row.provider_signature,'Provider signature']]){
   if(!value){write(title+': Pending');continue;}
   if(y<170)newpage();write(title+':');const image=await d.embedPng(Uint8Array.from(atob(value.split(',')[1]),x=>x.charCodeAt(0)));
   const scale=Math.min(150/image.width,58/image.height,1);p.drawImage(image,{x:46,y:y-60,width:image.width*scale,height:image.height*scale});y-=84;
 }
 d.getPages().forEach((page,i)=>{page.drawText('ProHouse | '+row.id+' | '+(i+1)+' / '+d.getPageCount(),{x:46,y:28,size:8,font:regular,color:rgb(.48,.52,.51)})});
 return new Uint8Array(await d.save());
}
export async function rentalV2(req,env){
 const u=new URL(req.url),path=u.pathname.replace(/^\/api\/rental-v2\/?/,'');
 try{
  if(path==='catalogue'&&req.method==='GET')return reply(200,'Clause catalogue', {clauses:RENTAL_CLAUSES});
  if(path==='owner/login'&&req.method==='POST'){
   if(!isOwnOrigin(req))return reply(403,'Origin not allowed.');
   if(!await throttle(req,env,'login'))return reply(429,'Please try again later.');
   const {email:address}=await apiBody(req);if(!email(address)||!env.PROHOUSE_ADMIN_EMAILS?.split(',').map(s=>s.trim().toLowerCase()).includes(address.toLowerCase()))return reply(200,'If authorised, a sign-in link has been emailed.');
   const t=token();await db(env).prepare('INSERT INTO rental_v2_auth (token_hash,role,expires_at,created_at) VALUES (?,?,?,?)').bind(await hash(t),'owner_login',plus(15),now()).run();
   await emailSend(env,address,'Your ProHouse Rental Portal login','Sign in within 15 minutes: '+APP_ORIGIN(req)+'/operations/rental/#owner-login='+t+'\n\nIf you did not request this, ignore this email.');
   return reply(200,'If authorised, a sign-in link has been emailed.');
  }
  if(path==='owner/verify'&&req.method==='POST'){
   const t=clean((await apiBody(req)).token,100);if(!validToken(t))return reply(403,'Invalid login link.');const h=await hash(t);
   const existing=await db(env).prepare("SELECT * FROM rental_v2_auth WHERE token_hash=? AND role='owner_login' AND expires_at>?").bind(h,now()).first();
   if(!existing)return reply(403,'Login link expired or used.');
   const session=token();await db(env).batch([db(env).prepare('DELETE FROM rental_v2_auth WHERE token_hash=?').bind(h),db(env).prepare('INSERT INTO rental_v2_auth (token_hash,role,expires_at,created_at) VALUES (?,?,?,?)').bind(await hash(session),'owner_session',plus(7*24*60),now())]);
   return reply(200,'Signed in',{session});
  }
  if(path==='owner/list'&&req.method==='GET'){
   if(!await owner(req,env))return reply(403,'Sign in as ProHouse first.');
   const rows=await db(env).prepare('SELECT * FROM rental_v2_agreements ORDER BY created_at DESC LIMIT 100').all();
   return reply(200,'Agreements',{agreements:rows.results.map(r=>safe(r,true))});
  }
  if(path==='owner/create'&&req.method==='POST'){
   if(!await owner(req,env))return reply(403,'Sign in as ProHouse first.');
   const x=await apiBody(req),clauses=chosen(x.selectedIds),schedule=scanFields(x.schedule),to=clean(x.guestEmail);
   if(!email(to)||!clauses.length)return reply(400,'Guest email and at least one clause required.');
   const id=crypto.randomUUID(),timestamp=now();
   await db(env).prepare('INSERT INTO rental_v2_agreements (id,status,clauses_json,schedule_json,guest_email,created_at,updated_at) VALUES (?,?,?,?,?,?,?)').bind(id,'draft',JSON.stringify(clauses),JSON.stringify(schedule),to,timestamp,timestamp).run();
   return reply(200,'Draft saved. Nothing has been sent.',{agreementId:id});
  }
  if(path==='owner/send'&&req.method==='POST'){
   if(!await owner(req,env))return reply(403,'Sign in as ProHouse first.');
   if(env.RENTAL_V2_SENDING_ENABLED!=='true')return reply(409,'Sending is disabled until the lease template has legal approval and production settings are configured.');
   const id=clean((await apiBody(req)).agreementId,100),r=await agreement(env,id);
   if(!r||r.status!=='draft')return reply(409,'Only a draft can be sent.');
   const t=token(),h=await hash(t),deadline=plus(24*60),sent=now();
   await db(env).prepare("UPDATE rental_v2_agreements SET status='sent',guest_token_hash=?,deadline_at=?,sent_at=?,updated_at=? WHERE id=? AND status='draft'").bind(h,deadline,sent,sent,id).run();
   // If delivery fails, the owner can resend a new link; old links are revoked.
   await emailSend(env,r.guest_email,'ProHouse rental agreement: complete within 24 hours',`You have been invited to review and sign a ProHouse rental agreement.\n\nComplete by ${deadline}.\n\nOpen your private link: ${APP_ORIGIN(req)}/operations/rental/#guest=${t}\n\nYou will provide your legal name, date of birth and phone number, verify your ID with Didit, review the agreement and sign. The rent and selected terms cannot be changed.\n\nDo not forward your link.`);
   return reply(200,'Invitation sent',{deadlineAt:deadline});
  }
  if(path==='owner/resend'&&req.method==='POST'){
   if(!await owner(req,env))return reply(403,'Sign in as ProHouse first.');
   if(env.RENTAL_V2_SENDING_ENABLED!=='true')return reply(409,'Sending is disabled pending legal approval.');
   const id=clean((await apiBody(req)).agreementId,100),r=await agreement(env,id);
   if(!r||!['sent','expired'].includes(r.status))return reply(409,'Resend only for unsigned agreements.');
   const t=token(),deadline=plus(24*60),stamp=now();
   await db(env).prepare("UPDATE rental_v2_agreements SET status='sent',guest_token_hash=?,deadline_at=?,sent_at=?,guest_full_name=NULL,guest_dob=NULL,guest_phone=NULL,identity_session_id=NULL,identity_verification_url=NULL,identity_status=NULL,verified_name=NULL,verified_dob=NULL,identity_checked_at=NULL,updated_at=? WHERE id=? AND status IN ('sent','expired')").bind(await hash(t),deadline,stamp,stamp,id).run();
   await emailSend(env,r.guest_email,'Your new ProHouse rental agreement invitation',`Your previous invitation has been replaced. Complete your agreement within 24 hours by ${deadline}.\n\nPrivate link: ${APP_ORIGIN(req)}/operations/rental/#guest=${t}`);
   return reply(200,'Fresh invitation issued',{deadlineAt:deadline});
  }
  if(path==='owner/get'&&req.method==='GET'){
   if(!await owner(req,env))return reply(403,'Sign in as ProHouse first.');const r=await agreement(env,u.searchParams.get('id'));
   if(!r)return reply(404,'Agreement not found.');return reply(200,'Agreement',{agreement:safe(r,true)});
  }
  if(path==='owner/pdf'&&req.method==='GET'){
   if(!await owner(req,env))return reply(403,'Sign in as ProHouse first.');const r=await agreement(env,u.searchParams.get('id'));
   if(!r)return reply(404,'Not found.');const pdf=r.final_pdf?new Uint8Array(r.final_pdf):await documentPDF(r,false);
   return new Response(pdf,{headers:{'Content-Type':'application/pdf','Content-Disposition':'attachment; filename="ProHouse-Rental-'+r.id+'.pdf"','Cache-Control':'no-store, private'}});
  }
  if(path==='guest/get'&&req.method==='GET'){
   const r=await guest(req,env);if(!r)return reply(404,'Invitation not found.');
   if(checkExpiry(r))return reply(410,'Invitation expired. Ask ProHouse to send a new agreement.');
   return reply(200,'Agreement',{agreement:safe(r)});
  }
  if(path==='guest/identity/start'&&req.method==='POST'){
   if(!isOwnOrigin(req))return reply(403,'Origin not allowed.');
   const r=await guest(req,env);if(!r||r.status!=='sent'||checkExpiry(r))return reply(409,'Invitation is not active.');
   if(!env.DIDIT_API_KEY||!env.DIDIT_WORKFLOW_ID)return reply(503,'Didit is not configured.');
   if(!await throttle(req,env,'didit'))return reply(429,'Please try again shortly.');
   const b=await apiBody(req),name=clean(b.name,140),dob=clean(b.dob,20),phone=clean(b.phone,45);
   if(name.length<3||!/^\d{4}-\d\d-\d\d$/.test(dob)||phone.length<7||b.consent!==true)return reply(400,'Complete legal name, DOB, phone and Didit consent.');
   // Reuse the guest's existing private Didit link when they return to the portal.
   // Legacy sessions saved only the ID. A fresh link replaces that unusable session.
   if(r.identity_session_id&&r.identity_verification_url&&/^https:\/\/verify\.didit\.me\//.test(r.identity_verification_url)){
    return reply(200,'Resume your Didit verification',{verificationUrl:r.identity_verification_url,resumed:true});
   }
   const result=await didit(env,'session/',{workflow_id:env.DIDIT_WORKFLOW_ID,vendor_data:r.id,callback:APP_ORIGIN(req)+'/operations/rental/'});
   const rawVerificationUrl=String(result.url||result.verification_url||result.session_url||'').trim();
   const verificationUrl=rawVerificationUrl.startsWith('verify.didit.me/')?'https://'+rawVerificationUrl:rawVerificationUrl;
   if(!/^https:\/\/verify\.didit\.me\//.test(verificationUrl)||!result.session_id)throw Error('Unexpected Didit session response.');
   await db(env).prepare("UPDATE rental_v2_agreements SET guest_full_name=?,guest_dob=?,guest_phone=?,identity_session_id=?,identity_verification_url=?,identity_status='In Progress',updated_at=? WHERE id=? AND status='sent' AND deadline_at>?").bind(name,dob,phone,result.session_id,verificationUrl,now(),r.id,now()).run();
   return reply(200,'Open secure ID verification',{verificationUrl});
  }
  if(path==='guest/identity/status'&&req.method==='POST'){
   const r=await guest(req,env);if(!r||r.status!=='sent'||checkExpiry(r))return reply(409,'Invitation is not active.');
   if(!r.identity_session_id)return reply(400,'Start verification first.');
   const result=normalizeDidit(await didit(env,'session/'+encodeURIComponent(r.identity_session_id)+'/decision/'));
   const outcome=identityOutcome(result,r.guest_full_name,r.guest_dob);
   await db(env).prepare('UPDATE rental_v2_agreements SET identity_status=?,verified_name=?,verified_dob=?,identity_checked_at=?,updated_at=? WHERE id=?').bind(outcome.status,result.name,result.dob,now(),now(),r.id).run();
   return reply(200,'Identity status',{status:outcome.status,approved:outcome.approved,inReview:outcome.inReview,maySign:outcome.approved||outcome.inReview});
  }
  if(path==='guest/sign'&&req.method==='POST'){
   const r=await guest(req,env);if(!r||r.status!=='sent'||checkExpiry(r))return reply(409,'Invitation is not active.');
   const b=await apiBody(req);if(b.consent!==true||b.paymentAcknowledged!==true||!dataUrl(b.signature))return reply(400,'Please read and acknowledge the payment deadlines before signing.');
    const scheduled=JSON.parse(r.schedule_json);
    const period=scheduled.period==='Guest chooses'?clean(b.period,12):scheduled.period;
    const end=calculateEnd(scheduled.start,period);
    if(!end)return reply(400,'Choose a valid 3, 6 or 12-month agreement period before signing.');
    if(scheduled.period!=='Guest chooses'&&b.period&&b.period!==scheduled.period)return reply(403,'The agreed rental period cannot be changed by the guest.');
    scheduled.period=period;scheduled.end=end;
   // Re-query the provider decision at signing, rather than trusting a browser flag.
   if(!r.identity_session_id)return reply(409,'Complete Didit verification first.');
   const v=normalizeDidit(await didit(env,'session/'+encodeURIComponent(r.identity_session_id)+'/decision/'));
   const outcome=identityOutcome(v,r.guest_full_name,r.guest_dob);
   if(!outcome.approved&&!outcome.inReview)return reply(409,'Didit must be Approved or In Review before signing. Status: '+outcome.status);
   // In Review records the guest signature, but the provider cannot countersign until verification is approved.
   const signedAt=now();
   const result=await db(env).prepare("UPDATE rental_v2_agreements SET status='guest_signed',schedule_json=?,guest_signature=?,guest_signed_at=?,identity_status=?,verified_name=?,verified_dob=?,identity_checked_at=?,updated_at=? WHERE id=? AND status='sent' AND deadline_at>?").bind(JSON.stringify(scheduled),b.signature,signedAt,outcome.status,v.name,v.dob,signedAt,signedAt,r.id,signedAt).run();
   if(result.meta?.changes!==1)return reply(409,'Invitation no longer valid.');
   const ownerMail=(env.PROHOUSE_ADMIN_EMAILS||'hi@prohouse.com.au').split(',').map(x=>x.trim()).filter(email);
   const receipt=await identityReceiptPDF({...r,identity_status:outcome.status,verified_name:v.name,verified_dob:v.dob,identity_checked_at:signedAt});
   await emailSend(env,ownerMail,outcome.inReview?'ACTION REQUIRED: Review Didit before countersigning ProHouse lease':'ProHouse lease ready for countersignature',`Didit status: ${outcome.status}\n${outcome.inReview?'MANUAL REVIEW REQUIRED: The guest has signed while Didit is In Review. Review the Didit session and obtain an Approved result before ProHouse countersigns.\n\n':''}Guest: ${r.guest_full_name}\nAgreement period: ${period} (${scheduled.start} to ${scheduled.end})\nDOB as entered: ${r.guest_dob}\nPhone: ${r.guest_phone}\nEmail: ${r.guest_email}\nDidit verified legal name: ${v.name}\nDidit session reference: ${r.identity_session_id}\n\nReview the secured verification record in your Didit console, then sign in to ProHouse Rental Portal.\nAgreement: ${r.id}\n\nFor privacy, no raw ID scan or biometric photo is transmitted by email.`,[{filename:'Didit-verification-summary-'+r.id+'.pdf',content:b64(receipt),content_type:'application/pdf'}]);
   return reply(200,'Signature recorded. ProHouse has been notified.');
  }
  if(path==='owner/sign'&&req.method==='POST'){
   if(!await owner(req,env))return reply(403,'Sign in as ProHouse first.');
   if(env.RENTAL_V2_SENDING_ENABLED!=='true')return reply(409,'Execution is disabled pending legal approval.');
   const b=await apiBody(req),r=await agreement(env,clean(b.agreementId,100));
   if(!r||r.status!=='guest_signed')return reply(409,'A verified guest signature is required first.');
   if(!dataUrl(b.signature)||b.consent!==true)return reply(400,'Provider signature and confirmation required.');
   if(!r.identity_session_id)return reply(409,'Didit verification is missing.');
   const latest=normalizeDidit(await didit(env,'session/'+encodeURIComponent(r.identity_session_id)+'/decision/'));
   const decision=identityOutcome(latest,r.guest_full_name,r.guest_dob);
   if(!decision.approved)return reply(409,'Countersignature blocked. Didit status: '+decision.status+'. Resolve manual review or mismatch in Didit first.');
   await db(env).prepare('UPDATE rental_v2_agreements SET identity_status=?,verified_name=?,verified_dob=?,identity_checked_at=? WHERE id=?').bind('Approved',latest.name,latest.dob,now(),r.id).run();
   r.identity_status='Approved';r.verified_name=latest.name;r.verified_dob=latest.dob;
   const signed=now();const payload=JSON.stringify({id:r.id,clauses:r.clauses_json,schedule:r.schedule_json,paymentNoticeVersion:PAYMENT_NOTICE_VERSION,guest:r.guest_email,guestSignedAt:r.guest_signed_at,providerSignedAt:signed});const signatureHash=await hash(payload);
   const completed={...r,provider_signature:b.signature,provider_signed_at:signed,content_sha256:signatureHash,status:'completed'};
   const pdf=await documentPDF(completed,true);
   if(pdf.length>2_000_000)throw Error('PDF too large for storage.');
   await db(env).prepare("UPDATE rental_v2_agreements SET status='completed',provider_signature=?,provider_signed_at=?,content_sha256=?,final_pdf=?,updated_at=? WHERE id=? AND status='guest_signed'").bind(b.signature,signed,signatureHash,pdf,signed,r.id).run();
   const att=[{filename:'ProHouse-Signed-Rental-'+r.id+'.pdf',content:b64(pdf),content_type:'application/pdf'}];
   await emailSend(env,[r.guest_email,...(env.PROHOUSE_ADMIN_EMAILS||'hi@prohouse.com.au').split(',').map(s=>s.trim()).filter(email)],'Completed signed ProHouse rental agreement',`Both parties have signed. Your executed agreement is attached as a PDF. Reference: ${r.id}.\n\nThe one-week rent advance of AUD ${Number(JSON.parse(r.schedule_json).rent).toFixed(2)} is requested within 24 hours from this countersignature, subject to applicable law. Before moving in, arrange any lawfully required bond/holding amount using the applicable statutory bond process. Keys are released after required cleared funds and/or bond lodgement are confirmed. New-payee transfers may be delayed, so arrange payment early.\n\nPayment reference: ${r.id}\nPayID: ${JSON.parse(r.schedule_json).payid}\nBank: ${JSON.parse(r.schedule_json).bank}`,att);
   return reply(200,'Agreement countersigned and completion email sent.');
  }
  return reply(404,'Unknown rental portal endpoint.');
 }catch(e){console.error('Rental V2:',path,e?.message);return reply(e.message?.startsWith('Didit')?502:400,e.message||'Portal request failed.');}
}