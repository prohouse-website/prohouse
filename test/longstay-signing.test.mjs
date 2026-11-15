import test from 'node:test';
import assert from 'node:assert/strict';
import { PDFDocument } from 'pdf-lib';
import { deflateSync } from 'node:zlib';
import {
 prepareLease,leaseTemplateStatus,packetForAdmin,tenantPacket,leaseDocument,sendLease,tenantSign,
 tenantReportPayment,verifyLeasePayment,verifyPostSigningFunds,requestProviderOtp,signProvider,checkLeaseDeadlines
} from '../src/longstay-signing.js';

const HOST='https://www.prohouse.com.au';
const tokenAdmin='b'.repeat(64);
const uri=(path,token=tokenAdmin)=>new Request(HOST+'/api/longstay/'+path,{
 headers:{Authorization:'Bearer '+token}
});
async function hash(token){
 const b=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(token));
 return [...new Uint8Array(b)].map(x=>x.toString(16).padStart(2,'0')).join('');
}
function crc32(bytes){
 let c=0xffffffff;
 for(const b of bytes){c^=b;for(let k=0;k<8;k++)c=c&1?(c>>>1)^0xedb88320:c>>>1;}
 return(c^0xffffffff)>>>0;
}
function chunk(name,data){const b=Buffer.from(name),len=Buffer.alloc(4),crc=Buffer.alloc(4);
 len.writeUInt32BE(data.length);crc.writeUInt32BE(crc32(Buffer.concat([b,data])));
 return Buffer.concat([len,b,data,crc]);}
