import { calculateUtilitySplit, money } from './bill-math.js';
import { billDateBounds, syncTenantsToBills, inclusiveStayDays } from './bill-dates.js';
const $ = id => document.getElementById(id);
const escapeHTML = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const palette = ['#e6ff67','#eaa1bd','#93cddd','#cbb4f1','#f2bd7a','#9ac9a8','#f0da7d','#cfcbf2','#dd9a8a'];
const baseDate = new Date();
const localISO = d => [d.getFullYear(),String(d.getMonth()+1).padStart(2,'0'),String(d.getDate()).padStart(2,'0')].join('-');
const periodStart = localISO(new Date(baseDate.getFullYear(),baseDate.getMonth(),1));
const periodEnd = localISO(baseDate);
let serial=0;
const uid = prefix => prefix + '-' + (++serial);
const newBill = (type='water', start=periodStart, end=periodEnd, amount='') => ({id:uid('bill'),type,start,end,amount,label:''});
const newTenant = (name='', start=periodStart, end=periodEnd) => ({id:uid('tenant'),name,start,end,manualStart:false,manualEnd:false});
const data = {
  bills: [newBill('water')],
  tenants: [newTenant()]
};
let lastReport = null;
let exporting = false;
let importing = false;
const attachedFiles=new Map(); // Browser-session files only. Removed bills remove attachments.
// Count anonymous page visits and meaningful completed calculations. Only event names
// leave this browser; property details, bill amounts and tenant names never do.
const sendUsage=type=>{
  try{
    void fetch('/api/sharebill/usage',{
      method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({type}),credentials:'same-origin',keepalive:true
    }).catch(()=>{});
  }catch{}
};
let calculationTimer=null,lastUsageSignature='';
function scheduleCalculationCount(){
  const signature=JSON.stringify({bills:data.bills.map(b=>[b.type,b.amount,b.start,b.end,b.label]),
    tenants:data.tenants.map(t=>[t.id,t.name,t.start,t.end])});
  clearTimeout(calculationTimer);
  if(signature===lastUsageSignature)return;
  calculationTimer=setTimeout(()=>{
    if(!lastReport)return;
    lastUsageSignature=signature;
    sendUsage('calculation');
  },1800);
}

