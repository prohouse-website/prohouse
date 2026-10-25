// Extract billed usage period and payable total from user-supplied utility invoices.
// No invoice bytes or extracted text is persisted.
import { parseDay } from '../public/assets/bill-math.js';

const MIME = new Map([
  ['application/pdf', ['pdf']],
  ['image/jpeg', ['jpg', 'jpeg']],
  ['image/png', ['png']],
  ['image/webp', ['webp']]
]);
function contentKind(bytes) {
  if (bytes.length>=5 && new TextDecoder('ascii').decode(bytes.slice(0,5)) === '%PDF-') return 'application/pdf';
  if (bytes.length>=3 && bytes[0]===255 && bytes[1]===216 && bytes[2]===255) return 'image/jpeg';
  if (bytes.length>=8 && bytes[0]===137 && bytes[1]===80 && bytes[2]===78 && bytes[3]===71 && bytes[4]===13 && bytes[5]===10 && bytes[6]===26 && bytes[7]===10) return 'image/png';
  if (bytes.length>=12 && String.fromCharCode(...bytes.slice(0,4))==='RIFF' && String.fromCharCode(...bytes.slice(8,12))==='WEBP') return 'image/webp';
  return null;
}
function validDate(v){
  if(typeof v!=='string')return null;
  try { parseDay(v);return v; } catch { return null; }
}
function extractAnswers(response, state){
  const answers=response?.answers||{};
  const answer=(key)=>{
    const node=answers[key];
    if(!node || node.value==null)return null;
    if(typeof node.p_null==='number' && node.p_null>0.6)return null;
    if(typeof node.confidence==='number' && node.confidence<0.43)return null;
    return node.value;
  };
  const rawAmount=answer('amount');
  const amountValue=typeof rawAmount==='number' ? rawAmount : Number(String(rawAmount||'').replace(/[^0-9.]/g,''));
  const amount=Number.isFinite(amountValue) && amountValue>0 && amountValue<=1e7 ? (Math.round(amountValue*100)/100).toFixed(2) : null;
  const start=validDate(answer('start'));
  const end=validDate(answer('end'));
  const validPeriod=start && end && parseDay(start)<=parseDay(end) && parseDay(end)-parseDay(start)<730;
  const sourceType=String(answer('utility')||'').toLowerCase();
  const text=String(state||'').toLowerCase();
  const type=/\bwater\b/.test(sourceType)?'water':/\bgas\b/.test(sourceType)?'gas':/\belectricity\b|\bpower\b/.test(sourceType)?'electricity':
    /\belectricity\b|\bkwh\b|\benergy usage\b/.test(text)?'electricity':
    /\bgas\b|\bmj\b/.test(text)?'gas':/\bwater\b|\bsewerage\b/.test(text)?'water':'other';
  const reference=String(answer('invoice_number')||'').trim().slice(0,60);
  const provider=String(answer('provider')||'').trim().slice(0,70);
  const missing=['amount','start','end'].filter(f=>!(f==='amount'?amount:f==='start'?validPeriod&&start:validPeriod&&end));
  return { type, amount, start:validPeriod?start:null, end:validPeriod?end:null, reference, provider,
    needsReview:true,missing,
    note:missing.length?'Could not confidently read '+missing.join(', ')+'. Enter these manually.':'Check the amount and billing dates against the original before using the report.' };
}
export function normaliseUtilityExtraction(response,state){return extractAnswers(response,state);}
export async function extractUtilityInvoice(request,env){
  const headers={'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','X-Robots-Tag':'noindex, nofollow','Referrer-Policy':'no-referrer'};
  const json=(body,status=200)=>Response.json(body,{status,headers});
  if(request.method!=='POST')return new Response('Method not allowed',{status:405,headers:{...headers,Allow:'POST'}});
  try {
    // Prevent this form endpoint being called cross-origin by ordinary websites.
    const origin=request.headers.get('Origin');
    if(origin && origin!==new URL(request.url).origin)return json({error:'Uploads must come from the ProHouse calculator.'},403);
    const size=Number(request.headers.get('content-length')||0);
    if(size>10*1024*1024)return json({error:'Please upload a file under 8 MB.'},413);
    const form=await request.formData();
    const file=form.get('bill');
    if(!(file instanceof File))return json({error:'Select a utility bill PDF or photograph.'},400);
    if(file.size<100 || file.size>8*1024*1024)return json({error:'The bill must be between 100 bytes and 8 MB.'},413);
    const bytes=new Uint8Array(await file.arrayBuffer());
    const mime=contentKind(bytes);
    const extension=String(file.name||'').split('.').pop()?.toLowerCase();
    if(!mime || !MIME.get(mime).includes(extension))return json({error:'Use a PDF, JPG, PNG or WebP bill.'},415);
    if(!env.AI?.toMarkdown || !env.AI?.run)return json({error:'Automatic bill reading is not enabled in this deployment. You can still enter bills manually.'},503);
    const converted=await env.AI.toMarkdown({
      name:'utility-invoice.'+(extension==='jpeg'?'jpg':extension),
      blob:new Blob([bytes],{type:mime})
    },{conversionOptions:{pdf:{metadata:false},output:{format:'text'}}});
    const convertedItem=Array.isArray(converted)?converted[0]:converted;
    if(!convertedItem || convertedItem.format==='error' || !convertedItem.data)
      return json({error:'Could not read text from this bill. Try a clearer photo or enter its details manually.'},422);
    const text=String(convertedItem.data).slice(0,24000);
    const response=await env.AI.run('@cf/cloudflare/clairic',{
      model:'clairic',state:text,reference_date:new Date().toISOString().slice(0,10),
      fields:{
        utility:{type:'text',instructions:'Identify whether this is a water, gas, or electricity utility invoice. Return the utility type named in the document; null if unclear.'},
        amount:{type:'number',decimals:2,unit:'AUD',instructions:'The amount payable or total payable for THIS utility invoice in Australian dollars. Prefer current invoice total; do not use a prior balance, amount already paid, supply charge alone, GST alone, instalment, or account number. Return null if ambiguous.'},
        start:{type:'date',instructions:'FIRST calendar day of the invoiced consumption / usage / service / billing period. NOT the issue date, payment due date, meter read issue date, or next read date. Return null if not stated.'},
        end:{type:'date',instructions:'LAST calendar day of the invoiced consumption / usage / service / billing period. NOT the issue date, due date, or next meter read date. Return null if not stated.'},
        invoice_number:{type:'text',instructions:'Invoice number or bill reference identifier, not customer account number; null if absent.'},
        provider:{type:'text',instructions:'Utility company or retailer name appearing as the issuer of this invoice.'}
      }
    });
    return json(normaliseUtilityExtraction(response,text));
  }catch(error){
    const message=String(error?.message||'');
    if(message.includes('Unsupported')||message.includes('not supported'))return json({error:'Could not read this file. Try a clear PDF or photo, or enter its details manually.'},422);
    return json({error:'Automatic reading was unavailable. Please retry or fill in the bill manually.'},502);
  }
}
