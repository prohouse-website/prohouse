/* ProHouse Live With Us: privacy-conscious Didit tenant identity verification.
   The form never uploads ID images to ProHouse while Didit is configured.
   The existing ID upload remains as a temporary fallback until Cloudflare secrets are installed. */
(()=>{
 const form=document.getElementById('application')||document.getElementById('coApplication');
 if(!form)return;
 const second=form.id==='coApplication',role=second?'second':'first';
 const $=id=>document.getElementById(id),panel=$('diditPanel'),upload=$('idUploadFields');
 const state={enabled:false,verified:false,token:'',url:''};
 const consent=$('diditConsent'),status=$('diditStatus'),start=$('diditStart'),
  open=$('diditOpen'),check=$('diditCheck'),hidden=$('identityToken');
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
  open.hidden=true;check.hidden=true;
  message('Your legal name or email changed. Start a new Didit verification for the updated details.');
 }
 async function api(path,options={}){
  const response=await fetch('/api/longstay/identity/'+path,{
   credentials:'same-origin',cache:'no-store',...options
  });
  const data=await response.json().catch(()=>({message:'Invalid verification response.'}));
  if(!response.ok)throw Error(data.message||'Identity verification failed.');
  return data;
 }
 async function refresh(){
  if(!state.enabled||!state.token)return;
  const button=check;button.disabled=true;button.textContent='Checking Didit…';
  try{
   const d=await api('status',{method:'POST',headers:{
    'Authorization':'Bearer '+state.token,'Content-Type':'application/json'
   },body:'{}'});
   if(d.verified){
    state.verified=true;
    hidden.value=state.token;
    message('Verified by Didit. ID, liveness and face-match checks approved for '+d.verifiedName+'.','approved');
    check.hidden=true;open.hidden=true;start.hidden=true;
   }else{
    state.verified=false;
    hidden.value='';
    message(d.status==='Name Mismatch'?
     'Your verified ID name did not match the form. Check your legal name and restart verification, or contact ProHouse.':
     'Didit result: '+d.status+'. If you just finished, try Check verification result again.',d.status==='Name Mismatch'?'error':'pending');
   }
  }catch(e){message(e.message,'error')}
  finally{button.disabled=false;button.textContent='Check verification result'}
 }
 async function startVerification(){
  if(!state.enabled)return;
  const fullname=readName(),mail=email();
  if(fullname.length<3||!mail||!mail.includes('@')){
   message('Enter your legal first name, family name and email before starting Didit.','error');return;
  }
  if(!consent.checked){
   message('Please consent to Didit checking your ID, selfie, liveness and face match.','error');return;
  }
  const invitationToken=second?$('invitationToken')?.value||'':null;
  if(second&&!invitationToken){message('Open the private joint-application invitation link before starting.','error');return;}
  start.disabled=true;start.textContent='Creating your secure Didit session…';
  try{
   const d=await api('start',{method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({role,legalName:fullname,email:mail,consent:true,
      ...(second?{invitationToken}:{})})});
   state.token=d.verificationToken;state.url=d.url;state.verified=false;
   hidden.value='';
   open.href=d.url;open.hidden=false;check.hidden=false;
   start.textContent='Start a new verification';
   message('Session ready. Open Didit, take a photo of your ID and complete the selfie/liveness check. Return to this tab and select Check verification result.','pending');
  }catch(e){message(e.message,'error');start.textContent='Try Didit verification again'}
  finally{start.disabled=false}
 }
 function validate(){
  if(!state.enabled)return true;
  if(state.verified&&hidden.value===state.token)return true;
  message('Please finish Didit ID verification and check that the result is Approved before continuing.','error');
  panel.scrollIntoView({behavior:'smooth',block:'center'});
  return false;
 }
 window.ProHouseDidit={validate,isEnabled:()=>state.enabled,isVerified:()=>state.verified};
 for(const field of [second?'secondFirstName':'firstName',second?'secondLastName':'lastName',second?'invitedEmail':'email']){
  $(field)?.addEventListener('change',resetOnEdit);
 }
 start.addEventListener('click',startVerification);
 check.addEventListener('click',refresh);
 open.addEventListener('click',()=>message('Didit opened in a new tab. When finished, return here and check the verification result.','pending'));
 addEventListener('focus',()=>{
  if(state.enabled&&state.token&&!state.verified)setTimeout(refresh,600);
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