function renderBills(){
  $('bills-list').innerHTML = data.bills.map((b,i)=>'<div class="bill-item" data-kind="bills" data-id="'+escapeHTML(b.id)+'">'+
    '<div class="bill-item-top"><div class="bill-item-index"><span class="bill-index-pill">'+String(i+1).padStart(2,'0')+'</span> UTILITY BILL</div><button class="bill-remove" type="button" data-remove="1" aria-label="Remove bill '+(i+1)+'">REMOVE ×</button></div>'+
    (b.sourceName?'<div class="bill-import-notice"><span>UPLOADED: '+escapeHTML(b.sourceName)+'</span>'+(b.reviewed?'<strong>✓ VERIFIED</strong>':'<strong>REVIEW REQUIRED</strong>')+'</div>':'')+
    '<div class="bill-row three">'+
    '<div><label class="bill-label" for="type-'+b.id+'">UTILITY TYPE</label><select id="type-'+b.id+'" data-field="type" aria-label="Utility type">'+
    [['water','Water'],['gas','Gas'],['electricity','Electricity'],['other','Other']].map(([value,label])=>'<option value="'+value+'"'+(value===b.type?' selected':'')+'>'+label+'</option>').join('')+'</select></div>'+
    '<div><label class="bill-label" for="amount-'+b.id+'">TOTAL BILL / AUD</label><input id="amount-'+b.id+'" inputmode="decimal" type="number" min="0" step="0.01" data-field="amount" placeholder="e.g. 360.00" value="'+escapeHTML(b.amount)+'"></div>'+
    '<div><label class="bill-label" for="ref-'+b.id+'">REFERENCE <span>OPTIONAL</span></label><input id="ref-'+b.id+'" maxlength="60" data-field="reference" placeholder="Invoice no." value="'+escapeHTML(b.reference||'')+'"></div></div>'+
    (b.type==='other'?'<div class="bill-other-name"><label class="bill-label" for="label-'+b.id+'">WHAT BILL IS THIS?</label><input required id="label-'+b.id+'" data-field="label" maxlength="60" placeholder="e.g. Internet, Strata, Council rates" value="'+escapeHTML(b.label||'')+'"></div>':'')+
    '<div class="bill-row"><div><label class="bill-label" for="start-'+b.id+'">BILL FROM</label><input id="start-'+b.id+'" type="date" data-field="start" value="'+escapeHTML(b.start)+'" required></div>'+
    '<div><label class="bill-label" for="end-'+b.id+'">BILL THROUGH <span>INCLUSIVE</span></label><input id="end-'+b.id+'" type="date" data-field="end" value="'+escapeHTML(b.end)+'" required></div></div>'+
    '<div class="bill-file-attachment"><label for="attach-'+b.id+'">'+(attachedFiles.has(b.id)?'✓ INVOICE ATTACHED · '+escapeHTML(attachedFiles.get(b.id).originalName):'＋ ATTACH INVOICE FOR PDF (OPTIONAL)')+'</label><input id="attach-'+b.id+'" type="file" data-attachment="1" accept=".pdf,.jpg,.jpeg,.png,.webp,application/pdf,image/jpeg,image/png,image/webp"><span>Original invoice pages are added after the report.</span></div>'+
    (b.sourceName&&!b.reviewed?'<button class="bill-confirm" type="button" data-confirm="1">I CHECKED THIS BILL — CONFIRM DETAILS ✓</button>':'')+'</div>').join('');
}
function formattedStayDays(start,end){const n=inclusiveStayDays(start,end);return n===null?'Choose valid dates to count days':n+' calendar day'+(n===1?'':'s')+' (both dates included)';}
function renderTenants(){
  $('tenants-list').innerHTML = data.tenants.map((t,i)=>'<div class="bill-item" data-kind="tenants" data-id="'+escapeHTML(t.id)+'">'+
    '<div class="bill-item-top"><div class="bill-item-index"><span class="bill-index-pill">'+String(i+1).padStart(2,'0')+'</span> PERSON / TENANT</div><button class="bill-remove" type="button" data-remove="1" aria-label="Remove tenant '+(i+1)+'">REMOVE ×</button></div>'+
    '<div><label class="bill-label" for="tenant-name-'+t.id+'">TENANT NAME</label><input id="tenant-name-'+t.id+'" maxlength="90" type="text" data-field="name" placeholder="Full name" value="'+escapeHTML(t.name)+'"></div>'+
    '<div class="bill-row" style="margin-top:14px"><div><label class="bill-label" for="tenant-start-'+t.id+'">LIVING FROM</label><input id="tenant-start-'+t.id+'" type="date" data-field="start" value="'+escapeHTML(t.start)+'"></div>'+
    '<div><label class="bill-label" for="tenant-end-'+t.id+'">LIVING THROUGH <span>INCLUSIVE</span></label><input id="tenant-end-'+t.id+'" type="date" data-field="end" value="'+escapeHTML(t.end)+'"></div></div>'+
    '<div class="bill-tenant-days" id="stay-count-'+t.id+'">'+formattedStayDays(t.start,t.end)+'</div></div>').join('');
}
function handleInput(event){
  const target=event.target;
  const wrapper=target.closest('[data-kind][data-id]');
  if(!wrapper || !target.dataset.field)return;
  const record = data[wrapper.dataset.kind].find(x => x.id === wrapper.dataset.id);
  if(!record)return;
  const field=target.dataset.field;
  record[field]=target.value;
  if(wrapper.dataset.kind==='tenants' && (field==='start'||field==='end')){
    record[field==='start'?'manualStart':'manualEnd']=true;
    const count=$('stay-count-'+record.id);
    if(count)count.textContent=formattedStayDays(record.start,record.end);
  }
  if(wrapper.dataset.kind==='bills' && (field==='start'||field==='end')){
    syncTenantsToBills(data.tenants,data.bills);
    renderTenants();
  }

  if(wrapper.dataset.kind==='bills' && record.sourceName) {
    record.reviewed=false;
    const confirmButton=wrapper.querySelector('[data-confirm]');
    if(!confirmButton){
      const control=document.createElement('button');control.className='bill-confirm';control.type='button';control.dataset.confirm='1';control.textContent='I CHECKED THIS BILL — CONFIRM DETAILS ✓';wrapper.appendChild(control);
    }
    const indicator=wrapper.querySelector('.bill-import-notice strong');
    if(indicator)indicator.textContent='REVIEW REQUIRED';
  }
  if(wrapper.dataset.kind==='bills' && field==='type')renderBills();
  updateReport();
}
function handleRemove(event){
  const confirm=event.target.closest('[data-confirm]');
  if(confirm){
    const wrapper=confirm.closest('[data-kind="bills"][data-id]');
    const b=data.bills.find(x=>x.id===wrapper?.dataset.id);
    if(!b)return;
    if(!b.amount||!(Number(b.amount)>0)||!b.start||!b.end||b.end<b.start||(b.type==='other'&&!String(b.label||'').trim())){showError('Fill in the bill amount and valid billing dates before confirming.');return;}
    b.reviewed=true;renderBills();updateReport();return;
  }
  const button=event.target.closest('[data-remove]');
  if(!button)return;
  const wrapper=button.closest('[data-kind][data-id]');
  if(!wrapper)return;
  const kind=wrapper.dataset.kind;
  data[kind]=data[kind].filter(x=>x.id!==wrapper.dataset.id);
  if(kind==='bills'){attachedFiles.delete(wrapper.dataset.id);syncTenantsToBills(data.tenants,data.bills);renderBills();renderTenants();}
  else renderTenants();
  updateReport();
}
$('bills-list').addEventListener('input',handleInput);
$('bills-list').addEventListener('change',handleInput);
$('bills-list').addEventListener('click',handleRemove);
$('tenants-list').addEventListener('input',handleInput);
$('tenants-list').addEventListener('change',handleInput);
$('tenants-list').addEventListener('click',handleRemove);
$('add-bill').addEventListener('click',()=>{
  if(data.bills.length>=30){showError('Maximum 30 bills per report.');return;}
  const bounds=billDateBounds(data.bills)||{start:periodStart,end:periodEnd};
  data.bills.push(newBill('water',bounds.start,bounds.end));
  renderBills();updateReport();
});
$('add-tenant').addEventListener('click',()=>{
  if(data.tenants.length>=80){showError('Maximum 80 tenants per report.');return;}
  const bounds=billDateBounds(data.bills)||{start:periodStart,end:periodEnd};
  data.tenants.push(newTenant('',bounds.start,bounds.end));
  renderTenants();updateReport();
});
$('sync-tenant-dates').addEventListener('click',()=>{
  if(!syncTenantsToBills(data.tenants,data.bills,{force:true})){showError('Enter a valid bill date range first.');return;}
  renderTenants();updateReport();
});
$('demo-btn').addEventListener('click',()=>{
  $('property-name').value='Wolli Creek · Example property';
  attachedFiles.clear();
  data.bills=[newBill('water','2026-10-01','2026-11-05','360.00')];
  data.tenants=[newTenant('Tenant A','2026-10-01','2026-11-05'),newTenant('Tenant B','2026-11-04','2026-11-05')];
  data.tenants[1].manualStart=true;
  renderBills();renderTenants();updateReport();
  $('bill-results').scrollIntoView({behavior:'smooth',block:'nearest'});
});

