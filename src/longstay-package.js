import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

const A4=[595.28,841.89];
function safe(text){return String(text||'Document').normalize('NFKD').replace(/[\u0300-\u036f]/g,'').replace(/[^\x20-\x7E]/g,'?').slice(0,105);}
function fit(w,h,maxW,maxH){const scale=Math.min(maxW/w,maxH/h,1);return [w*scale,h*scale];}
/**
 * Produce one readable PDF: application summary + each PDF page or scanned image page.
 * When a prior first-person PDF is used, skip its summary pages so the joint
 * application has just one summary and all first/second applicant evidence.
 * Original PDFs are copied as native pages, not rendered to low-res screenshots.
 */
export async function combineApplicationPDF(summaryBytes,documents=[],options={}){
  const out=await PDFDocument.load(summaryBytes);
  const initialPages=out.getPageCount();
  const font=await out.embedFont(StandardFonts.HelveticaBold);
  const addDocument=async(doc)=>{
    const bytes=doc.bytes;
    if(!(bytes instanceof Uint8Array)||!bytes.byteLength)throw Error('Empty uploaded document.');
    if(doc.type==='application/pdf'){
      let other;
      try{other=await PDFDocument.load(bytes,{ignoreEncryption:false});}
      catch{throw Error('Uploaded PDF "'+doc.filename+'" cannot be merged. Use an unprotected PDF.');}
      if(!other.getPageCount())throw Error('Empty uploaded PDF: '+doc.filename);
      const pages=await out.copyPages(other,other.getPageIndices());
      for(const page of pages)out.addPage(page);
    } else if(doc.type==='image/jpeg'||doc.type==='image/png'){
      const img=doc.type==='image/jpeg'?await out.embedJpg(bytes):await out.embedPng(bytes);
      const page=out.addPage(A4);
      const [w,h]=fit(img.width,img.height,A4[0]-72,A4[1]-125);
      page.drawText(safe(doc.label||doc.filename),{x:36,y:A4[1]-43,font,size:12,color:rgb(.13,.18,.15)});
      page.drawImage(img,{x:(A4[0]-w)/2,y:A4[1]-88-h,width:w,height:h});
      page.drawText(safe(doc.filename),{x:36,y:24,font,size:9,color:rgb(.3,.35,.32)});
    }else throw Error('Only PDF, JPEG and PNG supporting documents can be merged into the application PDF.');
  };
  if(options.priorPdf){
    const prior=await PDFDocument.load(options.priorPdf);
    const start=options.priorSummaryPages;
    if(!Number.isInteger(start)||start<=0||start>=prior.getPageCount())
      throw Error('The first applicant document package is incomplete.');
    const pages=await out.copyPages(prior,prior.getPageIndices().slice(start));
    pages.forEach(p=>out.addPage(p));
  }
  for(const doc of documents)await addDocument(doc);
  return {bytes:new Uint8Array(await out.save()),summaryPages:initialPages,totalPages:out.getPageCount()};
}
