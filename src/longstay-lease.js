import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { findReview } from './longstay-review.js';

// The source PDF is the six-page conversion of the DOCX supplied by ProHouse.
// Only Schedule A (the final page) receives filled values. The first five pages
// remain untouched except for a conspicuous non-signable draft footer.
const MAX_PDF_BYTES=3*1024*1024;
const HDR={'Cache-Control':'no-store, private','X-Content-Type-Options':'nosniff','X-Robots-Tag':'noindex, nofollow','Referrer-Policy':'no-referrer'};
const json=(status,message)=>Response.json({message},{status,headers:HDR});
const text=(val,max=200)=>typeof val==='string'?val.trim().slice(0,max):'';
const ascii=v=>String(v||'').normalize('NFKD').replace(/[\u0300-\u036f]/g,'')
  .replace(/[^\x20-\x7e]/g,'?');
const validMoney=v=>/^\d+(\.\d{1,2})?$/.test(v)&&Number(v)<100000;
const validDate=v=>/^\d{4}-\d{2}-\d{2}$/.test(v)&&!Number.isNaN(Date.parse(v+'T12:00:00Z'));
const money=v=>'$'+Number(v).toFixed(2);
const date=v=>{const [y,m,d]=v.split('-');return d+'/'+m+'/'+y;};
function compose(data,settings){
 const names=settings.guest1Name||[data.firstName,data.lastName].filter(Boolean).join(' ').trim();
 const second=settings.guest2Name||(data.people==='Two people'?[data.secondFirstName,data.secondLastName].filter(Boolean).join(' ').trim():'');
 const guests=[names,second].filter(Boolean).join('  /  ');
 const emails=[settings.guest1Email||data.email,data.people==='Two people'?(settings.guest2Email||data.secondEmail):''].filter(Boolean).join('  /  ');
 const phones=[settings.guest1Phone||data.phone,data.people==='Two people'?(settings.guest2Phone||data.secondPhone):''].filter(Boolean).join('  /  ');
 return {guests,emails,phones,
   address:settings.fullAddress,
   rentedArea:settings.rentedArea||(data.room==='Other'?data.roomOther:data.room),
   rent:money(settings.acceptedWeeklyRent)+' per week',
   frequency:settings.rentFrequency,
   internet:settings.internet,
   electricity:settings.electricity,
   water:settings.water,
   bankDetails:settings.bankDetails,
   payId:settings.payId||'hi@prohouse.com.au',
   start:date(settings.leaseStart),end:date(settings.leaseEnd),
   bond:money(settings.cleaningBond),
   holding:money(settings.holdingFund),
   guest1:names,guest2:second,
   providerSigner:settings.providerSigner
 };
}
export async function fillMutualAgreementPDF(templateBytes,data,settings,reference,options={draft:true}){
 const doc=await PDFDocument.load(templateBytes,{ignoreEncryption:false});
 if(doc.getPageCount()!==6)throw Error('Template must be the six-page ProHouse mutual agreement PDF.');
 const last=doc.getPage(5),regular=await doc.embedFont(StandardFonts.Helvetica);
 const bold=await doc.embedFont(StandardFonts.HelveticaBold);
 const pageHeight=last.getHeight();
 if(pageHeight<820||pageHeight>860)throw Error('Incorrect template page size.');
 const color=rgb(.12,.17,.14);
 const words=compose(data,settings);
 // top is baseline measured from top edge of the original A4 PDF.
 const rows=[
  [169,words.guests],[181,words.emails],[194,words.phones],
  [220,words.address],[233,words.rentedArea],[269,words.rent],
  [281,words.frequency],[293,words.internet],[306,words.electricity],
  [318,words.water],[342,words.payId],[354,words.bankDetails],[380,words.start],
  [392,words.end],[416,words.bond],[453,words.holding]
 ];
 for(const [top,value] of rows){
  // The original Schedule A contains static defaults in some of these cells.
  // Obscure *only* the value side before drawing confirmed replacements.
  const width=315;
  last.drawRectangle({x:267,y:pageHeight-top-3,width,height:13,color:rgb(1,1,1)});
  const valueText=ascii(value);
  let size=9;
  while(size>6.5&&regular.widthOfTextAtSize(valueText,size)>width-5)size-=.5;
  if(regular.widthOfTextAtSize(valueText,size)>width-5)throw Error('A Schedule A field is too long for the template.');
  last.drawText(valueText,{x:269,y:pageHeight-top,font:regular,size,color});
 }
 // Print names only. Rental application e-signatures must never be reused to sign a lease.
 for(const [x,top,value] of [[114,628,words.guest1],[364,628,words.guest2],[114,755,words.providerSigner]]){
  if(!value)continue;
  let size=8.5;
  const v=ascii(value);
  while(size>7&&regular.widthOfTextAtSize(v,size)>180)size-=.5;
  last.drawText(v.slice(0,90),{x,y:pageHeight-top,font:regular,size,color});
 }
 if(options.draft!==false){
  for(const page of doc.getPages()){
   page.drawText('DRAFT / LEGAL REVIEW REQUIRED / NOT FOR SIGNING',
     {x:55,y:16,size:8.3,font:bold,color:rgb(.65,.13,.14),opacity:.86});
  }
 }
 doc.setTitle((options.draft!==false?'Draft ':'')+'ProHouse mutual agreement - '+reference);
 doc.setSubject(options.draft!==false?
   'Schedule A mail merge draft; not signed or approved for issue':
   'Mutual agreement issued by ProHouse for separate electronic signatures');
 return new Uint8Array(await doc.save());
}
export async function generateMutualLeaseDraft(request,env){
 if(request.method!=='POST')return json(405,'Method not allowed.');
 const origin=request.headers.get('Origin');
 if(origin&&origin!==new URL(request.url).origin)return json(403,'Invalid request origin.');
 if(!request.headers.get('Content-Type')?.toLowerCase().startsWith('multipart/form-data'))
   return json(415,'Please upload a PDF template.');
 if(Number(request.headers.get('Content-Length')||0)>MAX_PDF_BYTES+8192)
   return json(413,'The PDF template exceeds 3 MB.');
 if(!env.LONGSTAY_DB)return json(503,'Review service unavailable.');
 let form;
 try{form=await request.formData()}catch{return json(400,'Unable to read draft request.');}
 const token=text(form.get('token'),80);
 const row=await findReview(env,token);
 if(!row)return json(404,'Review link not found.');
 if(row.expires_at<new Date().toISOString())return json(410,'Review link expired.');
 if(row.status!=='approved')return json(403,'An application must be approved before preparing a lease draft.');
 const file=form.get('template');
 let bytes,uploaded=false;
 if(file && typeof file!=='string' && file.size){
   if(file.type!=='application/pdf'||file.size>MAX_PDF_BYTES)return json(400,'Upload a six-page PDF no larger than 3 MB.');
   bytes=new Uint8Array(await file.arrayBuffer());
   uploaded=true;
 }else{
   const stored=await env.LONGSTAY_DB.prepare('SELECT template_bytes FROM longstay_lease_templates WHERE template_name=?')
     .bind('mutual-agreement-v10').first();
   if(!stored?.template_bytes)return json(400,'No saved agreement template. Upload the converted six-page PDF the first time.');
   bytes=Uint8Array.from(stored.template_bytes);
 }
 const keys=['fullAddress','acceptedWeeklyRent','leaseStart','leaseEnd','cleaningBond','holdingFund',
   'rentFrequency','internet','electricity','water','bankDetails','providerSigner'];
 const settings=Object.fromEntries(keys.map(k=>[k,text(form.get(k),180)]));
 if(keys.some(k=>!settings[k]))return json(400,'Confirm every lease value, including rent, dates, bond, charges and provider representative.');
 if(!['Every 2 weeks','Every 4 weeks','Every calendar month'].includes(settings.rentFrequency))
   return json(400,'Please confirm the rent payment frequency.');
 if(['acceptedWeeklyRent','cleaningBond','holdingFund'].some(k=>!validMoney(settings[k])))
   return json(400,'Enter valid agreed rent and bond amounts.');
 if(!validDate(settings.leaseStart)||!validDate(settings.leaseEnd)||settings.leaseEnd<settings.leaseStart)
   return json(400,'Enter valid agreed lease dates.');
 let data;
 try{data=JSON.parse(row.summary_json||'{}');}catch{return json(503,'Approved application data is unavailable.');}
 if(![37,80,68,70,45].every((b,i)=>bytes[i]===b))return json(400,'Upload a genuine PDF file.');
 try{
  const result=await fillMutualAgreementPDF(bytes,data,settings,row.reference);
  if(uploaded && form.get('saveTemplate')==='Yes'){
    try{
      await env.LONGSTAY_DB.prepare(
        'INSERT INTO longstay_lease_templates (template_name,template_bytes,uploaded_by_reference,updated_at) VALUES (?,?,?,?) ON CONFLICT(template_name) DO UPDATE SET template_bytes=excluded.template_bytes, uploaded_by_reference=excluded.uploaded_by_reference, updated_at=excluded.updated_at'
      ).bind('mutual-agreement-v10',bytes,row.reference,new Date().toISOString()).run();
    }catch(e){console.error('Could not save master lease template',e?.message);return json(503,'Draft rendered but master template could not be saved. Please try again.');}
  }
  return new Response(result,{
   status:200,headers:{...HDR,'Content-Type':'application/pdf',
    'Content-Disposition':'attachment; filename="ProHouse-Mutual-Agreement-DRAFT-'+row.reference+'.pdf"'}
  });
 }catch(e){
  console.error('Mutual agreement draft generation failed',row.reference,e?.message);
  return json(400,e.message||'Could not fill the agreement.');
 }
}
