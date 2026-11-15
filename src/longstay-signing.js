import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { fillMutualAgreementPDF } from './longstay-lease.js';
import { findReview } from './longstay-review.js';

const DB_TEMPLATE='mutual-agreement-v10';
const MAX_PDF=1900000;
const HEAD={'Cache-Control':'no-store, private','X-Robots-Tag':'noindex, nofollow','Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff'};
const reply=(status,message,extra={})=>Response.json({message,...extra},{status,headers:HEAD});
const str=(s,max=240)=>typeof s==='string'?s.trim().slice(0,max):'';
const goodMail=s=>/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s||'')&&s.length<=254;
const goodSignature=s=>typeof s==='string'&&/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(s)&&s.length>=250&&s.length<=300000;
const nonce=()=>[...crypto.getRandomValues(new Uint8Array(32))].map(x=>x.toString(16).padStart(2,'0')).join('');
const iso=()=>new Date().toISOString();
const future=hours=>new Date(Date.now()+hours*3600000).toISOString();
const headerToken=req=>(req.headers.get('Authorization')||'').replace(/^Bearer\s+/i,'').trim();
const bytes=x=>x instanceof Uint8Array?x:x instanceof ArrayBuffer?new Uint8Array(x):Uint8Array.from(x||[]);
function base64(bytes){
 let x='';for(let i=0;i<bytes.length;i+=8192)x+=String.fromCharCode(...bytes.subarray(i,i+8192));
 return btoa(x);
}
async function digest(token){
 if(!/^[a-f0-9]{64}$/.test(token||''))return null;
 const sha=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(token));
 return [...new Uint8Array(sha)].map(x=>x.toString(16).padStart(2,'0')).join('');
}
async function mail(env,to,subject,body,attachment){
 if(!env.RESEND_API_KEY)throw Error('Email service unavailable');
 const payload={from:env.APPLICATION_FROM_EMAIL||'ProHouse <no-reply@prohouse.com.au>',
   to:Array.isArray(to)?to:[to],subject,text:body,tags:[{name:'form',value:'longstay-lease'}]};
 if(attachment)payload.attachments=[{filename:attachment.name,content:base64(attachment.pdf),content_type:'application/pdf'}];
 const resp=await fetch('https://api.resend.com/emails',{
   method:'POST',headers:{Authorization:'Bearer '+env.RESEND_API_KEY,'Content-Type':'application/json'},
   body:JSON.stringify(payload)
 });
 if(!resp.ok){const error=await resp.text().catch(()=>'');console.error('Lease mail failure',resp.status,error.slice(0,250));throw Error('Could not deliver lease email.')}
 return resp.json();
}
function admins(env){return (env.PROHOUSE_ADMIN_EMAILS||'hi@prohouse.com.au').split(',').map(x=>x.trim()).filter(Boolean)}
async function adminRow(request,env){
 const token=headerToken(request);
 const review=await findReview(env,token);
 if(!review||review.expires_at<iso()||review.status!=='approved')return null;
 return review;
}
async function currentPacket(env,reference){
 return env.LONGSTAY_DB.prepare('SELECT * FROM longstay_lease_packets WHERE reference=?').bind(reference).first();
}
function summary(packet){
 const data=JSON.parse(packet.settings_json),app=JSON.parse(packet.application_json);
 return {reference:packet.reference,status:packet.status,
  settings:data,applicants:app.people,sentAt:packet.sent_at,deadlineAt:packet.deadline_at,
  firstSigned:!!packet.first_signed_at,secondSigned:app.people!=='Two people'||!!packet.second_signed_at,
  firstSignedAt:packet.first_signed_at,secondSignedAt:packet.second_signed_at,
  paymentReported:!!packet.payment_reported_at,paymentReference:packet.payment_reference||'',
  paymentVerified:!!packet.payment_verified_at,paymentVerifiedAt:packet.payment_verified_at,
  secondWeekVerified:!!packet.second_week_verified_at,
  secondWeekVerifiedAt:packet.second_week_verified_at,
  bondVerified:!!packet.bond_record_verified_at||Number(data.bondAmount||0)===0,
  bondReference:packet.bond_reference||'',
  bondAmount:data.bondAmount||'0',
  keyCollectionFinancialChecksComplete:packet.status==='completed'&&!!packet.payment_verified_at&&
    !!packet.second_week_verified_at&&
    (!!packet.bond_record_verified_at||Number(data.bondAmount||0)===0),
  providerSigned:!!packet.provider_signed_at,completedAt:packet.completed_at};
}
const properties=[
  ['VIC - Oakden Crescent, St. Albans','VIC'],
  ['NSW - Guess Avenue, Wolli Creek','NSW'],
  ['NSW - Arncliffe Street, Wolli Creek','NSW']
];
const settingsKeys=['guest1Name','guest1Email','guest1Phone','guest2Name','guest2Email','guest2Phone',
 'fullAddress','rentedArea','acceptedWeeklyRent','leaseStart','leaseEnd','cleaningBond','holdingFund',
 'rentFrequency','internet','electricity','water','bankDetails','payId','providerSigner','bondAmount'];
