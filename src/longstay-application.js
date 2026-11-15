import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

// Single, private mail-delivery flow. Documents are held only for the request and
// forwarded to ProHouse through the existing Resend account; never published as URLs.
const EMAIL = 'hi@prohouse.com.au';
const MAX_REQUEST = 19 * 1024 * 1024;
const MAX_FILE = 5 * 1024 * 1024;
const MAX_FILES_TOTAL = 15 * 1024 * 1024;
const allowedTypes = new Set(['application/pdf', 'image/jpeg', 'image/png', 'image/webp']);
export const applicationFields = [
  ['people','Number of applicants'], ['houseRules','Shared-house guideline accepted'],
  ['firstName','First name'], ['lastName','Family name'], ['email','Email'],
  ['phone','Phone'], ['photoIdType','Identification type'], ['occupation','Occupation'], ['occupationOther','Other occupation'],
  ['workFromHome','Working from home'], ['workFromHomeOther','Working from home details'],
  ['employer','Employer or school'], ['income','Weekly income (AUD)'],
  ['secondEmail','Second applicant invited email'], ['secondFirstName','Second applicant first name'],
  ['secondLastName','Second applicant family name'], ['secondPhone','Second applicant phone'], ['secondIdType','Second applicant identification type'],
  ['secondOccupation','Second applicant occupation'], ['secondOccupationOther','Second applicant other occupation'],
  ['secondWorkFromHome','Second applicant working from home'],
  ['secondWorkFromHomeOther','Second applicant work from home details'],
  ['secondEmployer','Second applicant employer or school'],
  ['secondIncome','Second applicant weekly income (AUD)'],
  ['secondDeclaration','Second applicant declaration'],
  ['secondPrivacyConsent','Second applicant privacy consent'],
  ['property','Property'], ['propertyOther','Other property'], ['room','Rental room'], ['roomOther','Other room'],
  ['moveIn','Preferred move-in date'], ['length','Length of stay'], ['lengthOther','Other length of stay'],
  ['weeklyRent','Weekly rent applicant wishes to pay (AUD)'], ['payFrequency','Preferred rent payment frequency'],
  ['linen','Bed linen and towels'], ['linenOther','Other linen preference'],
  ['declaration','Application declaration accepted'], ['privacyConsent','Privacy and email consent']
];
const uploadKeys = [
  ['photoId1', 'Main applicant ID document 1'],
  ['photoId2', 'Main applicant ID document 2'],
  ['incomeProof1', 'Main applicant proof of income 1'],
  ['incomeProof2', 'Main applicant proof of income 2'],
  ['secondId', 'Second applicant ID document'],
  ['secondIncome', 'Second applicant proof of income']
];
function respond(status, message, extra = {}) {
  return new Response(JSON.stringify({ message, ...extra }), {
    status, headers: { 'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }
  });
}
function clean(value, max = 280) {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}
function pdfSafe(value) {
  return String(value ?? '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\x20-\x7E]/g, '?');
}
function toBase64(bytes) {
  let output = '';
  for (let i = 0; i < bytes.length; i += 8192) {
    output += String.fromCharCode(...bytes.subarray(i, i + 8192));
  }
  return btoa(output);
}
function fileName(value, fallback) {
  const safe = String(value || fallback).split(/[\\/]/).pop()
    .replace(/[^a-zA-Z0-9._ -]/g, '_').replace(/^\.+/, '').slice(0, 90);
  return safe || fallback;
}
function validEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) && value.length <= 254;
}
function clipText(text, font, size, width) {
  const words = pdfSafe(text).split(/\s+/), lines = []; let line = '';
  for (const word of words) {
    if (!word) continue;
    const next = line ? line + ' ' + word : word;
    if (font.widthOfTextAtSize(next, size) <= width) { line = next; continue; }
    if (line) lines.push(line);
    line = '';
    for (const c of word) {
      if (font.widthOfTextAtSize(line + c, size) > width && line) { lines.push(line); line = ''; }
      line += c;
    }
  }
  if (line) lines.push(line);
  return lines.length ? lines : ['(Not supplied)'];
}
export async function buildApplicationPDF(data, documents, reference, signature, secondSignature) {
  const pdf = await PDFDocument.create();
  pdf.setTitle('ProHouse live with us - ' + reference);
  pdf.setAuthor('ProHouse');
  pdf.setSubject('Rental application summary; does not form a tenancy agreement');
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const ink = rgb(0.09, 0.13, 0.14), grey = rgb(0.38, 0.44, 0.43);
  let page, y;
  const nextPage = () => {
    page = pdf.addPage([595, 842]); y = 790;
    page.drawText('PROHOUSE  /  LIVE WITH US', { x: 42, y: 812, size: 10, font: bold, color: ink });
    page.drawLine({ start: { x:42, y:804 }, end: { x:553, y:804 }, thickness:1, color:rgb(.8,.85,.81) });
    page.drawText(reference, { x: 42, y: 31, font: regular, size: 9, color: grey });
    page.drawText('Private application  |  Not a lease', { x: 370, y:31, font:regular, size:9, color:grey });
  };
  const ensure = height => { if (y - height < 60) nextPage(); };
  const section = heading => {
    ensure(45); y -= 16;
    page.drawText(pdfSafe(heading).toUpperCase(), { x:42, y, font:bold, size:12, color:ink });
    y -= 12;
  };
  const row = (label, value) => {
    const lines = clipText(value || '(Not supplied)', regular, 10, 302);
    const height = Math.max(19, lines.length * 13 + 6);
    ensure(height);
    page.drawText(pdfSafe(label), { x:42, y, font:bold, size:9, color:grey, maxWidth:180 });
    lines.forEach((l,i)=>page.drawText(l, { x:244, y:y-i*13, font:regular,size:10,color:ink }));
    y -= height;
  };
  nextPage();
  page.drawText('Rental application', { x:42, y, font:bold, size:23, color:ink });
  y -= 25;
  row('Received UTC', new Date().toISOString());
  section('Screening');
  row('Applicants', data.people); row('Housemate guideline', data.houseRules);
  section('Main applicant');
  applicationFields.slice(2,13).forEach(([key,label])=>row(label,data[key]));
  section('Second applicant');
  applicationFields.slice(13,26).forEach(([key,label])=>row(label,data[key]));
  section('Rental preferences');
  applicationFields.slice(26,37).forEach(([key,label])=>row(label,data[key]));
  section('Declarations');
  applicationFields.slice(37).forEach(([key,label])=>row(label,data[key]));
  section('Attached documents');
  if (!documents.length) row('Documents', 'None supplied with initial application');
  documents.forEach(({label,filename})=>row(label,filename));
  const addSignature=(label,value)=>{
    return (async()=>{
      section(label);ensure(130);
      const pngBytes=Uint8Array.from(atob(value.split(',')[1]),x=>x.charCodeAt(0));
      const png=await pdf.embedPng(pngBytes);
      const scale=Math.min(1,310/png.width,100/png.height);
      page.drawRectangle({x:42,y:y-110,width:330,height:108,borderColor:rgb(.8,.85,.81),borderWidth:1});
      page.drawImage(png,{x:53,y:y-105+(100-png.height*scale)/2,width:png.width*scale,height:png.height*scale});
      y-=125;
    })();
  };
  await addSignature('First applicant signature',signature);
  if(secondSignature)await addSignature('Second applicant signature',secondSignature);
  return new Uint8Array(await pdf.save());
}
export async function submitLongStayApplication(request, env) {
  if (request.method !== 'POST') return respond(405, 'Method not allowed.');
  const origin = request.headers.get('Origin');
  if (origin && origin !== new URL(request.url).origin) return respond(403, 'Invalid form origin.');
  if (!request.headers.get('Content-Type')?.toLowerCase().startsWith('multipart/form-data'))
    return respond(415,'Please submit the application form.');
  if (Number(request.headers.get('Content-Length')||0)>MAX_REQUEST)
    return respond(413,'The combined files are too large. Please use smaller files.');
  if (!env.RESEND_API_KEY) return respond(503,'Applications are temporarily unavailable. Please contact ProHouse.');
  let form;
  try { form = await request.formData(); } catch { return respond(400,'Could not read your application.'); }
  if (form.get('website')) return respond(200,'Application received.');
  const data = Object.fromEntries(applicationFields.map(([k])=>[k, clean(form.get(k))]));
  const required = ['people','firstName','lastName','email','phone','occupation','workFromHome','employer',
    'income','property','room','moveIn','length','weeklyRent','payFrequency','linen'];
  if (required.some(k=>!data[k])) return respond(400,'Please complete all required fields.');
  if (!['Just me','Two people'].includes(data.people)) return respond(400,'Select the number of applicants.');
  if (data.people==='Two people' && ['secondFirstName','secondLastName','secondEmail','secondPhone'].some(k=>!data[k]))
    return respond(400,'Please complete the second applicant details.');
  if (!validEmail(data.email) || (data.people==='Two people' && !validEmail(data.secondEmail)))
    return respond(400,'Please enter a valid email address.');
  if (data.houseRules!=='Yes' || data.declaration!=='Yes' || data.privacyConsent!=='Yes')
    return respond(400,'Please accept the required declarations.');
  if (!(Number(data.weeklyRent)>0 && Number(data.weeklyRent)<100000) ||
      !(Number(data.income)>=0 && Number(data.income)<10000000))
    return respond(400,'Please check the weekly amounts.');
  const signature = clean(form.get('signature'), 550000);
  if (!/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(signature) || signature.length < 250 || signature.length > 550000)
    return respond(400,'Please sign the application before submitting.');
  const documents=[];let total=0;
  for (const [key,label] of uploadKeys) {
    const entries = form.getAll(key);
    if (entries.length > 3) return respond(400,'Please upload no more than three files per field.');
    for (const entry of entries) {
      if (!entry || typeof entry === 'string' || !entry.size) continue;
      if (entry.size>MAX_FILE) return respond(413,'Each uploaded file must be 5 MB or less.');
      total+=entry.size;
      if (total>MAX_FILES_TOTAL) return respond(413,'Total uploaded files must be 15 MB or less.');
      const mime=(entry.type||'').toLowerCase();
      if (!allowedTypes.has(mime)) return respond(400,'Only PDF, JPG, PNG and WebP files are accepted.');
      documents.push({label,filename:fileName(entry.name,key+'.pdf'),type:mime,file:entry});
    }
  }
  if (documents.length>10) return respond(400,'Too many attachments.');
  const reference='LH-'+new Date().toISOString().slice(0,10).replace(/-/g,'')+'-'+crypto.randomUUID().slice(0,8).toUpperCase();
  let pdf;
  try { pdf=await buildApplicationPDF(data,documents,reference,signature); }
  catch (e) { console.error('Long-stay PDF generation error',e?.message);return respond(500,'Could not prepare your application PDF.'); }
  const attachments=[{filename:reference+'-application.pdf',content:toBase64(pdf),content_type:'application/pdf'}];
  for (const {filename,type,file} of documents) {
    attachments.push({filename,content:toBase64(new Uint8Array(await file.arrayBuffer())),content_type:type});
  }
  const name=[data.firstName,data.lastName].join(' ').replace(/[\r\n]/g,' ');
  const emailBody=[
    'New ProHouse Live With Us application', 'Reference: '+reference,
    'Received UTC: '+new Date().toISOString(), '',
    ...applicationFields.map(([k,label])=>label+': '+(data[k]||'(not provided)')),
    '', 'Submitted documents:', ...(documents.length?documents.map(d=>d.label+': '+d.filename):['None']),
    '', 'Applicant signature: see application PDF.',
    'The attached PDF is a summary, not a signed tenancy agreement.',
    'Applicant consented to send details and documents to ProHouse for application assessment.'
  ].join('\n');
  try {
    const sent=await fetch('https://api.resend.com/emails',{
      method:'POST',
      headers:{Authorization:'Bearer '+env.RESEND_API_KEY,'Content-Type':'application/json'},
      body:JSON.stringify({
        from:env.APPLICATION_FROM_EMAIL||env.CLEANER_FROM_EMAIL||'ProHouse <no-reply@prohouse.com.au>',
        to:[env.PROHOUSE_ADMIN_EMAILS?.split(',')[0]?.trim()||EMAIL],
        reply_to:data.email,
        subject:'Live With Us application '+reference+' - '+name,
        text:emailBody,
        attachments
      })
    });
    if (!sent.ok) {
      const body=await sent.text().catch(()=> '');
      console.error('Long-stay email delivery failed:',sent.status,body.slice(0,350));
      return respond(502,'We could not deliver your application. Please try again.');
    }
    return respond(200,'Your application has been sent to ProHouse.',{reference});
  } catch(e) {
    console.error('Long-stay email connection failed:',e?.message);
    return respond(502,'We could not send your application. Please try again.');
  }
}
