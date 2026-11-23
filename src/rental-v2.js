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
const OWNER_PASSWORD_ITERATIONS=225000;
const ownerEmail=(address,env)=>{
 const value=clean(address,254).toLowerCase();
 return email(value)&&(env.PROHOUSE_ADMIN_EMAILS||'hi@prohouse.com.au').split(',').some(v=>v.trim().toLowerCase()===value)?value:null;
};
const randomBytesHex=n=>hex(crypto.getRandomValues(new Uint8Array(n)));
async function passwordHash(password,salt,iterations=OWNER_PASSWORD_ITERATIONS){
 const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(password),'PBKDF2',false,['deriveBits']);
 const saltBytes=new Uint8Array(salt.match(/.{2}/g).map(pair=>parseInt(pair,16)));
 return hex(await crypto.subtle.deriveBits({name:'PBKDF2',salt:saltBytes,iterations,hash:'SHA-256'},key,256));
}
function sameHash(a,b){
 if(typeof a!=='string'||typeof b!=='string'||a.length!==b.length)return false;
 let diff=0;for(let i=0;i<a.length;i++)diff|=a.charCodeAt(i)^b.charCodeAt(i);
 return diff===0;
}
const strongPassword=v=>typeof v==='string'&&v.length>=12&&v.length<=128&&!/[\x00-\x1f\x7f]/.test(v);
async function createOwnerSession(env){
 const session=token();
 await db(env).prepare('INSERT INTO rental_v2_auth (token_hash,role,expires_at,created_at) VALUES (?,?,?,?)')
 .bind(await hash(session),'owner_session',plus(7*24*60),now()).run();
 return session;
}
async function owner(req,env){
 const t=bearer(req);if(!validToken(t))return false;
 const row=await db(env).prepare("SELECT token_hash FROM rental_v2_auth WHERE token_hash=? AND role='owner_session' AND expires_at>?").bind(await hash(t),now()).first();
 return !!row;
}
async function agreement(env,id){return db(env).prepare('SELECT * FROM rental_v2_agreements WHERE id=?').bind(id).first()}
function safe(row,admin=false){
 const obj={id:row.id,status:row.status,clauses:JSON.parse(row.clauses_json),schedule:JSON.parse(row.schedule_json),guestEmail:row.guest_email,sentAt:row.sent_at,deadlineAt:row.deadline_at,guestSignedAt:row.guest_signed_at,providerSignedAt:row.provider_signed_at,identityStatus:row.identity_status,diditStarted:!!row.identity_session_id};
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
 const d=await PDFDocument.create();
 const regular=await d.embedFont(StandardFonts.Helvetica),bold=await d.embedFont(StandardFonts.HelveticaBold);
 const logo=await d.embedPng(Uint8Array.from(atob("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\n0wMAAAAASUVORK5CYII=\n"),v=>v.charCodeAt(0)));
 d.setTitle('ProHouse Rental Agreement | '+row.id);d.setAuthor('ProHouse Australia');
 const clauses=JSON.parse(row.clauses_json),s=JSON.parse(row.schedule_json);
 const charcoal=rgb(.12,.16,.15),lime=rgb(.84,1,.23),pink=rgb(1,.19,.53),muted=rgb(.43,.48,.46),white=rgb(1,1,1),light=rgb(.965,.975,.963),line=rgb(.84,.88,.84);
 const W=595,H=842,L=43,R=43,C=W-L-R;
 let p,y;
 const safe=v=>pdfSafe(v===null||v===undefined||v===''?'Not specified':String(v));
 const money=v=>'AUD '+Number(v||0).toLocaleString('en-AU',{minimumFractionDigits:2,maximumFractionDigits:2});
 const payid='hi@prohouse.com.au';
 const bankParts=String(s.bank||'').split(/\s*[-–]\s*/);
 const bsb=bankParts.length>1?bankParts[0].trim():'';
 const account=bankParts.length>1?bankParts.slice(1).join('-').trim():String(s.bank||'').trim();

 function page(){
  p=d.addPage([W,H]);y=743;
  // Actual ProHouse transparent logo, without the previous oversized coloured header.
  p.drawImage(logo,{x:L,y:769,width:148,height:47});
  p.drawLine({start:{x:L,y:756},end:{x:W-R,y:756},thickness:1.3,color:lime});
 }
 function ensure(h){if(y-h<65)page()}
 function section(name){
  ensure(44);y-=7;
  p.drawRectangle({x:L,y:y-26,width:5,height:29,color:pink});
  p.drawRectangle({x:L+5,y:y-26,width:C-5,height:29,color:lime});
  p.drawText(safe(name).toUpperCase(),{x:L+17,y:y-17,font:bold,size:10.5,color:charcoal});
  y-=40;
 }
 function paragraph(t,{size=9.1,pad=8,color=charcoal,boldText=false,width=C,indent=0}={}){
  const font=boldText?bold:regular,leading=size+4;
  for(const part of String(t).split('\n')){
   const lines=wrap(safe(part||' '),font,size,width-indent-6);
   for(const item of lines){ensure(leading);p.drawText(item||' ',{x:L+indent,y,font,size,color});y-=leading}
  }
  y-=pad;
 }
 function groupTitle(name){
  ensure(25);y-=4;
  p.drawText(safe(name).toUpperCase(),{x:L+3,y,font:bold,size:9,color:charcoal});
  p.drawLine({start:{x:L,y:y-7},end:{x:L+C,y:y-7},thickness:1,color:lime});y-=20;
 }
 function scheduleRow(fields){
  const n=fields.length,space=10,w=(C-space*(n-1))/n;
  const prepared=fields.map(([label,val])=>({label:safe(label).toUpperCase(),lines:wrap(safe(val),regular,9.5,w-22)}));
  const height=Math.max(41,...prepared.map(v=>23+v.lines.length*12));
  ensure(height+3);
  for(let i=0;i<n;i++){
   const x=L+i*(w+space);
   p.drawRectangle({x,y:y-height,width:w,height,color:light,borderColor:line,borderWidth:.45});
   p.drawRectangle({x,y:y-height,width:3,height,color:i===0?pink:lime});
   p.drawText(prepared[i].label,{x:x+11,y:y-13,font:bold,size:7,color:muted});
   let ty=y-27;for(const v of prepared[i].lines){p.drawText(v,{x:x+11,y:ty,font:regular,size:9.5,color:charcoal});ty-=12;}
  }
  y-=height+7;
 }
 function summaryStrip(){
  ensure(76);
  const items=[['WEEKLY RENT',money(s.rent)],['REFUNDABLE HOLDING',money(s.holding)],['CLEANING AMOUNT',money(s.bond)]];
  const w=(C-16)/3;
  for(let i=0;i<3;i++){
   const x=L+i*(w+8);
   p.drawRectangle({x,y:y-67,width:w,height:67,color:i===0?lime:light,borderColor:i===0?lime:line,borderWidth:.6});
   p.drawText(items[i][0],{x:x+10,y:y-18,font:bold,size:7.2,color:charcoal});
   const txt=items[i][1];const size=bold.widthOfTextAtSize(txt,12.5)>w-18?10.3:12.5;
   p.drawText(txt,{x:x+10,y:y-44,font:bold,size,color:charcoal});
  }
  y-=78;
 }
 page();
 paragraph('RENTAL AGREEMENT',{size:18,boldText:true,pad:4});
 paragraph((completed?'EXECUTED AGREEMENT':'DRAFT FOR REVIEW')+'  /  '+row.id,{size:8,color:muted,pad:12});
 section('Schedule A  |  Agreement details');
 groupTitle('The property');
 scheduleRow([['Property address',s.property]]);
 scheduleRow([['Rented area',s.area],['Excluded / no-access areas',s.noaccess]]);
 groupTitle('The parties');
 scheduleRow([['Provider',s.provider],['Provider email',s.owneremail]]);
 scheduleRow([['Guest',row.guest_full_name||'Pending signature'],['Guest email',row.guest_email]]);
 groupTitle('Rental period');
 scheduleRow([['Start date',s.start],['End date',s.end]]);
 scheduleRow([['Fixed term',s.period],['Payment frequency',s.frequency]]);
 groupTitle('Financial terms');
 summaryStrip();
 scheduleRow([['Internet',s.internet],['Utilities (electricity, gas and water)',s.utilities]]);

 page();
 section('Payment instructions  |  Choose one method');
 function paymentPanel(number,heading,rows,notice){
  const x=L,w=C;
  const blockH=rows.length*27+91;
  ensure(blockH+10);
  p.drawRectangle({x,y:y-blockH,width:w,height:blockH,color:white,borderColor:line,borderWidth:1});
  p.drawRectangle({x,y:y-34,width:w,height:34,color:lime});
  p.drawText('OPTION '+number+'  |  '+heading,{x:x+14,y:y-22,font:bold,size:11,color:charcoal});
  let ty=y-56;
  for(const [label,value] of rows){
   p.drawText(safe(label).toUpperCase(),{x:x+15,y:ty,font:bold,size:7.8,color:muted});
   const valueText=safe(value);
   const valSize=bold.widthOfTextAtSize(valueText,12.6)>w-194?10.6:12.6;
   p.drawText(valueText,{x:x+164,y:ty-1,font:bold,size:valSize,color:charcoal});
   ty-=27;
  }
  p.drawRectangle({x:x+11,y:y-blockH+12,width:w-22,height:29,color:light});
  const warningLines=wrap(safe(notice),regular,8.1,w-44);
  let ny=y-blockH+31;
  for(const ln of warningLines.slice(0,2)){p.drawText(ln,{x:x+19,y:ny,font:regular,size:8.1,color:charcoal});ny-=10;}
  y-=blockH+17;
 }
 paymentPanel(1,'PAYID',[
  ['PayID email',payid]
 ],'Commonwealth Bank may hold some first-time payments for up to 24 hours. PayID does not guarantee instant availability.');
 paymentPanel(2,'DIRECT BANK TRANSFER',[
  ['Bank','Commonwealth Bank of Australia'],
  ['Account name','Cu Nguyen'],
  ['BSB',bsb||'See Schedule A bank details'],
  ['Account number',account||'See Schedule A bank details']
 ],'Use the agreement reference when transferring. Allow time for funds to clear before the payment deadline.');
 paragraph('PAYMENT REFERENCE: '+row.id,{boldText:true,size:10.2,pad:12});
 section('Payment and moving in');
 paragraph('1. ONE WEEK RENT ADVANCE: '+money(s.rent),{boldText:true,pad:4});
 paragraph('Requested within 24 hours after the provider countersigns and credited toward rent. Any consequences for late payment remain subject to applicable law.');
 paragraph('2. BEFORE MOVING IN',{boldText:true,pad:4});
 paragraph('Refundable holding/security amount stated in Schedule A: '+money(s.holding)+'. Refundable cleaning amount stated in Schedule A: '+money(s.bond)+'. These are collectible only where lawful. Statutory bonds must follow applicable limits and lodgement requirements.');
 paragraph('Allow time for bank processing, including possible holds on Commonwealth Bank first-time transfers. A payment receipt is not proof of cleared funds.');
 page();
 section('Agreed terms and conditions');
 const names={'1':'Before rental period','2':'During rental period','3':'After rental period','4':'Special terms and conditions','5':'Termination and eviction'};
 const gap=22,colWidth=(C-gap)/2,termSize=8.05,termLeading=11.2;
 let col=0,last='',index=0,termY=y,termX=L;
 function nextColumn(){
  if(col===0){col=1;termX=L+colWidth+gap;termY=742;}
  else{page();col=0;termX=L;termY=742;}
 }
 function termRoom(h){if(termY-h<62)nextColumn()}
 function termHeading(t){
  const lines=wrap(safe(t).toUpperCase(),bold,8.2,colWidth-16),height=17+lines.length*10;
  termRoom(height+12);termY-=7;
  p.drawRectangle({x:termX,y:termY-height,width:colWidth,height,color:lime});
  let ty=termY-13;for(const tline of lines){p.drawText(tline,{x:termX+7,y:ty,font:bold,size:8.2,color:charcoal});ty-=10}
  termY-=height+6;
 }
 function termText(t){
  for(const part of String(t).split('\n')){
   if(!part.trim()){termY-=3;continue;}
   const lines=wrap(safe(part),regular,termSize,colWidth-7);
   for(const lineText of lines){
    termRoom(termLeading);
    p.drawText(lineText||' ',{x:termX+3,y:termY,font:regular,size:termSize,color:charcoal});
    termY-=termLeading;
   }
  }
  termY-=7;
 }
 function breakClause(number){
  // Render legacy or new clause 3.2.2 as a proper tiered panel; ignore pasted numbering.
  const intro='EARLY TERMINATION / BREAK LEASE';
  const note="At least 28 days' written notice, subject to applicable law.";
  const rows=[['Under 25% elapsed',"4 weeks' rent"],['25% to under 50%',"3 weeks' rent"],['50% to under 75%',"2 weeks' rent"],['75% or more',"1 week's rent"]];
  const h=156;termRoom(h+8);
  p.drawRectangle({x:termX,y:termY-h,width:colWidth,height:h,color:light,borderColor:line,borderWidth:.65});
  p.drawRectangle({x:termX,y:termY-26,width:colWidth,height:26,color:lime});
  p.drawText(number+'. '+intro,{x:termX+7,y:termY-17,font:bold,size:8.1,color:charcoal});
  let ty=termY-40;
  for(const t of wrap(note,regular,7.7,colWidth-14)){p.drawText(t,{x:termX+7,y:ty,font:regular,size:7.7,color:charcoal});ty-=10;}
  ty-=8;
  for(const [label,fee] of rows){
   p.drawText(label,{x:termX+7,y:ty,font:regular,size:7.7,color:charcoal});
   p.drawText(fee,{x:termX+colWidth-7-bold.widthOfTextAtSize(fee,7.7),y:ty,font:bold,size:7.7,color:charcoal});
   ty-=19;
  }
  termY-=h+11;
 }
 for(const c of clauses){
  if(c.section!==last){last=c.section;termHeading((last||'')+'  '+(names[last]||'Other terms'));}
  index++;
  if(c.id==='3.2.2')breakClause(index);
  else termText(index+'. '+c.text);
 }
 page();section('Signatures and identity verification');
 groupTitle('Execution record');
 scheduleRow([['Guest name',row.guest_full_name||'Pending'],['Didit status',row.identity_status||'Pending']]);
 scheduleRow([['Guest signed (UTC)',row.guest_signed_at||'Pending'],['Provider signed (UTC)',row.provider_signed_at||'Pending']]);
 scheduleRow([['Didit session reference',row.identity_session_id||'Pending']]);
 for(const [value,name] of [[row.guest_signature,'GUEST SIGNATURE'],[row.provider_signature,'PROHOUSE SIGNATURE']]){
  ensure(120);
  p.drawText(name,{x:L,y,font:bold,size:8.5,color:charcoal});y-=16;
  p.drawRectangle({x:L,y:y-78,width:250,height:78,borderColor:line,borderWidth:.7,color:white});
  if(value){const img=await d.embedPng(Uint8Array.from(atob(value.split(',')[1]),v=>v.charCodeAt(0)));const scale=Math.min(225/img.width,65/img.height,1);p.drawImage(img,{x:L+11,y:y-71,width:img.width*scale,height:img.height*scale});}
  else p.drawText('Awaiting signature',{x:L+12,y:y-39,font:regular,size:9,color:muted});
  y-=96;
 }
 paragraph('Document integrity SHA-256: '+(row.content_sha256||'Recorded upon final signing'),{size:7.2,color:muted});
 d.getPages().forEach((pg,i)=>{
  pg.drawLine({start:{x:L,y:49},end:{x:W-R,y:49},thickness:.7,color:line});
  pg.drawText('PROHOUSE AUSTRALIA  |  PRIVATE AGREEMENT',{x:L,y:31,font:bold,size:7.4,color:charcoal});
  pg.drawText('PAGE '+(i+1)+' OF '+d.getPageCount(),{x:W-R-66,y:31,font:regular,size:7.4,color:muted});
 });
 return new Uint8Array(await d.save());
}
export async function rentalV2(req,env){
 const u=new URL(req.url),path=u.pathname.replace(/^\/api\/rental-v2\/?/,'');
 try{
  if(path==='catalogue'&&req.method==='GET')return reply(200,'Clause catalogue', {clauses:RENTAL_CLAUSES});
  if(path==='owner/password/request'&&req.method==='POST'){
   if(!isOwnOrigin(req))return reply(403,'Origin not allowed.');
   if(!await throttle(req,env,'password-request'))return reply(429,'Please try again later.');
   const address=ownerEmail((await apiBody(req)).email,env);
   const generic='If this is your authorised ProHouse email, a password setup or reset link will arrive shortly.';
   if(!address)return reply(200,generic);
   const existing=await db(env).prepare('SELECT email FROM rental_v2_owner_credentials WHERE email=?').bind(address).first();
   const t=token(),h=await hash(t),purpose=existing?'reset':'setup';
   await db(env).prepare('DELETE FROM rental_v2_password_tokens WHERE email=?').bind(address).run();
   await db(env).prepare('INSERT INTO rental_v2_password_tokens (token_hash,email,purpose,expires_at,created_at) VALUES (?,?,?,?,?)')
    .bind(h,address,purpose,plus(20),now()).run();
   const link=APP_ORIGIN(req)+'/operations/rental/#owner-password='+t;
   await emailSend(env,address,'ProHouse Rental Portal: '+(existing?'Reset your password':'Set up your password'),
    'A password '+(existing?'reset':'setup')+' was requested for your ProHouse Rental Portal.\n\nOpen this private link within 20 minutes:\n'+link+'\n\nIf you did not request this, ignore the email. Never forward this link.');
   return reply(200,generic);
  }
  if(path==='owner/password/confirm'&&req.method==='POST'){
   if(!isOwnOrigin(req))return reply(403,'Origin not allowed.');
   if(!await throttle(req,env,'password-confirm'))return reply(429,'Please try again later.');
   const b=await apiBody(req),t=clean(b.token,100),password=b.password;
   if(!validToken(t))return reply(403,'Invalid or expired password link.');
   if(!strongPassword(password))return reply(400,'Use a password of 12 to 128 characters, without control characters.');
   const h=await hash(t),record=await db(env).prepare('SELECT * FROM rental_v2_password_tokens WHERE token_hash=? AND expires_at>?').bind(h,now()).first();
   if(!record||!ownerEmail(record.email,env))return reply(403,'Invalid or expired password link.');
   const existing=await db(env).prepare('SELECT email FROM rental_v2_owner_credentials WHERE email=?').bind(record.email).first();
   if(record.purpose!==(existing?'reset':'setup'))return reply(409,'This setup link is no longer valid. Request a new one.');
   const salt=randomBytesHex(16),derived=await passwordHash(password,salt);
   const consumed=await db(env).prepare('DELETE FROM rental_v2_password_tokens WHERE token_hash=? AND expires_at>?').bind(h,now()).run();
   if(consumed.meta?.changes!==1)return reply(403,'This password link has already been used or has expired.');
   await db(env).prepare('INSERT INTO rental_v2_owner_credentials (email,password_salt,password_hash,iterations,updated_at) VALUES (?,?,?,?,?) ON CONFLICT(email) DO UPDATE SET password_salt=excluded.password_salt,password_hash=excluded.password_hash,iterations=excluded.iterations,updated_at=excluded.updated_at')
    .bind(record.email,salt,derived,OWNER_PASSWORD_ITERATIONS,now()).run();
   await db(env).prepare("DELETE FROM rental_v2_auth WHERE role='owner_session' OR role='owner_login'").run();
   await db(env).prepare('DELETE FROM rental_v2_password_tokens WHERE email=?').bind(record.email).run();
   return reply(200,'Password saved. Sign in with your email and new password.');
  }
  if(path==='owner/password/login'&&req.method==='POST'){
   if(!isOwnOrigin(req))return reply(403,'Origin not allowed.');
   if(!await throttle(req,env,'password-login'))return reply(429,'Too many sign-in attempts. Please try later.');
   const b=await apiBody(req),address=ownerEmail(b.email,env);
   if(!address||typeof b.password!=='string')return reply(403,'Incorrect email or password.');
   const credential=await db(env).prepare('SELECT password_salt,password_hash,iterations FROM rental_v2_owner_credentials WHERE email=?').bind(address).first();
   if(!credential)return reply(403,'Incorrect email or password. Set up a password first if needed.');
   const candidate=await passwordHash(b.password,credential.password_salt,credential.iterations);
   if(!sameHash(candidate,credential.password_hash))return reply(403,'Incorrect email or password.');
   return reply(200,'Signed in',{session:await createOwnerSession(env)});
  }
  if(path==='owner/logout'&&req.method==='POST'){
   if(!isOwnOrigin(req))return reply(403,'Origin not allowed.');
   const t=bearer(req);
   if(validToken(t))await db(env).prepare("DELETE FROM rental_v2_auth WHERE token_hash=? AND role='owner_session'").bind(await hash(t)).run();
   return reply(200,'Signed out');
  }
  if((path==='owner/login'||path==='owner/verify')&&req.method==='POST')
   return reply(410,'Admin sign-in links have been replaced with password login. Use Set up password or Forgot password.');
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
   const b=await apiBody(req),givenNames=clean(b.givenNames,100),familyName=clean(b.familyName,100),name=givenNames&&familyName?clean(givenNames+' '+familyName,140):'',dob=clean(b.dob,20),phone=clean(b.phone,45);
   if(!givenNames||!familyName||name.length<3||!/^\d{4}-\d\d-\d\d$/.test(dob)||phone.length<7||b.consent!==true)return reply(400,'Complete given name(s), family name, DOB, phone and Didit consent.');
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
   await emailSend(env,ownerMail,outcome.inReview?'ACTION REQUIRED: Review Didit before countersigning ProHouse lease':'ProHouse lease ready for countersignature',`Didit status: ${outcome.status}\n${outcome.inReview?'MANUAL REVIEW REQUIRED: The guest has signed while Didit is In Review. Review the Didit session and obtain an Approved result before ProHouse countersigns.\n\n':''}Guest: ${r.guest_full_name}\nAgreement period: ${period} (${scheduled.start} to ${scheduled.end})\nDOB as entered: ${r.guest_dob}\nPhone: ${r.guest_phone}\nEmail: ${r.guest_email}\nDidit verified legal name: ${v.name}\nDidit session reference: ${r.identity_session_id}\n\nReview the secured verification record in your Didit console, then sign in to ProHouse Rental Portal.\n\nOPEN RENTAL PORTAL TO REVIEW AND SIGN:\n${APP_ORIGIN(req)}/operations/rental/?agreement=${encodeURIComponent(r.id)}\n\nAgreement: ${r.id}\n\nFor privacy, no raw ID scan or biometric photo is transmitted by email.`,[{filename:'Didit-verification-summary-'+r.id+'.pdf',content:b64(receipt),content_type:'application/pdf'}]);
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
   const schedule=JSON.parse(r.schedule_json);
   const AUD=n=>'AUD '+Number(n||0).toLocaleString('en-AU',{minimumFractionDigits:2,maximumFractionDigits:2});
   const dueAt=new Date(Date.parse(signed)+24*60*60*1000).toLocaleString('en-AU',{timeZone:'Australia/Sydney',dateStyle:'full',timeStyle:'short'});
   const paymentEmail=[
    'YOUR PROHOUSE RENTAL AGREEMENT IS SIGNED',
    '',
    'Hello '+(r.guest_full_name||'Guest')+',',
    'Both parties have signed your rental agreement. Please read the payment steps below. The signed PDF is attached.',
    '',
    'PROPERTY: '+(schedule.property||'As agreed'),
    'RENTAL PERIOD: '+schedule.start+' to '+schedule.end+' ('+schedule.period+')',
    'AGREEMENT REFERENCE: '+r.id,
    '',
    'STEP 1  |  PAY ONE WEEK RENT WITHIN 24 HOURS',
    'Amount: '+AUD(schedule.rent),
    'Deadline: '+dueAt+' (Sydney time)',
    'This is rent paid in advance and credited towards your tenancy.',
    'IMPORTANT: If the required payment is not received by the deadline, ProHouse may take steps to cancel or terminate the arrangement only where permitted by the applicable law. A signed residential tenancy is not automatically void simply because payment is late.',
    '',
    'STEP 2  |  BEFORE YOUR MOVE-IN DATE ('+schedule.start+')',
    'Refundable holding/security amount specified in Schedule A: '+AUD(schedule.holding),
    'Refundable cleaning amount specified in Schedule A: '+AUD(schedule.bond),
    'These amounts are due only to the extent permitted by the law governing your tenancy. Any rental bond must comply with the applicable legal limit and official lodgement requirements. For a standard NSW residential tenancy, an additional cleaning bond cannot be added on top of the maximum four-week rental bond.',
    '',
    'STEP 3  |  CHOOSE ONE OF TWO PAYMENT METHODS',
    '',
    'OPTION 1: PAYID',
    'PayID email: hi@prohouse.com.au',
    'Important: Commonwealth Bank may hold some first-time payments for up to 24 hours. PayID does not guarantee instant availability.',
    '',
    'OPTION 2: DIRECT BANK TRANSFER',
    'Bank: Commonwealth Bank of Australia',
    'Account name: Cu Nguyen',
    'BSB: '+(String(schedule.bank||'').split(/\s*[-–]\s*/).length>1?String(schedule.bank).split(/\s*[-–]\s*/)[0].trim():'See Schedule A bank details'),
    'Account number: '+(String(schedule.bank||'').split(/\s*[-–]\s*/).length>1?String(schedule.bank).split(/\s*[-–]\s*/).slice(1).join('-').trim():String(schedule.bank||'See Schedule A bank details')),
    '',
    'PAYMENT REFERENCE: '+r.id,
    'Bank transfer receipt is not confirmation that cleared funds have arrived. ProHouse confirms receipt before releasing keys, subject to legal bond lodgement and tenancy requirements.',
    '',
    'BANK TRANSFER WARNING',
    'Commonwealth Bank (CBA) says first-time transfers to a new payee can be held for up to 24 hours, and some transfers can take longer. Allow extra time. If you cannot meet the payment deadline, contact ProHouse immediately about an alternative payment method, including another bank or a bank-branch deposit where available.',
    '',
    'QUESTIONS OR PAYMENT CONFIRMATION',
    'Email: hi@prohouse.com.au',
    'Rental portal: '+APP_ORIGIN(req)+'/operations/rental/',
    '',
    'Kind regards,',
    'ProHouse Australia'
   ].join('\n');
   await emailSend(env,[r.guest_email,...(env.PROHOUSE_ADMIN_EMAILS||'hi@prohouse.com.au').split(',').map(x=>x.trim()).filter(email)],'ACTION REQUIRED: Pay first week rent by '+dueAt+' | ProHouse '+r.id,paymentEmail,att);
   return reply(200,'Agreement countersigned and completion email sent.');
  }
  return reply(404,'Unknown rental portal endpoint.');
 }catch(e){console.error('Rental V2:',path,e?.message);return reply(e.message?.startsWith('Didit')?502:400,e.message||'Portal request failed.');}
}