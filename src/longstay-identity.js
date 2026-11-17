// Didit tenant ID verification, modelled on the existing vendor identity workflow.
// No applicant ID scans or biometric payloads are stored or emailed by ProHouse.
// Only Didit's server-verified decision, full name, and session reference are retained.
const HEAD={'Cache-Control':'no-store, private','Referrer-Policy':'no-referrer',
 'X-Content-Type-Options':'nosniff','X-Robots-Tag':'noindex, nofollow'};
const reply=(status,message,other={})=>Response.json({message,...other},{status,headers:HEAD});
const now=()=>new Date().toISOString();
const validToken=t=>typeof t==='string'&&/^[0-9a-f]{64}$/.test(t);
const nameKey=s=>String(s||'').normalize('NFKD').replace(/[\u0300-\u036f]/g,'')
 .toLowerCase().replace(/[^\p{L}\p{N}]/gu,'');
const validEmail=s=>typeof s==='string'&&/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)&&s.length<=254;
const norm=s=>typeof s==='string'?s.trim().slice(0,180):'';
async function hash(t){
 const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(t));
 return [...new Uint8Array(digest)].map(v=>v.toString(16).padStart(2,'0')).join('');
}
export const diditTenantReady=env=>!!(env.DIDIT_API_KEY&&env.DIDIT_WORKFLOW_ID&&env.LONGSTAY_DB&&env.DIDIT_LONGSTAY_ENABLED!=='false');
const prepared=data=>({
 method:'Didit ID, selfie/liveness, face match',
 status:'Approved',
 verifiedName:data.provider_name,
 sessionId:data.session_id,
 verifiedAt:data.verified_at
});
class DiditProviderError extends Error{
 constructor(status,reason=''){
  super('Didit API returned '+status);
  this.name='DiditProviderError';this.status=status;this.reason=reason;
 }
}
async function provider(env,path,data){
 const r=await fetch('https://verification.didit.me/v3/'+path,{
  method:data?'POST':'GET',
  headers:{'x-api-key':String(env.DIDIT_API_KEY||'').trim(),'Content-Type':'application/json'},
  ...(data?{body:JSON.stringify(data)}:{}),
  signal:AbortSignal.timeout(15000)
 });
 if(!r.ok){
  // Keep diagnostic detail private in D1. It must never expose the key,
  // applicants' contact details or any provider response directly in the browser.
  const endpoint=data?'create-session':'decision';
  let detail='Unspecified Didit error';
  try{
   const payload=JSON.parse((await r.text()).slice(0,3500));
   const main=payload?.detail||payload?.message||payload?.error||payload?.code;
   if(main)detail=typeof main==='object'?JSON.stringify(main):String(main);
   else if(payload&&typeof payload==='object'){
    // Didit/DRF field validation errors often use e.g. {"workflow_id":["..."]}
    // without a top-level detail/message. Only record permitted error field names.
    const keys=['workflow_id','vendor_data','callback','callback_method','contact_details',
      'language','metadata','non_field_errors','errors'];
    const fields=Object.entries(payload).filter(([key])=>keys.includes(key))
     .map(([key,value])=>key+': '+(typeof value==='string'?value:JSON.stringify(value)));
    if(fields.length)detail=fields.join('; ');
    else detail='Validation fields: '+Object.keys(payload).slice(0,12).join(', ');
   }
   detail=detail.slice(0,600);
  }catch{detail='Didit returned a non-JSON error';}
  detail=detail.replace(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/g,'[redacted-email]')
   .replace(/[A-Za-z0-9_=-]{45,}/g,'[redacted-token]');
  if(env.LONGSTAY_DB&&data){
   try{
    await env.LONGSTAY_DB.prepare(
     'INSERT INTO longstay_didit_api_errors(endpoint,http_status,detail,occurred_at) VALUES(?,?,?,?)'
    ).bind(endpoint,r.status,detail,now()).run();
    await env.LONGSTAY_DB.prepare(
     'DELETE FROM longstay_didit_api_errors WHERE id NOT IN (SELECT id FROM longstay_didit_api_errors ORDER BY id DESC LIMIT 20)'
    ).run();
   }catch(e){console.warn('Could not store Didit diagnostic',e?.name);}
  }
  console.warn('Didit request rejected', {endpoint,status:r.status});
  const reason=detail.toLowerCase().includes('no write access to sessions')?'sessions_write_denied':
   detail.toLowerCase().includes('no read access to workflows')?'workflows_read_denied':'';
  throw new DiditProviderError(r.status,reason);
 }
 return r.json();
}
function safeStartFailure(e){
 if(!(e instanceof DiditProviderError)){
  if(e?.message==='Unexpected Didit verification URL.')
   return {status:502,message:'Didit returned an unexpected verification link. Contact ProHouse.'};
  if(e?.name==='TimeoutError'||e?.name==='AbortError')
   return {status:504,message:'Didit did not respond in time. Please try again.'};
  return {status:502,message:'Could not start Didit verification. Please contact ProHouse if the problem continues.'};
 }
 const n=e.status;
 if(e.reason==='sessions_write_denied')return {status:503,message:
  'ProHouse Didit API key is missing permission to CREATE verification sessions. In the Didit Business Console, select the correct Live application under Developers → API keys and use a key with Sessions create/write access. Contact ProHouse until this is configured.'};
 if(e.reason==='workflows_read_denied')return {status:503,message:
  'ProHouse Didit API key lacks Workflows read permission. Check the permissions of the key under the same Live Didit application.'};
 if(n===400||n===422)return {status:502,message:
  'Didit rejected the verification setup (HTTP '+n+'). ProHouse needs to check the workflow configuration.'};
 if(n===401)return {status:503,message:
  'Didit did not accept the API key (HTTP 401). ProHouse must check the API key in Cloudflare.'};
 if(n===403||n===404)return {status:503,message:
  'Didit cannot access the configured workflow (HTTP '+n+'). ProHouse must check that the workflow ID and API key belong to the same Didit application and Live/Sandbox environment.'};
 if(n===402)return {status:503,message:
  'Didit could not create the session because of an account or credit restriction (HTTP 402). Contact ProHouse.'};
 if(n===429)return {status:429,message:
  'Didit is rate-limiting new verification sessions. Please try again later.'};
 return {status:502,message:'Didit could not start the verification (HTTP '+n+'). Please try again later.'};
}
const checkedStatus=(result,identity)=>{
 const categories=['id_verifications','liveness_checks','face_matches'];
 // Didit's final Approved decision may be the result of a human review. Still
 // require all three checks to have actually run; the reviewer owns the verdict.
 const validChecks=categories.every(k=>Array.isArray(result[k])&&result[k].length>0);
 const verifiedName=norm(result.id_verifications?.[0]?.full_name);
 const fullMatch=!!verifiedName&&nameKey(verifiedName)===nameKey(identity.legal_name);
 const approved=result.status==='Approved'&&validChecks&&fullMatch;
 return {
  status:approved?'Approved':(result.status==='Approved'&&!fullMatch?'Name Mismatch':
   (result.status==='Approved'?'In Review':norm(result.status)||'In Review')),
  providerName:verifiedName,approved
 };
};
async function session(env,token){
 if(!validToken(token))return null;
 return env.LONGSTAY_DB.prepare(
  'SELECT * FROM longstay_identity_sessions WHERE token_hash=?'
 ).bind(await hash(token)).first();
}
async function confirmFromDidit(env,row){
 if(!row.session_id)throw Error('No Didit session has started.');
 const result=await provider(env,'session/'+encodeURIComponent(row.session_id)+'/decision/');
 if(result.session_id!==row.session_id||result.vendor_data!==row.vendor_data||
    result.workflow_id!==env.DIDIT_WORKFLOW_ID)
  throw Error('Didit identity session did not match the application.');
 const decision=checkedStatus(result,row),time=now();
 await env.LONGSTAY_DB.prepare(
  'UPDATE longstay_identity_sessions SET provider_status=?,provider_name=?,checked_at=?,verified_at=? WHERE token_hash=?'
 ).bind(decision.status,decision.providerName,time,decision.approved?time:null,row.token_hash).run();
 const updated={...row,provider_status:decision.status,provider_name:decision.providerName,
  checked_at:time,verified_at:decision.approved?time:null};
 // Do not let a notification delivery problem block the applicant's status check.
 if(['In Review','Declined','Resubmitted'].includes(decision.status))
  await notifyIdentityUpdate(env,updated).catch(e=>console.warn('Didit notification failed',e?.message));
 return updated;
}
// Didit does not email the business on manual review. Send deduplicated
// ProHouse alerts, with an hourly polling safety net for visitors who close the tab.
// This table is created lazily so production needs no out-of-band D1 migration.
async function notifyIdentityUpdate(env,row){
 if(!env.RESEND_API_KEY||!env.LONGSTAY_DB)return;
 if(!['In Review','Declined','Resubmitted'].includes(row.provider_status))return;
 await env.LONGSTAY_DB.prepare(
  'CREATE TABLE IF NOT EXISTS longstay_identity_alerts (token_hash TEXT NOT NULL, status TEXT NOT NULL, audience TEXT NOT NULL, sent_at TEXT, PRIMARY KEY(token_hash,status,audience))'
 ).run();
 const state=row.provider_status;
 const recipients=[
  {audience:'admin',to:env.PROHOUSE_ADMIN_EMAILS?.split(',').map(s=>s.trim()).filter(Boolean)||['hi@prohouse.com.au']},
  ...(state==='Declined'||state==='Resubmitted'?[{audience:'applicant',to:[row.email]}]:[])
 ];
 for(const recipient of recipients){
  try{
   await env.LONGSTAY_DB.prepare(
    'INSERT OR IGNORE INTO longstay_identity_alerts(token_hash,status,audience) VALUES(?,?,?)'
   ).bind(row.token_hash,state,recipient.audience).run();
   const delivery=await env.LONGSTAY_DB.prepare(
    'SELECT sent_at FROM longstay_identity_alerts WHERE token_hash=? AND status=? AND audience=?'
   ).bind(row.token_hash,state,recipient.audience).first();
   if(delivery?.sent_at)continue;
   const isAdmin=recipient.audience==='admin';
   const subject=isAdmin?
    (state==='In Review'?'[DIDIT MANUAL REVIEW REQUIRED] ':('[DIDIT '+state.toUpperCase()+'] '))+
      'Live With Us | '+row.legal_name:
    (state==='Resubmitted'?'Action needed: update your ProHouse ID check':
     'Update about your ProHouse ID verification');
   const body=isAdmin?[
    'Didit identity verification requires attention.','',
    'Status: '+state,
    'Applicant: '+row.legal_name,
    'Email: '+row.email,
    'Applicant role: '+row.role,
    'Application reference: '+(row.used_reference||row.invite_reference||'Not yet submitted'),
    'Didit session ID: '+row.session_id,'',
    'Open https://business.didit.me and go to Identity verification > User verifications.',
    'Find the session, inspect its warnings, then approve, decline or request resubmission.',
    'Do not approve the rental application while identity verification is pending or declined.'
   ].join('\n'):
   state==='Resubmitted'?[
    'Your ProHouse identity verification needs an updated ID or selfie step.',
    'Please open the same secure Didit verification link to complete the requested check:',
    row.session_url,'',
    'Your rental application remains on hold until your identity is approved.',
    'Contact hi@prohouse.com.au if you need help.'
   ].join('\n'):[
    'Your Didit identity verification was not approved.',
    'This does not automatically mean your rental application has been rejected.',
    'ProHouse will review whether a new document or selfie submission is appropriate.',
    'Please do not start a second check unless we ask you to.',
    'Contact hi@prohouse.com.au if you need help.'
   ].join('\n');
   const response=await fetch('https://api.resend.com/emails',{
    method:'POST',headers:{Authorization:'Bearer '+env.RESEND_API_KEY,'Content-Type':'application/json'},
    body:JSON.stringify({
     from:env.APPLICATION_FROM_EMAIL||'ProHouse <no-reply@prohouse.com.au>',
     to:recipient.to,subject,text:body,
     tags:[{name:'form',value:'livewithus'},{name:'stage',value:'didit-status'}]
    })
   });
   if(!response.ok)throw Error('Resend returned '+response.status);
   await env.LONGSTAY_DB.prepare(
    'UPDATE longstay_identity_alerts SET sent_at=? WHERE token_hash=? AND status=? AND audience=?'
   ).bind(now(),row.token_hash,state,recipient.audience).run();
  }catch(error){
   console.warn('Didit status mail failed',{audience:recipient.audience,status:state,error:error?.message});
  }
 }
}