const acceptedFiles=['application/pdf','image/jpeg','image/png','image/webp'];
const $uploadStatus=$('bill-upload-status'),$uploadLog=$('bill-upload-log');
$('bill-upload').addEventListener('change',async event=>{
  if(importing)return;
  const files=Array.from(event.target.files||[]);
  event.target.value='';
  if(!files.length)return;
  if(files.length>8){showError('Upload up to 8 bills at a time.');return;}
  if(data.bills.length+files.length>31){showError('Maximum 30 bills per report. Remove some bills first.');return;}
  importing=true;
  $('bill-upload').disabled=true;
  $('bill-upload-log').innerHTML='';
  let success=0;
  for(let i=0;i<files.length;i++){
    const file=files[i];
    const summary=document.createElement('div');
    summary.className='bill-upload-result';
    $uploadLog.appendChild(summary);
    $uploadStatus.textContent='Reading bill '+(i+1)+' of '+files.length+'…';
    if(!acceptedFiles.includes(file.type)||file.size>8*1024*1024||file.size<100){
      summary.textContent='Could not read '+file.name+': use a PDF or photo under 8 MB.';
      summary.classList.add('bill-upload-failed');continue;
    }
    try{
      const form=new FormData();form.append('bill',file);
      const response=await fetch('/api/utilities/extract',{method:'POST',body:form});
      const result=await response.json();
      if(!response.ok)throw new Error(result.error||'Bill could not be read.');
      let next;
      const blank=data.bills.find(b=>!b.sourceName&&!String(b.amount).trim()&&!b.reference);
      if(blank){
        Object.assign(blank,{type:result.type||'other',start:result.start||'',end:result.end||'',amount:result.amount||'',reference:result.reference||'',label:result.label||'',sourceName:file.name.slice(0,120),reviewed:false});
        next=blank;
      }else{
        if(data.bills.length>=30)throw new Error('Maximum 30 bills per report.');
        next=newBill(result.type||'other',result.start||'',result.end||'',result.amount||'');
        Object.assign(next,{reference:result.reference||'',label:result.label||'',sourceName:file.name.slice(0,120),reviewed:false});
        data.bills.push(next);
      }
      try {
        attachedFiles.set(next.id,await normaliseAttachment(file));
      } catch (attachmentError) {
        summary.textContent='Bill values extracted, but the original file was not attached: '+attachmentError.message+'. ';
      }
      syncTenantsToBills(data.tenants,data.bills);
      renderBills();renderTenants();updateReport();
      summary.textContent+='Added '+file.name+'. '+(result.missing?.length?'Enter missing '+result.missing.join(', ')+'. ':'')+'Review and confirm its details.';
      success++;
    }catch(error){
      summary.textContent='Could not import '+file.name+': '+(error.message||'Please try again.');
      summary.classList.add('bill-upload-failed');
    }
  }
  importing=false;$('bill-upload').disabled=false;
  $uploadStatus.textContent=success
    ?'Imported '+success+' bill'+(success===1?'':'s')+'. Check the highlighted details and click CONFIRM on each bill.'
    :'No bills imported. You can add invoices manually below.';
});


