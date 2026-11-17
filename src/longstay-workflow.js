import { buildApplicationPDF, applicationFields } from './longstay-application.js';
import { combineApplicationPDF } from './longstay-package.js';
import { saveFirstPackage, loadFirstPackage, deleteFirstPackage } from './longstay-documents.js';
import { createReview, cancelReview } from './longstay-review.js';
import { diditTenantReady, verifiedTenantIdentity, markTenantIdentityUsed, cleanupTenantIdentitySessions } from './longstay-identity.js';

// For joint applications, the first applicant's combined PDF is temporarily stored
// as encrypted D1 chunks for up to the invitation window, then deleted.
// The documents are NEVER exposed by the second-applicant invitation API.
const MAX_REQUEST = 19 * 1024 * 1024;
const MAX_FILE = 5 * 1024 * 1024;
const MAX_FILES_TOTAL = 15 * 1024 * 1024;
const MIME = new Set(['application/pdf', 'image/jpeg', 'image/png']);
const PROPERTIES = {
  'VIC - Oakden Crescent, St. Albans': [
    'Master room with ensuite', 'Left room near stairway', 'Right room near bathroom'
  ],
  'NSW - Guess Avenue, Wolli Creek': [
    'Room near entrance', 'Master bedroom with ensuite', 'Small room near kitchen'
  ],
  'NSW - Arncliffe Street, Wolli Creek': [
    'Room 1', 'Room 2 (near kitchen)', 'Room 3 (near entrance)'
  ],
  'Other': ['Other']
};
const responseHeaders={'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store, private','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'};
const reply=(status,message,extra={})=>new Response(JSON.stringify({message,...extra}),{status,headers:responseHeaders});
const clean=(v,max=280)=>typeof v==='string'?v.trim().slice(0,max):'';
const emailValid=v=>/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)&&v.length<=254;
const okSignature=v=>/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(v)&&v.length>=250&&v.length<=550000;
const sender=env=>env.APPLICATION_FROM_EMAIL||env.CLEANER_FROM_EMAIL||'ProHouse <no-reply@prohouse.com.au>';
const admin=env=>env.PROHOUSE_ADMIN_EMAILS?.split(',').map(x=>x.trim()).filter(Boolean)||['hi@prohouse.com.au'];
const pdfBase64=bytes=>{let s='';for(let i=0;i<bytes.length;i+=8192)s+=String.fromCharCode(...bytes.subarray(i,i+8192));return btoa(s);};
const safeFileName=(v,fallback)=>String(v||fallback).split(/[\\/]/).pop().replace(/[^a-zA-Z0-9._ -]/g,'_').replace(/^\.+/,'').slice(0,90)||fallback;
async function rateCheck(request,env){
  if(!env.LONGSTAY_FORM_LIMIT)return null;
  try{
    const ip=request.headers.get('CF-Connecting-IP')||'unknown';
    const {success}=await env.LONGSTAY_FORM_LIMIT.limit({key:'longstay-form:'+ip});
    if(!success)return reply(429,'Too many attempts. Please try again shortly.');
  }catch(e){console.warn('Longstay rate limiting error',e?.message);}
  return null;
}
function errorCheck(request){
  const origin=request.headers.get('Origin');
  if(origin&&origin!==new URL(request.url).origin)return reply(403,'This form must be submitted from ProHouse.');
  if(!request.headers.get('Content-Type')?.toLowerCase().startsWith('multipart/form-data'))
    return reply(415,'Form data is required.');
  if(Number(request.headers.get('Content-Length')||0)>MAX_REQUEST)
    return reply(413,'Your files are too large. Reduce the total upload size.');
  return null;
}
async function readFiles(form,prefix='',env={}){
  const didit=diditTenantReady(env);
  const fields=prefix==='second'?
    [...(didit?[]:[['secondId','Second applicant photo ID'],['secondIdExtra','Second applicant extra photo ID']]),
     ['secondIncomeProof','Second applicant proof of income'],['secondIncomeExtra','Second applicant extra income proof']]:
    [...(didit?[]:[['photoId1','First applicant photo ID'],['photoId2','First applicant extra photo ID']]),
     ['incomeProof1','First applicant proof of income'],['incomeProof2','First applicant extra income proof']];
  const documents=[];let total=0;
  for(const [key,label] of fields){
    const entries=form.getAll(key);
    if(entries.length>1)throw Error('Please select one file per upload field.');
    const entry=entries[0];
    if(!entry||typeof entry==='string'||!entry.size)continue;
    if(entry.size>MAX_FILE)throw Error('Each document must be 5 MB or smaller.');
    total+=entry.size;
    if(total>MAX_FILES_TOTAL)throw Error('Your documents exceed the 15 MB combined limit.');
    if(!MIME.has(entry.type.toLowerCase()))throw Error('Upload PDF, JPG or PNG files only.');
    const bytes=new Uint8Array(await entry.arrayBuffer());
    const looksPdf=bytes.length>=5&&[37,80,68,70,45].every((x,i)=>bytes[i]===x);
    const looksJpg=bytes.length>=3&&bytes[0]===255&&bytes[1]===216&&bytes[2]===255;
    const looksPng=bytes.length>=8&&[137,80,78,71,13,10,26,10].every((x,i)=>bytes[i]===x);
    const looksWebP=bytes.length>=12&&String.fromCharCode(...bytes.subarray(0,4))==='RIFF'&&String.fromCharCode(...bytes.subarray(8,12))==='WEBP';
    if(!((entry.type==='application/pdf'&&looksPdf)||(entry.type==='image/jpeg'&&looksJpg)||
         (entry.type==='image/png'&&looksPng)||(entry.type==='image/webp'&&looksWebP)))
      throw Error('One uploaded file does not match its PDF or image file type.');
    documents.push({key,label,filename:safeFileName(entry.name,key),type:entry.type,bytes});
  }
  const required=prefix==='second'?
    (didit?['secondIncomeProof']:['secondId','secondIncomeProof']):
    (didit?['incomeProof1']:['photoId1','incomeProof1']);
  for(const key of required)
    if(!documents.some(d=>d.key===key))throw Error(didit?
      'A proof of income document is required. Verify your ID through Didit.':
      'A photo ID and proof of income are both required.');
  return documents;
}
async function retrieveFirstPackage(env,reference,emailId) {
  if(!/^[a-f0-9-]{20,}$/.test(emailId||''))throw Error('Missing original submission reference.');
  const endpoint='https://api.resend.com/emails/'+emailId+'/attachments';
  const headers={Authorization:'Bearer '+env.RESEND_API_KEY};
  const result=await fetch(endpoint,{headers});
  if(!result.ok)throw Error('The original application attachment could not be retrieved.');
  const list=await result.json();
  let attachment=(list.data||[]).find(d=>d.filename===reference+'-applicant-1.pdf');
  if(!attachment)throw Error('First applicant merged PDF was not found.');
  if(!attachment.download_url){
    const detail=await fetch(endpoint+'/'+encodeURIComponent(attachment.id),{headers});
    if(!detail.ok)throw Error('Original PDF attachment link unavailable.');
    attachment=await detail.json();
  }
  const uri=new URL(attachment.download_url||'');
  if(uri.protocol!=='https:')throw Error('Invalid document download URL.');
  const file=await fetch(uri.toString(),{redirect:'follow'});
  if(!file.ok)throw Error('Original application PDF download failed.');
  const bytes=new Uint8Array(await file.arrayBuffer());
  if(bytes.length<10||bytes.length>19*1024*1024)throw Error('Original document size invalid.');
  return bytes;
}
const appText=data=>applicationFields.map(([key,label])=>label+': '+(data[key]||'(not provided)')).join('\n');
const attachmentsFrom=docs=>docs.map(d=>({filename:d.filename,content:pdfBase64(d.bytes),content_type:d.type}));
async function sendMail(env,{to,subject,text,attachments=[],replyTo,tag}){
  if(!env.RESEND_API_KEY)throw Error('Mail service is not configured.');
  const r=await fetch('https://api.resend.com/emails',{
    method:'POST',headers:{Authorization:'Bearer '+env.RESEND_API_KEY,'Content-Type':'application/json'},
    body:JSON.stringify({from:sender(env),to:Array.isArray(to)?to:[to],
      ...(replyTo?{reply_to:replyTo}:{}),subject,text,attachments,
      tags:[{name:'form',value:'livewithus'},{name:'stage',value:tag||'application'}]})
  });
  if(!r.ok){const body=await r.text().catch(()=>'');console.error('Longstay mail error',r.status,body.slice(0,250));throw Error('Email delivery failed. Please try again later.');}
  return r;
}
function summarise(data,reference){
  return [
    'Reference: '+reference,
    'First applicant: '+[data.firstName,data.lastName].filter(Boolean).join(' '),
    'Property: '+(data.property==='Other'?data.propertyOther:data.property),
    'Room: '+(data.room==='Other'?data.roomOther:data.room),
    'Preferred move-in: '+data.moveIn,
    'Length of stay: '+(data.length==='Other'?data.lengthOther:data.length),
    'Proposed weekly rent: $'+data.weeklyRent+' AUD',
    'Payment frequency: '+data.payFrequency,
    'Linen and towels: '+data.linen
  ].join('\n');
}
function validateShared(data){
  if(!Object.hasOwn(PROPERTIES,data.property))throw Error('Please choose a valid property.');
  if(data.property==='Other'&&!data.propertyOther)throw Error('Please name the other property.');
  if(!PROPERTIES[data.property].includes(data.room))throw Error('Please choose a room for your selected property.');
  if(data.room==='Other'&&!data.roomOther)throw Error('Please name the other room.');
  if(!['3 months','6 months','12 months','Other'].includes(data.length))throw Error('Please choose a length of stay.');
  if(data.length==='Other'&&!data.lengthOther)throw Error('Please specify your length of stay.');
  if(!/^\d{4}-\d{2}-\d{2}$/.test(data.moveIn)||Number.isNaN(Date.parse(data.moveIn)))throw Error('Please select a valid move-in date.');
  if(!['Every 2 weeks','Every 4 weeks','Every calendar month'].includes(data.payFrequency))
    throw Error('Please select a payment frequency.');
  if(!(Number(data.weeklyRent)>0&&Number(data.weeklyRent)<=100000))throw Error('Enter your proposed weekly rent.');
  if(!['Yes','No, I will use my own','Other'].includes(data.linen))throw Error('Please select a linen preference.');
  if(data.linen==='Other'&&!data.linenOther)throw Error('Please describe your linen preference.');
}
function validApplicant(data,prefix=''){
  const isSecond=prefix==='second';
  const pick=(first,second)=>data[isSecond?second:first];
  const required=[
    ['firstName','secondFirstName'],['lastName','secondLastName'],
    ['phone','secondPhone'],['occupation','secondOccupation'],['workFromHome','secondWorkFromHome'],
    ['employer','secondEmployer'],['income','secondIncome']];
  if(required.some(([a,b])=>!clean(pick(a,b))))throw Error('Please complete all applicant details.');
  const income=Number(pick('income','secondIncome'));
  if(!(income>=0&&income<10000000))throw Error('Enter a valid weekly income.');
  const occupation=pick('occupation','secondOccupation');
  if(occupation==='Other'&&!pick('occupationOther','secondOccupationOther'))throw Error('Describe your occupation.');
  if(!['Full-time employee','Part-time employee','Casual employee','Self-employed','Student','Other'].includes(occupation))
    throw Error('Select an occupation.');
  const wfh=pick('workFromHome','secondWorkFromHome');
  if(!['Yes','No','Sometimes','Other'].includes(wfh))throw Error('Choose a work-from-home answer.');
  if(wfh==='Other'&&!pick('workFromHomeOther','secondWorkFromHomeOther'))throw Error('Please describe work from home.');
}
async function hashToken(token){
  const bytes=new TextEncoder().encode(token);
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(n=>n.toString(16).padStart(2,'0')).join('');
}
function privatePreview(data,reference){
  return {
    reference,firstName:data.firstName,lastName:data.lastName,
    email:data.email,
    property:data.property,propertyOther:data.propertyOther,room:data.room,roomOther:data.roomOther,
    moveIn:data.moveIn,length:data.length,lengthOther:data.lengthOther,
    weeklyRent:data.weeklyRent,payFrequency:data.payFrequency,linen:data.linen
  };
}
async function fetchInvitation(token,env){
  if(!/^[a-f0-9]{64}$/.test(token))return null;
  const hash=await hashToken(token);
  return env.LONGSTAY_DB.prepare('SELECT * FROM longstay_applications WHERE invite_hash = ?').bind(hash).first();
}
export async function getLongStayInvitation(request,env){
  if(request.method!=='GET')return reply(405,'Method not allowed.');
  if(!env.LONGSTAY_DB)return reply(503,'Invitation service unavailable.');
  const token=new URL(request.url).searchParams.get('token')||'';
  const row=await fetchInvitation(token,env);
  if(!row)return reply(404,'Invitation not found. Contact ProHouse for a new invitation.');
  if(row.status==='completed')return reply(200,'This application has already been completed.',{status:'completed',reference:row.reference});
  if(row.expires_at<=new Date().toISOString()){
    await deleteExpiredDraft(env,row);
    return reply(410,'This unfinished joint application was deleted after 48 hours. Please start a new application.');
  }
  if(row.status!=='invited')return reply(409,'This invitation is being processed. Please try again shortly.');
  const data=JSON.parse(row.first_data||'{}');
  return reply(200,'Invitation ready.',{status:'invited',firstApplicant:privatePreview(data,row.reference),invitedEmail:row.second_email});
}
// Expire only incomplete joint drafts. Approved/completed application records
// have separate retention rules and must not be deleted by this 48h cleanup.
async function deleteExpiredDraft(env,row){
  if(row.status!=='invited'||row.expires_at>new Date().toISOString())return false;
  const deleted=await env.LONGSTAY_DB.prepare(
    "DELETE FROM longstay_applications WHERE reference=? AND status='invited' AND expires_at<=?"
  ).bind(row.reference,new Date().toISOString()).run();
  if(deleted.meta?.changes){
    await deleteFirstPackage(env,row.reference);
    return true;
  }
  return false;
}
async function cleanupPending(env){
  if(!env.LONGSTAY_DB)return;
  const now=new Date().toISOString();
  // Clear encrypted PDF bytes while the draft references still exist.
  await env.LONGSTAY_DB.prepare(
    "DELETE FROM longstay_application_documents WHERE reference IN (SELECT reference FROM longstay_applications WHERE status='invited' AND expires_at<=? OR status='completed') OR created_at<?"
  ).bind(now,new Date(Date.now()-5*86400000).toISOString()).run();
  await env.LONGSTAY_DB.prepare(
    "DELETE FROM longstay_applications WHERE status='invited' AND expires_at<=?"
  ).bind(now).run();
  await env.LONGSTAY_DB.prepare(
    "DELETE FROM longstay_applications WHERE status='completed' AND completed_at < datetime('now','-14 days')"
  ).run();
  await env.LONGSTAY_DB.prepare("DELETE FROM longstay_reviews WHERE created_at < datetime('now','-90 days')").run();
  await cleanupTenantIdentitySessions(env);
}
export async function cleanupLongStayInvitations(env){try{await cleanupPending(env);}catch(e){console.warn('Longstay cleanup error',e?.message)}}
export async function submitLongStayFirst(request,env){
  if(request.method!=='POST')return reply(405,'Method not allowed.');
  const early=errorCheck(request);if(early)return early;
  const limited=await rateCheck(request,env);if(limited)return limited;
  if(!env.RESEND_API_KEY||!env.LONGSTAY_DB)return reply(503,'Rental applications are temporarily unavailable.');
  let form;try{form=await request.formData()}catch{return reply(400,'Could not read the uploaded application.')}
  if(form.get('website'))return reply(200,'Thank you.');
  const data=Object.fromEntries(applicationFields.map(([k])=>[k,clean(form.get(k))]));
  try{
    if(!['Just me','Two people'].includes(data.people))throw Error('Please select one or two people.');
    if(data.houseRules!=='Yes'||data.declaration!=='Yes'||data.privacyConsent!=='Yes')
      throw Error('Please accept the shared-home and application declarations.');
    if(!emailValid(data.email))throw Error('Please enter a valid email address.');
    if(data.people==='Two people'&&(!emailValid(data.secondEmail)||data.secondEmail.toLowerCase()===data.email.toLowerCase()))
      throw Error('Please enter the other applicant’s own email address.');
    validApplicant(data);
    validateShared(data);
  }catch(e){return reply(400,e.message);}
  const signature=clean(form.get('signature'),550000);
  if(!okSignature(signature))return reply(400,'Please provide your signature.');
  const identityToken=clean(form.get('identityToken'),80);
  let identity=null;
  if(diditTenantReady(env)){
    try{identity=await verifiedTenantIdentity(env,identityToken,{
      role:'first',firstName:data.firstName,lastName:data.lastName,email:data.email
    });}
    catch(e){return reply(403,e.message);}
    data.identityVerification=identity;
  }
  let documents;try{documents=await readFiles(form,'',env)}catch(e){return reply(400,e.message)}
  const ref='LH-'+new Date().toISOString().slice(0,10).replace(/-/g,'')+'-'+crypto.randomUUID().slice(0,8).toUpperCase();
  let firstPackage;
  try{
    const summary=await buildApplicationPDF(data,documents,ref,signature);
    firstPackage=await combineApplicationPDF(summary,documents);
  }catch(e){
    console.error('Longstay document package error',e?.message);
    return reply(400,e.message||'Unable to merge your supporting documents.');
  }
  const firstName=(data.firstName+' '+data.lastName).trim();
  let token=null,reviewLink=null;
  if(data.people==='Two people'){
    token=[...crypto.getRandomValues(new Uint8Array(32))].map(x=>x.toString(16).padStart(2,'0')).join('');
    const inviteHash=await hashToken(token);
    const now=new Date(),expiry=new Date(now.getTime()+48*3600000);
    try{
      await env.LONGSTAY_DB.prepare('INSERT INTO longstay_applications (reference,first_email,first_name,second_email,invite_hash,first_data,first_signature,status,created_at,expires_at) VALUES (?,?,?,?,?,?,?,?,?,?)')
        .bind(ref,data.email,firstName,data.secondEmail,inviteHash,JSON.stringify(data),signature,'invited',now.toISOString(),expiry.toISOString()).run();
    }catch(e){console.error('Unable to create longstay invitation',e?.message);return reply(503,'Unable to create an invitation. Try again.');}
  }else{
    try{reviewLink=await createReview(env,ref,data,request)}
    catch(e){console.error('Unable to create longstay review',e?.message);return reply(503,'Unable to create approval link. Try again.');}
  }
  if(token){
    try{await saveFirstPackage(env,ref,firstPackage.bytes);}
    catch(e){
      console.error('Cannot escrow first applicant PDF',ref,e?.message);
      await deleteFirstPackage(env,ref).catch(()=>{});
      await env.LONGSTAY_DB.prepare('DELETE FROM longstay_applications WHERE reference=?').bind(ref).run().catch(()=>{});
      return reply(503,'Could not securely store documents for the joint application. Please try again.');
    }
  }
  try{
    const sent=await sendMail(env,{to:admin(env),
      subject:(token?'[1/3 received] ':'[REVIEW REQUIRED] ')+'Long-stay application '+ref+' | '+firstName,
      replyTo:data.email,tag:'first-received',
      text:['New Live With Us application submitted.','Stage: '+(token?'first applicant received, second applicant to be invited':'ready for approval/rejection'),
        summarise(data,ref),'',appText(data),'',
        'ONE PDF is attached, including the signed application and every supporting document.',
        ...(reviewLink?['','Private review link (approve or reject):',reviewLink,'Do not forward this link.']:[])
      ].join('\n'),
      attachments:[{filename:ref+'-applicant-1.pdf',content:pdfBase64(firstPackage.bytes),content_type:'application/pdf'}]});
    if(token){
      const delivered=await sent.json().catch(()=>({}));
      await env.LONGSTAY_DB.prepare('UPDATE longstay_applications SET first_email_id=?, first_summary_pages=? WHERE reference=?')
        .bind(/^[a-f0-9-]{20,}$/.test(delivered.id||'')?delivered.id:null,firstPackage.summaryPages,ref).run();
    }
  }catch(e){
    if(token){
      await deleteFirstPackage(env,ref).catch(()=>{});
      await env.LONGSTAY_DB.prepare('DELETE FROM longstay_applications WHERE reference=?').bind(ref).run().catch(()=>{});
    }
    if(reviewLink)await cancelReview(env,ref).catch(()=>{});
    return reply(502,'Could not deliver the merged application PDF. Please try again.');
  }
  if(identity)await markTenantIdentityUsed(env,identityToken,ref).catch(e=>console.warn('Could not mark Didit proof used',ref,e?.message));
  const firstReceipt=['Hello '+data.firstName+',',
    'We received your ProHouse Live With Us application.','',summarise(data,ref),'',
    data.people==='Two people'?'We are inviting the second applicant to complete their own details and supporting documents.':'Our team will review your application.',
    identity?'Your identity was verified through Didit. ProHouse received the verification result and your income documents, not a copy of your ID or selfie.':
     'Your identity and income files have been sent to ProHouse but are not attached to this email.',
    'We will email you as your application progresses.','',
    'ProHouse | hi@prohouse.com.au'].join('\n');
  let firstReceiptSent=false;
  try{await sendMail(env,{to:data.email,subject:'ProHouse application received | '+ref,text:firstReceipt,tag:'first-confirmation'});firstReceiptSent=true;}
  catch(e){console.warn('First applicant confirmation email failed',ref,e?.message)}
  let invited=false;
  if(token){
    const inviteURL=new URL('/longstay/form/livewithus/second/',new URL(request.url).origin);
    inviteURL.hash='token='+token;
    const inviteText=[
      'You have been invited to complete a joint ProHouse rental application.',
      'Invited by: '+firstName,
      '',
      'Details provided by the first applicant:',
      summarise(data,ref),
      'First applicant email: '+data.email,
      '',
      'You must complete your own legal name, contact details, occupation, work/study information and income proof, plus your own identity verification.',
      'The first applicant’s identity verification result, proof-of-income files and signature are private and not shared with you.',
      '',
      'Complete your part of the joint application using this private invitation link:',
      inviteURL.toString(),
      '',
      'IMPORTANT: If the joint application is not completed, the unfinished draft and temporarily stored documents will be automatically deleted after 48 hours. A new application will then be required.',
      '',
      'Do not forward this link. If you did not expect this, ignore it and contact hi@prohouse.com.au.'
    ].join('\n');
    try{
      await sendMail(env,{to:data.secondEmail,subject:'Complete your ProHouse joint application | '+ref,text:inviteText,tag:'second-invited'});
      invited=true;
      await env.LONGSTAY_DB.prepare('UPDATE longstay_applications SET invitation_sent_at=? WHERE reference=?').bind(new Date().toISOString(),ref).run();
    }catch(e){console.error('Joint application invite delivery failed',ref,e?.message);}
    if(!invited){
      const warning='Second applicant email invitation could not be delivered.\nReference: '+ref+'\nInvited email: '+data.secondEmail+'\nPlease contact the other applicant and ProHouse to arrange a corrected email invitation.';
      await Promise.allSettled([
        sendMail(env,{to:admin(env),subject:'[ACTION NEEDED] Joint application invitation '+ref,text:warning,tag:'invite-failed'}),
        sendMail(env,{to:data.email,subject:'Action needed on your second applicant invitation | '+ref,text:warning,tag:'first-invite-failed'})
      ]);
    }
    if(invited){
      const update='Stage update: second applicant invitation sent.\n'+
        'Reference: '+ref+'\nInvited: '+data.secondEmail+'\nIf the joint application remains unfinished, the temporary draft and stored documents will be deleted after 48 hours.';
      await Promise.allSettled([
        sendMail(env,{to:admin(env),subject:'[2/3 invited] ProHouse '+ref,text:update,tag:'second-invited-update'}),
        sendMail(env,{to:data.email,subject:'Second applicant invited | '+ref,
          text:'Hello '+data.firstName+',\n\n'+update+'\n\nWe will email you when the second applicant submits their part.\n\nProHouse',tag:'first-invite-update'})
      ]);
    }
  }
  return reply(200,token
    ? invited?'Your part is submitted. We have emailed the second applicant an invitation.':
      'Your part was received, but we could not deliver the invitation. Please contact ProHouse with your reference.'
    : 'Your application has been sent to ProHouse.',
    {reference:ref,status:token?(invited?'awaiting_second':'invitation_delivery_failed'):'completed',
      receiptEmailSent:firstReceiptSent});
}
export async function submitLongStaySecond(request,env){
  if(request.method!=='POST')return reply(405,'Method not allowed.');
  const early=errorCheck(request);if(early)return early;
  const limited=await rateCheck(request,env);if(limited)return limited;
  if(!env.RESEND_API_KEY||!env.LONGSTAY_DB)return reply(503,'Invitation service unavailable.');
  let form;try{form=await request.formData()}catch{return reply(400,'Cannot read your form.')}
  if(form.get('website'))return reply(200,'Thank you.');
  const token=clean(form.get('invitationToken'),70);
  const row=await fetchInvitation(token,env);
  if(!row)return reply(404,'Your invitation was not found.');
  if(row.status==='completed')return reply(200,'This invitation has already been completed.',{reference:row.reference,status:'completed'});
  if(row.expires_at<=new Date().toISOString()){
    await deleteExpiredDraft(env,row);
    return reply(410,'The unfinished joint application was deleted after 48 hours. Please start a new application.');
  }
  if(row.status!=='invited')return reply(409,'Application is already being processed.');
  const extraKeys=['secondFirstName','secondLastName','secondPhone','secondOccupation','secondOccupationOther',
    'secondWorkFromHome','secondWorkFromHomeOther','secondEmployer','secondIncome','secondDeclaration','secondPrivacyConsent'];
  const extra=Object.fromEntries(extraKeys.map(k=>[k,clean(form.get(k))]));
  try{
    validApplicant(extra,'second');
    if(extra.secondDeclaration!=='Yes'||extra.secondPrivacyConsent!=='Yes')
    throw Error('Please accept the declarations.');}
  catch(e){return reply(400,e.message)}
  const signature=clean(form.get('signature'),550000);
  if(!okSignature(signature))return reply(400,'Please sign the application.');
  const identityToken=clean(form.get('identityToken'),80);
  let identity=null;
  if(diditTenantReady(env)){
    try{identity=await verifiedTenantIdentity(env,identityToken,{
      role:'second',firstName:extra.secondFirstName,lastName:extra.secondLastName,
      email:row.second_email,inviteReference:row.reference
    });}
    catch(e){return reply(403,e.message);}
  }
  let documents;try{documents=await readFiles(form,'second',env)}catch(e){return reply(400,e.message)}
  const original=JSON.parse(row.first_data||'{}');
  const combined={...original,...extra,secondEmail:row.second_email,...(identity?{secondIdentityVerification:identity}:{})};
  let pdf,allDocumentsInOnePDF=false;
  try{
    const summary=await buildApplicationPDF(combined,documents,row.reference,row.first_signature,signature);
    let firstPackage=null;
    try{
      firstPackage=await loadFirstPackage(env,row.reference);
      if(!firstPackage)firstPackage=await retrieveFirstPackage(env,row.reference,row.first_email_id);
    }catch(e){
      console.warn('Original first-person PDF retrieval failed; proceeding with safely separated evidence',row.reference,e?.message);
    }
    if(firstPackage){
      try{
        pdf=await combineApplicationPDF(summary,documents,{
          priorPdf:firstPackage,priorSummaryPages:row.first_summary_pages
        });
        allDocumentsInOnePDF=true;
      }catch(e){
        console.warn('Could not append first-person PDF; preserving second submission and original owner email',row.reference,e?.message);
      }
    }
    if(!pdf)pdf=await combineApplicationPDF(summary,documents);
  }catch(e){
    console.error('Second applicant document packaging error',row.reference,e?.message);
    return reply(400,'Could not read an uploaded document. Please use an unprotected PDF, JPG or PNG and try again.');
  }
  // The pending -> processing transition prevents duplicate concurrent submissions.
  const changed=await env.LONGSTAY_DB.prepare("UPDATE longstay_applications SET status='processing' WHERE reference=? AND status='invited'")
    .bind(row.reference).run();
  if(!changed.meta?.changes)return reply(409,'Application already in progress.');
  let reviewLink;
  try{reviewLink=await createReview(env,row.reference,combined,request)}
  catch(e){
    await env.LONGSTAY_DB.prepare("UPDATE longstay_applications SET status='invited' WHERE reference=? AND status='processing'").bind(row.reference).run().catch(()=>{});
    return reply(503,'Could not prepare the application review. Please try again.');
  }
  const stage3=['Both applicants completed their submissions.','Reference: '+row.reference,
    'Applicant 1: '+row.first_name+' <'+row.first_email+'>',
    'Applicant 2: '+extra.secondFirstName+' '+extra.secondLastName+' <'+row.second_email+'>',
    '',appText(combined),'',
    allDocumentsInOnePDF?
      'ONE merged PDF is attached containing both signatures and ALL supporting documents.':
      'IMPORTANT: The attached PDF contains the completed joint form, both signatures, and SECOND-applicant documents only. The FIRST-applicant supporting documents were delivered in the EARLIER ProHouse admin email [1/3 received] for this same reference. Review BOTH email attachments before approving. The first applicant documents could not be combined automatically.',
    '',
    'Private link to APPROVE or REJECT this application:',
    reviewLink,
    'Do not forward. Approval moves the application to lease preparation and does not itself create a lease.'
  ].join('\n');
  try{
    await sendMail(env,{to:admin(env),subject:(allDocumentsInOnePDF?'[REVIEW REQUIRED] ':'[REVIEW REQUIRED: TWO PDF EMAILS] ')+'ProHouse joint application '+row.reference,
      replyTo:row.second_email,tag:'second-complete',text:stage3,
      attachments:[{filename:row.reference+'-joint-complete.pdf',content:pdfBase64(pdf.bytes),content_type:'application/pdf'}]});
  }catch(e){
    await cancelReview(env,row.reference).catch(()=>{});
    await env.LONGSTAY_DB.prepare("UPDATE longstay_applications SET status='invited' WHERE reference=? AND status='processing'").bind(row.reference).run().catch(()=>{});
    return reply(502,'Could not deliver your combined application PDF. Please try again.');
  }
  await env.LONGSTAY_DB.prepare("UPDATE longstay_applications SET status='completed',first_data=NULL,first_signature=NULL,completed_at=? WHERE reference=? AND status='processing'")
    .bind(new Date().toISOString(),row.reference).run();
  await deleteFirstPackage(env,row.reference).catch(e=>console.warn('Pending document cleanup failed',row.reference,e?.message));
  if(identity)await markTenantIdentityUsed(env,identityToken,row.reference).catch(e=>console.warn('Could not mark second Didit proof used',row.reference,e?.message));
  const done=['ProHouse joint rental application completed.','Reference: '+row.reference,'',
    'Both applicants have now submitted their details and required supporting information.',
    'The ProHouse team has been emailed the completed application and will review it.',
    'This confirmation is not approval of a tenancy or an executed agreement.',
    '','ProHouse | hi@prohouse.com.au'].join('\n');
  const notifications=await Promise.allSettled([
    sendMail(env,{to:row.first_email,subject:'Both applicants submitted | '+row.reference,text:done,tag:'joint-complete-first'}),
    sendMail(env,{to:row.second_email,subject:'Your ProHouse application is complete | '+row.reference,text:done,tag:'joint-complete-second'})
  ]);
  notifications.forEach((r,i)=>{if(r.status==='rejected')console.error('Longstay completion notification failed',row.reference,i)});
  return reply(200,'Your joint application has been submitted to ProHouse.',
    {reference:row.reference,status:'completed',documentsCombined:allDocumentsInOnePDF,
      notificationsSent:notifications.every(x=>x.status==='fulfilled')});
}
