import test from 'node:test';
import assert from 'node:assert/strict';
import {rpc,secretToken} from '../cloud.js';
test('random administration keys are 256-bit hex',()=>{const a=secretToken();assert.match(a,/^[a-f0-9]{64}$/);assert.notEqual(a,secretToken());});
test('RPC uses only publishable API header and explicit arguments',async()=>{const result=await rpc('event',{p_event_id:'test'},async(url,opts)=>{assert.match(url,/\/rpc\/bazaar_event$/);assert.match(opts.headers.apikey,/^sb_publishable_/);assert.equal(opts.headers.Authorization,undefined);assert.deepEqual(JSON.parse(opts.body),{p_event_id:'test'});return {ok:true,json:async()=>({title:'test'})};});assert.equal(result.title,'test');});
test('conflict and missing schema produce actionable errors',async()=>{await assert.rejects(rpc('save',{},async()=>({ok:false,json:async()=>({message:'REVISION_CONFLICT'})})),/バックアップ/);await assert.rejects(rpc('health',{},async()=>({ok:false,json:async()=>({code:'PGRST202'})})),/初期設定/);});
test('failed network never reports success',async()=>{await assert.rejects(rpc('submit',{},async()=>{throw Error('offline');}),/通信できません/);});
