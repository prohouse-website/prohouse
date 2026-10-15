const q=(env,sql,...args)=>env.CLEANER_DB.prepare(sql).bind(...args);
const reply=(data,status=200)=>Response.json(data,{status,headers:{'Cache-Control':'no-store','Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff'}});
const now=()=>new Date().toISOString();
const digest=async bytes=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join('');
const nameKey=s=>String(s||'').normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^\p{L}\p{N}]/gu,'');
export const diditReady=env=>!!(env.DIDIT_API_KEY&&env.DIDIT_WORKFLOW_ID);
export async function identitySummary(env,id){
 const files=(await q(env,'SELECT id,slot,document_type,mime,size,sha256,uploaded FROM vendor_id_files WHERE agreement_id=? ORDER BY slot',id).all()).results;
 const check=await q(env,'SELECT provider_status,provider_name,submitted_name,checked_at,manual_by,manual_at,manual_name,review_notes,session_id FROM vendor_id_checks WHERE agreement_id=?',id).first();
 return {files,check:check||null,diditAvailable:diditReady(env)};
}
export async function approvedIdentity(env,id,signer){
 const s=await identitySummary(env,id),c=s.check;
 if(c?.manual_at&&nameKey(c.manual_name)===nameKey(signer))return {method:'ProHouse document review',reviewedBy:c.manual_by,reviewedAt:c.manual_at,signatory:c.manual_name,files:s.files.map(f=>({slot:f.slot,sha256:f.sha256}))};
 if(c?.provider_status==='Approved'&&nameKey(c.provider_name)===nameKey(signer))return {method:'Didit ID, liveness and face match',sessionId:c.session_id,checkedAt:c.checked_at,signatory:c.provider_name};
 return null;
}
function imageType(bytes){if(bytes[0]===255&&bytes[1]===216&&bytes[2]===255)return 'image/jpeg';if(bytes.slice(0,8).every((b,i)=>b===[137,80,78,71,13,10,26,10][i]))return 'image/png';if(String.fromCharCode(...bytes.slice(0,4))==='RIFF'&&String.fromCharCode(...bytes.slice(8,12))==='WEBP')return 'image/webp';return null;}
async function limitedBytes(request,max){
 const reader=request.body?.getReader();if(!reader)return new Uint8Array();const chunks=[];let size=0;
 while(true){const r=await reader.read();if(r.done)break;size+=r.value.byteLength;if(size>max){await reader.cancel();throw Error('TOO_LARGE');}chunks.push(r.value);}
 const bytes=new Uint8Array(size);let i=0;for(const chunk of chunks){bytes.set(chunk,i);i+=chunk.length;}return bytes;
}
async function provider(env,path,body){const r=await fetch('https://verification.didit.me/v3/'+path,{method:body?'POST':'GET',headers:{'x-api-key':env.DIDIT_API_KEY,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(15000)});if(!r.ok)throw Error('Provider temporarily unavailable');return r.json();}
export async function vendorIdentity(req,env,a,user,isAdmin,action,body={}){
 const post=req.method==='POST',d=JSON.parse(a.data),mutable=['Awaiting cleaner','Awaiting ProHouse'].includes(a.status);
 if(action==='identity'&&req.method==='GET')return reply(await identitySummary(env,a.id));
 const fileMatch=action.match(/^identity\/file\/([a-f0-9-]{36})$/);
 if(fileMatch&&req.method==='GET'){
  const f=await q(env,'SELECT mime,bytes FROM vendor_id_files WHERE agreement_id=? AND id=?',a.id,fileMatch[1]).first();if(!f)return reply({error:'ID file not found.'},404);
  return new Response(new Uint8Array(f.bytes),{headers:{'Content-Type':f.mime,'Content-Disposition':'inline; filename="vendor-id"','Cache-Control':'no-store','Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'none'; sandbox"}});
 }
 if(!post)return reply({error:'Method not allowed.'},405);
 if(req.headers.get('origin')!==new URL(req.url).origin)return reply({error:'Invalid origin.'},403);
 if(action==='identity/upload'){
  if(isAdmin)return reply({error:'The invited vendor must upload their own ID.'},403);
  if(a.status!=='Awaiting cleaner')return reply({error:'Identity documents are locked after vendor signature.'},409);
  const url=new URL(req.url),slot=url.searchParams.get('slot'),type=url.searchParams.get('type');
  if(!['front','back'].includes(slot)||!['passport','driver-licence','national-id'].includes(type))return reply({error:'Choose a document type and front or back.'},400);
  if(req.headers.get('x-identity-consent')!=='yes')return reply({error:'Confirm consent to private ID storage and review.'},400);
  let bytes;try{bytes=await limitedBytes(req,1048576);}catch{return reply({error:'ID image is too large. Upload an image up to 1 MB.'},413);}
  const mime=imageType(bytes);if(bytes.length<32||!mime)return reply({error:'Upload a JPEG, PNG or WebP photo of the ID (up to 1 MB).'},415);
  const id=crypto.randomUUID();
  // The guarded insert and clearing a stale review happen in one transaction.
  await env.CLEANER_DB.batch([
   q(env,`INSERT INTO vendor_id_files(id,agreement_id,slot,document_type,mime,bytes,size,sha256,uploaded,owner) SELECT ?,?,?,?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM cleaner_agreements WHERE id=? AND status='Awaiting cleaner') ON CONFLICT(agreement_id,slot) DO UPDATE SET id=excluded.id,document_type=excluded.document_type,mime=excluded.mime,bytes=excluded.bytes,size=excluded.size,sha256=excluded.sha256,uploaded=excluded.uploaded,owner=excluded.owner`,id,a.id,slot,type,mime,bytes.buffer,bytes.length,await digest(bytes),now(),user.email,a.id),
   q(env,"UPDATE vendor_id_checks SET manual_by=NULL,manual_at=NULL,manual_name=NULL,review_notes=NULL WHERE agreement_id=? AND EXISTS(SELECT 1 FROM cleaner_agreements WHERE id=? AND status='Awaiting cleaner')",a.id,a.id)
  ]);
  return reply({ok:true,...await identitySummary(env,a.id)});
 }
 if(action==='identity/review'){
  if(!isAdmin)return reply({error:'Only ProHouse may review identity documents.'},403);
  if(!mutable)return reply({error:'This agreement is locked.'},409);
  if(body.consent!==true||typeof body.name!=='string'||!body.name.trim()||body.name.length>300)return reply({error:'Enter the ID holder’s full name and confirm you matched the photo ID to the authorised signatory.'},400);
  const s=await identitySummary(env,a.id),front=s.files.find(f=>f.slot==='front');
  if(!front)return reply({error:'The vendor must upload a photo ID before manual review.'},400);
  if(front.document_type!=='passport'&&!s.files.some(f=>f.slot==='back'&&f.document_type===front.document_type))return reply({error:'Both sides of this ID are required for review.'},400);
  if(d.cleaner&&nameKey(body.name)!==nameKey(d.cleaner.legal))return reply({error:'The ID holder name must match the vendor signatory name.'},400);
  await q(env,'INSERT INTO vendor_id_checks(agreement_id,manual_by,manual_at,manual_name,review_notes) VALUES(?,?,?,?,?) ON CONFLICT(agreement_id) DO UPDATE SET manual_by=excluded.manual_by,manual_at=excluded.manual_at,manual_name=excluded.manual_name,review_notes=excluded.review_notes',a.id,user.email,now(),body.name.trim(),String(body.notes||'').slice(0,1000)).run();
  return reply({ok:true,...await identitySummary(env,a.id)});
 }
 if(action==='identity/delete'){
  if(!isAdmin)return reply({error:'Only ProHouse may remove stored ID copies.'},403);
  if(body.consent!==true)return reply({error:'Confirm deletion of uploaded ID copies.'},400);
  await env.CLEANER_DB.batch([q(env,'DELETE FROM vendor_id_files WHERE agreement_id=?',a.id),q(env,'UPDATE vendor_id_checks SET manual_by=NULL,manual_at=NULL,manual_name=NULL,review_notes=NULL WHERE agreement_id=?',a.id)]);
  return reply({ok:true,...await identitySummary(env,a.id)});
 }
 if(action==='identity/start'){
  if(isAdmin||a.status!=='Awaiting cleaner')return reply({error:'Only the invited vendor may start verification before signing.'},403);
  if(!diditReady(env))return reply({error:'Automatic ID verification is not activated yet. ProHouse can review your private ID upload in the meantime.'},503);
  if(body.consent!==true)return reply({error:'Consent to Didit’s document, selfie and liveness verification is required.'},400);
  const existing=await q(env,'SELECT session_id,session_url FROM vendor_id_checks WHERE agreement_id=?',a.id).first();if(existing?.session_id)return reply({url:existing.session_url});
  const month=now().slice(0,7),usageId=crypto.randomUUID(),cap=Math.max(0,Math.min(450,Number.isFinite(Number(env.DIDIT_MONTHLY_LIMIT))?Math.floor(Number(env.DIDIT_MONTHLY_LIMIT)):450));
  const used=await q(env,'INSERT INTO vendor_id_usage(id,agreement_id,month,created) SELECT ?,?,?,? WHERE (SELECT COUNT(*) FROM vendor_id_usage WHERE month=?)<? AND (SELECT COUNT(*) FROM vendor_id_usage WHERE agreement_id=?)<2',usageId,a.id,month,now(),month,cap,a.id).run();
  if(!used.meta.changes)return reply({error:'The portal’s free verification allowance is unavailable. Use private ID upload for ProHouse review.'},429);
  // Reserve the agreement before calling the provider, preventing duplicate sessions from concurrent clicks.
  const claim=await q(env,"INSERT INTO vendor_id_checks(agreement_id,provider_status,started_at) VALUES(?,'Starting',?) ON CONFLICT(agreement_id) DO UPDATE SET provider_status='Starting',started_at=excluded.started_at WHERE vendor_id_checks.session_id IS NULL AND vendor_id_checks.provider_status IS NOT 'Starting'",a.id,now()).run();
  if(!claim.meta.changes)return reply({error:'Verification is starting. Refresh shortly.'},409);
  try{
   const session=await provider(env,'session/',{workflow_id:env.DIDIT_WORKFLOW_ID,vendor_data:a.id,callback:new URL('/cleaners/?agreement='+a.id,new URL(req.url).origin).href,contact_details:{email:user.email,send_notification_emails:false}});
   const link=new URL(session.url);if(!session.session_id||link.protocol!=='https:'||link.hostname!=='verify.didit.me')throw Error('Unexpected verification link');
   await q(env,'UPDATE vendor_id_checks SET session_id=?,session_url=?,provider_status=?,started_at=? WHERE agreement_id=?',session.session_id,link.href,'Not Started',now(),a.id).run();return reply({url:link.href});
  }catch{await q(env,"UPDATE vendor_id_checks SET provider_status='Unavailable' WHERE agreement_id=? AND session_id IS NULL",a.id).run();return reply({error:'Verification could not be started. Please use private ID upload or retry later.'},502);}
 }
 if(action==='identity/refresh'){
  if(!diditReady(env))return reply({error:'Automatic ID verification is not activated.'},503);
  if(!mutable)return reply({error:'This completed agreement’s identity record is locked.'},409);
  const c=await q(env,'SELECT session_id FROM vendor_id_checks WHERE agreement_id=?',a.id).first();if(!c?.session_id)return reply({error:'No verification session has been started.'},400);
  try{
   const result=await provider(env,'session/'+encodeURIComponent(c.session_id)+'/decision/');
   if(result.session_id!==c.session_id||result.vendor_data!==a.id||result.workflow_id!==env.DIDIT_WORKFLOW_ID)return reply({error:'Verification reference did not match this agreement.'},409);
   const checks=['id_verifications','liveness_checks','face_matches'];
   const verified=result.status==='Approved'&&checks.every(k=>Array.isArray(result[k])&&result[k].length>0&&result[k].every(v=>v.status==='Approved'));
   const providerName=String(result.id_verifications?.[0]?.full_name||'').slice(0,300);
   const status=verified&&providerName?'Approved':result.status==='Approved'?'In Review':String(result.status||'In Review').slice(0,50);
   await q(env,'UPDATE vendor_id_checks SET provider_status=?,provider_name=?,checked_at=? WHERE agreement_id=?',status,providerName,now(),a.id).run();
   return reply({ok:true,...await identitySummary(env,a.id)});
  }catch{return reply({error:'Could not retrieve the verification result. Please retry later.'},502);}
 }
 return reply({error:'Not found.'},404);
}
