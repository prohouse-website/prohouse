import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { calculateUtilitySplit, fmtDate, money, VACANT_ID } from '../public/assets/bill-math.js';

const A4 = [595.28, 841.89];
const INK = rgb(.11,.13,.115), GREY = rgb(.39,.43,.39), LINE = rgb(.84,.86,.82);
const LIME = rgb(.902,1,.404), PINK = rgb(.925,.635,.745), PAPER = rgb(.976,.976,.957);
const pale = rgb(.946,.958,.91);
const MAX_WIDTH = A4[0] - 104;
const left = 52;

function safeText(input, font) {
  const raw=String(input??'').normalize('NFC')
    .replace(/\u2010|\u2011|\u2012|\u2013|\u2014|\u2015/g,'-')
    .replace(/\u00a0|\u202f/g,' ')
    .replace(/\u2022/g,'*');
  return Array.from(raw, ch => {
    if(ch==='\n'||ch==='\r'||ch==='\t')return ch;
    try { font.encodeText(ch); return ch; }
    catch { return '?'; }
  }).join('');
}
function wrappedLines(value, font, size, maxWidth=MAX_WIDTH) {
  const paragraphs=safeText(value,font).split(/\r?\n/);
  const result=[];
  for(const para of paragraphs){
    let current='';
    for(const word of para.split(/\s+/).filter(Boolean)){
      if(!current && font.widthOfTextAtSize(word,size)<=maxWidth){current=word;continue;}
      const candidate=current?current+' '+word:word;
      if(font.widthOfTextAtSize(candidate,size)<=maxWidth){current=candidate;continue;}
      if(current){result.push(current);current='';}
      if(font.widthOfTextAtSize(word,size)<=maxWidth){current=word;continue;}
      let fragment='';
      for(const ch of word){
        if(fragment && font.widthOfTextAtSize(fragment+ch,size)>maxWidth){result.push(fragment);fragment='';}
        fragment+=ch;
      }
      current=fragment;
    }
    result.push(current);
  }
  return result;
}

