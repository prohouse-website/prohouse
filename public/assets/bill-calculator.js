import { calculateUtilitySplit, fmtDate, money, VACANT_ID } from './bill-math.js';
const $ = id => document.getElementById(id);
const escapeHTML = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const palette = ['#e6ff67','#eaa1bd','#93cddd','#cbb4f1','#f2bd7a','#9ac9a8','#f0da7d','#cfcbf2','#dd9a8a'];
const baseDate = new Date();
const localISO = d => [d.getFullYear(),String(d.getMonth()+1).padStart(2,'0'),String(d.getDate()).padStart(2,'0')].join('-');
const periodStart = localISO(new Date(baseDate.getFullYear(),baseDate.getMonth(),1));
const periodEnd = localISO(baseDate);
let serial=0;
const uid = prefix => prefix + '-' + (++serial);
const newBill = (type='water', start=periodStart, end=periodEnd, amount='') => ({id:uid('bill'),type,start,end,amount});
const newTenant = (name='', start=periodStart, end=periodEnd) => ({id:uid('tenant'),name,start,end});
const data = {
  bills: [newBill('water')],
  tenants: [newTenant('Tenant A'),newTenant('Tenant B')]
};
let lastReport = null;
let exporting = false;
let importing = false;

function renderBills(){
  $('bills-list').innerHTML = data.bills.map((b,i)=>'<div class="bill-item" data-kind="bills" data-id="'+escapeHTML(b.id)+'">'+
    '<div class="bill-item-top"><div class="bill-item-index"><span class="bill-index-pill">'+String(i+1).padStart(2,'0')+'</span> UTILITY BILL</div><button class="bill-remove" type="button" data-remove="1" aria-label="Remove bill '+(i+1)+'">REMOVE ×</button></div>'+
    (b.sourceName?'<div class="bill-import-notice"><span>UPLOADED: '+escapeHTML(b.sourceName)+'</span>'+(b.reviewed?'<strong>✓ VERIFIED</strong>':'<strong>REVIEW REQUIRED</strong>')+'</div>':'')+
    '<div class="bill-row three">'+
    '<div><label class="bill-label" for="type-'+b.id+'">UTILITY TYPE</label><select id="type-'+b.id+'" data-field="type" aria-label="Utility type">'+
    [['water','Water'],['gas','Gas'],['electricity','Electricity'],['other','Other']].map(([value,label])=>'<option value="'+value+'"'+(value===b.type?' selected':'')+'>'+label+'</option>').join('')+'</select></div>'+
    '<div><label class="bill-label" for="amount-'+b.id+'">TOTAL BILL / AUD</label><input id="amount-'+b.id+'" inputmode="decimal" type="number" min="0" step="0.01" data-field="amount" placeholder="e.g. 360.00" value="'+escapeHTML(b.amount)+'"></div>'+
    '<div><label class="bill-label" for="ref-'+b.id+'">REFERENCE <span>OPTIONAL</span></label><input id="ref-'+b.id+'" maxlength="60" data-field="reference" placeholder="Invoice no." value="'+escapeHTML(b.reference||'')+'"></div></div>'+
    '<div class="bill-row"><div><label class="bill-label" for="start-'+b.id+'">BILL FROM</label><input id="start-'+b.id+'" type="date" data-field="start" value="'+escapeHTML(b.start)+'" required></div>'+
    '<div><label class="bill-label" for="end-'+b.id+'">BILL THROUGH <span>INCLUSIVE</span></label><input id="end-'+b.id+'" type="date" data-field="end" value="'+escapeHTML(b.end)+'" required></div></div>'+
    (b.sourceName&&!b.reviewed?'<button class="bill-confirm" type="button" data-confirm="1">I CHECKED THIS BILL — CONFIRM DETAILS ✓</button>':'')+'</div>').join('');
}
function renderTenants(){
  $('tenants-list').innerHTML = data.tenants.map((t,i)=>'<div class="bill-item" data-kind="tenants" data-id="'+escapeHTML(t.id)+'">'+
    '<div class="bill-item-top"><div class="bill-item-index"><span class="bill-index-pill">'+String(i+1).padStart(2,'0')+'</span> PERSON / TENANT</div><button class="bill-remove" type="button" data-remove="1" aria-label="Remove tenant '+(i+1)+'">REMOVE ×</button></div>'+
    '<div><label class="bill-label" for="tenant-name-'+t.id+'">TENANT NAME</label><input id="tenant-name-'+t.id+'" maxlength="90" type="text" data-field="name" placeholder="Full name" value="'+escapeHTML(t.name)+'"></div>'+
    '<div class="bill-row" style="margin-top:14px"><div><label class="bill-label" for="tenant-start-'+t.id+'">LIVING FROM</label><input id="tenant-start-'+t.id+'" type="date" data-field="start" value="'+escapeHTML(t.start)+'"></div>'+
    '<div><label class="bill-label" for="tenant-end-'+t.id+'">LIVING THROUGH <span>INCLUSIVE</span></label><input id="tenant-end-'+t.id+'" type="date" data-field="end" value="'+escapeHTML(t.end)+'"></div></div></div>').join('');
}
function handleInput(event){
  const target=event.target;
  const wrapper=target.closest('[data-kind][data-id]');
  if(!wrapper || !target.dataset.field)return;
  const record = data[wrapper.dataset.kind].find(x => x.id === wrapper.dataset.id);
  if(!record)return;
  record[target.dataset.field]=target.value;
  if(wrapper.dataset.kind==='bills' && record.sourceName) {
    record.reviewed=false;
    const confirmButton=wrapper.querySelector('[data-confirm]');
    if(!confirmButton){
      const control=document.createElement('button');control.className='bill-confirm';control.type='button';control.dataset.confirm='1';control.textContent='I CHECKED THIS BILL — CONFIRM DETAILS ✓';wrapper.appendChild(control);
    }
    const indicator=wrapper.querySelector('.bill-import-notice strong');
    if(indicator)indicator.textContent='REVIEW REQUIRED';
  }
  updateReport();
}
function handleRemove(event){
  const confirm=event.target.closest('[data-confirm]');
  if(confirm){
    const wrapper=confirm.closest('[data-kind="bills"][data-id]');
    const b=data.bills.find(x=>x.id===wrapper?.dataset.id);
    if(!b)return;
    if(!b.amount||!(Number(b.amount)>0)||!b.start||!b.end||b.end<b.start){showError('Fill in the bill amount and valid billing dates before confirming.');return;}
    b.reviewed=true;renderBills();updateReport();return;
  }
  const button=event.target.closest('[data-remove]');
  if(!button)return;
  const wrapper=button.closest('[data-kind][data-id]');
  if(!wrapper)return;
  const kind=wrapper.dataset.kind;
  data[kind]=data[kind].filter(x=>x.id!==wrapper.dataset.id);
  if(kind==='bills')renderBills();else renderTenants();
  updateReport();
}
$('bills-list').addEventListener('input',handleInput);
$('bills-list').addEventListener('change',handleInput);
$('bills-list').addEventListener('click',handleRemove);
$('tenants-list').addEventListener('input',handleInput);
$('tenants-list').addEventListener('change',handleInput);
$('tenants-list').addEventListener('click',handleRemove);
$('add-bill').addEventListener('click',()=>{data.bills.push(newBill(data.bills.length===0?'water':'other'));renderBills();updateReport();});
$('add-tenant').addEventListener('click',()=>{if(data.tenants.length>=80){showError('Maximum 80 tenants per report.');return;}data.tenants.push(newTenant('Tenant '+(data.tenants.length+1)));renderTenants();updateReport();});
$('demo-btn').addEventListener('click',()=>{
  $('property-name').value='Wolli Creek · Example property';
  data.bills=[newBill('water','2026-10-01','2026-11-05','360.00')];
  data.tenants=[newTenant('Tenant A','2026-10-01','2026-11-05'),newTenant('Tenant B','2026-11-04','2026-11-05')];
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
        Object.assign(blank,{type:result.type||'other',start:result.start||'',end:result.end||'',amount:result.amount||'',reference:result.reference||'',sourceName:file.name.slice(0,120),reviewed:false});
        next=blank;
      }else{
        if(data.bills.length>=30)throw new Error('Maximum 30 bills per report.');
        next=newBill(result.type||'other',result.start||'',result.end||'',result.amount||'');
        Object.assign(next,{reference:result.reference||'',sourceName:file.name.slice(0,120),reviewed:false});
        data.bills.push(next);
      }
      renderBills();updateReport();
      summary.textContent='Added '+file.name+'. '+(result.missing?.length?'Enter missing '+result.missing.join(', ')+'. ':'')+'Review and confirm its details.';
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
  }catch(error){
    lastReport=null;
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
  const response=await fetch('/api/utilities/pdf',{
    method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({property:$('property-name').value.trim(),tenants:data.tenants,bills:data.bills})
  });
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