const png=(()=>{
 const w=32,h=32,data=[];for(let y=0;y<h;y++){data.push(0);
  for(let x=0;x<w;x++){const v=(x*17+y*31+x*y*7)&255;data.push(v,(v*19)&255,(v*37)&255,255);}}
 const ihdr=Buffer.alloc(13);ihdr.writeUInt32BE(w,0);ihdr.writeUInt32BE(h,4);ihdr[8]=8;ihdr[9]=6;
 return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',ihdr),
  chunk('IDAT',deflateSync(Buffer.from(data))),chunk('IEND',Buffer.alloc(0))]);
})();
const sig='data:image/png;base64,'+png.toString('base64');
function mockApp(){
 const app={people:'Two people',firstName:'ALICE',lastName:'EXAMPLE',
  email:'alice@example.com',phone:'0400111111',secondFirstName:'BOB',secondLastName:'EXAMPLE',
  secondEmail:'bob@example.com',secondPhone:'0400222222',room:'Room 1',
  property:'NSW - Arncliffe Street, Wolli Creek',weeklyRent:'450',moveIn:'2026-12-10',length:'6 months',
  payFrequency:'Every 2 weeks'};
 const reviews=new Map(),packets=new Map(),templates=new Map(),sent=[];
 const review={reference:'LH-TEST-LEASE',token_hash:'',status:'approved',
  expires_at:new Date(Date.now()+30*86400000).toISOString(),summary_json:JSON.stringify(app)};
 return {app,reviews,packets,templates,sent,review,
  env:{RESEND_API_KEY:'unit-key',APPLICATION_FROM_EMAIL:'ProHouse <no-reply@prohouse.com.au>',
   PROHOUSE_ADMIN_EMAILS:'hi@prohouse.com.au',
   LONGSTAY_DB:{prepare(sql){
    let params=[];
    return {bind(...items){params=items;return this;},
     async first(){
      if(sql.includes('FROM longstay_reviews WHERE token_hash='))return [...reviews.values()].find(x=>x.token_hash===params[0])||null;
      if(sql.includes('FROM longstay_lease_packets WHERE reference='))return packets.get(params[0])||null;
      if(sql.includes('FROM longstay_lease_packets WHERE first_token_hash='))return [...packets.values()].find(x=>x.first_token_hash===params[0]||x.second_token_hash===params[1])||null;
      if(sql.includes('FROM longstay_lease_templates WHERE template_name='))return templates.has(params[0])?{template_bytes:[...templates.get(params[0])]}:null;
      throw Error('Unsupported first SQL: '+sql);
     },
     async run(){
      const p=params;
      if(sql.startsWith('INSERT INTO longstay_lease_templates')){
       templates.set(p[0],p[1]);return{meta:{changes:1}};
      }
      if(sql.startsWith('INSERT INTO longstay_lease_packets')){
       const [reference,status,application_json,settings_json,draft_pdf,created_at,updated_at]=p;
       const prev=packets.get(reference);
       packets.set(reference,{...(prev||{}),reference,status,application_json,settings_json,draft_pdf,created_at,updated_at});
       return{meta:{changes:1}};
      }
      const entry=packets.get(p.find(x=>typeof x==='string'&&x.startsWith('LH-')))||packets.values().next().value;
      if(sql.includes("status='sent',lease_pdf=")){
       if(entry.status!=='draft')return{meta:{changes:0}};
       Object.assign(entry,{status:'sent',lease_pdf:p[0],first_token_hash:p[1],second_token_hash:p[2],
        sent_at:p[3],deadline_at:p[4],updated_at:p[5]});
       return{meta:{changes:1}};
      }
      if(sql.includes("SET first_signature=")||sql.includes("SET second_signature=")){
       const key=sql.includes('first_signature')?'first':'second';
       entry[key+'_signature']=p[0];entry[key+'_signed_at']=p[1];entry.updated_at=p[2];
       return{meta:{changes:1}};
      }
      if(sql.includes("status='tenants_signed'")){
       entry.status='tenants_signed';return{meta:{changes:1}};
      }
      if(sql.includes('SET payment_reported_at=')){
       entry.payment_reported_at=p[0];entry.payment_reference=p[1];return{meta:{changes:1}};
      }
      if(sql.includes('SET second_week_verified_at=')){
       entry.second_week_verified_at=p[0];entry.second_week_verified_by=p[1];return{meta:{changes:1}};
      }
      if(sql.includes('SET bond_record_verified_at=')){
       entry.bond_record_verified_at=p[0];entry.bond_record_verified_by=p[1];entry.bond_reference=p[2];
       return{meta:{changes:1}};
      }
      if(sql.includes('SET payment_verified_at=')){
       entry.payment_verified_at=p[0];entry.payment_verified_by=p[1];return{meta:{changes:1}};
      }
      if(sql.includes('SET provider_otp_hash=')){
       entry.provider_otp_hash=p[0];entry.provider_otp_expires=p[1];entry.provider_otp_sent=p[2];entry.provider_otp_attempts=0;
       return{meta:{changes:1}};
      }
      if(sql.includes('SET provider_otp_attempts=')){entry.provider_otp_attempts=(entry.provider_otp_attempts||0)+1;return{meta:{changes:1}};}
      if(sql.includes("SET status='provider_signing'")){
       entry.status='provider_signing';entry.provider_signature=p[0];entry.provider_signed_at=p[1];return{meta:{changes:1}};
      }
      if(sql.includes("status='completed'")){
       entry.status='completed';entry.final_pdf=p[0];entry.completed_at=p[1];return{meta:{changes:1}};
      }
      if(sql.includes("status='expired'")){entry.status='expired';return{meta:{changes:1}};}
      throw Error('Unsupported run SQL: '+sql);
     },
     async all(){
      if(sql.includes('FROM longstay_lease_packets WHERE status IN')){
       return{results:[...packets.values()].filter(x=>['sent','tenants_signed'].includes(x.status)&&x.deadline_at<params[0])};
      }
      throw Error('Unsupported all SQL: '+sql);
     }
    };
   }}
  }};
}
function json(path,data,token=tokenAdmin){
 return new Request(HOST+'/api/longstay/'+path,{
  method:'POST',headers:{Origin:HOST,'Content-Type':'application/json',Authorization:'Bearer '+token},
  body:JSON.stringify(data)});
}
function formRequest(path,form){
 return new Request(HOST+'/api/longstay/'+path,{
  method:'POST',body:form,headers:{Origin:HOST,Authorization:'Bearer '+tokenAdmin}
 });
}
function leaseForm(pdf){
 const f=new FormData();
 const data={guest1Name:'ALICE EXAMPLE',guest1Email:'alice@example.com',guest1Phone:'0400111111',
  guest2Name:'BOB EXAMPLE',guest2Email:'bob@example.com',guest2Phone:'0400222222',
  fullAddress:'G01/52-62 Arncliffe Street, Wolli Creek NSW 2205',rentedArea:'Room 1',
  acceptedWeeklyRent:'450.00',leaseStart:'2026-12-10',leaseEnd:'2027-06-09',
  cleaningBond:'0',holdingFund:'0',bondAmount:'1800.00',rentFrequency:'Every 2 weeks',
  internet:'$30 per calendar month',electricity:'Equally split',water:'Equally split',
  bankDetails:'067 873 - 1998 7232',payId:'hi@prohouse.com.au',providerSigner:'CU NGUYEN'};
 for(const [k,v] of Object.entries(data))f.set(k,v);
 f.set('saveTemplate','Yes');
 f.set('template',new File([pdf],'reviewed-mutual.pdf',{type:'application/pdf'}));
 return f;
}
test('lease editor -> preview -> separate tenant signing -> bank confirmation -> provider signature',async()=>{
 const mock=mockApp(),originalFetch=globalThis.fetch;
 mock.review.token_hash=await hash(tokenAdmin);
 mock.reviews.set(mock.review.reference,mock.review);
 const source=await PDFDocument.create();
 for(let i=0;i<6;i++)source.addPage([595.3,841.9]);
 const template=await source.save();
 globalThis.fetch=async(url,opts)=>{
  assert.equal(String(url),'https://api.resend.com/emails');
  const mail=JSON.parse(opts.body);mock.sent.push(mail);
  return Response.json({id:'a'.repeat(36)});
 };
 try{
  const emptyStatus=await leaseTemplateStatus(uri('lease-template-status'),mock.env);
  assert.equal((await emptyStatus.json()).templateSaved,false);
  const result=await prepareLease(formRequest('lease-prepare',leaseForm(template)),mock.env);
  assert.equal(result.status,200,await result.text().catch(()=>'')); // test won't leak data
  assert.equal((await packetForAdmin(uri('lease-status'),mock.env)).status,200);
  assert.ok(mock.templates.has('mutual-agreement-v10'));
  const templateStatus=await leaseTemplateStatus(uri('lease-template-status'),mock.env);
  assert.equal((await templateStatus.json()).templateSaved,true);
  const preview=await leaseDocument(uri('lease-pdf'),mock.env);
  assert.equal(preview.status,200);
  assert.equal((await PDFDocument.load(await preview.arrayBuffer())).getPageCount(),6);
  const premature=await sendLease(json('lease-send',{confirmLeaseReviewed:false}),mock.env);
  assert.equal(premature.status,400);
  const sent=await sendLease(json('lease-send',{
   confirmLeaseReviewed:true,confirmTermsFinal:true,confirm24Hours:true}),mock.env);
  assert.equal(sent.status,200,JSON.stringify(await sent.json()));
  const packet=mock.packets.get(mock.review.reference);
  assert.equal(packet.status,'sent');assert.ok(packet.first_token_hash&&packet.second_token_hash);
  assert.ok(new Date(packet.deadline_at).getTime()-Date.now()<=24*3600000+15000);
  const invited=mock.sent.filter(x=>x.subject.startsWith('Congratulations! Sign your ProHouse lease'));
  assert.ok(invited.every(x=>x.text.includes('SCHEDULE A, the LAST PAGE')));
  assert.ok(invited.every(x=>x.text.toLowerCase().includes('commonwealth bank')));
  assert.ok(invited.every(x=>x.text.includes('ONE WEEK of rent')));
  assert.ok(invited.every(x=>x.text.includes('CANCELLATION / WITHDRAWAL')));
  assert.ok(invited.every(x=>x.text.includes('not legally owed will be returned')));
  assert.ok(invited.every(x=>x.text.includes('BEFORE the ProHouse signature')));
  assert.equal(invited.length,2);
  const inviteToken=(mail)=>mail.text.match(/#token=([a-f0-9]{64})/)[1];
  const t1=inviteToken(invited[0]),t2=inviteToken(invited[1]);
  const first=await tenantPacket(uri('tenant',t1),mock.env);
  assert.equal((await first.json()).legalName,'ALICE EXAMPLE');
  const shown=await leaseDocument(uri('lease-pdf',t2),mock.env);assert.equal(shown.status,200);
  const wrong=await tenantSign(json('tenant-sign',{legalName:'Wrong Person',readAllPages:true,
    agreeElectronicSign:true,agreeTerms:true,acknowledgeWithdrawalTerms:true,signature:sig},t1),mock.env);assert.equal(wrong.status,400);
  const missingAcknowledgement=await tenantSign(json('tenant-sign',{legalName:'ALICE EXAMPLE',readAllPages:true,
    agreeElectronicSign:true,agreeTerms:true,signature:sig},t1),mock.env);
  assert.equal(missingAcknowledgement.status,400);
  const signed1=await tenantSign(json('tenant-sign',{legalName:'ALICE EXAMPLE',readAllPages:true,
    agreeElectronicSign:true,agreeTerms:true,acknowledgeWithdrawalTerms:true,signature:sig},t1),mock.env);
  assert.equal(signed1.status,200);
  const signed2=await tenantSign(json('tenant-sign',{legalName:'BOB EXAMPLE',readAllPages:true,
    agreeElectronicSign:true,agreeTerms:true,acknowledgeWithdrawalTerms:true,signature:sig},t2),mock.env);
  assert.equal(signed2.status,200);
  assert.equal(mock.packets.get(mock.review.reference).status,'tenants_signed');
  const prematureProvider=await signProvider(json('provider-sign',{providerName:'CU NGUYEN',
   confirmRead:true,signature:sig}),mock.env);assert.equal(prematureProvider.status,409);
  const reported=await tenantReportPayment(json('tenant-payment',{
   confirmPaid:true,transactionReference:'BANK-TXN-123456'},t1),mock.env);
  assert.equal(reported.status,200);
  const wrongPaid=await verifyLeasePayment(json('payment-verify',{
   verifiedAmount:'400.00',verifiedBy:'Admin',confirmBankStatement:true}),mock.env);
  assert.equal(wrongPaid.status,400);
  const verified=await verifyLeasePayment(json('payment-verify',{
   verifiedAmount:'450.00',verifiedBy:'ProHouse Admin',confirmBankStatement:true}),mock.env);
  assert.equal(verified.status,200);
  const requested=await requestProviderOtp(json('provider-otp',{}),mock.env);
  assert.equal(requested.status,200);
  const codeEmail=mock.sent.find(x=>x.subject.includes('countersignature code'));
  assert.ok(codeEmail);
  const code=codeEmail.text.match(/six-digit signing code is: ([0-9]{6})/)[1];
  const badCode=await signProvider(json('provider-sign',{
   providerName:'CU NGUYEN',confirmRead:true,signature:sig,verificationCode:'000000'===code?'111111':'000000'
  }),mock.env);
  assert.equal(badCode.status,403);
  const provider=await signProvider(json('provider-sign',{
   providerName:'CU NGUYEN',confirmRead:true,signature:sig,verificationCode:code}),mock.env);
  assert.equal(provider.status,200,JSON.stringify(await provider.json()));
  assert.equal(mock.packets.get(mock.review.reference).status,'completed');
  const final=await leaseDocument(uri('lease-pdf',t1),mock.env);
  assert.equal((await PDFDocument.load(await final.arrayBuffer())).getPageCount(),7);
  const completeEmails=mock.sent.filter(x=>x.subject.startsWith('Your fully signed'));
  assert.equal(completeEmails.length,2);
  assert.ok(completeEmails.every(x=>x.attachments.length===1));
  assert.ok(completeEmails.every(x=>x.text.includes('RENTAL BOND: AUD $1800.00')));
  assert.ok(completeEmails.every(x=>x.text.includes('SECOND WEEK OF RENT: AUD $450.00')));
  assert.ok(completeEmails.every(x=>x.text.includes('CLEARED and is VISIBLE in the ProHouse bank account')));
  assert.ok(completeEmails.every(x=>x.text.includes('LAST PAGE')));
  const initialStatus=await (await packetForAdmin(uri('lease-status'),mock.env)).json();
  assert.equal(initialStatus.keyCollectionFinancialChecksComplete,false);
  const earlyBond=await verifyPostSigningFunds(json('postsign-verify',{
   kind:'bond',amount:'1800.00',verifiedBy:'ProHouse Manager',
   bondReference:'RBO-987654',confirmBondReceipt:true
  }),mock.env);
  assert.equal(earlyBond.status,200);
  assert.equal((await earlyBond.json()).keyCollectionFinancialChecksComplete,false);
  const incorrectSecond=await verifyPostSigningFunds(json('postsign-verify',{
   kind:'second_week',amount:'400.00',verifiedBy:'ProHouse Manager',confirmVisibleInBank:true
  }),mock.env);
  assert.equal(incorrectSecond.status,400);
  const secondWeek=await verifyPostSigningFunds(json('postsign-verify',{
   kind:'second_week',amount:'450.00',verifiedBy:'ProHouse Manager',confirmVisibleInBank:true
  }),mock.env);
  assert.equal(secondWeek.status,200);
  assert.equal((await secondWeek.json()).keyCollectionFinancialChecksComplete,true);
  const finalStatus=await (await packetForAdmin(uri('lease-status'),mock.env)).json();
  assert.equal(finalStatus.secondWeekVerified,true);
  assert.equal(finalStatus.bondVerified,true);
  assert.equal(finalStatus.keyCollectionFinancialChecksComplete,true);
 }finally{globalThis.fetch=originalFetch}
});
test('24-hour expiration locks unsigned lease and alerts ProHouse',async()=>{
 const m=mockApp(),originalFetch=globalThis.fetch;
 globalThis.fetch=async(url,opts)=>{
  m.sent.push(JSON.parse(opts.body));return Response.json({id:'test-email'});
 };
 try{
  const now=new Date().toISOString(),previous=new Date(Date.now()-120000).toISOString();
  m.packets.set('LH-EXPIRED',{reference:'LH-EXPIRED',status:'sent',
   deadline_at:previous,application_json:JSON.stringify(m.app),settings_json:JSON.stringify({
    guest1Name:'ALICE EXAMPLE',guest1Email:m.app.email}),first_signed_at:null,second_signed_at:null,
    payment_reported_at:null});
  await checkLeaseDeadlines(m.env);
  assert.equal(m.packets.get('LH-EXPIRED').status,'expired');
  assert.ok(m.sent.some(x=>x.subject.includes('24H DEADLINE PASSED')));
 }finally{globalThis.fetch=originalFetch}
});