// Keep PDF source pages unchanged; WebP is converted locally to JPEG so pdf-lib
// can embed it. Files are kept in memory, not uploaded until an export is requested.
async function normaliseAttachment(file){
  const type=file.type||({'pdf':'application/pdf','jpg':'image/jpeg','jpeg':'image/jpeg','png':'image/png','webp':'image/webp'}[file.name.split('.').pop()?.toLowerCase()]);
  if(!acceptedFiles.includes(type))throw new Error('Attach a PDF, JPG, PNG or WebP invoice.');
  if(file.size<100 || file.size>8*1024*1024)throw new Error('Each attached invoice must be below 8 MB.');
  if(type!=='image/webp')return {file,originalName:file.name.slice(0,120)};
  const image=await createImageBitmap(file);
  try{
    const canvas=document.createElement('canvas');canvas.width=image.width;canvas.height=image.height;
    if(canvas.width*canvas.height>24000000)throw new Error('Image is too large to include in a report.');
    const context=canvas.getContext('2d');
    context.fillStyle='#fff';context.fillRect(0,0,canvas.width,canvas.height);
    context.drawImage(image,0,0);
    const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/jpeg',.88));
    if(!blob || blob.size>8*1024*1024)throw new Error('Could not convert this image to PDF-compatible format.');
    return {file:new File([blob],file.name.replace(/\.webp$/i,'.jpg'),{type:'image/jpeg'}),originalName:file.name.slice(0,120)};
  }finally{image.close();}
}
$('bills-list').addEventListener('change',async event=>{
  const input=event.target.closest('[data-attachment]');
  if(!input)return;
  const wrapper=input.closest('[data-kind="bills"]');
  const chosen=input.files?.[0];
  if(!chosen||!wrapper)return;
  try{
    const normalized=await normaliseAttachment(chosen);
    const withoutPrevious=[...attachedFiles].filter(([id])=>id!==wrapper.dataset.id).reduce((sum,[,v])=>sum+v.file.size,0);
    if(withoutPrevious+normalized.file.size>22*1024*1024)throw new Error('Combined attachments must be under 22 MB.');
    attachedFiles.set(wrapper.dataset.id,normalized);
    renderBills();
    updateReport();
  }catch(error){showError(error.message||'Could not attach this bill.');}
});

