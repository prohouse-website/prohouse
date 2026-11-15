import test from 'node:test';
import assert from 'node:assert/strict';
import { startSignatureHandoff,signatureHandoffStatus,saveMobileSignature,cleanupSignatureSessions } from '../src/longstay-signature-handoff.js';

const ORIGIN='https://www.prohouse.com.au';
function mock(){
 const signatures=new Map();
 const env={LONGSTAY_DB:{prepare(sql){
  const values=[];
  return {bind(...args){values.push(...args);return this;},
   async first(){
    if(sql.startsWith('SELECT signature,expires_at,signed_at FROM longstay_signature_sessions'))
      return signatures.get(values[0])||null;
    throw Error('Unexpected DB read '+sql);
   },
   async run(){
    if(sql.startsWith('INSERT INTO longstay_signature_sessions')){
     signatures.set(values[0],{signature:null,created_at:values[1],expires_at:values[2],signed_at:null});
     return {meta:{changes:1}};
    }
    if(sql.startsWith('UPDATE longstay_signature_sessions SET signature=')){
     const row=signatures.get(values[2]);
     if(!row||row.signature||row.expires_at<=values[3])return {meta:{changes:0}};
     row.signature=values[0];row.signed_at=values[1];return {meta:{changes:1}};
    }
    if(sql.startsWith('DELETE FROM longstay_signature_sessions')){
     for(const [id,row] of signatures)if(row.expires_at<values[0])signatures.delete(id);
     return {meta:{changes:1}};
    }
    throw Error('Unexpected DB command '+sql);
   }
  };
 }}};
 return {env,signatures};
}
function post(path,payload){
 return new Request(ORIGIN+'/api/longstay/'+path,{method:'POST',headers:{
  Origin:ORIGIN,...(payload?{'Content-Type':'application/json'}:{})
 },...(payload?{body:JSON.stringify(payload)}:{})});
}
function status(token){return new Request(ORIGIN+'/api/longstay/signature-session',
 {headers:{Authorization:'Bearer '+token}});}
test('phone QR signature is private, single use, and imported by laptop with matching token',async()=>{
 const m=mock();
 const begin=await startSignatureHandoff(post('signature-session'),m.env);
 assert.equal(begin.status,200);
 const data=await begin.json();
 assert.match(data.token,/^[a-f0-9]{64}$/);
 assert.match(data.url,/^https:\/\/www\.prohouse\.com\.au\/operations\/livewithus\/sign-on-phone\/#token=/);
 assert.ok(!JSON.stringify([...m.signatures.keys()]).includes(data.token),'database must store only token hash');
 const initial=await (await signatureHandoffStatus(status(data.token),m.env)).json();
 assert.equal(initial.signed,false);
 assert.equal(initial.signature,null);
 const fakePng='data:image/png;base64,'+'A'.repeat(400);
 const sent=await saveMobileSignature(post('signature-save',{token:data.token,signature:fakePng}),m.env);
 assert.equal(sent.status,200);
 const result=await (await signatureHandoffStatus(status(data.token),m.env)).json();
 assert.equal(result.signed,true);assert.equal(result.signature,fakePng);
 const duplicate=await saveMobileSignature(post('signature-save',{token:data.token,signature:fakePng}),m.env);
 assert.equal(duplicate.status,409);
 const invalid=await signatureHandoffStatus(status('1'.repeat(64)),m.env);
 assert.equal(invalid.status,404);
 const hash=[...m.signatures.keys()][0];
 m.signatures.get(hash).expires_at=new Date(Date.now()-60000).toISOString();
 const expired=await signatureHandoffStatus(status(data.token),m.env);
 assert.equal(expired.status,410);
 await cleanupSignatureSessions(m.env);
 assert.equal(m.signatures.size,0);
});
