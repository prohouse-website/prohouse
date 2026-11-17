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
async function provider(env,path,data){
 const r=await fetch('https://verification.didit.me/v3/'+path,{
  method:data?'POST':'GET',
  headers:{'x-api-key':env.DIDIT_API_KEY,'Content-Type':'application/json'},
  ...(data?{body:JSON.stringify(data)}:{}),
  signal:AbortSignal.timeout(15000)
 });
 if(!r.ok)throw Error('Didit verification is temporarily unavailable.');
 return r.json();
}
const checkedStatus=(result,identity)=>{
 const categories=['id_verifications','liveness_checks','face_matches'];
 const validChecks=categories.every(k=>Array.isArray(result[k])&&result[k].length>0
  &&result[k].every(v=>v.status==='Approved'));
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
 return {...row,provider_status:decision.status,provider_name:decision.providerName,
  checked_at:time,verified_at:decision.approved?time:null};
}
export async function identityConfig(request,env){
 if(request.method!=='GET')return reply(405,'Method not allowed.');
 const active=diditTenantReady(env);
 return reply(200,'Identity verification settings ready.',{
  diditAvailable:active,
  uploadFallback:!active,
  verificationMethods:active?['Didit identity document','Didit selfie/liveness','Didit face match']:[],
  instructions:active?'Verify your identity with Didit. ProHouse does not collect a scan of your ID.':
   'Online ID verification is being activated. For now the existing secure ID upload method remains available.'
 });
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
   workflow_id:env.DIDIT_WORKFLOW_ID,vendor_data:vendorData,
   callback,contact_details:{email,send_notification_emails:false}
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
  console.error('Didit tenant session start failed',e?.message);
  return reply(502,'Could not start Didit verification. Please try again.');
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
 if(data.provider_status!=='Approved')throw Error('Finish Didit ID and selfie verification, then check the result before submitting.');
 // Fresh check on submission: never trust browser-supplied status or stale Didit claims.
 try{data=await confirmFromDidit(env,data);}
 catch{throw Error('Could not confirm your Didit result. Please try again before submitting.');}
 if(data.provider_status!=='Approved')
  throw Error(data.provider_status==='Name Mismatch'
   ?'Your name does not match the verified ID. Correct your application legal name or contact ProHouse.'
   :'Didit has not approved the required ID, selfie and face-match checks.');
 return prepared(data);
}
export async function markTenantIdentityUsed(env,token,reference){
 if(!diditTenantReady(env))return;
 if(!validToken(token))throw Error('Verification reference missing.');
 await env.LONGSTAY_DB.prepare(
  'UPDATE longstay_identity_sessions SET used_reference=? WHERE token_hash=? AND used_reference IS NULL AND provider_status=?'
 ).bind(reference,await hash(token),'Approved').run();
}
export async function cleanupTenantIdentitySessions(env){
 if(!env.LONGSTAY_DB)return;
 await env.LONGSTAY_DB.prepare(
  'DELETE FROM longstay_identity_sessions WHERE expires_at<? OR (used_reference IS NOT NULL AND started_at<?)'
 ).bind(now(),new Date(Date.now()-90*86400000).toISOString()).run();
}