const safeColour = i => palette[i%palette.length];
function showError(message){
  $('report-error').textContent=message;
  $('report-error').hidden=false;
}
function updateReport(){
  $('report-error').hidden=true;
  $('report-error').textContent='';
  try{
    if(data.bills.length>30)throw new Error('Maximum 30 utility bills per report.');
    if(!data.bills.some(b => String(b.amount).trim() !== '' && Number(b.amount) !== 0))
      throw new Error('Add at least one utility bill amount above $0.');
    const calculated=calculateUtilitySplit(data);
    if(!calculated.billCount)throw new Error('Add a valid, non-zero utility bill.');
    lastReport=calculated;
    $('grand-total').textContent=money(calculated.totalCents);
    $('summary-bills').textContent=String(calculated.billCount);
    $('summary-tenants').textContent=String(calculated.tenantCount);
    $('report-state').textContent='CALCULATED';
    $('report-state').style.background='#4f5e2b';
    const total=calculated.totalCents;
    $('distribution').innerHTML=calculated.summary.map((s,i)=>'<div title="'+escapeHTML(s.name+': '+money(s.amountCents))+'" style="width:'+((s.amountCents/total)*100).toFixed(6)+'%;background:'+safeColour(i)+'"></div>').join('');
    $('tenant-summary').innerHTML=calculated.summary.map((s,i)=>'<div class="bill-tenant-line"><div class="bill-person-name"><span class="bill-colour" style="background:'+safeColour(i)+'"></span><span>'+escapeHTML(s.name)+'</span></div><strong class="bill-person-amount">'+money(s.amountCents)+'</strong></div>').join('');
    const needsReview=data.bills.some(b=>b.sourceName&&!b.reviewed);
    if(needsReview){$('report-state').textContent='CHECK IMPORTED BILL';$('report-state').style.background='#694b36';}
    $('export-pdf').disabled=needsReview;
    $('print-report').disabled=needsReview;
    if(!needsReview)scheduleCalculationCount();
    else clearTimeout(calculationTimer);
  }catch(error){
    lastReport=null;
    clearTimeout(calculationTimer);
    $('report-state').textContent='NEEDS DETAILS';
    $('report-state').style.background='#694b36';
    $('grand-total').textContent='$0.00';
    $('summary-bills').textContent='0';
    $('summary-tenants').textContent=String(data.tenants.length);
    $('distribution').innerHTML='';
    $('tenant-summary').innerHTML='<p>Complete the entries to calculate each person’s share.</p>';
    $('export-pdf').disabled=true;
    $('print-report').disabled=true;
    const message=String(error.message||error);
    if(!message.startsWith('Add at least one utility bill amount'))showError(message);
  }
}
async function makePDF(){
  if(!lastReport)throw new Error('Complete the billing details first.');
  if(data.bills.some(b=>b.sourceName&&!b.reviewed))throw new Error('Confirm each uploaded bill before exporting.');
  const payload={property:$('property-name').value.trim(),tenants:data.tenants,bills:data.bills};
  const body=new FormData();
  body.append('report',JSON.stringify(payload));
  for(const bill of data.bills){
    const item=attachedFiles.get(bill.id);
    if(item && String(bill.amount).trim()!=='' && Number(bill.amount)>0)
      body.append('invoice_'+bill.id,item.file,item.file.name);
  }
  const response=await fetch('/api/utilities/pdf',{method:'POST',body});
  if(!response.ok){
    let message='Could not generate your PDF. Please try again.';
    try{const info=await response.json();if(typeof info.error==='string')message=info.error;}catch{}
    throw new Error(message);
  }
  return response.blob();
}
function fileName(){return 'ProHouse-Utility-Split-'+new Date().toISOString().slice(0,10)+'.pdf';}
$('export-pdf').addEventListener('click',async()=>{
  if(exporting)return;exporting=true;$('export-pdf').disabled=true;
  const previous=$('export-pdf').innerHTML;$('export-pdf').textContent='GENERATING PDF…';
  try{
    const blob=await makePDF();const url=URL.createObjectURL(blob);
    const a=document.createElement('a');a.href=url;a.download=fileName();document.body.appendChild(a);a.click();a.remove();
    setTimeout(()=>URL.revokeObjectURL(url),60000);
  }catch(error){showError(error.message||'Could not export the PDF.');}
  finally{exporting=false;$('export-pdf').innerHTML=previous;$('export-pdf').disabled=!lastReport||data.bills.some(b=>b.sourceName&&!b.reviewed);}
});
$('print-report').addEventListener('click',async()=>{
  if(exporting)return;
  const tab=window.open('','_blank');
  try{
    const blob=await makePDF();const url=URL.createObjectURL(blob);
    if(tab){tab.location.href=url;}else{
      const a=document.createElement('a');a.href=url;a.target='_blank';a.rel='noopener';a.click();
    }
    setTimeout(()=>URL.revokeObjectURL(url),180000);
  }catch(error){if(tab)tab.close();showError(error.message||'Could not prepare PDF preview.');}
});
renderBills();renderTenants();updateReport();
sendUsage('visit');
