import test from 'node:test';
import assert from 'node:assert/strict';
import {
 identityConfig,startTenantIdentity,tenantIdentityStatus,verifiedTenantIdentity,
 markTenantIdentityUsed,diditTenantReady,cleanupTenantIdentitySessions
} from '../src/longstay-identity.js';

const BASE='https://www.prohouse.com.au';
const WORKFLOW='test-didit-workflow-1';
const sha=async value=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',
 new TextEncoder().encode(value)))].map(v=>v.toString(16).padStart(2,'0')).join('');
const url=path=>BASE+'/api/longstay/identity/'+path;
function post(path,body,token){
 return new Request(url(path),{method:'POST',headers:{Origin:BASE,'Content-Type':'application/json',
 ...(token?{Authorization:'Bearer '+token}:{})},body:JSON.stringify(body)});
}
function status(token){return new Request(url('status'),{headers:{Authorization:'Bearer '+token}});}
function mocks(){
 const sessions=new Map(),invites=new Map();
 const database={
  prepare(sql){
   let a=[];
   return {bind(...values){a=values;return this;},
    async first(){
     if(sql.startsWith('SELECT COUNT(*) AS total FROM longstay_identity_sessions'))
      return {total:[...sessions.values()].filter(x=>x.started_at>=a[0]).length};
     if(sql.includes('FROM longstay_applications WHERE invite_hash='))return invites.get(a[0])||null;
     if(sql.includes('FROM longstay_identity_sessions WHERE token_hash='))return sessions.get(a[0])||null;
     throw Error('Unmocked read SQL '+sql);
    },
    async run(){
     if(sql.startsWith('INSERT INTO longstay_identity_sessions')){
      const keys=['token_hash','role','invite_reference','legal_name','email','vendor_data',
       'session_id','session_url','provider_status','started_at','expires_at'];
      sessions.set(a[0],Object.fromEntries(keys.map((k,i)=>[k,a[i]])));
      return {meta:{changes:1}};
     }
     if(sql.startsWith('UPDATE longstay_identity_sessions SET provider_status=')){
      const row=sessions.get(a[4]);
      Object.assign(row,{provider_status:a[0],provider_name:a[1],checked_at:a[2],verified_at:a[3]});
      return {meta:{changes:1}};
     }
     if(sql.startsWith('UPDATE longstay_identity_sessions SET used_reference=')){
      const row=sessions.get(a[1]);row.used_reference=a[0];return {meta:{changes:1}};
     }
     if(sql.startsWith('DELETE FROM longstay_identity_sessions WHERE expires_at<')){
      for(const [key,row] of sessions)if(row.expires_at<a[0]||(row.used_reference&&row.started_at<a[1]))sessions.delete(key);
      return {meta:{changes:1}};
     }
     throw Error('Unmocked write SQL '+sql);
    }
   };
  }
 };
 const env={LONGSTAY_DB:database,DIDIT_API_KEY:'unit-test-private-key',
 DIDIT_WORKFLOW_ID:WORKFLOW,DIDIT_LONGSTAY_MONTHLY_LIMIT:'25'};
 return {env,sessions,invites};
}
function mockDidit(fetchState){
 return async (input,options)=>{
  const uri=String(input);
  assert.ok(uri.startsWith('https://verification.didit.me/v3/'),uri);
  assert.equal(options.headers['x-api-key'],'unit-test-private-key');
  if(uri.endsWith('/session/')){
   assert.equal(options.method,'POST');
   const payload=JSON.parse(options.body);
   fetchState.calls.push(payload);
   fetchState.vendorData=payload.vendor_data;
   return Response.json({session_id:'session-tenant-123',
    url:'https://verify.didit.me/s/tenant-mock'}, {status:201});
  }
  assert.ok(uri.endsWith('/session/session-tenant-123/decision/'));
  return Response.json({
   session_id:'session-tenant-123',vendor_data:fetchState.vendorData,workflow_id:WORKFLOW,
   status:'Approved',id_verifications:[{status:'Approved',full_name:fetchState.name||'Alice Example'}],
   liveness_checks:fetchState.liveness===false?[]:[{status:'Approved'}],
   face_matches:[{status:'Approved'}]
  });
 };
}
test('tenant Didit first applicant: approved identity requires ID, liveness, face match, matching name, and is single-use',async()=>{
 const {env,sessions}=mocks(),state={calls:[]},orig=globalThis.fetch;
 globalThis.fetch=mockDidit(state);
 try{
  assert.equal(diditTenantReady(env),true);
  const ready=await identityConfig(new Request(url('config')),env);
  assert.equal((await ready.json()).diditAvailable,true);
  const started=await startTenantIdentity(post('start',{role:'first',
   legalName:'Alice Example',email:'alice@example.com',consent:true}),env);
  assert.equal(started.status,200);
  const response=await started.json();
  assert.match(response.verificationToken,/^[a-f0-9]{64}$/);
  assert.equal(response.url,'https://verify.didit.me/s/tenant-mock');
  assert.deepEqual(Object.keys(state.calls[0]).sort(),['callback','vendor_data','workflow_id']);
  assert.equal(state.calls[0].workflow_id,WORKFLOW);
  assert.equal(state.calls[0].contact_details,undefined,'ID verification must not send unnecessary applicant email to Didit');
  assert.ok(!JSON.stringify([...sessions.keys()]).includes(response.verificationToken),'Must store token hash');
  const before=await tenantIdentityStatus(status(response.verificationToken),env);
  assert.equal((await before.json()).verified,false);
  const refreshed=await tenantIdentityStatus(post('status',{},response.verificationToken),env);
  assert.equal((await refreshed.json()).verified,true);
  const id=await verifiedTenantIdentity(env,response.verificationToken,{role:'first',
   firstName:'Alice',lastName:'Example',email:'alice@example.com'});
  assert.equal(id.status,'Approved');assert.equal(id.method,'Didit ID, selfie/liveness, face match');
  await assert.rejects(()=>verifiedTenantIdentity(env,response.verificationToken,{role:'first',
   firstName:'Wrong',lastName:'Example',email:'alice@example.com'}),/match your application/);
  await markTenantIdentityUsed(env,response.verificationToken,'LH-123');
  await assert.rejects(()=>verifiedTenantIdentity(env,response.verificationToken,{role:'first',
   firstName:'Alice',lastName:'Example',email:'alice@example.com'}),/Start and complete/);
 }finally{globalThis.fetch=orig;}
});
test('unverified liveness or mismatched name must not pass tenant verification',async()=>{
 const {env}=mocks(),state={calls:[],liveness:false},orig=globalThis.fetch;
 globalThis.fetch=mockDidit(state);
 try{
  const started=await startTenantIdentity(post('start',{role:'first',
   legalName:'Alice Example',email:'alice@example.com',consent:true}),env);
  const token=(await started.json()).verificationToken;
  const first=(await (await tenantIdentityStatus(post('status',{},token),env)).json());
  assert.equal(first.verified,false);
  await assert.rejects(()=>verifiedTenantIdentity(env,token,{
   role:'first',firstName:'Alice',lastName:'Example',email:'alice@example.com'
  }),/Finish Didit/);
  state.liveness=true;state.name='Different Person';
  const second=await tenantIdentityStatus(post('status',{},token),env);
  // The browser may be asked to retry after rate limiting; direct backend check is definitive.
  assert.equal((await second.json()).verified,false);
  await assert.rejects(()=>verifiedTenantIdentity(env,token,{
   role:'first',firstName:'Alice',lastName:'Example',email:'alice@example.com'
  }),/Finish Didit|does not match/);
 }finally{globalThis.fetch=orig;}
});
test('second applicant Didit session is restricted to private invitation and invited email',async()=>{
 const {env,invites}=mocks(),state={calls:[],name:'Bob Example'},orig=globalThis.fetch;
 globalThis.fetch=mockDidit(state);
 try{
  const privateToken='a'.repeat(64);
  invites.set(await sha(privateToken),{
   reference:'LH-SECOND',second_email:'bob@example.com',status:'invited',
   expires_at:new Date(Date.now()+36*3600000).toISOString()
  });
  const denied=await startTenantIdentity(post('start',{role:'second',legalName:'Bob Example',
   email:'wrong@example.com',invitationToken:privateToken,consent:true}),env);
  assert.equal(denied.status,403);
  const verified=await startTenantIdentity(post('start',{role:'second',legalName:'Bob Example',
   email:'bob@example.com',invitationToken:privateToken,consent:true}),env);
  assert.equal(verified.status,200);
  const token=(await verified.json()).verificationToken;
  const decision=await tenantIdentityStatus(post('status',{},token),env);
  assert.equal((await decision.json()).verified,true);
  const proof=await verifiedTenantIdentity(env,token,{role:'second',
   firstName:'Bob',lastName:'Example',email:'bob@example.com',inviteReference:'LH-SECOND'});
  assert.equal(proof.status,'Approved');
  await assert.rejects(()=>verifiedTenantIdentity(env,token,{role:'second',
   firstName:'Bob',lastName:'Example',email:'bob@example.com',inviteReference:'LH-ANOTHER'}),/match your application/);
 }finally{globalThis.fetch=orig;}
});
test('Didit API key missing Sessions create permission returns actionable error without secrets',async()=>{
 const {env}=mocks(),original=globalThis.fetch;
 globalThis.fetch=async()=>Response.json({
   detail:'This API key has no write access to sessions.'
 },{status:403});
 try{
  const response=await startTenantIdentity(post('start',{
   role:'first',legalName:'Alice Example',email:'alice@example.com',consent:true
  }),env);
  assert.equal(response.status,503);
  const result=await response.json();
  assert.match(result.message,/missing permission to CREATE verification sessions/);
  assert.doesNotMatch(result.message,/unit-test-private-key/);
 }finally{globalThis.fetch=original}
});
test('until Didit credentials exist, legacy ID upload can continue without impersonating verification',async()=>{
 const {env}=mocks();delete env.DIDIT_API_KEY;
 assert.equal(diditTenantReady(env),false);
 const cfg=await (await identityConfig(new Request(url('config')),env)).json();
 assert.equal(cfg.diditAvailable,false);
 assert.equal(cfg.uploadFallback,true);
 const blocked=await startTenantIdentity(post('start',{role:'first',legalName:'Alice Example',email:'alice@example.com',consent:true}),env);
 assert.equal(blocked.status,503);
});
