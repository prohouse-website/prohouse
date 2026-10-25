import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { calculateUtilitySplit, fmtDate, money, VACANT_ID, parseDay } from '../public/assets/bill-math.js';
import { summariseBilledDays } from './bill-day-summary.js';
const A4=[595.28,841.89], LEFT=48, RIGHT=547, WIDTH=RIGHT-LEFT;
const INK=rgb(.12,.14,.13), GREY=rgb(.39,.44,.4), LINE=rgb(.83,.86,.82),
      LIME=rgb(.91,1,.405), PALE=rgb(.96,.97,.94), PINK=rgb(.98,.90,.93), WHITE=rgb(1,1,1);

function printable(value,font){
  return Array.from(String(value??'').normalize('NFC').replace(/[\u2010-\u2015]/g,'-'),c=>{
    try{font.encodeText(c);return c;}catch{return '?';}
  }).join('');
}
async function generatePDF(report,property,references,logoBytes,attachments=[]){
  const pdf=await PDFDocument.create();
  pdf.setTitle('ProHouse - Utility Bill Summary'+(property?' - '+property:''));
  pdf.setAuthor('ProHouse Australia');
  const font=await pdf.embedFont(StandardFonts.Helvetica);
  const bold=await pdf.embedFont(StandardFonts.HelveticaBold);
  const logo=logoBytes?await pdf.embedPng(logoBytes).catch(()=>null):null;
  const daySummary=summariseBilledDays(report);
  let page,y,number=0;
  const tx=(str,x,baseline,size=10,face=font,color=INK)=>{
    page.drawText(printable(str,face),{x,y:baseline,size,font:face,color});
  };
  const fitted=(str,face,size,width)=>{
    let s=printable(str,face);
    if(face.widthOfTextAtSize(s,size)<=width)return s;
    while(s.length>1&&face.widthOfTextAtSize(s+'...',size)>width)s=s.slice(0,-1);
    return s+'...';
  };
  const center=(str,cx,yy,size,face=bold,color=INK)=>tx(str,cx-face.widthOfTextAtSize(printable(str,face),size)/2,yy,size,face,color);
  const right=(str,rightX,yy,size=10,face=bold,color=INK)=>tx(str,rightX-face.widthOfTextAtSize(printable(str,face),size),yy,size,face,color);
  const divider=()=>page.drawLine({start:{x:LEFT,y},end:{x:RIGHT,y},thickness:.7,color:LINE});
  function newPage(){
    page=pdf.addPage(A4);number++;
    page.drawRectangle({x:0,y:826,width:595.28,height:16,color:LIME});
    if(logo){const sz=logo.scaleToFit(128,44);page.drawImage(logo,{x:LEFT+7+(128-sz.width)/2,y:755+(44-sz.height)/2,width:sz.width,height:sz.height});}
    else tx('PROHOUSE',LEFT+12,773,21,bold);
    right('UTILITY COST SUMMARY',RIGHT,778,9,bold,GREY);
    y=724;
  }
  const needed=(height)=>{if(y-height<82)newPage();};
  function section(label){
    needed(42);
    tx(label,LEFT,y,12,bold);
    y-=11;divider();y-=14;
  }
  function utilityRow(b){
    needed(32);
    const mark=b.name.toUpperCase();
    tx(fitted(mark,bold,9,105),LEFT+8,y-5,9,bold);
    tx(fitted(fmtDate(b.start)+' - '+fmtDate(b.end),font,8.5,195),LEFT+111,y-5,8.5,font,GREY);
    tx(b.days+' day'+(b.days===1?'':'s'),LEFT+318,y-5,8,bold,GREY);
    right(money(b.amountCents),RIGHT-7,y-5,10,bold);
    y-=31;
    divider();
  }
  newPage();
  tx('SIMPLE. FAIR. CLEAR.',LEFT,y,8,bold,GREY);y-=35;
  tx('Utility bill split',LEFT,y,30,bold);y-=27;
  const propertyName=property||'Property not specified';
  tx(fitted(propertyName,font,11,WIDTH),LEFT,y,11,font,GREY);y-=31;
  needed(81);
  page.drawRectangle({x:LEFT,y:y-59,width:WIDTH,height:71,color:INK});
  tx('TOTAL UTILITY BILLS',LEFT+17,y-12,8,bold,LIME);
  tx(money(report.totalCents),LEFT+17,y-45,27,bold,WHITE);
  right(report.billCount+' bill'+(report.billCount===1?'':'s')+' / '+report.tenantCount+' tenants',RIGHT-17,y-30,9,bold,WHITE);
  right(daySummary.billedDays+' total billed day'+(daySummary.billedDays===1?'':'s'),RIGHT-17,y-47,9,bold,LIME);
  y-=96;
  section('1  Bills included');
  for(const b of report.bills)utilityRow(b);
  y-=22;
  section('2  Amount payable by each resident');
  const groups=['water','gas','electricity','other'].filter(type=>report.bills.some(b=>b.type===type));
  const cols=[...groups,'total'];
  const nameWidth=groups.length===4?154:groups.length===3?175:210;
  const numericWidth=(WIDTH-nameWidth)/cols.length;
  const headings={water:'WATER',gas:'GAS',electricity:'POWER',other:'OTHER',total:'TOTAL'};
  const colRight=index=>LEFT+nameWidth+(index+1)*numericWidth-9;
  function tableHeading(){
    needed(32);
    page.drawRectangle({x:LEFT,y:y-28,width:WIDTH,height:30,color:LIME});
    tx('RESIDENT / TENANT',LEFT+9,y-18,9,bold);
    cols.forEach((name,i)=>right(headings[name],colRight(i),y-18,8,bold));
    y-=30;
  }
  tableHeading();
  const summaries=report.summary;
  summaries.forEach((row,i)=>{
    const height=51;
    if(y-height<98){newPage();section('Amount payable (continued)');tableHeading();}
    page.drawRectangle({x:LEFT,y:y-height,width:WIDTH,height,color:row.id===VACANT_ID?PINK:i%2===1?PALE:WHITE});
    tx(fitted(row.name,bold,10,nameWidth-17),LEFT+9,y-19,10,bold);
    const resident=report.tenants.find(t=>t.id===row.id);
    if(resident){
      tx(fitted(fmtDate(resident.start)+' - '+fmtDate(resident.end),font,8,nameWidth-17),LEFT+9,y-32,8,font,GREY);
      const stayDays=parseDay(resident.end)-parseDay(resident.start)+1;
      const billedDays=daySummary.tenantDays.get(resident.id)||0;
      const daysLabel=stayDays+' stayed / '+billedDays+' billed days';
      tx(fitted(daysLabel,bold,7.8,nameWidth-17),LEFT+9,y-45,7.8,bold,GREY);
    } else {
      tx('Unoccupied billing days',LEFT+9,y-32,7.8,font,GREY);
      tx(daySummary.vacantDays+' vacant billed days',LEFT+9,y-45,7.8,bold,GREY);
    }
    const centsByType=Object.fromEntries(groups.map(g=>[g,0]));
    for(const b of report.bills){
      const r=b.rows.find(p=>p.id===row.id);
      if(r && Object.hasOwn(centsByType,b.type))centsByType[b.type]+=r.amountCents;
    }
    cols.forEach((g,j)=>right(money(g==='total'?row.amountCents:centsByType[g]),colRight(j),y-30,groups.length>=3?8.3:9,font));
    y-=height;
    divider();
  });
  if(y<123){newPage();}
  y-=7;
  page.drawRectangle({x:LEFT,y:y-34,width:WIDTH,height:39,color:LIME});
  tx('TOTAL ALLOCATED',LEFT+9,y-22,10,bold);
  right(money(report.totalCents),RIGHT-9,y-22,14,bold);
  y-=59;
  needed(105);
  tx('3  How this is calculated',LEFT,y,12,bold);y-=12;divider();y-=18;
  tx('Each bill is divided by its calendar days (shown next to the bill).',LEFT,y,9.5,font);y-=17;
  tx('Each day is shared equally by the residents living there on that day.',LEFT,y,10,font);y-=17;
  tx('Any empty days are charged to "Vacant / property", not other tenants.',LEFT,y,10,font);y-=17;
  tx('Stayed days = whole stay; billed days = days within the bill period(s).',LEFT,y,9,font,GREY);y-=17;
  needed(16);
  tx('Shared dates and overlapping invoices are counted once for day totals.',LEFT,y,8.7,font,GREY);
  const summaryPageCount=pdf.getPageCount();
  // Preserve original invoice PDFs as appended pages, rather than recreating them
  // from OCR text. Photographs become full-page, proportionally scaled images.
  let appendedPages=0;
  for (const item of attachments) {
    if(item.kind==='pdf'){
      let original;
      try { original=await PDFDocument.load(item.bytes); }
      catch { throw new Error('Attached PDF "'+item.name+'" is encrypted or damaged. Please replace it.'); }
      const count=original.getPageCount();
      if(count>40 || appendedPages+count>100)throw new Error('Attached PDFs exceed the 100-page report limit.');
      const pages=await pdf.copyPages(original,Array.from({length:count},(_,i)=>i));
      for(const sourcePage of pages)pdf.addPage(sourcePage);
      appendedPages+=count;
    } else {
      let image;
      try {
        image=item.kind==='png'?await pdf.embedPng(item.bytes):await pdf.embedJpg(item.bytes);
      } catch {throw new Error('Could not include attached image "'+item.name+'". Please replace it.');}
      if(appendedPages+1>100)throw new Error('Attached invoices exceed the 100-page report limit.');
      const sheet=pdf.addPage(A4);
      sheet.drawRectangle({x:0,y:826,width:595.28,height:16,color:LIME});
      const title=printable('ATTACHED INVOICE / '+item.billName,bold);
      sheet.drawText(fitted(title,bold,13,WIDTH),{x:LEFT,y:795,font:bold,size:13,color:INK});
      sheet.drawText(fitted(item.name,font,9,WIDTH),{x:LEFT,y:778,font,size:9,color:GREY});
      const maxWidth=WIDTH,maxHeight=690;
      const ratio=Math.min(maxWidth/image.width,maxHeight/image.height);
      const imageWidth=image.width*ratio,imageHeight=image.height*ratio;
      sheet.drawImage(image,{x:LEFT+(WIDTH-imageWidth)/2,y:65+(maxHeight-imageHeight)/2,width:imageWidth,height:imageHeight});
      appendedPages++;
    }
  }
  const pages=pdf.getPages();
  pages.slice(0,summaryPageCount).forEach((p,i)=>{
    p.drawLine({start:{x:LEFT,y:55},end:{x:RIGHT,y:55},thickness:.7,color:LINE});
    const footer=printable('PROHOUSE AUSTRALIA  |  DAY-BASED UTILITY ALLOCATION',font);
    p.drawText(footer,{x:LEFT,y:36,size:8,font,color:GREY});
    const num=String(i+1)+' / '+String(pages.length);
    p.drawText(num,{x:RIGHT-bold.widthOfTextAtSize(num,8),y:36,size:8,font:bold,color:GREY});
  });
  return pdf.save({useObjectStreams:false});
}

