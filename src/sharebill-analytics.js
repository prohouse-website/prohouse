// Privacy-first, anonymous Share Bill usage metrics.
// Stores only the event type and time: never bill amounts, tenant names,
// invoice text, uploaded documents, IP addresses, cookies or device IDs.
const ALLOWED = new Set(['visit','calculation','scan','pdf_download']);
const CLIENT_ALLOWED = new Set(['visit','calculation']);
const ADMIN_EMAIL = 'hi@prohouse.com.au';
const HEADER = {'Cache-Control':'no-store','X-Robots-Tag':'noindex, nofollow','Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff'};
function dateSydney(when) {
  const parts=new Intl.DateTimeFormat('en-GB',{timeZone:'Australia/Sydney',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(when);
  const p=Object.fromEntries(parts.map(x=>[x.type,x.value]));
  return p.year+'-'+p.month+'-'+p.day;
}
const emptyCounts=()=>({visit:0,calculation:0,scan:0,pdf_download:0});
function humanDay(day){
  return new Date(day+'T00:00:00Z').toLocaleDateString('en-AU',{
    timeZone:'UTC',day:'numeric',month:'short',year:'numeric'});
}
export async function logShareBillEvent(env,type,now=new Date()){
  if(!ALLOWED.has(type))throw new Error('Unsupported analytics event');
  if(!env.SHAREBILL_ANALYTICS_DB)return false;
  await env.SHAREBILL_ANALYTICS_DB.prepare(
    'INSERT INTO sharebill_usage (event_day, event_time, event_type) VALUES (?, ?, ?)'
  ).bind(dateSydney(now),now.toISOString(),type).run();
  return true;
}
export async function usageEvent(request,env){
  if(request.method!=='POST')return new Response(null,{status:405,headers:{...HEADER,Allow:'POST'}});
  if(request.headers.get('Origin')!==new URL(request.url).origin)
    return Response.json({error:'Same-origin requests only.'},{status:403,headers:HEADER});
  if(!String(request.headers.get('Content-Type')||'').toLowerCase().startsWith('application/json'))
    return Response.json({error:'JSON required.'},{status:415,headers:HEADER});
  if(Number(request.headers.get('Content-Length')||0)>256)
    return Response.json({error:'Event too large.'},{status:413,headers:HEADER});
  const body=await request.text();
  if(body.length>256)return Response.json({error:'Event too large.'},{status:413,headers:HEADER});
  let parsed;
  try{parsed=JSON.parse(body);}catch{return Response.json({error:'Invalid event.'},{status:400,headers:HEADER});}
  if(!parsed||typeof parsed!=='object'||Array.isArray(parsed)||
     Object.keys(parsed).length!==1||!CLIENT_ALLOWED.has(parsed.type))
    return Response.json({error:'Invalid event type.'},{status:400,headers:HEADER});
  try{
    if(env.SHAREBILL_USAGE_LIMIT){
      // IP used solely by edge rate limiter and is never added to the database.
      const ip=request.headers.get('CF-Connecting-IP')||'anonymous';
      const {success}=await env.SHAREBILL_USAGE_LIMIT.limit({key:'sharebill-usage:'+ip});
      if(!success)return new Response(null,{status:429,headers:HEADER});
    }
    if(!await logShareBillEvent(env,parsed.type))
      return Response.json({error:'Usage tracking is not configured.'},{status:503,headers:HEADER});
    return new Response(null,{status:204,headers:HEADER});
  }catch{
    return Response.json({error:'Could not record usage.'},{status:503,headers:HEADER});
  }
}
export function compileUsageReport(rows,day){
  const today=emptyCounts();
  const days=new Map();
  for(const row of rows||[]){
    const key=String(row.event_day);
    if(!/^\d{4}-\d{2}-\d{2}$/.test(key)||!ALLOWED.has(row.event_type))continue;
    if(!days.has(key))days.set(key,emptyCounts());
    const n=Math.max(0,Number(row.count)||0);
    days.get(key)[row.event_type]+=n;
    if(key===day)today[row.event_type]+=n;
  }
  const week=emptyCounts();
  for(const counts of days.values())for(const key of ALLOWED)week[key]+=counts[key];
  const conversion=today.visit?Math.round(today.calculation/today.visit*100):null;
  const lines=[
    'ProHouse Share Bill Calculator - daily usage',
    'Day: '+humanDay(day)+' (Australia/Sydney)',
    'Page visits: '+today.visit,
    'Completed calculations: '+today.calculation,
    'Successful invoice scans: '+today.scan,
    'Successful PDF exports/previews: '+today.pdf_download,
    'Calculations per visit: '+(conversion===null?'N/A':conversion+'%'),
    '',
    'Last 7 days, including this day:',
    'Visits: '+week.visit,
    'Calculations: '+week.calculation,
    'Invoice scans: '+week.scan,
    'PDF exports/previews: '+week.pdf_download,
    '',
    'Daily visits:',
    ...[...days.keys()].sort().reverse().map(k=>humanDay(k)+': '+days.get(k).visit),
    '',
    'This report contains anonymous usage totals only. No guest/tenant details,',
    'bill amounts, file contents, device identifiers, or IP addresses are stored.',
    'Visits are browser-tab sessions, not guaranteed unique people.',
    'Actions can exceed visits when one visitor calculates multiple times.',
    '',
    'Calculator: https://www.prohouse.com.au/operations/sharebill/'
  ];
  return {today,week,text:lines.join('\n')};
}
export async function sendShareBillDailySummary(env,now=new Date(),fetcher=fetch){
  if(!env.SHAREBILL_ANALYTICS_DB)return {sent:false,reason:'No analytics database'};
  if(!env.RESEND_API_KEY || !env.ANALYTICS_FROM_EMAIL)return {sent:false,reason:'Email not configured'};
  const yesterday=new Date(now.getTime()-86400000);
  const date=dateSydney(yesterday);
  // Last 7 complete calendar days through yesterday.
  const earliest=dateSydney(new Date(now.getTime()-7*86400000));
  const db=env.SHAREBILL_ANALYTICS_DB;
  const rows=await db.prepare(
    'SELECT event_day, event_type, COUNT(*) AS count FROM sharebill_usage WHERE event_day >= ? AND event_day <= ? GROUP BY event_day, event_type ORDER BY event_day'
  ).bind(earliest,date).all();
  const report=compileUsageReport(rows.results||[],date);
  const claimed=await db.prepare(
    'INSERT OR IGNORE INTO sharebill_email_reports (event_day,sent_at) VALUES (?,?)'
  ).bind(date,now.toISOString()).run();
  if((claimed.meta?.changes??0)===0)return {sent:false,reason:'Already emailed',date};
  try{
    const response=await fetcher('https://api.resend.com/emails',{
      method:'POST',
      headers:{Authorization:'Bearer '+env.RESEND_API_KEY,'Content-Type':'application/json'},
      body:JSON.stringify({
        from:env.ANALYTICS_FROM_EMAIL,
        to:[ADMIN_EMAIL],
        subject:'ProHouse Share Bill usage — '+humanDay(date),
        text:report.text
      })
    });
    if(!response.ok)throw new Error('Email provider returned '+response.status);
    // Remove counts older than 90 days, but leave email dedupe rows for 120 days.
    const cutoff=dateSydney(new Date(now.getTime()-90*86400000));
    const emailCutoff=dateSydney(new Date(now.getTime()-120*86400000));
    try {
      await db.prepare('DELETE FROM sharebill_usage WHERE event_day < ?').bind(cutoff).run();
      await db.prepare('DELETE FROM sharebill_email_reports WHERE event_day < ?').bind(emailCutoff).run();
    } catch {
      // An already-sent email must never be resent because housekeeping failed.
      console.warn('Share Bill analytics retention cleanup failed');
    }
    return {sent:true,date,counts:report.today};
  }catch{
    await db.prepare('DELETE FROM sharebill_email_reports WHERE event_day=?').bind(date).run();
    return {sent:false,reason:'Could not send daily summary',date};
  }
}
