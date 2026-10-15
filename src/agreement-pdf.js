import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
// A self-contained PDF is generated from the stored agreement snapshot, never current terms.
export async function agreementPDF(a){
 const d=a.data,p=d.proposal,c=d.cleaner,doc=await PDFDocument.create();
 doc.setTitle('ProHouse Vendor Service Agreement - '+a.id);doc.setAuthor('ProHouse');
 doc.setCreationDate(new Date(d.prohouseSignedAt||d.cleanerSignedAt||d.audit[0].at));
 const regular=await doc.embedFont(StandardFonts.Helvetica),bold=await doc.embedFont(StandardFonts.HelveticaBold);
 const pink=rgb(.67,.13,.36),ink=rgb(.08,.13,.2),grey=rgb(.34,.39,.45),width=491;
 let page,y;
 function newPage(){page=doc.addPage([595.28,841.89]);y=781;page.drawText('PROHOUSE  /  VENDOR AGREEMENT',{x:52,y:809,size:9,font:bold,color:pink});}
 function text(value){return Array.from(String(value??'').normalize('NFC').replace(/[\u2010-\u2015]/g,'-').replace(/\u202f|\u00a0/g,' '),ch=>{if(ch==='\n'||ch==='\r')return ch;try{regular.encodeText(ch);return ch;}catch{return '[U+'+ch.codePointAt(0).toString(16).toUpperCase()+']';}}).join('');}
 function lines(value,font,size){const result=[];for(const paragraph of text(value).split(/\r?\n/)){let line='';for(const word of paragraph.split(/\s+/)){let rest=word;if(line&&font.widthOfTextAtSize(line+' '+rest,size)>width){result.push(line);line='';}while(font.widthOfTextAtSize(rest,size)>width){let n=rest.length;while(n>1&&font.widthOfTextAtSize(rest.slice(0,n),size)>width)n--;result.push(rest.slice(0,n));rest=rest.slice(n);}line+=(line?' ':'')+rest;}result.push(line);}return result;}
 function block(value,{heading=false,title=false}={}){const size=title?21:heading?12:10,font=heading||title?bold:regular,leading=size*1.35,ls=lines(value,font,size);if(y<75+Math.min(ls.length,heading?3:2)*leading)newPage();for(const line of ls){if(y<65)newPage();page.drawText(line,{x:52,y,size,font,color:title?pink:ink});y-=leading;}y-=heading?7:8;}
 function heading(s){if(y<130)newPage();block(s,{heading:true});}
 function rates(rows){for(const [i,r] of rows.entries())block(`${i+1}. ${r.service}\nUnit: ${r.unit} | AUD rate: ${String(r.rate??'').trim()===''?'Vendor to propose':'$'+Number(r.rate).toFixed(2)}`);}
 newPage();block('Vendor Service Agreement',{title:true});
 block(`Reference: ${a.id}\nStatus: ${a.status==='Completed'?'Completed - both parties signed':'DRAFT - agreement not completed'}\nTerms version: ${d.termsVersion}`);
 heading('A / ProHouse service schedule');
 block(`Contracting legal entity: ${p.legal} trading as ProHouse\nABN: ${p.abn}\nBusiness address: ${p.address}\nProHouse phone / WhatsApp: ${p.phone||''}\nProHouse email: ${p.email||'hi@prohouse.com.au'}\nService address: ${p.serviceAddress||'As specified in scope'}\nStart date: ${p.start}\nInvoice payment: ${p.paymentDays} calendar days after a correct, undisputed invoice`);
 heading('Services and inclusions');block(p.scope);heading('ProHouse offered rates');rates(p.rows);block(`${p.gst}\nInsurance: ${p.insurance}`);
 if(c){heading('B / Vendor business and payment information');block(`Authorised representative: ${c.legal}\nEntity / trading name: ${c.entity}\nABN: ${c.abn}\nBusiness address: ${c.address}\nEmail: ${c.email}\nPhone: ${c.phone}\nAccount name: ${c.accountName}\nBank: ${c.bank}\nBSB: ${c.bsb}\nAccount number: ${c.accountNumber}`);heading('Vendor final proposed rates (accepted on ProHouse countersignature)');rates(c.rows);block(`${c.gst}\nService inclusions / pricing notes: ${c.notes||'None'}`);}
 newPage();heading('Terms and conditions');for(const [h,t] of d.terms){heading(h);block(t);}
 heading('Identity verification');block(d.identityVerification?`${d.identityVerification.method}\nSignatory: ${d.identityVerification.signatory}\nChecked / reviewed: ${d.identityVerification.checkedAt||d.identityVerification.reviewedAt||''}`:'Pending / see portal verification result');
 heading('C / Electronic signatures');block(`Vendor signature: ${c?.signature||'Pending'}\nSigned at (UTC): ${d.cleanerSignedAt||'Pending'}\nVerified email: ${c?.email||'Pending'}\n\nProHouse signature: ${d.prohouseSignature||'Pending'}\nSigned at (UTC): ${d.prohouseSignedAt||'Pending'}\nVerified email: ${d.prohouseEmail||'Pending'}\n\nOperating deadlines use Australia/Sydney time.`);
 heading('Agreement integrity');block(`Vendor signed content SHA-256:\n${d.signedContentHash||'Pending'}\nCompleted content SHA-256:\n${d.completedContentHash||'Pending'}`);
 heading('Agreement activity');for(const e of d.audit)block(`${e.event}\n${e.at} | ${e.by}`);
 const pages=doc.getPages();pages.forEach((p,i)=>{p.drawLine({start:{x:52,y:48},end:{x:543,y:48},thickness:.5,color:grey});p.drawText(`ProHouse | ${a.id} | ${i+1} / ${pages.length}`,{x:52,y:32,size:8,font:regular,color:grey});});
 return doc.save({useObjectStreams:false});
}
