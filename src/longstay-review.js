// Review is a separate, one-time admin action. No decision is triggered by GET
// or by an email link preview; a button click sends an authenticated-by-link POST.
// The link token is never stored in plain text in D1.
const HEADERS={'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store, private','X-Robots-Tag':'noindex, nofollow','Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff'};
const response=(status,message,extra={})=>new Response(JSON.stringify({message,...extra}),{status,headers:HEADERS});
async function digest(token){
  const bytes=new TextEncoder().encode(token),sha=await crypto.subtle.digest('SHA-256',bytes);
  return [...new Uint8Array(sha)].map(n=>n.toString(16).padStart(2,'0')).join('');
}
const validToken=token=>typeof token==='string'&&/^[a-f0-9]{64}$/.test(token);
async function notify(env,to,subject,text){
  const recipients=Array.isArray(to)?to:[to];
  const result=await fetch('https://api.resend.com/emails',{
    method:'POST',headers:{Authorization:'Bearer '+env.RESEND_API_KEY,'Content-Type':'application/json'},
    body:JSON.stringify({
      from:env.APPLICATION_FROM_EMAIL||'ProHouse <no-reply@prohouse.com.au>',
      to:recipients,subject,text,tags:[{name:'form',value:'livewithus'},{name:'stage',value:'decision'}]
    })
  });
  if(!result.ok)throw Error('Decision email delivery failed: '+result.status);
}
export async function createReview(env,reference,data,request){
  if(!env.LONGSTAY_DB)throw Error('Review database unavailable');
  const token=[...crypto.getRandomValues(new Uint8Array(32))].map(n=>n.toString(16).padStart(2,'0')).join('');
  const hash=await digest(token),now=new Date(),end=new Date(now.getTime()+30*86400000);
  await env.LONGSTAY_DB.prepare(
    'INSERT INTO longstay_reviews (reference,token_hash,status,first_email,second_email,summary_json,created_at,expires_at) VALUES (?,?,?,?,?,?,?,?)'
  ).bind(reference,hash,'pending',data.email,data.people==='Two people'?data.secondEmail:null,
    JSON.stringify(data),now.toISOString(),end.toISOString()).run();
  const url=new URL('/operations/livewithus/review/',new URL(request.url).origin);
  url.hash='token='+token;
  return url.toString();
}
export async function cancelReview(env,reference){
  await env.LONGSTAY_DB.prepare("DELETE FROM longstay_reviews WHERE reference=? AND status='pending'").bind(reference).run();
}
async function findReview(env,token){
  if(!validToken(token)||!env.LONGSTAY_DB)return null;
  return env.LONGSTAY_DB.prepare('SELECT * FROM longstay_reviews WHERE token_hash=?').bind(await digest(token)).first();
}
export async function getLongStayReview(request,env){
  if(request.method!=='GET')return response(405,'Method not allowed.');
  const token=new URL(request.url).searchParams.get('token');
  const row=await findReview(env,token);
  if(!row)return response(404,'Private review link not found.');
  if(row.expires_at<new Date().toISOString())return response(410,'This private review link has expired.');
  let summary;
  try{summary=JSON.parse(row.summary_json);}catch{return response(500,'Review data unavailable.')}
  return response(200,'Review ready.',{
    reference:row.reference,status:row.status,decisionAt:row.decision_at,
    applicant:summary,createdAt:row.created_at,expiresAt:row.expires_at
  });
}
export async function decideLongStayReview(request,env){
  if(request.method!=='POST')return response(405,'Method not allowed.');
  const origin=request.headers.get('Origin');
  if(origin&&origin!==new URL(request.url).origin)return response(403,'Same-origin review required.');
  if(!request.headers.get('Content-Type')?.startsWith('application/json'))return response(415,'JSON required.');
  if(Number(request.headers.get('Content-Length')||0)>1400)return response(413,'Review request too large.');
  let data;
  try{data=await request.json()}catch{return response(400,'Invalid review request.')}
  const token=data?.token,decision=data?.decision;
  if(!validToken(token)||!['approved','rejected'].includes(decision))return response(400,'Invalid review decision.');
  const row=await findReview(env,token);
  if(!row)return response(404,'Review link not found.');
  if(row.expires_at<new Date().toISOString())return response(410,'Review link expired.');
  if(row.status!=='pending')return response(200,'This application was already reviewed.',{reference:row.reference,status:row.status});
  const decisionAt=new Date().toISOString();
  const changed=await env.LONGSTAY_DB.prepare(
    "UPDATE longstay_reviews SET status=?,decision_at=? WHERE reference=? AND status='pending' AND token_hash=?"
  ).bind(decision,decisionAt,row.reference,row.token_hash).run();
  if(!changed.meta?.changes)return response(409,'This application has already been reviewed.');
  const approved=decision==='approved';
  const heading=approved?'Application approved for lease preparation':'Application not approved';
  const note=approved?
    'Your rental application has been approved for the next stage. This is NOT a lease, booking confirmation, or permission to move in. ProHouse will contact you when the actual lease and signing process are ready.':
    'Thank you for your interest. After reviewing the application, ProHouse is unable to proceed with this rental application.';
  const body=heading+'\n\nReference: '+row.reference+'\n\n'+note+'\n\nContact hi@prohouse.com.au with questions.';
  const targets=[row.first_email,...(row.second_email?[row.second_email]:[])];
  let notified=0;
  for(const recipient of targets){
    try{await notify(env,recipient,'ProHouse rental application update | '+row.reference,body);notified++}
    catch(e){console.error('Applicant decision notice failed',row.reference,recipient,e?.message)}
  }
  try{
    const adminEmails=env.PROHOUSE_ADMIN_EMAILS?.split(',').map(x=>x.trim()).filter(Boolean)||['hi@prohouse.com.au'];
    await notify(env,adminEmails,'[REVIEW '+decision.toUpperCase()+'] ProHouse '+row.reference,
      'Decision saved: '+decision+'\nReference: '+row.reference+'\nNotification emails sent: '+notified+'/'+targets.length+'\n'+
      (approved?'Next: provide your lease template and field mapping; no lease has yet been generated or signed.':'No lease will be prepared.'));
  }catch(e){console.error('Admin review confirmation failed',row.reference,e?.message)}
  return response(200,'Review saved.',{reference:row.reference,status:decision,notificationsSent:notified,notificationsTotal:targets.length});
}
