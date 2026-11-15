// Short-lived encrypted application PDF escrow for the 48h co-applicant window.
// Original identity/income documents remain private; neither applicant can GET this file.
// Each encrypted blob is below Cloudflare D1's per-cell size limit.
const CHUNK=768*1024;
const MAX_BYTES=19*1024*1024;
const encoder=new TextEncoder();
function u8(v){
 if(v instanceof Uint8Array)return v;
 if(v instanceof ArrayBuffer)return new Uint8Array(v);
 if(Array.isArray(v))return Uint8Array.from(v);
 throw Error('Stored document bytes have an invalid format.');
}
async function keyFor(env,reference){
 if(!env.RESEND_API_KEY||!reference)throw Error('Document encryption key is unavailable.');
 const base=await crypto.subtle.importKey('raw',encoder.encode(env.RESEND_API_KEY),'HKDF',false,['deriveKey']);
 return crypto.subtle.deriveKey({
  name:'HKDF',hash:'SHA-256',
  salt:encoder.encode('prohouse-application-documents-v1:'+reference),
  info:encoder.encode('first-applicant-combined-pdf')
 },base,{name:'AES-GCM',length:256},false,['encrypt','decrypt']);
}
export async function deleteFirstPackage(env,reference){
 if(!env.LONGSTAY_DB)return;
 await env.LONGSTAY_DB.prepare('DELETE FROM longstay_application_documents WHERE reference=?').bind(reference).run();
}
export async function saveFirstPackage(env,reference,pdf){
 if(!env.LONGSTAY_DB)throw Error('Private application document store is unavailable.');
 const original=u8(pdf);
 if(original.byteLength<12||original.byteLength>MAX_BYTES)
  throw Error('Application PDF is too large for secure temporary storage.');
 if(String.fromCharCode(...original.subarray(0,5))!=='%PDF-')throw Error('Invalid application PDF.');
 const key=await keyFor(env,reference),iv=crypto.getRandomValues(new Uint8Array(12));
 const ciphertext=new Uint8Array(await crypto.subtle.encrypt({name:'AES-GCM',iv},key,original));
 const encrypted=new Uint8Array(iv.length+ciphertext.length);
 encrypted.set(iv);encrypted.set(ciphertext,iv.length);
 await deleteFirstPackage(env,reference);
 try{
  const created=new Date().toISOString();
  for(let i=0,part=0;i<encrypted.length;i+=CHUNK,part++){
   await env.LONGSTAY_DB.prepare(
    'INSERT INTO longstay_application_documents (reference,part,ciphertext,created_at) VALUES (?,?,?,?)'
   ).bind(reference,part,encrypted.slice(i,i+CHUNK),created).run();
  }
 }catch(e){await deleteFirstPackage(env,reference).catch(()=>{});throw e;}
}
export async function loadFirstPackage(env,reference){
 if(!env.LONGSTAY_DB)throw Error('Private document store not available.');
 const count=await env.LONGSTAY_DB.prepare(
  'SELECT COUNT(*) AS chunks FROM longstay_application_documents WHERE reference=?'
 ).bind(reference).first();
 const n=Number(count?.chunks||0);
 if(!n)return null; // old invitations can still fall back to the original email
 if(n>32)throw Error('Unexpected document chunk count.');
 const parts=[];let total=0;
 for(let i=0;i<n;i++){
  const row=await env.LONGSTAY_DB.prepare(
   'SELECT ciphertext FROM longstay_application_documents WHERE reference=? AND part=?'
  ).bind(reference,i).first();
  if(!row?.ciphertext)throw Error('Temporary application document is incomplete.');
  const chunk=u8(row.ciphertext);
  total+=chunk.byteLength;
  if(total>MAX_BYTES+28)throw Error('Temporary document is too large.');
  parts.push(chunk);
 }
 const encrypted=new Uint8Array(total);let p=0;
 for(const part of parts){encrypted.set(part,p);p+=part.byteLength;}
 if(encrypted.length<29)throw Error('Temporary document is incomplete.');
 const key=await keyFor(env,reference);
 const plaintext=await crypto.subtle.decrypt({name:'AES-GCM',iv:encrypted.subarray(0,12)},key,encrypted.subarray(12));
 const pdf=new Uint8Array(plaintext);
 if(String.fromCharCode(...pdf.subarray(0,5))!=='%PDF-')throw Error('Invalid stored PDF.');
 return pdf;
}