export async function utilityPDF(request, env) {
  if(request.method!=='POST') return new Response('Method not allowed',{status:405,headers:{Allow:'POST'}});
  try {
    const contentType=(request.headers.get('Content-Type')||'').toLowerCase();
    let raw,attachments=[];
    if(contentType.includes('multipart/form-data')){
      if(Number(request.headers.get('content-length')||0)>25*1024*1024)
        return Response.json({error:'Total attachment size must be below 22 MB.'},{status:413});
      const form=await request.formData();
      const reportJSON=form.get('report');
      if(typeof reportJSON!=='string'||reportJSON.length>90000)throw new Error('Invalid report details.');
      raw=JSON.parse(reportJSON);
      if(!raw||!Array.isArray(raw.bills))throw new Error('Missing bill information.');
      let totalAttachmentBytes=0;
      const allowedBillIDs=new Set(raw.bills.map(b=>String(b.id||'')));
      for(const [field,file] of form.entries()){
        if(field==='report')continue;
        if(!field.startsWith('invoice_')||!(file instanceof File))throw new Error('Invalid invoice attachment.');
        const billID=field.slice('invoice_'.length);
        if(!allowedBillIDs.has(billID))throw new Error('Invoice does not match a listed bill.');
        const bill=raw.bills.find(b=>String(b.id)===billID);
        if(attachments.some(a=>a.billID===billID))throw new Error('Each bill can have one attached file.');
        if(file.size<100||file.size>8*1024*1024)throw new Error('Each attached invoice must be under 8 MB.');
        totalAttachmentBytes+=file.size;
        if(totalAttachmentBytes>22*1024*1024)throw new Error('Total attachment size must be below 22 MB.');
        const bytes=new Uint8Array(await file.arrayBuffer());
        const pdfSig=bytes.length>=5&&String.fromCharCode(...bytes.slice(0,5))==='%PDF-';
        const pngSig=bytes.length>=8&&[137,80,78,71,13,10,26,10].every((v,i)=>bytes[i]===v);
        const jpgSig=bytes.length>=3&&bytes[0]===255&&bytes[1]===216&&bytes[2]===255;
        const kind=pdfSig?'pdf':pngSig?'png':jpgSig?'jpeg':null;
        if(!kind)throw new Error('Attached invoices must be PDF, PNG or JPG. WebP photos are converted to JPG before export.');
        const safeName=String(file.name||'Invoice').replace(/[^\w .()\-]/g,'_').slice(0,110);
        attachments.push({billID,bytes,kind,name:safeName,billName:String(bill.label||bill.type||'Bill').slice(0,60)});
      }
      attachments.sort((a,b)=>raw.bills.findIndex(v=>String(v.id)===a.billID)-raw.bills.findIndex(v=>String(v.id)===b.billID));
    } else if(contentType.includes('application/json')){
      const body=await request.text();
      if(body.length>90000)return Response.json({error:'Report is too large.'},{status:413});
      raw=JSON.parse(body);
    } else return Response.json({error:'Upload report information as JSON or multipart form data.'},{status:415});
    if(!raw||typeof raw!=='object')throw new Error('Invalid report data.');
    const report=calculateUtilitySplit(raw);
    if(!report.bills.length || report.totalCents<=0)throw new Error('Enter at least one bill above $0.');
    const property=String(raw.property||'').trim().slice(0,120);
    const references=Object.fromEntries((Array.isArray(raw.bills)?raw.bills:[]).map((b,i)=>[
      String(b.id||('bill-'+i)),String(b.reference||'').trim().slice(0,60)
    ]));
    let image=null;
    try {
      const logoURL=new URL('/assets/prohouse-logo-transparent.png',request.url);
      const response=await env.ASSETS.fetch(new Request(logoURL,{method:'GET'}));
      if(response.ok && response.headers.get('content-type')?.includes('image/'))image=new Uint8Array(await response.arrayBuffer());
    } catch {}
    const pdf=await generatePDF(report,property,references,image,attachments);
    return new Response(pdf,{headers:{
      'Content-Type':'application/pdf',
      'Content-Disposition':'attachment; filename="ProHouse-Utility-Bill-Allocation.pdf"',
      'Cache-Control':'private, no-store',
      'X-Content-Type-Options':'nosniff',
      'Referrer-Policy':'no-referrer',
      'X-Robots-Tag':'noindex, nofollow'
    }});
  }catch(error){
    if(error instanceof SyntaxError)return Response.json({error:'Invalid report details.'},{status:400,headers:{'Cache-Control':'no-store'}});
    const message=String(error.message||'PDF generation failed.');
    const expected=/^(Enter|Add|Maximum|Missing|Tenant|Invalid|Unable|Attached|Each|Total attachment|Invoice|Could not include|Name each|.*date|.*end date|.*billing periods|.*bill amount)/i.test(message);
    return Response.json({error:expected?message:'Unable to generate PDF. Please try again.'},{status:expected?400:500,headers:{'Cache-Control':'no-store'}});
  }
}