async function generatePDF(report, property, references, logoBytes) {
  const doc=await PDFDocument.create();
  doc.setTitle('ProHouse Utility Bill Allocation - '+property);
  doc.setAuthor('ProHouse Australia');
  doc.setSubject('Fair daily allocation of water, gas, and electricity bills');
  const regular=await doc.embedFont(StandardFonts.Helvetica);
  const bold=await doc.embedFont(StandardFonts.HelveticaBold);
  const logo=logoBytes?await doc.embedPng(logoBytes).catch(()=>null):null;
  const pageHeight=A4[1];
  let page,y;
  function text(str,x,yy,size=10,{font=regular,color=INK,maxWidth}={}){
    const clean=safeText(str,font);
    const opts={x,y:yy,size,font,color};
    if(maxWidth)opts.maxWidth=maxWidth;
    page.drawText(clean,opts);
  }
  function newPage(){
    page=doc.addPage(A4);
    page.drawRectangle({x:0,y:pageHeight-10,width:A4[0],height:10,color:LIME});
    page.drawRectangle({x:0,y:0,width:A4[0],height:47,color:PAPER});
    page.drawLine({start:{x:left,y:49},end:{x:A4[0]-left,y:49},thickness:.7,color:LINE});
    page.drawRectangle({x:left,y:pageHeight-77,width:130,height:37,color:LIME});
    if(logo) {
      const sz=logo.scaleToFit(114,29);
      page.drawImage(logo,{x:left+8+(114-sz.width)/2,y:pageHeight-74+(29-sz.height)/2,width:sz.width,height:sz.height});
    } else {text('PROHOUSE',left+10,pageHeight-65,17,{font:bold});}
    text('PROPERTY OPERATIONS  /  UTILITY SPLIT',310,pageHeight-60,8,{font:bold,color:GREY});
    y=pageHeight-102;
  }
  function ensure(height=35){if(y-height<70)newPage();}
  function horizontalLine(pad=10){ensure(pad+5);y-=pad;page.drawLine({start:{x:left,y},end:{x:A4[0]-left,y},thickness:.7,color:LINE});y-=pad;}
  function write(value,{font=regular,size=10,color=INK,leading=size*1.44,indent=0,maxWidth=MAX_WIDTH,after=6}={}){
    const lines=wrappedLines(value,font,size,maxWidth-indent);
    for(const ln of lines){ensure(leading+6);if(ln)text(ln,left+indent,y,size,{font,color});y-=leading;}
    y-=after;
  }
  function small(label){ensure(35);write(label.toUpperCase(),{font:bold,size:8,color:GREY,after:6});}
  function heading(label){ensure(66);write(label,{font:bold,size:17,leading:22,after:9});}
  function boxValue(label,value,explanation){
    ensure(94);
    page.drawRectangle({x:left,y:y-76,width:MAX_WIDTH,height:82,color:INK});
    text(label,left+16,y-16,8,{font:bold,color:LIME});
    text(value,left+16,y-52,28,{font:bold,color:rgb(1,1,1)});
    if(explanation)text(explanation,left+255,y-44,9,{font:regular,color:rgb(.84,.88,.81)});
    y-=103;
  }
  function valueRow(label,amount,sub=''){
    const labelLines=wrappedLines(label,bold,10,315);
    const rowHeight=Math.max(28,labelLines.length*14+10)+(sub?11:0);
    ensure(rowHeight+5);
    let yy=y;
    for(const ln of labelLines){text(ln,left+7,yy-11,10,{font:bold});yy-=14;}
    if(sub)text(sub,left+7,y-rowHeight+8,8,{color:GREY});
    const amountText=money(amount);
    text(amountText,A4[0]-left-7-bold.widthOfTextAtSize(amountText,12),y-12,12,{font:bold});
    y-=rowHeight;
    page.drawLine({start:{x:left,y},end:{x:A4[0]-left,y},thickness:.6,color:LINE});
  }

  newPage();
  small('ProHouse / transparent resident billing');
  write('UTILITY BILL',{font:bold,size:29,leading:31,after:0});
  write('ALLOCATION REPORT',{font:bold,size:29,leading:31,after:13});
  write('Property: '+(property||'Not specified'),{font:bold,size:11,after:3});
  write('Generated: '+new Date().toLocaleDateString('en-AU',{day:'numeric',month:'long',year:'numeric',timeZone:'Australia/Sydney'}),{size:9,color:GREY,after:16});
  boxValue('COMBINED UTILITY INVOICES',money(report.totalCents),report.billCount+' invoices  /  '+report.tenantCount+' people');
  heading('Who pays what');
  for(const row of report.summary) valueRow(row.name,row.amountCents,row.id===VACANT_ID?'Unoccupied days - property responsibility':'Share of the invoices during this person’s stay');
  horizontalLine(10);
  heading('How the allocation works');
  write('1. Each utility bill is allocated evenly over its calendar-day billing period, including both the first and last day.',{size:10});
  write('2. For each calendar day, the day’s cost is divided equally among tenants whose recorded stay includes that day.',{size:10});
  write('3. If no tenant is present, that day is assigned to Vacant / property rather than to another tenant.',{size:10});
  write('4. Exact shares are rounded to cents using a largest-remainder method, so all tenant and property shares together equal the original invoice exactly.',{size:10});
  write('This is a time-and-occupancy estimate, not a meter-reading or consumption-based allocation. Review the applicable tenancy agreement and local rules before charging.',{size:9,color:GREY,after:18});

  for(const [index,bill] of report.bills.entries()){
    ensure(155);
    horizontalLine(12);
    small('Invoice '+String(index+1).padStart(2,'0')+' / '+bill.name);
    heading(bill.name.toUpperCase()+' / '+money(bill.amountCents));
    write(fmtDate(bill.start)+' to '+fmtDate(bill.end)+'  |  '+bill.days+' calendar days'+(references[bill.id]?'  |  Ref: '+references[bill.id]:''),{size:10,color:GREY,after:11});
    const daily=money(bill.amountCents / bill.days);
    write('Daily cost: '+money(bill.amountCents)+' / '+bill.days+' days = approx. '+daily+' per calendar day.',{size:10,after:12});
    small('Occupancy timeline');
    for(const span of bill.spans){
      write(fmtDate(span.start)+' - '+fmtDate(span.end)+'  |  '+span.days+' day'+(span.days===1?'':'s')+'  |  '+span.occupants.join(', '),{size:9,after:4});
    }
    y-=5;
    small('Allocated invoice amount');
    for(const row of bill.rows){
      const equivalent=Number(row.equivalentDays.toFixed(6));
      valueRow(row.name,row.amountCents,row.presentDays+' days present; '+equivalent+' equivalent full-rate days / '+bill.days+' bill days');
    }
    write('Formula: share = invoice amount x (sum of 1 / number of present occupants on each occupied day) / total billing days. Final amounts reconciled to the nearest cent.',{size:8,color:GREY,after:13});
  }

  horizontalLine(12);
  small('Individual resident statements');
  for(const [index,tenant] of report.tenants.entries()){
    const s=report.summary.find(x=>x.id===tenant.id);
    ensure(135);
    heading(String(index+1).padStart(2,'0')+' / '+tenant.name);
    write('Recorded residence: '+fmtDate(tenant.start)+' - '+fmtDate(tenant.end)+' (inclusive)',{size:10,color:GREY,after:8});
    if(s && s.bills.length){
      for(const item of s.bills){
        valueRow(item.name+' / '+fmtDate(item.start)+' - '+fmtDate(item.end),item.amountCents,
          item.presentDays+' present days; '+Number(item.equivalentDays.toFixed(6))+' equivalent days of '+item.days);
      }
    }else{
      write('No charge from the listed bills: this person was not present during the billed dates.',{size:10,color:GREY});
    }
    ensure(35);
    const total=money(s?.amountCents||0);
    write('TOTAL OWING: '+total,{font:bold,size:14,after:22});
  }
  if(report.summary.some(x=>x.id===VACANT_ID)){
    horizontalLine(8);heading('Vacant / property allocation');
    const s=report.summary.find(x=>x.id===VACANT_ID);
    for(const item of s.bills)valueRow(item.name,item.amountCents,item.presentDays+' unoccupied days');
    write('Not charged to tenants.',{size:10,color:GREY});
  }
  const pages=doc.getPages();
  pages.forEach((p,i)=>{
    const mark='PROHOUSE AUSTRALIA    |    '+(property||'UTILITY SPLIT');
    const markText=safeText(mark,regular);
    p.drawText(markText.slice(0,78),{x:left,y:28,size:7,font:regular,color:GREY});
    const count=String(i+1)+' / '+String(pages.length);
    p.drawText(count,{x:A4[0]-left-bold.widthOfTextAtSize(count,8),y:28,size:8,font:bold,color:GREY});
  });
  return doc.save({useObjectStreams:false});
}

export async function utilityPDF(request, env) {
  if(request.method!=='POST') return new Response('Method not allowed',{status:405,headers:{Allow:'POST'}});
  try {
    if(!(request.headers.get('Content-Type')||'').toLowerCase().includes('application/json')){
      return Response.json({error:'Send JSON to generate this report.'},{status:415});
    }
    const body=await request.text();
    if(body.length>90000)return Response.json({error:'Report is too large.'},{status:413});
    const raw=JSON.parse(body);
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
    const pdf=await generatePDF(report,property,references,image);
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
    const expected=/^(Enter|Add|Maximum|Missing|Tenant|Invalid|Unable|.*date|.*end date|.*billing periods|.*bill amount)/i.test(message);
    return Response.json({error:expected?message:'Unable to generate PDF. Please try again.'},{status:expected?400:500,headers:{'Cache-Control':'no-store'}});
  }
}