export async function checkTenantIdentityReviews(env){
 if(!diditTenantReady(env))return;
 // Scan a bounded queue every hour: abandoned applicant tabs cannot block alerts.
 // Used sessions are retained after the browser session expires for manual decisions.
 const pending=await env.LONGSTAY_DB.prepare(
  "SELECT * FROM longstay_identity_sessions WHERE (used_reference IS NOT NULL OR expires_at>?) AND started_at>? AND provider_status IN ('Not Started','In Progress','In Review','Resubmitted','Approved','Declined') ORDER BY checked_at ASC LIMIT 60"
 ).bind(now(),new Date(Date.now()-90*86400000).toISOString()).all();
 for(const row of pending.results||[]){
  try{
   // Approved/declined sessions with no recent changes are rechecked only while
   // their rental review is open, to catch reviewer updates and resubmissions.
   if(['Approved','Declined'].includes(row.provider_status)&&!row.used_reference)continue;
   await confirmFromDidit(env,row);
  }catch(e){console.warn('Didit review sweep could not check session',row.session_id,e?.name);}
 }
}

// Read-only connection check. No personal details, no verification session created,
// no secret or workflow ID returned. Cached to avoid repeated calls to Didit.
let connectionCache={until:0,workflow:null,result:null};
async function discoverAvailableWorkflows(env){
 const endpoint='https://verification.didit.me/v3/workflows/';
 const response=await fetch(endpoint,{
  method:'GET',headers:{'x-api-key':String(env.DIDIT_API_KEY).trim(),Accept:'application/json'},
  signal:AbortSignal.timeout(10000)
 });
 let candidates=[],errorDetail=null;
 if(!response.ok){
  try{
   const raw=(await response.text()).slice(0,1200);
   const data=JSON.parse(raw);
   errorDetail=String(data.detail||data.message||data.error||data.code||'Unspecified provider error').slice(0,360);
  }catch{errorDetail='Provider returned non-JSON HTTP '+response.status;}
  errorDetail=errorDetail.replace(/[A-Za-z0-9_=-]{45,}/g,'[redacted]').replace(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/g,'[redacted-email]');
 }
 if(response.ok){
  const data=await response.json();
  const workflows=Array.isArray(data)?data:
   Array.isArray(data?.results)?data.results:
   Array.isArray(data?.workflows)?data.workflows:[];
  candidates=workflows.slice(0,50).map(w=>({
   id:String(w.workflow_id||w.uuid||w.id||'').slice(0,80),
   label:String(w.workflow_label||w.name||'').slice(0,180),
   type:String(w.workflow_type||w.type||'').slice(0,80),
   status:String(w.status||w.workflow_status||'').slice(0,80),
   published:typeof w.is_published==='boolean'?w.is_published:null,
   is_default:typeof w.is_default==='boolean'?w.is_default:null
  })).filter(x=>/^[a-z0-9_-]{5,80}$/i.test(x.id));
 }
 if(env.LONGSTAY_DB)await env.LONGSTAY_DB.prepare(
  'INSERT INTO longstay_didit_workflow_diagnostics(id,fetched_at,fetch_status,workflows_json) VALUES(1,?,?,?) ON CONFLICT(id) DO UPDATE SET fetched_at=excluded.fetched_at,fetch_status=excluded.fetch_status,workflows_json=excluded.workflows_json'
 ).bind(new Date().toISOString(),response.status,JSON.stringify({candidates,errorDetail})).run();
 return {status:response.status,availableCount:candidates.length};
}
async function checkDiditConnection(env){
 if(!diditTenantReady(env))return {reachable:false,reason:'Not configured'};
 if(connectionCache.until>Date.now()&&connectionCache.workflow===env.DIDIT_WORKFLOW_ID)
  return connectionCache.result;
 let result;
 try{
  const res=await fetch('https://verification.didit.me/v3/workflows/'+
   encodeURIComponent(env.DIDIT_WORKFLOW_ID)+'/',{
    method:'GET',headers:{'x-api-key':String(env.DIDIT_API_KEY).trim(),
     Accept:'application/json'},signal:AbortSignal.timeout(10000)
   });
  let workflow=null;
  if(res.ok){
   try{
    const item=await res.json();
    workflow={
     status:String(item.status||'unknown').slice(0,80),
     published:typeof item.is_published==='boolean'?item.is_published:null,
     currentVersion:item.current_version??item.published_version??null,
     label:String(item.workflow_label||'').slice(0,70)
    };
   }catch{}
  }
  result={
   ...(workflow?{workflow}:{}),
   reachable:res.ok,
   status:res.status,
   reason:res.ok?'The API key can access the configured Didit workflow.':
    res.status===401?'Didit rejected the API key.':
    [403,404].includes(res.status)?
      'The API key cannot access this workflow. Check its Didit application and Live/Sandbox environment.':
    res.status===400?'Workflow configuration is invalid.':
    'Didit returned HTTP '+res.status+'.'
  };
  if([403,404].includes(res.status)){
   try{
    const found=await discoverAvailableWorkflows(env);
    result.accessibleWorkflows=found.availableCount;
    result.workflowListStatus=found.status;
   }catch(e){console.warn('Didit workflow discovery failed',{message:e?.name||'Error'});}
  }
 }catch(e){
  result={reachable:false,reason:e?.name==='TimeoutError'?
   'Didit did not respond in time.':'Didit connection check failed.'};
 }
 connectionCache={workflow:env.DIDIT_WORKFLOW_ID,until:Date.now()+120000,result};
 return result;
}
export async function identityConfig(request,env){
 if(request.method!=='GET')return reply(405,'Method not allowed.');
 const active=diditTenantReady(env);
 const result={
  diditAvailable:active,
  uploadFallback:!active,
  verificationMethods:active?['Didit identity document','Didit selfie/liveness','Didit face match']:[],
  instructions:active?'Verify your identity with Didit. ProHouse does not collect a scan of your ID.':
   'Online ID verification is being activated. For now the existing secure ID upload method remains available.'
 };
 if(new URL(request.url).searchParams.get('check')==='1')
  result.providerConnection=await checkDiditConnection(env);
 return reply(200,'Identity verification settings ready.',result);
}
export async function startTenantIdentity(request,env){
 if(request.method!=='POST')return reply(405,'Method not allowed.');
 if(request.headers.get('Origin')!==new URL(request.url).origin)return reply(403,'Please start verification on the ProHouse form.');
 if(!diditTenantReady(env))return reply(503,'Didit verification is not yet configured for ProHouse.');
 if(Number(request.headers.get('Content-Length')||0)>6000)return reply(413,'Request too large.');
 if(!request.headers.get('Content-Type')?.startsWith('application/json'))return reply(415,'JSON required.');
 if(env.LONGSTAY_FORM_LIMIT){
  const ip=request.headers.get('CF-Connecting-IP')||'unknown';
  const limit=await env.LONGSTAY_FORM_LIMIT.limit({key:'longstay-didit:'+ip});
  if(!limit.success)return reply(429,'Too many verification attempts. Please try again shortly.');
 }
 let body;try{body=await request.json()}catch{return reply(400,'Unable to read verification request.');}
 const role=body.role;
 const legalName=norm(body.legalName),email=norm(body.email).toLowerCase();
 if(!['first','second'].includes(role)||legalName.length<3||legalName.length>170||!validEmail(email)
    ||body.consent!==true)
  return reply(400,'Enter your legal name, email, and consent to Didit ID and selfie verification.');
 let inviteReference=null,expiry=new Date(Date.now()+48*3600000).toISOString();
 if(role==='second'){
  if(!validToken(body.invitationToken))return reply(403,'Open the private second-applicant invitation first.');
  const row=await env.LONGSTAY_DB.prepare(
    'SELECT reference,second_email,status,expires_at FROM longstay_applications WHERE invite_hash=?'
  ).bind(await hash(body.invitationToken)).first();
  if(!row||row.status!=='invited'||row.expires_at<=now()||
     row.second_email?.toLowerCase()!==email)
   return reply(403,'Invitation not valid for this applicant and email.');
  inviteReference=row.reference;expiry=row.expires_at;
 }
 const cap=Math.max(1,Math.min(250,Number(env.DIDIT_LONGSTAY_MONTHLY_LIMIT)||50));
 const total=await env.LONGSTAY_DB.prepare(
  'SELECT COUNT(*) AS total FROM longstay_identity_sessions WHERE started_at>=?'
 ).bind(new Date(Date.now()-31*86400000).toISOString()).first();
 if(Number(total?.total||0)>=cap)return reply(429,'Monthly ID verification limit reached. Contact ProHouse.');
 const token=[...crypto.getRandomValues(new Uint8Array(32))].map(v=>v.toString(16).padStart(2,'0')).join('');
 const tokenHash=await hash(token);
 const vendorData='prohouse-tenant:'+crypto.randomUUID();
 const baseUrl=new URL(request.url);
 const callback=new URL('/operations/livewithus/verification-complete/',baseUrl.origin).toString();
 try{
  const start=await provider(env,'session/',{
   // Didit's contact_details are optional and can reject certain applicant email
   // formats even when ProHouse accepts the address. We keep their email privately
   // in ProHouse and do not request a Didit invitation email.
   workflow_id:env.DIDIT_WORKFLOW_ID,vendor_data:vendorData,
   callback
  });
  const uri=new URL(start.url);
  if(!start.session_id||uri.protocol!=='https:'||uri.hostname!=='verify.didit.me')
   throw Error('Unexpected Didit verification URL.');
  const time=now();
  await env.LONGSTAY_DB.prepare(
   'INSERT INTO longstay_identity_sessions(token_hash,role,invite_reference,legal_name,email,vendor_data,session_id,session_url,provider_status,started_at,expires_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)'
  ).bind(tokenHash,role,inviteReference,legalName,email,vendorData,start.session_id,uri.href,
    'Not Started',time,expiry).run();
  return reply(200,'Verification started.',{verificationToken:token,url:uri.href,
   status:'Not Started',expiresAt:expiry});
 }catch(e){
  const failure=safeStartFailure(e);
  console.error('Didit tenant session start failed',{reason:e?.name,status:e?.status||null,stage:'create-session'});
  return reply(failure.status,failure.message);
 }
}
export async function tenantIdentityStatus(request,env){
 if(request.method!=='GET'&&request.method!=='POST')return reply(405,'Method not allowed.');
 if(!diditTenantReady(env))return reply(503,'Didit tenant verification is not available.');
 if(request.method==='POST'&&request.headers.get('Origin')!==new URL(request.url).origin)
  return reply(403,'Only the ProHouse form can check verification results.');
 const token=(request.headers.get('Authorization')||'').replace(/^Bearer\s+/i,'').trim();
 let data=await session(env,token);
 if(!data)return reply(404,'This verification session was not found. Please restart.');
 if(data.expires_at<=now())return reply(410,'Your verification session expired. Please restart.');
 if(request.method==='POST'){
  if(data.checked_at&&Date.now()-Date.parse(data.checked_at)<8000)
   return reply(200,'Check recorded.',{status:data.provider_status,verified:data.provider_status==='Approved',verifiedName:data.provider_status==='Approved'?data.provider_name:undefined});
  try{data=await confirmFromDidit(env,data);}
  catch(e){
   console.warn('Didit decision retrieval failed',e?.message);
   return reply(502,'Could not obtain your Didit result. Try checking again soon.');
  }
 }
 return reply(200,'Verification status.',{
  status:data.provider_status,verified:data.provider_status==='Approved',
  verifiedName:data.provider_status==='Approved'?data.provider_name:undefined,
  hasOpenSession:!!data.session_id,expiresAt:data.expires_at
 });
}
export async function verifiedTenantIdentity(env,token,identity){
 if(!diditTenantReady(env))return null; // transitional upload pathway
 let data=await session(env,token);
 if(!data||data.used_reference||data.expires_at<=now())throw Error('Start and complete your own Didit identity verification.');
 const name=[identity.firstName,identity.lastName].filter(Boolean).join(' ').trim();
 if(data.role!==identity.role||data.email!==identity.email.toLowerCase()||
    nameKey(data.legal_name)!==nameKey(name)||
    (identity.role==='second'&&data.invite_reference!==identity.inviteReference))
  throw Error('Your Didit verification must match your application name and email.');
 // Fresh decision check: an "In Review" result is accepted as a *pending*
 // application attachment, never as an approved identity or tenancy.
 try{data=await confirmFromDidit(env,data);}
 catch{throw Error('Could not confirm your Didit result. Please try again before submitting.');}
 if(data.provider_status==='In Review')
  return {method:'Didit ID, selfie/liveness, face match',status:'In Review',
   sessionId:data.session_id,verifiedAt:null,verifiedName:null};
 if(data.provider_status!=='Approved')
  throw Error(data.provider_status==='Name Mismatch'
   ?'Your name does not match the verified ID. Correct your application legal name or contact ProHouse.'
   :data.provider_status==='Declined'
    ?'Your ID verification was declined. Contact ProHouse to arrange a review or resubmission.'
    :'Please finish the Didit ID and selfie checks before sending this application.');
 return prepared(data);
}
export async function identityReviewGate(env,reference,summary){
 if(!diditTenantReady(env))return {ok:true};
 for(const key of ['identityVerification','secondIdentityVerification']){
  const verification=summary?.[key];
  if(!verification?.sessionId)continue; // Older ID-upload application.
  const row=await env.LONGSTAY_DB.prepare(
   'SELECT * FROM longstay_identity_sessions WHERE used_reference=? AND session_id=?'
  ).bind(reference,verification.sessionId).first();
  if(!row)return {ok:false,message:'Didit identity session was not linked to this application. Contact ProHouse.'};
  let current;
  try{current=await confirmFromDidit(env,row);}
  catch{return {ok:false,message:'Could not obtain the latest Didit decision. Try again before approving.'};}
  if(current.provider_status!=='Approved')
   return {ok:false,message:
    (key==='secondIdentityVerification'?'Second applicant':'First applicant')+
    ' identity verification is '+current.provider_status+'. Approve their identity in Didit or request a resubmission before approving the rental application.'};
 }
 return {ok:true};
}
export async function markTenantIdentityUsed(env,token,reference){
 if(!diditTenantReady(env))return;
 if(!validToken(token))throw Error('Verification reference missing.');
 await env.LONGSTAY_DB.prepare(
  "UPDATE longstay_identity_sessions SET used_reference=? WHERE token_hash=? AND used_reference IS NULL AND provider_status IN ('Approved','In Review')"
 ).bind(reference,await hash(token)).run();
}
export async function cleanupTenantIdentitySessions(env){
 if(!env.LONGSTAY_DB)return;
 await env.LONGSTAY_DB.prepare(
  'DELETE FROM longstay_identity_sessions WHERE (used_reference IS NULL AND expires_at<?) OR (used_reference IS NOT NULL AND started_at<?)'
 ).bind(now(),new Date(Date.now()-90*86400000).toISOString()).run();
}
