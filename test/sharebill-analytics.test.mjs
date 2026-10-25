import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {usageEvent,logShareBillEvent,compileUsageReport,sendShareBillDailySummary} from '../src/sharebill-analytics.js';

const createDB=()=>{
  const events=[],reports=new Map(),operations=[];
  return {
    events,reports,operations,
    prepare(sql){
      const entry={sql,values:[]};operations.push(entry);
      return {
        bind(...values){entry.values=values;return this;},
        async run(){
          if(sql.startsWith('INSERT INTO sharebill_usage')){
            events.push({day:entry.values[0],time:entry.values[1],type:entry.values[2]});
            return {meta:{changes:1}};
          }
          if(sql.startsWith('INSERT OR IGNORE INTO sharebill_email_reports')){
            if(reports.has(entry.values[0]))return {meta:{changes:0}};
            reports.set(entry.values[0],entry.values[1]);return {meta:{changes:1}};
          }
          if(sql.startsWith('DELETE FROM sharebill_email_reports WHERE event_day=?')){
            reports.delete(entry.values[0]);return {meta:{changes:1}};
          }
          return {meta:{changes:1}};
        },
        async all(){
          const rows=events.filter(e=>e.day>=entry.values[0]&&e.day<=entry.values[1]);
          const counts=new Map();
          for(const e of rows){
            const k=e.day+'|'+e.type;counts.set(k,(counts.get(k)||0)+1);
          }
          return {results:[...counts].map(([k,count])=>({
            event_day:k.split('|')[0],event_type:k.split('|')[1],count
          }))};
        }
      };
    }
  };
};
const makeEvent=(data,headers={})=>new Request('https://www.prohouse.com.au/api/sharebill/usage',{
  method:'POST',headers:{Origin:'https://www.prohouse.com.au','Content-Type':'application/json',...headers},
  body:JSON.stringify(data)
});
test('records only anonymous event type and timestamp; no payload details',async()=>{
  const db=createDB(),env={SHAREBILL_ANALYTICS_DB:db,SHAREBILL_USAGE_LIMIT:{limit:async()=>({success:true})}};
  const response=await usageEvent(makeEvent({type:'visit'}),env);
  assert.equal(response.status,204);
  assert.equal(db.events.length,1);
  assert.equal(db.events[0].type,'visit');
  assert.deepEqual(Object.keys(db.events[0]),['day','time','type']);
  assert.match(db.events[0].day,/^\d{4}-\d{2}-\d{2}$/);
  const invalid=await usageEvent(makeEvent({type:'visit',tenantName:'PRIVATE'}),env);
  assert.equal(invalid.status,400);assert.equal(db.events.length,1);
});
test('browser cannot forge invoice scans or PDF exports, and cross-origin calls fail',async()=>{
  const db=createDB(),env={SHAREBILL_ANALYTICS_DB:db};
  assert.equal((await usageEvent(makeEvent({type:'scan'}),env)).status,400);
  assert.equal((await usageEvent(makeEvent({type:'pdf_download'}),env)).status,400);
  assert.equal((await usageEvent(makeEvent({type:'visit'},{Origin:'https://evil.example'}),env)).status,403);
  assert.equal(db.events.length,0);
});
test('rate limit suppresses abusive events',async()=>{
  const db=createDB(),env={SHAREBILL_ANALYTICS_DB:db,SHAREBILL_USAGE_LIMIT:{limit:async()=>({success:false})}};
  const response=await usageEvent(makeEvent({type:'calculation'}),env);
  assert.equal(response.status,429);
  assert.equal(db.events.length,0);
});
test('Sydney daily reporting handles daylight savings dates and produces aggregate only',async()=>{
  const db=createDB();
  await logShareBillEvent({SHAREBILL_ANALYTICS_DB:db},'visit',new Date('2026-10-25T12:45:00Z'));
  assert.equal(db.events[0].day,'2026-10-25');
  await logShareBillEvent({SHAREBILL_ANALYTICS_DB:db},'visit',new Date('2026-10-25T13:45:00Z'));
  assert.equal(db.events[1].day,'2026-10-26');
  const report=compileUsageReport([
    {event_day:'2026-10-25',event_type:'visit',count:5},
    {event_day:'2026-10-25',event_type:'calculation',count:3},
    {event_day:'2026-10-25',event_type:'scan',count:2},
    {event_day:'2026-10-24',event_type:'visit',count:4}
  ],'2026-10-25');
  assert.deepEqual(report.today,{visit:5,calculation:3,scan:2,pdf_download:0});
  assert.equal(report.week.visit,9);
  assert.match(report.text,/Page visits: 5/);
  assert.match(report.text,/Calculations per visit: 60%/);
  assert.doesNotMatch(report.text,/Tenant A|Bill Amount:|account number/i);
});
test('daily email sent once; response failures allow retry',async()=>{
  const db=createDB();
  const env={SHAREBILL_ANALYTICS_DB:db,RESEND_API_KEY:'test-secret',ANALYTICS_FROM_EMAIL:'ProHouse Share Bill <no-reply@prohouse.com.au>'};
  await logShareBillEvent(env,'visit',new Date('2026-10-25T00:00:00Z'));
  await logShareBillEvent(env,'calculation',new Date('2026-10-25T00:01:00Z'));
  let sent=0,saved;
  const now=new Date('2026-10-25T23:00:00Z'); // Sydney 26 Oct morning, report 25 Oct
  const send=async(_url,args)=>{
    sent++;saved=JSON.parse(args.body);
    return {ok:true};
  };
  const first=await sendShareBillDailySummary(env,now,send);
  assert.equal(first.sent,true);assert.equal(first.date,'2026-10-25');
  assert.deepEqual([first.counts.visit,first.counts.calculation],[1,1]);
  assert.deepEqual(saved.to,['hi@prohouse.com.au']);
  assert.match(saved.text,/Page visits: 1/);
  const second=await sendShareBillDailySummary(env,now,send);
  assert.equal(second.sent,false);assert.equal(sent,1);
  const failingDb=createDB();
  const failure=await sendShareBillDailySummary({...env,SHAREBILL_ANALYTICS_DB:failingDb},now,async()=>({ok:false,status:500}));
  assert.equal(failure.sent,false);
  assert.equal(failingDb.reports.size,0);
});
test('public page discloses anonymous tracking and privacy policy',()=>{
  const html=readFileSync(new URL('../public/operations/sharebill/index.html',import.meta.url),'utf8');
  const js=readFileSync(new URL('../public/assets/bill-calculator.js',import.meta.url),'utf8');
  const policy=readFileSync(new URL('../public/privacy/index.html',import.meta.url),'utf8');
  assert.match(html,/Anonymous usage statistics/);
  assert.match(html,/href="\/privacy\/"/);
  assert.match(policy,/Free Share Bill Calculator usage statistics/);
  assert.match(js,/sendUsage\('visit'\)/);
  assert.match(js,/sendUsage\('calculation'\)/);
  assert.doesNotMatch(js,/sendUsage\('scan'\)|sendUsage\('pdf_download'\)/);
});
