import { buildApplicationPDF, applicationFields } from './longstay-application.js';
import { combineApplicationPDF } from './longstay-package.js';
import { createReview, cancelReview } from './longstay-review.js';

// Deliberately don't store ID and income documents in D1. Only their filenames
// travel in email/PDF; the document bytes go to ProHouse's Resend mailbox.
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
async function readFiles(form,prefix=''){
  const fields=prefix==='second'?
    [['secondId','Second applicant photo ID'],['secondIncomeProof','Second applicant proof of income'],
     ['secondIdExtra','Second applicant extra photo ID'],['secondIncomeExtra','Second applicant extra income proof']]:
    [['photoId1','First applicant photo ID'],['incomeProof1','First applicant proof of income'],
     ['photoId2','First applicant extra photo ID'],['incomeProof2','First applicant extra income proof']];
  const documents=[];let total=0;
  for(const [key,label] of fields){
    const entries=form.getAll(key);
    if(entries.length>1)throw Error('Please select one file per upload field.');
    const entry=entries[0];
    if(!entry||typeof entry==='string'||!entry.size)continue;
    if(entry.size>MAX_FILE)throw Error('Each document must be 5 MB or smaller.');
    total+=entry.size;
    if(total>MAX_FILES_TOTAL)throw Error('Your documents exceed the 15 MB combined limit.');
    if(!MIME.has(entry.type.toLowerCase()))throw Error('Upload PDF, JPG, PNG or WebP files only.');
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
  for(const key of (prefix==='second'?['secondId','secondIncomeProof']:['photoId1','incomeProof1']))
    if(!documents.some(d=>d.key===key))throw Error('A photo ID and proof of income are both required.');
  return documents;
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
  if(!['Every week','Every 2 weeks','Every 4 weeks','Every calendar month'].includes(data.payFrequency))
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
  if(row.expires_at<new Date().toISOString())return reply(410,'This invitation has expired. Please contact ProHouse.');
  if(row.status!=='invited')return reply(409,'This invitation is being processed. Please try again shortly.');
  const data=JSON.parse(row.first_data||'{}');
  return reply(200,'Invitation ready.',{status:'invited',firstApplicant:privatePreview(data,row.reference),invitedEmail:row.second_email});
}
async function cleanupPending(env){
  if(env.LONGSTAY_DB){
    await env.LONGSTAY_DB.prepare("DELETE FROM longstay_applications WHERE expires_at < datetime('now','-7 days') OR (status='completed' AND completed_at < datetime('now','-14 days'))").run();
    await env.LONGSTAY_DB.prepare("DELETE FROM longstay_reviews WHERE created_at < datetime('now','-90 days')").run();
  }
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
    if(!['Australian-issued driver licence','Passport'].includes(data.photoIdType))
      throw Error('Select Australian-issued driver licence or passport.');
    validateShared(data);
  }catch(e){return reply(400,e.message);}
  const signature=clean(form.get('signature'),550000);
  if(!okSignature(signature))return reply(400,'Please provide your signature.');
  let documents;try{documents=await readFiles(form)}catch(e){return reply(400,e.message)}
  const ref='LH-'+new Date().toISOString().slice(0,10).replace(/-/g,'')+'-'+crypto.randomUUID().slice(0,8).toUpperCase();
  let pdf;try{pdf=await buildApplicationPDF(data,documents,ref,signature)}
  catch(e){console.error('Longstay PDF error',e?.message);return reply(500,'Unable to generate your application PDF.')}
  const applicationPackage=[
    {filename:ref+'-applicant-1.pdf',content:pdfBase64(pdf),content_type:'application/pdf'},
    ...attachmentsFrom(documents)
  ];
  const firstName=(data.firstName+' '+data.lastName).trim();
  let token=null;
  if(data.people==='Two people'){
    token=[...crypto.getRandomValues(new Uint8Array(32))].map(x=>x.toString(16).padStart(2,'0')).join('');
    const inviteHash=await hashToken(token);
    const now=new Date(),expiry=new Date(now.getTime()+48*3600000);
    try{
      await env.LONGSTAY_DB.prepare('INSERT INTO longstay_applications (reference,first_email,first_name,second_email,invite_hash,first_data,first_signature,status,created_at,expires_at) VALUES (?,?,?,?,?,?,?,?,?,?)')
        .bind(ref,data.email,firstName,data.secondEmail,inviteHash,JSON.stringify(data),signature,'invited',now.toISOString(),expiry.toISOString()).run();
    }catch(e){console.error('Unable to create longstay invitation',e?.message);return reply(503,'Unable to create an invitation. Try again.');}
  }
  try{
    await sendMail(env,{to:admin(env),subject:(token?'[1/3 received] ':'[1/1 complete] ')+'Long-stay application '+ref+' | '+firstName,
      replyTo:data.email,tag:'first-received',
      text:['New Live With Us application submitted.', 'Stage: first applicant received',
        'Second applicant: '+(data.people==='Two people'?'invitation to follow':'not applicable'),summarise(data,ref),'',
        appText(data),'','Both a completed PDF and mandatory supporting files are attached.'].join('\n'),
      attachments:applicationPackage});
  }catch(e){if(token)await env.LONGSTAY_DB.prepare('DELETE FROM longstay_applications WHERE reference=?').bind(ref).run().catch(()=>{});return reply(502,'Could not deliver documents. Please try again.')}
  const firstReceipt=['Hello '+data.firstName+',',
    'We received your ProHouse Live With Us application.','',summarise(data,ref),'',
    data.people==='Two people'?'We are inviting the second applicant to complete their own details and supporting documents.':'Our team will review your application.',
    'Your identity and income files have been sent to the ProHouse team but are not attached to this email.',
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
      'You must complete your own legal name, contact details, occupation, work/study information, income and supporting documents.',
      'The first applicant’s ID, proof-of-income documents and signature are not included in this email or shared with you.',
      '',
      'Complete your application using this private invitation link (expires in 48 hours):',
      inviteURL.toString(),
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
        'Reference: '+ref+'\nInvited: '+data.secondEmail+'\nThe second applicant must submit their information and mandatory documents within 48 hours.';
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
  if(row.expires_at<new Date().toISOString())return reply(410,'Your invitation has expired.');
  if(row.status==='completed')return reply(200,'This invitation has already been completed.',{reference:row.reference,status:'completed'});
  if(row.status!=='invited')return reply(409,'Application is already being processed.');
  const extraKeys=['secondIdType','secondFirstName','secondLastName','secondPhone','secondOccupation','secondOccupationOther',
    'secondWorkFromHome','secondWorkFromHomeOther','secondEmployer','secondIncome','secondDeclaration','secondPrivacyConsent'];
  const extra=Object.fromEntries(extraKeys.map(k=>[k,clean(form.get(k))]));
  try{
    validApplicant(extra,'second');
    if(!['Australian-issued driver licence','Passport'].includes(extra.secondIdType))
      throw Error('Select Australian-issued driver licence or passport.');
    if(extra.secondDeclaration!=='Yes'||extra.secondPrivacyConsent!=='Yes')
    throw Error('Please accept the declarations.');}
  catch(e){return reply(400,e.message)}
  const signature=clean(form.get('signature'),550000);
  if(!okSignature(signature))return reply(400,'Please sign the application.');
  let documents;try{documents=await readFiles(form,'second')}catch(e){return reply(400,e.message)}
  const original=JSON.parse(row.first_data||'{}');
  const combined={...original,...extra,secondEmail:row.second_email};
  let pdf;try{pdf=await buildApplicationPDF(combined,documents,row.reference,row.first_signature,signature);}
  catch(e){console.error('Second applicant PDF error',e?.message);return reply(500,'Cannot generate the combined PDF.')}
  // The pending -> processing transition prevents duplicate concurrent submissions.
  const changed=await env.LONGSTAY_DB.prepare("UPDATE longstay_applications SET status='processing' WHERE reference=? AND status='invited'")
    .bind(row.reference).run();
  if(!changed.meta?.changes)return reply(409,'Application already in progress.');
  const stage3='Both applicants completed their submissions.\n'+
    'Reference: '+row.reference+'\nApplicant 1: '+row.first_name+' <'+row.first_email+'>\n'+
    'Applicant 2: '+extra.secondFirstName+' '+extra.secondLastName+' <'+row.second_email+'>\n\n'+
    appText(combined)+'\n\nThe combined PDF and SECOND applicant supporting files are attached. '+
    'The FIRST applicant supporting files were delivered in the initial application email.';
  try{
    await sendMail(env,{to:admin(env),subject:'[3/3 complete] ProHouse joint application '+row.reference,
      replyTo:row.second_email,tag:'second-complete',text:stage3,
      attachments:[{filename:row.reference+'-joint-application.pdf',content:pdfBase64(pdf),content_type:'application/pdf'},
        ...attachmentsFrom(documents)]});
  }catch(e){
    await env.LONGSTAY_DB.prepare("UPDATE longstay_applications SET status='invited' WHERE reference=? AND status='processing'").bind(row.reference).run().catch(()=>{});
    return reply(502,'Could not deliver your application documents. Please try again.');
  }
  await env.LONGSTAY_DB.prepare("UPDATE longstay_applications SET status='completed',first_data=NULL,first_signature=NULL,completed_at=? WHERE reference=? AND status='processing'")
    .bind(new Date().toISOString(),row.reference).run();
  const done=['ProHouse joint rental application completed.','Reference: '+row.reference,'',
    'Both applicants have now submitted their details and mandatory documents.',
    'The ProHouse team has been emailed the completed application and will review it.',
    'This confirmation is not approval of a tenancy or an executed agreement.',
    '','ProHouse | hi@prohouse.com.au'].join('\n');
  const notifications=await Promise.allSettled([
    sendMail(env,{to:row.first_email,subject:'Both applicants submitted | '+row.reference,text:done,tag:'joint-complete-first'}),
    sendMail(env,{to:row.second_email,subject:'Your ProHouse application is complete | '+row.reference,text:done,tag:'joint-complete-second'})
  ]);
  notifications.forEach((r,i)=>{if(r.status==='rejected')console.error('Longstay completion notification failed',row.reference,i)});
  return reply(200,'Your joint application has been submitted to ProHouse.',
    {reference:row.reference,status:'completed',notificationsSent:notifications.every(x=>x.status==='fulfilled')});
}
