import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';

test('Didit In Review hides Verify, allows next step, then updates to Approved',async()=>{
 const js=readFileSync('public/assets/livewithus-didit.js','utf8');
 const callbacks=new Map(),globalCallbacks=new Map();
 const element=id=>({
  id,hidden:false,disabled:false,checked:false,value:'',textContent:'',
  dataset:{required:id==='photoId1'?'true':undefined},files:[],
  addEventListener(event,fn){callbacks.set(id+':'+event,fn)},
  scrollIntoView(){},
  querySelectorAll(){return[]}
 });
 const nodes=new Map(['application','diditPanel','idUploadFields','diditConsent','diditStatus',
  'diditStart','identityToken','firstName','lastName','email','photoId1'].map(id=>[id,element(id)]));
 nodes.get('firstName').value='Alex';
 nodes.get('lastName').value='Example';
 nodes.get('email').value='alex@example.com';
 nodes.get('diditConsent').checked=true;
 nodes.get('idUploadFields').querySelectorAll=()=>[nodes.get('photoId1')];
 const events=[],popup={
  document:{title:'',body:{textContent:''}},
  location:{replace(url){events.push('navigate:'+url)}},
  close(){events.push('close')},opener:{}
 };
 const fakeWindow={
  open(url,target){events.push('open:'+url+':'+target);return popup}
 };
 const didit={status:'In Review',verified:false};
 const fetch=async(input,options={})=>{
  const url=String(input);
  events.push('fetch:'+url);
  if(url.endsWith('/config'))return{ok:true,json:async()=>({diditAvailable:true})};
  if(url.endsWith('/start'))return{ok:true,json:async()=>({
   verificationToken:'abc123',url:'https://verify.didit.me/s/prohouse-test'
  })};
  if(url.endsWith('/status'))return{ok:true,json:async()=>({
   ...didit,verifiedName:'Alex Example'
  })};
  throw Error('Unexpected request: '+url);
 };
 const document={
  visibilityState:'visible',
  getElementById(id){return nodes.get(id)||null},
  addEventListener(event,fn){globalCallbacks.set('document:'+event,fn)}
 };
 const context={
  window:fakeWindow,document,fetch,URL,
  setInterval(fn,ms){events.push('poll:'+ms);return 4},
  clearInterval(){events.push('stop-poll')},
  setTimeout(fn){Promise.resolve().then(fn)},
  addEventListener(event,fn){globalCallbacks.set('window:'+event,fn)}
 };
 vm.runInNewContext(js,context,{filename:'livewithus-didit.js'});
 await new Promise(resolve=>setImmediate(resolve)); // config fetch
 assert.equal(nodes.get('diditPanel').hidden,false);
 assert.equal(nodes.get('idUploadFields').hidden,true);
 assert.equal(nodes.get('photoId1').required,false);
 assert.equal(nodes.get('diditStart').textContent,'');
 await callbacks.get('diditStart:click')();
 assert.equal(events[1],'open:about:blank:_blank');
 assert.ok(events.includes('navigate:https://verify.didit.me/s/prohouse-test'));
 assert.ok(events.includes('poll:9000'));
 assert.equal(nodes.get('identityToken').value,'');
 // Resuming before completion reuses the same session and never bills again.
 await callbacks.get('diditStart:click')();
 assert.equal(events.filter(x=>x==='fetch:/api/longstay/identity/start').length,1);
 globalCallbacks.get('window:focus')();
 await new Promise(resolve=>setImmediate(resolve));
 assert.equal(nodes.get('identityToken').value,'abc123');
 assert.equal(nodes.get('diditStart').hidden,true);
 assert.equal(fakeWindow.ProHouseDidit.validate(),true);
 assert.match(nodes.get('diditStatus').textContent,/Awaiting ProHouse manual review/);
 didit.status='Approved';didit.verified=true;
 globalCallbacks.get('window:focus')();
 await new Promise(resolve=>setImmediate(resolve));
 assert.equal(nodes.get('diditStart').hidden,true);
 assert.equal(fakeWindow.ProHouseDidit.isVerified(),true);
 assert.match(nodes.get('diditStatus').textContent,/approved by Didit/);
 assert.ok(!events.includes('close'));
});
