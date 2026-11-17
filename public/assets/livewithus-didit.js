/* ProHouse Live With Us: privacy-conscious Didit tenant identity verification.
   The form never uploads ID images to ProHouse while Didit is configured.
   The existing ID upload remains as a temporary fallback until Cloudflare secrets are installed. */
(()=>{
 const form=document.getElementById('application')||document.getElementById('coApplication');
 if(!form)return;
 const second=form.id==='coApplication',role=second?'second':'first';
 const $=id=>document.getElementById(id),panel=$('diditPanel'),upload=$('idUploadFields');
 const state={enabled:false,verified:false,pendingReview:false,declined:false,token:'',url:'',checking:false,pollTimer:null};
 const consent=$('diditConsent'),status=$('diditStatus'),start=$('diditStart'),
  hidden=$('identityToken');
 const readName=()=>second?[$('secondFirstName').value,$('secondLastName').value].join(' ').trim():
  [$('firstName').value,$('lastName').value].join(' ').trim();
 const email=()=>second?$('invitedEmail').value.trim():$('email').value.trim();
 const message=(value,type='info')=>{
  status.textContent=value;
  status.dataset.type=type;
 };
 function resetOnEdit(){
  if(!state.enabled)return;
  state.verified=false;state.pendingReview=false;state.declined=false;state.token='';state.url='';hidden.value='';
  stopPolling();
  start.hidden=false;start.disabled=false;start.textContent='Verify your ID';
  message('Your legal name or email changed. Verify your ID again to continue.','pending');
 }
 async function api(path,options={}){
  const response=await fetch('/api/longstay/identity/'+path,{
   credentials:'same-origin',cache:'no-store',...options
  });
  const data=await response.json().catch(()=>({message:'Invalid verification response.'}));
  if(!response.ok)throw Error(data.message||'Identity verification failed.');
  return data;
 }
 function stopPolling(){
  if(state.pollTimer){clearInterval(state.pollTimer);state.pollTimer=null;}
 }
 async function refresh(){
  if(!state.enabled||!state.token||state.verified||state.checking)return;
  if(document.visibilityState==='hidden')return;
  state.checking=true;
  try{
   const d=await api('status',{method:'POST',headers:{
    'Authorization':'Bearer '+state.token,'Content-Type':'application/json'
   },body:'{}'});
   if(d.verified){
    state.verified=true;state.pendingReview=false;state.declined=false;
    hidden.value=state.token;
    stopPolling();
    start.hidden=true;
    message('Your ID has been approved by Didit for '+d.verifiedName+'. You can continue your application.','approved');
   }else if(d.status==='In Review'){
    // The ID/selfie work is finished; only ProHouse's manual decision remains.
    state.pendingReview=true;state.declined=false;
    hidden.value=state.token;
    start.hidden=true;
    message('ID submitted successfully. Awaiting ProHouse manual review. You can continue and submit your rental application; it cannot be approved until your ID is approved.','pending');
   }else if(d.status==='Declined'||d.status==='Name Mismatch'){
    state.pendingReview=false;state.declined=true;
    hidden.value='';start.hidden=true;
    // Keep checking for a ProHouse reviewer requesting resubmission.
    message(d.status==='Name Mismatch'?
      'The name on your ID does not match your application. Please contact ProHouse to correct it.':
      'Your ID verification was declined. ProHouse will review whether you can resubmit. Please contact hi@prohouse.com.au.','error');
   }else if(d.status==='Resubmitted'){
    state.pendingReview=false;hidden.value='';start.hidden=true;
    message('ProHouse has requested that you redo a Didit check. Follow the secure resubmission link sent to you, then return here.','pending');
   }else{
    state.pendingReview=false;hidden.value='';
    start.hidden=false;start.textContent='Resume Didit verification';
    message('Please finish the ID and selfie checks in Didit. Use Resume to reopen your existing verification link.','pending');
   }
  }catch(e){
   message('Could not check your verification yet. Your result will be checked again automatically when you return.','pending');
  }finally{state.checking=false}
 }
 function beginPolling(){
  stopPolling();
  state.pollTimer=setInterval(refresh,9000);
 }
 async function startVerification(){
  if(!state.enabled)return;
  const fullname=readName(),mail=email();
  if(fullname.length<3||!mail||!mail.includes('@')){
   message('Enter your legal first name, family name and email before verifying your ID.','error');return;
  }
  if(!consent.checked){
   message('Please consent to Didit checking your ID, selfie, liveness and face match.','error');return;
  }
  if(state.token&&state.url){
   // Never create a duplicate session when someone resumes an unfinished check.
   window.open(state.url,'_blank','noopener');
   return;
  }
  const invitationToken=second?$('invitationToken')?.value||'':null;
  if(second&&!invitationToken){
   message('Open the private joint-application invitation link before verifying your ID.','error');return;
  }
  // Open a blank tab while this click is still a user gesture. Opening it after
  // the asynchronous Didit API call is blocked by Safari and in-app browsers.
  const diditTab=window.open('about:blank','_blank');
  if(!diditTab){
   message('Your browser blocked the secure Didit tab. Allow pop-ups for ProHouse and select Verify your ID again.','error');
   return;
  }
  try{
   diditTab.document.title='Opening secure ID verification';
   diditTab.document.body.textContent='Connecting securely to Didit…';
  }catch{}
  start.disabled=true;start.textContent='Opening Didit…';
  try{
   const d=await api('start',{method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({role,legalName:fullname,email:mail,consent:true,
      ...(second?{invitationToken}:{})})});
   const verifiedUrl=new URL(d.url);
   if(verifiedUrl.protocol!=='https:'||verifiedUrl.hostname!=='verify.didit.me')
    throw Error('Unexpected Didit verification link. Please contact ProHouse.');
   state.token=d.verificationToken;state.url=verifiedUrl.href;
   state.verified=false;state.pendingReview=false;state.declined=false;
   hidden.value='';
   diditTab.location.replace(verifiedUrl.href);
   // Break the opener relationship after navigation is instructed.
   try{diditTab.opener=null}catch{}
   message('Didit opened in a new tab. Complete your ID and selfie checks, then return here. Your result updates automatically.','pending');
   beginPolling();
  }catch(e){
   try{diditTab.close()}catch{}
   message(e.message,'error');
  }finally{
   start.disabled=false;
   start.textContent=state.token?'Resume Didit verification':'Verify your ID';
  }
 }
 function validate(){
  if(!state.enabled)return true;
  if((state.verified||state.pendingReview)&&state.token&&hidden.value===state.token)return true;
  message(state.declined?
   'Your ID check needs attention before the application can be submitted. Contact ProHouse for resubmission.':
   'Please finish the ID and selfie checks, or wait until Didit confirms your submission is In Review.','error');
  panel.scrollIntoView({behavior:'smooth',block:'center'});
  return false;
 }
 window.ProHouseDidit={validate,isEnabled:()=>state.enabled,isVerified:()=>state.verified};
 for(const field of [second?'secondFirstName':'firstName',second?'secondLastName':'lastName',second?'invitedEmail':'email']){
  $(field)?.addEventListener('change',resetOnEdit);
 }
 start.addEventListener('click',startVerification);
 addEventListener('focus',()=>{
  if(state.enabled&&state.token&&!state.verified)setTimeout(refresh,600);
 });
 document.addEventListener('visibilitychange',()=>{
  if(document.visibilityState==='visible'&&state.enabled&&state.token&&!state.verified)
   refresh();
 });
 (async()=>{
  try{
   const cfg=await api('config');
   state.enabled=!!cfg.diditAvailable;
   panel.hidden=!state.enabled;
   upload.hidden=state.enabled;
   for(const input of upload.querySelectorAll('input[type=file]')){
    input.required=!state.enabled&&input.dataset.required==='true';
    if(state.enabled)input.value='';
   }
   if(!state.enabled){
    message('Didit is not configured on the ProHouse website yet. The existing ID-upload path remains available until activation.','pending');
   }
  }catch(e){
   state.enabled=false;panel.hidden=true;upload.hidden=false;
   // Fail safely to the original required uploads on configuration errors.
   for(const input of upload.querySelectorAll('input[type=file]'))
    input.required=input.dataset.required==='true';
  }
 })();
})();
