/* ProHouse Live With Us: privacy-conscious Didit tenant identity verification.
   The form never uploads ID images to ProHouse while Didit is configured.
   The existing ID upload remains as a temporary fallback until Cloudflare secrets are installed. */
(()=>{
 const form=document.getElementById('application')||document.getElementById('coApplication');
 if(!form)return;
 const second=form.id==='coApplication',role=second?'second':'first';
 const $=id=>document.getElementById(id),panel=$('diditPanel'),upload=$('idUploadFields');
 const state={enabled:false,verified:false,token:'',url:'',checking:false,pollTimer:null};
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
  state.verified=false;state.token='';state.url='';hidden.value='';
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
    state.verified=true;
    hidden.value=state.token;
    stopPolling();
    start.hidden=true;
    message('ID verified successfully with Didit for '+d.verifiedName+'. You can continue your application.','approved');
   }else{
    hidden.value='';
    if(d.status==='Name Mismatch'){
     stopPolling();
     message('The verified ID name does not match this application. Correct your legal name and select Verify your ID again.','error');
     start.hidden=false;start.textContent='Verify your ID';
    }else{
     message('Verification in progress. Complete the Didit checks, then return here. Your result will update automatically.','pending');
    }
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
   state.token=d.verificationToken;state.url=verifiedUrl.href;state.verified=false;
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
   start.textContent='Verify your ID';
  }
 }
 function validate(){
  if(!state.enabled)return true;
  if(state.verified&&hidden.value===state.token)return true;
  message('Please complete your Didit identity verification. When you return to this tab, the result will update automatically.','error');
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
