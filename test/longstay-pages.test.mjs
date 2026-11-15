import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync,existsSync} from 'node:fs';

const pages=[
 ['public/operations/livewithus/review/index.html',['editor','previewSection','sendLease','verifyForm','providerForm']],
 ['public/operations/livewithus/sign/index.html',['viewer','signForm','payForm']],
 ['public/operations/livewithus/index.html',['signaturePad','phoneSignatureButton','mobileQr','payFrequency']],
 ['public/operations/livewithus/second/index.html',['signaturePad','phoneSignatureButton','mobileQr']],
 ['public/operations/livewithus/sign-on-phone/index.html',['signaturePad','sendSignature','signArea','success']]
];
for(const [path,ids] of pages){
 test('lease page markup and JS parse: '+path,()=>{
  assert.ok(existsSync(path),path+' missing');
  const html=readFileSync(path,'utf8');
  for(const id of ids)assert.match(html,new RegExp('id="'+id+'"'));
  const scripts=[...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)];
  assert.ok(scripts.length,'No local browser JS');
  for(const [,js] of scripts)assert.doesNotThrow(()=>new vm.Script(js,{filename:path}));
  assert.match(html,/noindex/);
 });
}

test('application forms do not ask applicants to choose ID type and do not offer weekly payment',()=>{
 const first=readFileSync('public/operations/livewithus/index.html','utf8');
 const second=readFileSync('public/operations/livewithus/second/index.html','utf8');
 for(const src of [first,second]){
  assert.doesNotMatch(src,/id="(?:photoIdType|secondIdType)"/);
  assert.match(src,/type="file"[^>]*required/);
  assert.match(src,/id="phoneSignatureButton"/);
  assert.match(src,/requestAnimationFrame\(\(\)=>resize\(\)\)/);
  assert.match(src,/\/assets\/qrcode\.min\.js/);
 }
 assert.doesNotMatch(first,/<option>Every week<\/option>/);
 assert.match(first,/Every 2 weeks/);
 assert.match(first,/Every 4 weeks/);
 assert.match(first,/Every calendar month/);
});
