// QR-based single-use mobile signature handoff. No applicant data or documents
// are sent to the phone, only a fresh 15-minute random one-time session.
const headers={'Cache-Control':'no-store, private','X-Robots-Tag':'noindex, nofollow','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'};
const reply=(status,message,extra={})=>Response.json({message,...extra},{status,headers});
const validToken=t=>typeof t==='string'&&/^[a-f0-9]{64}$/.test(t);
const signatureValid=s=>typeof s==='string'&&/^data:image\/png;base64,[a-zA-Z0-9+/=]+$/.test(s)&&s.length>=250&&s.length<=550000;
async function hash(t){
 const sha=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(t));
 return [...new Uint8Array(sha)].map(n=>n.toString(16).padStart(2,'0')).join('');
}
export async function startSignatureHandoff(request,env){
 if(request.method!=='POST')return reply(405,'Method not allowed.');
 if(request.headers.get('Origin')!==new URL(request.url).origin)return reply(403,'Signature session must start on ProHouse.');
 if(!env.LONGSTAY_DB)return reply(503,'Signature transfer service is unavailable.');
 if(env.LONGSTAY_FORM_LIMIT){
  const ip=request.headers.get('CF-Connecting-IP')||'unknown';
  const limit=await env.LONGSTAY_FORM_LIMIT.limit({key:'longstay-sign:'+ip});
  if(!limit.success)return reply(429,'Too many signature links requested. Please try again shortly.');
 }
 const token=[...crypto.getRandomValues(new Uint8Array(32))].map(n=>n.toString(16).padStart(2,'0')).join('');
 const now=new Date(),expiry=new Date(now.getTime()+15*60000);
 await env.LONGSTAY_DB.prepare('INSERT INTO longstay_signature_sessions (token_hash,created_at,expires_at) VALUES (?,?,?)')
   .bind(await hash(token),now.toISOString(),expiry.toISOString()).run();
 const url=new URL('/operations/livewithus/sign-on-phone/',request.url);
 url.hash='token='+token;
 return reply(200,'Scan this private QR to sign on your phone.',{token,url:url.toString(),expiresAt:expiry.toISOString()});
}
export async function signatureHandoffStatus(request,env){
 if(request.method!=='GET')return reply(405,'Method not allowed.');
 if(!env.LONGSTAY_DB)return reply(503,'Signature transfer service is unavailable.');
 const token=(request.headers.get('Authorization')||'').replace(/^Bearer\s+/i,'').trim();
 if(!validToken(token))return reply(400,'Invalid signature link.');
 const row=await env.LONGSTAY_DB.prepare('SELECT signature,expires_at,signed_at FROM longstay_signature_sessions WHERE token_hash=?')
   .bind(await hash(token)).first();
 if(!row)return reply(404,'Signature link was not found.');
 if(row.expires_at<new Date().toISOString())return reply(410,'Signature link expired. Create another QR.');
 return reply(200,'Signature session ready.',{signed:!!row.signed_at,signature:row.signature||null});
}
export async function saveMobileSignature(request,env){
 if(request.method!=='POST')return reply(405,'Method not allowed.');
 if(request.headers.get('Origin')!==new URL(request.url).origin)return reply(403,'Use the ProHouse mobile signature page.');
 if(Number(request.headers.get('Content-Length')||0)>600000)return reply(413,'Signature image is too large.');
 if(!request.headers.get('Content-Type')?.startsWith('application/json'))return reply(415,'JSON required.');
 if(!env.LONGSTAY_DB)return reply(503,'Signature transfer unavailable.');
 let body;try{body=await request.json()}catch{return reply(400,'Invalid signature request.');}
 if(!validToken(body?.token)||!signatureValid(body?.signature))
  return reply(400,'Please draw your signature and submit from the mobile signing page.');
 const now=new Date().toISOString();
 const result=await env.LONGSTAY_DB.prepare(
  'UPDATE longstay_signature_sessions SET signature=?,signed_at=? WHERE token_hash=? AND signature IS NULL AND expires_at>?'
 ).bind(body.signature,now,await hash(body.token),now).run();
 if(!result.meta?.changes)return reply(409,'This link is expired or already used. Generate another QR if needed.');
 return reply(200,'Signature transferred. Return to the laptop and complete your application.',{status:'signed'});
}
export async function cleanupSignatureSessions(env){
 if(env.LONGSTAY_DB)await env.LONGSTAY_DB.prepare('DELETE FROM longstay_signature_sessions WHERE expires_at<?')
   .bind(new Date().toISOString()).run();
}
