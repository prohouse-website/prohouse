import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync,existsSync} from 'node:fs';

const pages=[
 ['public/operations/livewithus/review/index.html',['editor','previewSection','sendLease','verifyForm','providerForm']],
 ['public/operations/livewithus/sign/index.html',['viewer','signForm','payForm']]
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
