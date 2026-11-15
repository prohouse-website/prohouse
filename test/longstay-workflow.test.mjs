import test from 'node:test';
import assert from 'node:assert/strict';
import { deflateSync } from 'node:zlib';
import { PDFDocument } from 'pdf-lib';
import { submitLongStayFirst, submitLongStaySecond, getLongStayInvitation } from '../src/longstay-workflow.js';

function crc32(bytes) {
  let c=0xffffffff;
  for(const b of bytes){c^=b;for(let k=0;k<8;k++)c=c&1?(c>>>1)^0xedb88320:c>>>1;}
  return (c^0xffffffff)>>>0;
}
function chunk(type,data) {
  const kind=Buffer.from(type,'ascii'),len=Buffer.alloc(4),crc=Buffer.alloc(4);
  len.writeUInt32BE(data.length);crc.writeUInt32BE(crc32(Buffer.concat([kind,data])));
  return Buffer.concat([len,kind,data,crc]);
}
function samplePNG(){
  const width=32,height=32,raw=[];
  for(let y=0;y<height;y++){
    raw.push(0);
    for(let x=0;x<width;x++) {
      const v=(x*17+y*31+x*y*7)&255;
      raw.push(v,(v*19)&255,(v*37)&255,255);
    }
  }
  const ihdr=Buffer.alloc(13);ihdr.writeUInt32BE(width,0);ihdr.writeUInt32BE(height,4);ihdr[8]=8;ihdr[9]=6;
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',ihdr),chunk('IDAT',deflateSync(Buffer.from(raw))),chunk('IEND',Buffer.alloc(0))]);
}
const png=samplePNG();
const signature='data:image/png;base64,'+png.toString('base64');
assert.ok(signature.length>250);
function buildFirst({second=true,missingDocument=false,wrongRoom=false}={}){
 const f=new FormData();
 const fields={
  people:second?'Two people':'Just me',houseRules:'Yes',firstName:'TEST',lastName:'Applicant',
  email:'first@example.com',phone:'0400000001',occupation:'Student',
  workFromHome:'No',employer:'Test School',income:'450',
  secondEmail:second?'second@example.com':'',
  property:'NSW - Arncliffe Street, Wolli Creek',room:wrongRoom?'Master room with ensuite':'Room 2 (near kitchen)',
  moveIn:'2026-12-10',length:'6 months',weeklyRent:'450',
  payFrequency:'Every 2 weeks',linen:'No, I will use my own',
  declaration:'Yes',privacyConsent:'Yes',signature
 };
 for(const [key,value] of Object.entries(fields))f.append(key,value);
 f.append('photoId1',new File([png],'TEST-photo-id.png',{type:'image/png'}));
 if(!missingDocument)f.append('incomeProof1',new File([png],'TEST-income.png',{type:'image/png'}));
 return f;
}
function buildSecond(token){
 const f=new FormData();
 const fields={
  invitationToken:token,secondFirstName:'TEST SECOND',secondLastName:'Applicant',secondPhone:'0400000002',
  secondOccupation:'Casual employee',secondWorkFromHome:'Sometimes',secondEmployer:'Test Business',
  secondIncome:'550',secondDeclaration:'Yes',secondPrivacyConsent:'Yes',signature
 };
 for(const [key,value] of Object.entries(fields))f.append(key,value);
 f.append('secondId',new File([png],'TEST-second-id.png',{type:'image/png'}));
 f.append('secondIncomeProof',new File([png],'TEST-second-income.png',{type:'image/png'}));
 return f;
}
function makeRequest(path,form,method='POST') {
 return new Request('https://www.prohouse.com.au'+path,{
  method, ...(form?{body:form}:{}),
  headers:{Origin:'https://www.prohouse.com.au'}
 });
}
function mockEnv(){
 const rows=new Map(),sent=[];
 return {
  rows,sent,
  env:{
   RESEND_API_KEY:'unit-test-value',APPLICATION_FROM_EMAIL:'ProHouse TEST <no-reply@prohouse.com.au>',
   PROHOUSE_ADMIN_EMAILS:'hi@prohouse.com.au',
   LONGSTAY_DB:{
    prepare(sql){
     const args={};
     return {bind(...p){args.values=p;return this;},
      async first(){
       if(sql.includes('WHERE invite_hash'))return [...rows.values()].find(x=>x.invite_hash===args.values[0])||null;
       throw Error('Unexpected D1 SELECT '+sql);
      },
      async run(){
       const v=args.values||[];
       if(sql.startsWith('INSERT INTO longstay_applications')) {
        const [reference,first_email,first_name,second_email,invite_hash,first_data,first_signature,status,created_at,expires_at]=v;
        rows.set(reference,{reference,first_email,first_name,second_email,invite_hash,first_data,first_signature,status,created_at,expires_at});
        return {meta:{changes:1}};
       }
       if(sql.startsWith('DELETE FROM longstay_applications')){rows.delete(v[0]);return {meta:{changes:1}}}
       if(sql.includes('SET invitation_sent_at')){rows.get(v[1]).invitation_sent_at=v[0];return {meta:{changes:1}}}
       if(sql.includes("SET status='processing'")){const r=rows.get(v[0]);if(r?.status!=='invited')return {meta:{changes:0}};r.status='processing';return {meta:{changes:1}}}
       if(sql.includes("SET status='completed'")){const r=rows.get(v[1]);r.status='completed';r.first_data=null;r.first_signature=null;r.completed_at=v[0];return {meta:{changes:1}}}
       if(sql.includes("SET status='invited'")){rows.get(v[0]).status='invited';return {meta:{changes:1}}}
       throw Error('Unexpected D1 operation '+sql);
      }}
    }
   }
  }
 };
}
test('required photo ID and income proof are enforced without emailing',async()=>{
 const m=mockEnv(),original=globalThis.fetch;
 globalThis.fetch=async()=>{throw Error('Email should not have been called')};
 try{
  const r=await submitLongStayFirst(makeRequest('/api/longstay/application',buildFirst({missingDocument:true})),m.env);
  assert.equal(r.status,400);assert.match((await r.json()).message,/photo ID and proof of income/i);
  assert.equal(m.rows.size,0);
 }finally{globalThis.fetch=original}
});
test('property and room must match; invalid selection blocked',async()=>{
 const m=mockEnv();
 const r=await submitLongStayFirst(makeRequest('/api/longstay/application',buildFirst({wrongRoom:true})),m.env);
 assert.equal(r.status,400);
 assert.match((await r.json()).message,/room for your selected property/i);
});
test('two applicant lifecycle emails, PDF signatures and D1 cleanup',async()=>{
 const m=mockEnv(),original=globalThis.fetch;
 globalThis.fetch=async(url,options)=>{
  assert.equal(url,'https://api.resend.com/emails');
  const payload=JSON.parse(options.body);m.sent.push(payload);
  return new Response(JSON.stringify({id:'testing-'+m.sent.length}),{status:200,headers:{'Content-Type':'application/json'}});
 };
 try{
  const response=await submitLongStayFirst(makeRequest('/api/longstay/application',buildFirst()),m.env);
  assert.equal(response.status,200);
  const first=await response.json();assert.equal(first.status,'awaiting_second');
  assert.ok(first.reference.startsWith('LH-'));
  assert.equal(m.rows.size,1);
  const firstMail=m.sent.find(x=>x.subject.includes('[1/3 received]'));
  assert.ok(firstMail);assert.equal(firstMail.to[0],'hi@prohouse.com.au');
  assert.equal(firstMail.attachments.length,3); // application PDF, ID, income proof
  assert.ok((await PDFDocument.load(Buffer.from(firstMail.attachments[0].content,'base64'))).getPageCount()>=1);
  const invite=m.sent.find(x=>x.subject.includes('Complete your ProHouse joint application'));
  assert.ok(invite);
  assert.deepEqual(invite.to,['second@example.com']);
  const match=invite.text.match(/#token=([a-f0-9]{64})/);assert.ok(match,'private invitation link missing');
  const token=match[1];
  assert.ok(!invite.text.includes('TEST-photo-id.png')); // no documents shared with second
  const get=await getLongStayInvitation(
    new Request('https://www.prohouse.com.au/api/longstay/invitation?token='+token),m.env);
  assert.equal(get.status,200);
  const preview=await get.json();
  assert.equal(preview.firstApplicant.room,'Room 2 (near kitchen)');
  assert.equal(preview.firstApplicant.income,'450');
  assert.equal(preview.invitedEmail,'second@example.com');
  assert.equal(m.rows.get(first.reference).first_data.includes('TEST-photo-id.png'),false);
  const secondReply=await submitLongStaySecond(makeRequest('/api/longstay/coapplicant',buildSecond(token)),m.env);
  assert.equal(secondReply.status,200);
  const final=await secondReply.json();assert.equal(final.status,'completed');
  const combined=m.sent.find(x=>x.subject.includes('[3/3 complete]'));
  assert.ok(combined);
  assert.equal(combined.attachments.length,3); // combined PDF, second ID, second income proof
  assert.ok((await PDFDocument.load(Buffer.from(combined.attachments[0].content,'base64'))).getPageCount()>=1);
  assert.equal(m.rows.get(first.reference).status,'completed');
  assert.equal(m.rows.get(first.reference).first_data,null);
  assert.equal(m.rows.get(first.reference).first_signature,null);
  assert.ok(m.sent.some(x=>x.subject.includes('Both applicants submitted')));
  assert.ok(m.sent.some(x=>x.subject.includes('Your ProHouse application is complete')));
  const repeat=await submitLongStaySecond(makeRequest('/api/longstay/coapplicant',buildSecond(token)),m.env);
  assert.equal((await repeat.json()).status,'completed');
 }finally{globalThis.fetch=original}
});
test('single applicant receives its confirmation and owner receives uploaded files',async()=>{
 const m=mockEnv(),original=globalThis.fetch;
 globalThis.fetch=async(_url,options)=>{m.sent.push(JSON.parse(options.body));return new Response('{}',{status:200});};
 try{
  const r=await submitLongStayFirst(makeRequest('/api/longstay/application',buildFirst({second:false})),m.env);
  assert.equal((await r.json()).status,'completed');
  assert.equal(m.rows.size,0);
  assert.equal(m.sent.length,2);
  assert.equal(m.sent[0].attachments.length,3);
  assert.deepEqual(m.sent[1].to,['first@example.com']);
 }finally{globalThis.fetch=original}
});