function readSettings(form,app){
 const settings=Object.fromEntries(settingsKeys.map(k=>[k,str(form.get(k),240)]));
 if(app.people!=='Two people'){
  settings.guest2Name='';settings.guest2Email='';settings.guest2Phone='';
 }
 const required=['guest1Name','guest1Email','guest1Phone','fullAddress','rentedArea','acceptedWeeklyRent',
  'leaseStart','leaseEnd','cleaningBond','holdingFund','rentFrequency','internet','electricity',
  'water','bankDetails','payId','providerSigner','bondAmount'];
 if(app.people==='Two people')required.push('guest2Name','guest2Email','guest2Phone');
 if(required.some(k=>!settings[k]))throw Error('Review and complete every required prefilled lease field.');
 if(!goodMail(settings.guest1Email)||(app.people==='Two people'&&
    (!goodMail(settings.guest2Email)||settings.guest2Email.toLowerCase()===settings.guest1Email.toLowerCase())))
   throw Error('Please confirm distinct, valid tenant email addresses.');
 if(!['Every week','Every 2 weeks','Every 4 weeks','Every calendar month'].includes(settings.rentFrequency))
   throw Error('Invalid payment frequency.');
 for(const key of ['acceptedWeeklyRent','cleaningBond','holdingFund','bondAmount'])
   if(!/^\d{1,6}(\.\d{1,2})?$/.test(settings[key]))throw Error('Check the rent and bond amounts.');
 if(Number(settings.acceptedWeeklyRent)<=0)throw Error('Weekly rent must be greater than zero.');
 if(Number(settings.bondAmount)<0)throw Error('Bond amount cannot be negative. Confirm the lawful amount separately from any cleaning bond.');
 for(const key of ['leaseStart','leaseEnd'])
   if(!/^\d{4}-\d{2}-\d{2}$/.test(settings[key])||Number.isNaN(Date.parse(settings[key]+'T12:00:00Z')))
     throw Error('Confirm valid lease start and end dates.');
 if(settings.leaseEnd<settings.leaseStart)throw Error('Lease end must follow the start date.');
 if(settingsKeys.some(k=>settings[k].includes('<')||settings[k].includes('>')))
   throw Error('Please remove unsupported characters from entered lease details.');
 const state=app.property?.startsWith('VIC')?'VIC':app.property?.startsWith('NSW')?'NSW':null;
 if(state && !(settings.fullAddress.toUpperCase().includes(state)))
   throw Error('Full address must include the selected property state: '+state);
 return settings;
}
async function masterPDF(form,env){
 const file=form.get('template');let master,upload=false;
 if(file&&typeof file!=='string'&&file.size){
  if(file.type!=='application/pdf'||file.size>MAX_PDF)throw Error('Use a six-page PDF template under 1.9 MB.');
  master=bytes(await file.arrayBuffer());upload=true;
 } else {
  const record=await env.LONGSTAY_DB.prepare(
    'SELECT template_bytes FROM longstay_lease_templates WHERE template_name=?'
  ).bind(DB_TEMPLATE).first();
  if(!record?.template_bytes)throw Error('Upload the six-page mutual agreement PDF for the first application.');
  master=bytes(record.template_bytes);
 }
 if(master.length<12||master.length>MAX_PDF||String.fromCharCode(...master.subarray(0,5))!=='%PDF-')
   throw Error('Invalid mutual agreement PDF.');
 return {master,upload};
}
export async function prepareLease(request,env){
 if(request.method!=='POST')return reply(405,'Method not allowed.');
 if(request.headers.get('Origin')&&request.headers.get('Origin')!==new URL(request.url).origin)
  return reply(403,'ProHouse portal only.');
 if(!request.headers.get('Content-Type')?.toLowerCase().startsWith('multipart/form-data'))
  return reply(415,'Multipart lease form required.');
 if(Number(request.headers.get('Content-Length')||0)>MAX_PDF+50000)return reply(413,'Lease template too large.');
 const review=await adminRow(request,env);
 if(!review)return reply(403,'Approved application review link required.');
 const current=await currentPacket(env,review.reference);
 if(current&&current.status!=='draft')return reply(409,'This lease has already been released. Contact ProHouse to change a released agreement.');
 let form;try{form=await request.formData()}catch{return reply(400,'Unable to read lease editor.')}
 let app;try{app=JSON.parse(review.summary_json);}catch{return reply(503,'Applicant data unavailable.')}
 let settings,master,upload;
 try{
  settings=readSettings(form,app);
  ({master,upload}=await masterPDF(form,env));
  const preview=await fillMutualAgreementPDF(master,app,settings,review.reference,{draft:true});
  if(preview.length>MAX_PDF)throw Error('The draft PDF exceeds the private storage limit.');
  // Never publish a draft. Store the exact bytes that staff will be shown.
  const now=iso();
  await env.LONGSTAY_DB.prepare(
    'INSERT INTO longstay_lease_packets (reference,status,application_json,settings_json,draft_pdf,created_at,updated_at) VALUES (?,?,?,?,?,?,?) ON CONFLICT(reference) DO UPDATE SET application_json=excluded.application_json,settings_json=excluded.settings_json,draft_pdf=excluded.draft_pdf,updated_at=excluded.updated_at WHERE status=\'draft\''
  ).bind(review.reference,'draft',JSON.stringify(app),JSON.stringify(settings),preview,now,now).run();
  if(upload&&form.get('saveTemplate')==='Yes'){
    await env.LONGSTAY_DB.prepare(
      'INSERT INTO longstay_lease_templates (template_name,template_bytes,uploaded_by_reference,updated_at) VALUES (?,?,?,?) ON CONFLICT(template_name) DO UPDATE SET template_bytes=excluded.template_bytes,uploaded_by_reference=excluded.uploaded_by_reference,updated_at=excluded.updated_at'
    ).bind(DB_TEMPLATE,master,review.reference,now).run();
  }
  return reply(200,'Lease draft prepared for your review. No tenant email has been sent.',
    {reference:review.reference,status:'draft',settings,previewAvailable:true});
 }catch(e){console.error('Lease preparation failed',e?.message);return reply(400,e.message||'Could not prepare lease.')}
}
export async function packetForAdmin(request,env){
 const review=await adminRow(request,env);if(!review)return reply(403,'Invalid staff review link.');
 const packet=await currentPacket(env,review.reference);
 if(!packet)return reply(200,'No lease draft has been prepared.',{status:'not_prepared',reference:review.reference});
 return reply(200,'Lease status ready.',summary(packet));
}
async function packetForTenant(env,token){
 const hash=await digest(token);
 if(!hash)return null;
 const packet=await env.LONGSTAY_DB.prepare(
  'SELECT * FROM longstay_lease_packets WHERE first_token_hash=? OR second_token_hash=?'
 ).bind(hash,hash).first();
 if(!packet)return null;
 const slot=packet.first_token_hash===hash?1:2;
 return {packet,slot};
}
export async function tenantPacket(request,env){
 if(request.method!=='GET')return reply(405,'Method not allowed.');
 const record=await packetForTenant(env,headerToken(request));
 if(!record)return reply(404,'Invitation not found.');
 const {packet,slot}=record,settings=JSON.parse(packet.settings_json);
 return reply(200,'Lease invitation loaded.',{
  reference:packet.reference,status:packet.status,slot,
  legalName:settings['guest'+slot+'Name'],email:settings['guest'+slot+'Email'],
  property:settings.fullAddress,rentedArea:settings.rentedArea,
  weeklyRent:settings.acceptedWeeklyRent,payId:settings.payId,bondAmount:settings.bondAmount,
  bankDetails:settings.bankDetails,
  dueAt:packet.deadline_at,sentAt:packet.sent_at,
  signed:!!packet[slot===1?'first_signed_at':'second_signed_at'],
  otherSigned:!!packet[slot===1?'second_signed_at':'first_signed_at'],
  paymentReported:!!packet.payment_reported_at,paymentVerified:!!packet.payment_verified_at
 });
}
export async function leaseDocument(request,env){
 if(request.method!=='GET')return reply(405,'Method not allowed.');
 let packet,staff=false;
 const review=await adminRow(request,env);
 if(review){packet=await currentPacket(env,review.reference);staff=true;}
 else {
  const record=await packetForTenant(env,headerToken(request));
  if(!record)return reply(404,'Private lease link not found.');
  packet=record.packet;
  if(!['sent','tenants_signed','completed'].includes(packet.status)||
     (packet.status!=='completed'&&packet.deadline_at<iso()&&
      (!packet.payment_reported_at||!packet.first_signed_at||
       (JSON.parse(packet.application_json).people==='Two people'&&!packet.second_signed_at))))
    return reply(410,'This signing invitation has expired. Contact ProHouse.');
 }
 if(!packet)return reply(404,'Lease has not been prepared.');
 const file=packet.status==='completed'?packet.final_pdf:
   (staff&&packet.status==='draft'?packet.draft_pdf:packet.lease_pdf);
 if(!file)return reply(404,'Requested lease PDF is unavailable.');
 return new Response(bytes(file),{headers:{...HEAD,'Content-Type':'application/pdf',
  'Content-Disposition':'inline; filename="ProHouse-Lease-'+packet.reference+'.pdf"'}});
}
async function signedPDF(packet,withProvider=false){
 const original=packet.lease_pdf;
 if(!original)throw Error('Released agreement PDF missing.');
 const pdf=await PDFDocument.load(bytes(original)),page=pdf.getPage(5),font=await pdf.embedFont(StandardFonts.Helvetica);
 const p=JSON.parse(packet.settings_json);
 const entries=[
  {file:packet.first_signature,date:packet.first_signed_at,name:p.guest1Name,x:108,y:233,dx:108,dy:197},
  {file:packet.second_signature,date:packet.second_signed_at,name:p.guest2Name,x:357,y:233,dx:357,dy:197},
  {file:withProvider?packet.provider_signature:null,date:withProvider?packet.provider_signed_at:null,
   name:p.providerSigner,x:108,y:110,dx:108,dy:75}
 ];
 for(const v of entries){
  if(!v.file)continue;
  const image=await pdf.embedPng(Uint8Array.from(atob(v.file.split(',')[1]),x=>x.charCodeAt(0)));
  const scale=Math.min(172/image.width,36/image.height);
  page.drawImage(image,{x:v.x,y:v.y,width:image.width*scale,height:image.height*scale});
  page.drawText(v.date.slice(0,10),{x:v.dx,y:v.dy,font,size:8.3,color:rgb(.14,.17,.15)});
 }
 if(withProvider){
  const audit=pdf.addPage([595,842]),now=packet.provider_signed_at;
  const lines=[
   'PROHOUSE - ELECTRONIC SIGNATURE AUDIT',
   'Application reference: '+packet.reference,
   'Lease issued (UTC): '+packet.sent_at,
   'Tenant 1: '+p.guest1Name+' <'+p.guest1Email+'>',
   'Tenant 1 electronically signed (UTC): '+packet.first_signed_at,
   ...(p.guest2Email?[
     'Tenant 2: '+p.guest2Name+' <'+p.guest2Email+'>',
     'Tenant 2 electronically signed (UTC): '+packet.second_signed_at]:[]),
   'One-week rent payment reported (UTC): '+packet.payment_reported_at,
   'Payment verified by ProHouse (UTC): '+packet.payment_verified_at,
   'Provider signer: '+p.providerSigner,
   'Provider electronically signed (UTC): '+now,
   'Signing method: private email invitation, written consent, canvas signature.',
   'Each signer viewed the six-page agreement and acknowledged the withdrawal notice.',
   'This audit page records the service workflow; it is not independent ID verification.'
  ];
  let y=782;
  for(let i=0;i<lines.length;i++){
   audit.drawText(lines[i],{x:45,y,font,size:i===0?13:9,color:rgb(.1,.16,.13)});
   y-=i===0?40:26;
  }
 }
 pdf.setTitle('ProHouse lease '+packet.reference+(withProvider?' - fully signed':' - tenant signed'));
 return new Uint8Array(await pdf.save());
}
export async function sendLease(request,env){
 if(request.method!=='POST')return reply(405,'Method not allowed.');
 if(request.headers.get('Origin')!==new URL(request.url).origin)return reply(403,'Same-origin review required.');
 const review=await adminRow(request,env);
 if(!review)return reply(403,'Approved review required.');
 let body;try{body=await request.json()}catch{return reply(400,'Invalid approval request.')}
 if(body?.confirmLeaseReviewed!==true||body?.confirmTermsFinal!==true||body?.confirm24Hours!==true)
  return reply(400,'Confirm the legally reviewed lease, edited terms and 24-hour signing deadline.');
 let packet=await currentPacket(env,review.reference);
 if(!packet||packet.status!=='draft')return reply(409,'Save and preview a lease draft before sending it.');
 const app=JSON.parse(packet.application_json),settings=JSON.parse(packet.settings_json);
 const template=await env.LONGSTAY_DB.prepare('SELECT template_bytes FROM longstay_lease_templates WHERE template_name=?')
   .bind(DB_TEMPLATE).first();
 if(!template?.template_bytes)return reply(503,'Saved master PDF is missing. Upload and save the PDF master before sending.');
 let released;
 try{released=await fillMutualAgreementPDF(bytes(template.template_bytes),app,settings,review.reference,{draft:false});}
 catch(e){console.error('Lease release PDF error',e?.message);return reply(500,'Unable to prepare signable lease PDF.')}
 if(released.length>MAX_PDF)return reply(413,'The agreement exceeds the private lease storage limit.');
 const token1=nonce(),token2=app.people==='Two people'?nonce():null;
 const now=iso(),deadline=future(24),hash1=await digest(token1),hash2=token2?await digest(token2):null;
 const changed=await env.LONGSTAY_DB.prepare(
   "UPDATE longstay_lease_packets SET status='sent',lease_pdf=?,first_token_hash=?,second_token_hash=?,sent_at=?,deadline_at=?,updated_at=? WHERE reference=? AND status='draft'"
 ).bind(released,hash1,hash2,now,deadline,now,review.reference).run();
 if(!changed.meta?.changes)return reply(409,'This lease was already released.');
 const inviteUrl=(t)=>{const url=new URL('/operations/livewithus/sign/',new URL(request.url).origin);
  url.hash='token='+t;return url.toString();};
 const recipients=[
  {email:settings.guest1Email,name:settings.guest1Name,token:token1},
  ...(token2?[{email:settings.guest2Email,name:settings.guest2Name,token:token2}]:[])
 ];
 const failed=[];
 for(const r of recipients){
  const localDeadline=new Intl.DateTimeFormat('en-AU',{
    timeZone:'Australia/Sydney',dateStyle:'full',timeStyle:'short'
   }).format(new Date(deadline));
  const body=[
   'Congratulations '+r.name+'! Your ProHouse rental application has been approved.',
   '',
   'Your agreement for '+settings.fullAddress+' is now ready to review and sign.',
   'Please open this PRIVATE link, read every page, and sign with your own signature:',
   inviteUrl(r.token),
   '',
   'ACTION REQUIRED WITHIN 24 HOURS OF THIS EMAIL:',
   '1. Read and electronically sign the full six-page lease.',
   '2. Make a bank transfer for ONE WEEK of rent in advance: AUD $'+Number(settings.acceptedWeeklyRent).toFixed(2)+'.',
   'Deadline: '+localDeadline+' (Sydney/Melbourne time).',
   '',
   'PAYMENT DETAILS: The PayID, BSB and bank account are listed on SCHEDULE A, the LAST PAGE of the lease.',
   'RECOMMENDED: Use PayID '+settings.payId+' where your bank supports fast transfer. Verify the recipient name before paying.',
   'COMMONWEALTH BANK: First-time payments to a new payee may be delayed for security checks, usually up to 24 hours and sometimes longer, including 24–48 hours in certain circumstances. If possible, use another bank that can transfer promptly or contact ProHouse before the deadline.',
   'Use transfer reference: '+review.reference+'. This is ONE week of rent for the rental agreement, not per tenant.',
   'After transferring, report your bank transaction reference on your signing page.',
   '',
   'ProHouse can confirm payment only after CLEARED funds appear in our bank account. A bank screenshot or transfer receipt alone is not proof of payment.',
   'NEXT: After all named tenants sign and ProHouse confirms the first-week rent has arrived, ProHouse will countersign and email the final fully signed lease. You must complete the signing and transfer steps BEFORE the ProHouse signature.',
   'Bond and the second week of rent will then be due before key collection.',
   '',
   'CANCELLATION / WITHDRAWAL: If you change your mind after submitting your signed agreement and first-week rent, ProHouse may apply that payment to rent legally due or applicable lawful lease-break costs. You may lose some or all of the first-week payment. It is NOT an automatic non-refundable penalty; any amount not legally owed will be returned, subject to the agreement and applicable state law.',
   'Notify ProHouse promptly in writing if you decide not to proceed. Do not share your personal signing link. Contact hi@prohouse.com.au if you need help.'
  ].join('\n');
  try{await mail(env,r.email,'Congratulations! Sign your ProHouse lease and pay within 24 hours | '+review.reference,body);}
  catch(e){failed.push(r.email)}
 }
 try{await mail(env,admins(env),'[LEASE SENT] '+review.reference,
  'The lease was approved and issued.\\nReference: '+review.reference+
  '\\nTenants: '+recipients.map(x=>x.email).join(', ')+
  '\\nDeadline: '+deadline+' UTC\\n24-hour payment requirement: $'+Number(settings.acceptedWeeklyRent).toFixed(2)+
  '\\nUnsent invitations: '+(failed.join(', ')||'none')+
  '\\nUse the original private review link to monitor signing and verify cleared funds.',
  {name:'ProHouse-Lease-For-Signing-'+review.reference+'.pdf',pdf:released});}
 catch(e){console.error('Owner issue email failure',e?.message)}
 return reply(failed.length?207:200,failed.length?'Some invitation emails could not be sent. Contact ProHouse.':'Lease sent to tenants. The 24-hour deadline has started.',
  {reference:review.reference,status:'sent',deadlineAt:deadline,inviteSent:recipients.length-failed.length,failedEmails:failed});
}
export async function tenantSign(request,env){
 if(request.method!=='POST')return reply(405,'Method not allowed.');
 if(request.headers.get('Origin')!==new URL(request.url).origin)return reply(403,'Invalid origin.');
 const match=await packetForTenant(env,headerToken(request));
 if(!match)return reply(404,'Private signing invitation not found.');
 let {packet,slot}=match;
 if(packet.status!=='sent'&&packet.status!=='tenants_signed')return reply(409,'This lease cannot currently be signed.');
 if(packet.deadline_at<iso())return reply(410,'The 24-hour deadline has passed. Contact ProHouse.');
 let body;try{body=await request.json()}catch{return reply(400,'Invalid signing form.')}
 const settings=JSON.parse(packet.settings_json);
 const key=slot===1?'first':'second';
 const name=settings['guest'+slot+'Name'];
 if(str(body.legalName)!==name||body.readAllPages!==true||body.agreeElectronicSign!==true||
     body.agreeTerms!==true||body.acknowledgeWithdrawalTerms!==true||!goodSignature(body.signature))
  return reply(400,'Read all pages, acknowledge the withdrawal notice, confirm your exact name and consent, and provide your own signature.');
 if(packet[key+'_signed_at'])return reply(200,'You already signed this lease.',{status:'signed'});
 const time=iso();
 const changed=await env.LONGSTAY_DB.prepare(
  "UPDATE longstay_lease_packets SET "+key+"_signature=?,"+key+"_signed_at=?,updated_at=? WHERE reference=? AND "+key+"_signed_at IS NULL AND status IN ('sent','tenants_signed')"
 ).bind(body.signature,time,time,packet.reference).run();
 if(!changed.meta?.changes)return reply(409,'Your signature was already recorded.');
 packet=await currentPacket(env,packet.reference);
 const app=JSON.parse(packet.application_json),allSigned=!!packet.first_signed_at&&(app.people!=='Two people'||!!packet.second_signed_at);
 if(allSigned){
  await env.LONGSTAY_DB.prepare(
   "UPDATE longstay_lease_packets SET status='tenants_signed',updated_at=? WHERE reference=? AND status='sent'"
  ).bind(iso(),packet.reference).run();
  packet=await currentPacket(env,packet.reference);
 }
 try{await mail(env,admins(env),
  '[TENANT SIGNED] '+packet.reference+' | '+name,
  name+' electronically signed the ProHouse lease at '+time+' UTC.\n'+
   (allSigned?'ALL TENANTS HAVE SIGNED. Verify the one-week rent transfer before provider signing.':'Awaiting other tenant signature.')+
   '\nRent payment reported: '+(packet.payment_reported_at?'yes':'no')+
   '\nView the original private review link to continue.',
  allSigned?{name:'ProHouse-Tenant-Signed-'+packet.reference+'.pdf',pdf:await signedPDF(packet)}:null);}
 catch(e){console.error('Tenant signed owner notification failed',e?.message)}
 try{await mail(env,settings['guest'+slot+'Email'],'Your ProHouse signature was received | '+packet.reference,
   'Hello '+name+',\nYour electronic signature was recorded at '+time+' UTC.\nReference: '+packet.reference+
   '\nProHouse will countersign and email the completed copy. Applicable state law may create binding rights earlier.\nProHouse');}
 catch(e){console.error('Tenant signature receipt failed',e?.message)}
 return reply(200,'Your electronic signature has been recorded.',{status:'signed',allSigned});
}
export async function tenantReportPayment(request,env){
 if(request.method!=='POST')return reply(405,'Method not allowed.');
 if(request.headers.get('Origin')!==new URL(request.url).origin)return reply(403,'Invalid origin.');
 const match=await packetForTenant(env,headerToken(request));
 if(!match)return reply(404,'Private payment link not found.');
 const p=match.packet;
 if(!['sent','tenants_signed'].includes(p.status))return reply(409,'This lease is not awaiting payment.');
 if(p.deadline_at<iso())return reply(410,'The payment reporting deadline has passed. Contact ProHouse.');
 let body;try{body=await request.json()}catch{return reply(400,'Invalid payment report.')}
 const ref=str(body.transactionReference,110);
 if(ref.length<4||body.confirmPaid!==true)return reply(400,'Enter your bank transaction reference and confirm the transfer was made.');
 if(p.payment_reported_at)return reply(200,'Payment has already been reported. Await ProHouse bank verification.',{status:'reported'});
 const now=iso();
 const changed=await env.LONGSTAY_DB.prepare(
  'UPDATE longstay_lease_packets SET payment_reported_at=?,payment_reference=?,updated_at=? WHERE reference=? AND payment_reported_at IS NULL'
 ).bind(now,ref,now,p.reference).run();
 if(!changed.meta?.changes)return reply(409,'Payment report already recorded.');
 const settings=JSON.parse(p.settings_json);
 try{await mail(env,admins(env),'[PAYMENT REPORTED - UNVERIFIED] '+p.reference,
  'A tenant reports payment of ONE WEEK rent: $'+Number(settings.acceptedWeeklyRent).toFixed(2)+' AUD.\n'+
  'Reference: '+p.reference+'\nTenant-entered bank transfer reference: '+ref+'\nReported UTC: '+now+
  '\nTHIS IS NOT BANK VERIFICATION. Check your bank statement, then mark payment verified on your private review page.');}
 catch(e){console.error('Payment report owner email error',e?.message)}
 return reply(200,'Payment reported. ProHouse must verify funds have arrived.',{status:'reported'});
}
export async function verifyLeasePayment(request,env){
 if(request.method!=='POST')return reply(405,'Method not allowed.');
 if(request.headers.get('Origin')!==new URL(request.url).origin)return reply(403,'Invalid origin.');
 const review=await adminRow(request,env);
 if(!review)return reply(403,'Private ProHouse review link required.');
 const p=await currentPacket(env,review.reference);
 if(!p||!['sent','tenants_signed'].includes(p.status))return reply(409,'No issued lease awaiting bank verification.');
 if(!p.payment_reported_at)return reply(409,'A tenant must first report a transfer.');
 let body;try{body=await request.json()}catch{return reply(400,'Invalid bank confirmation.')}
 const settings=JSON.parse(p.settings_json);
 if(body.confirmBankStatement!==true||str(body.verifiedAmount)!==Number(settings.acceptedWeeklyRent).toFixed(2)||
    str(body.verifiedBy,100).length<2)
  return reply(400,'Confirm actual cleared bank funds, the exact one-week rent amount, and the verifier.');
 if(p.payment_verified_at)return reply(200,'Payment already verified.',{status:'verified'});
 const now=iso();
 await env.LONGSTAY_DB.prepare(
  'UPDATE longstay_lease_packets SET payment_verified_at=?,payment_verified_by=?,updated_at=? WHERE reference=? AND payment_verified_at IS NULL'
 ).bind(now,str(body.verifiedBy,100),now,p.reference).run();
 try{await mail(env,admins(env),'[PAYMENT VERIFIED] '+p.reference,
   'ProHouse bank confirmation recorded.\\nAmount: $'+settings.acceptedWeeklyRent+
   '\\nVerifier: '+str(body.verifiedBy,100)+'\\nUTC: '+now+
   '\\nTenant signatures must also be complete before ProHouse can sign.');}
 catch(e){console.error('Payment verification notification error',e?.message)}
 return reply(200,'One-week rent payment marked verified.',{status:'verified'});
}
async function secureOtpHash(env,reference,code){
 const data=new TextEncoder().encode((env.RESEND_API_KEY||'')+'|provider|'+reference+'|'+code);
 const sha=await crypto.subtle.digest('SHA-256',data);
 return [...new Uint8Array(sha)].map(x=>x.toString(16).padStart(2,'0')).join('');
}
export async function requestProviderOtp(request,env){
 if(request.method!=='POST')return reply(405,'Method not allowed.');
 if(request.headers.get('Origin')!==new URL(request.url).origin)return reply(403,'Invalid origin.');
 const review=await adminRow(request,env);
 if(!review)return reply(403,'Private ProHouse approval link required.');
 const p=await currentPacket(env,review.reference);
 if(!p||p.status!=='tenants_signed'||!p.payment_verified_at)
  return reply(409,'All tenant signatures and bank-verified rent are required.');
 if(p.provider_otp_sent&&Date.now()-Date.parse(p.provider_otp_sent)<60000)
  return reply(429,'A signing code was just sent. Please check your ProHouse inbox.');
 const random=crypto.getRandomValues(new Uint32Array(1))[0];
 const code=String(random%1000000).padStart(6,'0');
 const hash=await secureOtpHash(env,p.reference,code);
 const now=iso(),expiry=future(10/60);
 await env.LONGSTAY_DB.prepare(
   'UPDATE longstay_lease_packets SET provider_otp_hash=?,provider_otp_expires=?,provider_otp_sent=?,provider_otp_attempts=0 WHERE reference=?'
 ).bind(hash,expiry,now,p.reference).run();
 try{
  await mail(env,admins(env),'ProHouse lease countersignature code | '+p.reference,
   'Your six-digit signing code is: '+code+
   '\n\nReference: '+p.reference+
   '\nExpires at: '+expiry+' UTC (10 minutes)'+
   '\nOnly enter this code on the private ProHouse lease review page. Do not forward it.');
 }catch(e){return reply(502,'Could not email the signing code. Check email settings.')}
 return reply(200,'A six-digit signing code has been sent to hi@prohouse.com.au.',{expiresAt:expiry});
}
export async function signProvider(request,env){
 if(request.method!=='POST')return reply(405,'Method not allowed.');
 if(request.headers.get('Origin')!==new URL(request.url).origin)return reply(403,'Invalid origin.');
 const review=await adminRow(request,env);if(!review)return reply(403,'Private ProHouse review link required.');
 let p=await currentPacket(env,review.reference);
 if(!p||p.status!=='tenants_signed')return reply(409,'All tenant signatures are required before ProHouse can sign.');
 if(!p.payment_verified_at)return reply(409,'Verify the one-week rent has arrived before signing.');
 let body;try{body=await request.json()}catch{return reply(400,'Invalid provider signing form.')}
 const settings=JSON.parse(p.settings_json);
 if(body.confirmRead!==true||str(body.providerName)!==settings.providerSigner||
    !goodSignature(body.signature))return reply(400,'Enter the authorised provider name, read the lease and sign.');
 const code=str(body.verificationCode,16);
 if(!/^\d{6}$/.test(code)||!p.provider_otp_hash||p.provider_otp_expires<iso()||
    Number(p.provider_otp_attempts||0)>=5)return reply(403,'Request a fresh six-digit ProHouse signing code.');
 if(await secureOtpHash(env,p.reference,code)!==p.provider_otp_hash){
  await env.LONGSTAY_DB.prepare('UPDATE longstay_lease_packets SET provider_otp_attempts=provider_otp_attempts+1 WHERE reference=?')
   .bind(p.reference).run();
  return reply(403,'Incorrect signing code. Check the ProHouse email.');
 }
 const now=iso();
 const claimed=await env.LONGSTAY_DB.prepare(
  "UPDATE longstay_lease_packets SET status='provider_signing',provider_signature=?,provider_signed_at=?,updated_at=?,provider_otp_hash=NULL,provider_otp_expires=NULL WHERE reference=? AND status='tenants_signed'"
 ).bind(body.signature,now,now,p.reference).run();
 if(!claimed.meta?.changes)return reply(409,'Agreement signing already in progress.');
 p=await currentPacket(env,p.reference);
 let finalPdf;
 try{
  finalPdf=await signedPDF(p,true);
  if(finalPdf.byteLength>MAX_PDF)throw Error('Signed PDF exceeds storage limit.');
 }catch(e){
  await env.LONGSTAY_DB.prepare("UPDATE longstay_lease_packets SET status='tenants_signed' WHERE reference=? AND status='provider_signing'").bind(p.reference).run().catch(()=>{});
  return reply(500,'Could not complete the signed agreement PDF.');
 }
 const addresses=[settings.guest1Email,...(settings.guest2Email?[settings.guest2Email]:[])];
 const bond=Number(settings.bondAmount||0);
 const week=Number(settings.acceptedWeeklyRent||0);
 const propertyState=JSON.parse(p.application_json||'{}').property?.startsWith('VIC')?'VIC':
   JSON.parse(p.application_json||'{}').property?.startsWith('NSW')?'NSW':'';
 const bondProcess=propertyState==='NSW'
   ?'ProHouse will provide NSW Rental Bonds Online or other legally required bond lodgement instructions.'
   :propertyState==='VIC'
    ?'ProHouse will provide the Victorian RTBA bond lodgement/payment instructions.'
    :'ProHouse will provide the correct bond payment or lodgement instructions for your rental arrangement.';
 const finalMessage=[
   'Congratulations! Your ProHouse rental agreement is now signed by all tenants and the ProHouse representative.',
   '',
   'Your FULLY SIGNED lease is attached, including the electronic-signature audit record.',
   'Reference: '+p.reference,
   'Property: '+settings.fullAddress,
   '',
   'BEFORE KEY COLLECTION, PLEASE COMPLETE BOTH PAYMENTS:',
   '1. RENTAL BOND: AUD $'+bond.toFixed(2)+'. '+bondProcess,
   '   The bond is separate from rent. Follow the official bond instructions provided to you. Do not transfer the bond to the rent PayID unless a lawful and verified separate arrangement is expressly provided.',
   '2. SECOND WEEK OF RENT: AUD $'+week.toFixed(2)+'. Pay by bank transfer using the PayID, BSB or account shown on Schedule A (the LAST PAGE of your signed lease).',
   '   PayID '+settings.payId+' is recommended where available. Commonwealth Bank transfers to a new payee may be delayed by security checks.',
   '   Transfer reference: '+p.reference+'.',
   '',
   'IMPORTANT: ProHouse will only arrange key collection after the SECOND WEEK rent has CLEARED and is VISIBLE in the ProHouse bank account, the first week rent is verified, and the bond has been paid and appropriately receipted/lodged.',
   'A bank transfer screenshot, pending payment or proof of initiation is not enough.',
   'This email alone does not authorise collection of keys or access codes. We will confirm access arrangements separately once the payments and required bond records have been verified.',
   '',
   'Please retain the attached signed agreement.',
   'Questions? Contact hi@prohouse.com.au.'
 ].join('\n');
 try{
  for(const to of addresses)await mail(env,to,'Your fully signed ProHouse lease | Bond and second-week rent required before keys | '+p.reference,
   finalMessage,{name:'ProHouse-Fully-Signed-'+p.reference+'.pdf',pdf:finalPdf});
  await mail(env,admins(env),'[FULLY SIGNED] Lease '+p.reference,
   'All tenants and the authorised ProHouse representative have signed.\nOne-week rent is marked bank-verified.\nReference: '+p.reference+
   '\nThe fully signed agreement is attached for your records.',
   {name:'ProHouse-Fully-Signed-'+p.reference+'.pdf',pdf:finalPdf});
 }catch(e){
  console.error('Final signed lease mail delivery error',p.reference,e?.message);
  await env.LONGSTAY_DB.prepare("UPDATE longstay_lease_packets SET status='tenants_signed' WHERE reference=? AND status='provider_signing'").bind(p.reference).run().catch(()=>{});
  return reply(502,'The signed file was prepared but email delivery failed. Please retry ProHouse signing; do not resend tenant invitations.');
 }
 await env.LONGSTAY_DB.prepare(
  "UPDATE longstay_lease_packets SET status='completed',final_pdf=?,completed_at=?,updated_at=? WHERE reference=? AND status='provider_signing'"
 ).bind(finalPdf,iso(),iso(),p.reference).run();
 return reply(200,'Fully signed lease emailed to all tenants and ProHouse.',{reference:p.reference,status:'completed'});
}
export async function verifyPostSigningFunds(request,env){
 if(request.method!=='POST')return reply(405,'Method not allowed.');
 if(request.headers.get('Origin')!==new URL(request.url).origin)return reply(403,'Private ProHouse review page required.');
 const review=await adminRow(request,env);
 if(!review)return reply(403,'Approved ProHouse review link required.');
 const packet=await currentPacket(env,review.reference);
 if(!packet||packet.status!=='completed'||!packet.payment_verified_at)
   return reply(409,'Complete all signatures and verify the first week of rent before post-signing checks.');
 let body;
 try{body=await request.json()}catch{return reply(400,'Invalid payment verification.');}
 const settings=JSON.parse(packet.settings_json);
 const kind=body.kind,verifier=str(body.verifiedBy,100),amount=str(body.amount,30);
 if(!['second_week','bond'].includes(kind)||verifier.length<2)
   return reply(400,'Select rent or bond and enter the name of the ProHouse verifier.');
 const expected=Number(kind==='second_week'?settings.acceptedWeeklyRent:settings.bondAmount||0).toFixed(2);
 if(!/^\d+(\.\d{1,2})?$/.test(amount)||Number(amount).toFixed(2)!==expected)
   return reply(400,'The confirmed amount must match the '+(kind==='second_week'?'second-week rent':'agreed rental bond')+': AUD '+expected);
 const now=iso(),reference=packet.reference;
 if(kind==='second_week'){
  if(body.confirmVisibleInBank!==true)
   return reply(400,'Only confirm after the second week rent is cleared and visible in the ProHouse bank account.');
  if(packet.second_week_verified_at)return reply(200,'Second-week rent already verified.',{status:'verified'});
  const result=await env.LONGSTAY_DB.prepare(
    "UPDATE longstay_lease_packets SET second_week_verified_at=?,second_week_verified_by=?,updated_at=? WHERE reference=? AND status='completed' AND second_week_verified_at IS NULL"
  ).bind(now,verifier,now,reference).run();
  if(!result.meta?.changes)return reply(409,'Second-week rent verification already recorded.');
 }else{
  if(Number(settings.bondAmount||0)===0)return reply(200,'No bond amount was recorded as due.',{status:'not_required'});
  const bondReference=str(body.bondReference,140);
  if(body.confirmBondReceipt!==true||bondReference.length<4)
   return reply(400,'Confirm the lawful bond payment/lodgement evidence and enter its receipt or scheme reference.');
  if(packet.bond_record_verified_at)return reply(200,'Bond record already verified.',{status:'verified'});
  const result=await env.LONGSTAY_DB.prepare(
    "UPDATE longstay_lease_packets SET bond_record_verified_at=?,bond_record_verified_by=?,bond_reference=?,updated_at=? WHERE reference=? AND status='completed' AND bond_record_verified_at IS NULL"
  ).bind(now,verifier,bondReference,now,reference).run();
  if(!result.meta?.changes)return reply(409,'Bond verification already recorded.');
 }
 const latest=await currentPacket(env,reference);
 const ready=!!latest.payment_verified_at&&!!latest.second_week_verified_at&&
  (!!latest.bond_record_verified_at||Number(settings.bondAmount||0)===0)&&latest.status==='completed';
 try{
  await mail(env,admins(env),'[POST-SIGNING PAYMENT CHECK] '+reference,
   'ProHouse verification saved for '+(kind==='second_week'?'SECOND WEEK RENT':'RENTAL BOND')+
   '\nReference: '+reference+'\nVerified by: '+verifier+
   '\nAmount: AUD '+expected+'\nKey-collection financial checklist: '+(ready?'COMPLETE':'INCOMPLETE')+
   '\nNo key or code has been automatically released. Ensure the agreed commencement date and all applicable statutory access duties are met.');
 }catch(e){console.error('Post-signing verification email failed',reference,e?.message);}
 return reply(200,ready?'Financial verification checklist complete. Arrange lawful key collection manually.':'Verification saved. Other financial checks are still pending.',
  {status:'verified',keyCollectionFinancialChecksComplete:ready});
}
export async function checkLeaseDeadlines(env){
 if(!env.LONGSTAY_DB)return;
 const due=await env.LONGSTAY_DB.prepare(
  "SELECT reference,application_json,first_signed_at,second_signed_at,payment_reported_at,deadline_at FROM longstay_lease_packets WHERE status IN ('sent','tenants_signed') AND deadline_at<? LIMIT 100"
 ).bind(iso()).all();
 for(const p of due.results||[]){
  const two=JSON.parse(p.application_json).people==='Two people';
  if(p.first_signed_at&&(!two||p.second_signed_at)&&p.payment_reported_at)continue;
  const changed=await env.LONGSTAY_DB.prepare(
    "UPDATE longstay_lease_packets SET status='expired',updated_at=? WHERE reference=? AND status IN ('sent','tenants_signed')"
  ).bind(iso(),p.reference).run();
  if(!changed.meta?.changes)continue;
  try{await mail(env,admins(env),'[24H DEADLINE PASSED] '+p.reference,
    'Lease invitation expired at '+p.deadline_at+' UTC.\n'+
    'First signed: '+!!p.first_signed_at+'\nSecond signed (if required): '+!!p.second_signed_at+
    '\nOne-week rent reported: '+!!p.payment_reported_at+
    '\nNo automatic cancellation, penalty, eviction or money retention has been applied. Contact the applicant to decide next steps.');}
  catch(e){console.error('Lease expiry notice failed',p.reference,e?.message)}
 }
}
