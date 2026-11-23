const el = id => document.getElementById(id);
const sessionKey = 'prohouseRentalOwner';
const api = '/api/guest-messages/';
let selected = null, revision = '', offset = 0, busy = false;
async function call(path, body) {
  const headers = {Authorization:'Bearer '+(sessionStorage.getItem(sessionKey)||'')};
  const options = {headers,cache:'no-store'};
  if(body) Object.assign(options,{method:'POST',headers:{...headers,'Content-Type':'application/json'},body:JSON.stringify(body)});
  const response = await fetch(path,options);
  const result = await response.json();
  if (response.status === 403 && path.startsWith(api)) {
    el('signin').hidden=false; el('desk').hidden=true;
  }
  if (!response.ok) throw Error(result.error || result.message || 'Request failed.');
  return result;
}
async function run(fn) {
  if(busy) return;
  busy=true; el('desk').inert=true; el('signin').inert=true; el('notice').textContent='';
  try { await fn(); } catch(e) { el('notice').textContent=e.message; }
  finally { busy=false; el('desk').inert=false; el('signin').inert=false; }
}
function clearSelection() {
  selected=null; revision=''; el('title').textContent='Paste a guest message';
  el('history').textContent=''; el('promptLabel').hidden=false; el('send').hidden=true;
  el('reply').value=''; el('prompt').value='';
  document.querySelector('#threads .active')?.classList.remove('active');
}
function canDiscard() {
  return !(el('reply').value.trim() || el('prompt').value.trim()) || confirm('Discard the current text?');
}
async function selectThread(thread,button) {
  if(!canDiscard()) return;
  const data=await call(api+'thread?id='+encodeURIComponent(thread.id));
  clearSelection(); selected=thread; revision=data.revision;
  button.classList.add('active'); el('title').textContent=thread.guest;
  el('promptLabel').hidden=true; el('send').hidden=false;
  el('history').textContent=data.messages.map(m=>[m.sender,m.at,m.text].filter(Boolean).join(' · ')).join('\n\n');
}
async function inbox(reset) {
  const start=reset?0:offset;
  const {threads}=await call(api+'inbox?offset='+start);
  if(reset) el('threads').replaceChildren();
  for(const thread of threads) {
    const button=document.createElement('button');
    button.textContent=[thread.guest,thread.property,thread.channel].filter(Boolean).join(' · ');
    if(selected?.id===thread.id) button.classList.add('active');
    button.onclick=()=>run(()=>selectThread(thread,button)); el('threads').append(button);
  }
  offset=start+threads.length; el('more').hidden=threads.length<20;
  if(!offset) el('connection').textContent='No conversations yet.';
}
async function start() {
  const status=await call(api+'status');
  el('signin').hidden=true; el('desk').hidden=false;
  el('connection').textContent=status.connected?'Hostex connected':'Awaiting Hostex token. You can draft from pasted messages.';
  el('refresh').disabled=!status.connected;
  if(status.connected) await inbox(true);
}
el('login').onsubmit=e=>{e.preventDefault();run(async()=>{
  const r=await call('/api/rental-v2/owner/password/login',{email:el('email').value,password:el('password').value});
  sessionStorage.setItem(sessionKey,r.session);el('password').value='';await start();
});};
el('manual').onclick=()=>{if(canDiscard()) clearSelection();};
el('refresh').onclick=()=>run(()=>inbox(true));
el('more').onclick=()=>run(()=>inbox(false));
el('generate').onclick=()=>run(async()=>{
  const conversation=selected?[selected.property,el('history').textContent].join('\n').slice(-16000):el('prompt').value.trim();
  if(!conversation.trim()) throw Error('Enter a guest message first.');
  const result=await call(api+'draft',{conversation});
  el('reply').value=result.reply;
});
el('copy').onclick=()=>run(async()=>{
  if(!el('reply').value.trim()) throw Error('Write or draft a reply first.');
  await navigator.clipboard.writeText(el('reply').value); el('notice').textContent='Reply copied.';
});
el('send').onclick=()=>run(async()=>{
  const message=el('reply').value.trim();
  if(!selected || !message) throw Error('Write a reply first.');
  if(!confirm('Send this reply to '+selected.guest+' through '+selected.channel+'?')) return;
  await call(api+'send?id='+encodeURIComponent(selected.id),{message,revision});
  clearSelection(); el('notice').textContent='Reply submitted to Hostex.'; await inbox(true);
});
if(sessionStorage.getItem(sessionKey)) run(start); else el('signin').hidden=false;
