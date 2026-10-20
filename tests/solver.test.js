import test from 'node:test';
import assert from 'node:assert/strict';
import {solve,slots,groupFor} from '../solver.js';
const event={dates:['2026-11-01','2026-11-02']};
const make=()=>['chief','fire','cooklead','cook','selllead','sell'].map((role,i)=>({id:String(i),name:'人'+i,grade:3,role,maxHours:5,available:Array.from({length:20},(_,i)=>i)}));
function verify(r,ps){for(const row of r.rows){const ids=row.people.filter(x=>x!==null);assert.equal(new Set(ids).size,ids.length);row.people.forEach((id,g)=>{if(id===null)return;const p=ps.find(x=>x.id===id);assert.ok(p.available.includes(row.id));assert.equal(groupFor(p.role),g);});}for(const p of ps)assert.ok(r.rows.filter(r=>r.people.includes(p.id)).length<=p.maxHours*2);}
test('20 half-hour slots cover both 10–15 windows',()=>{assert.equal(slots(event).length,20);assert.equal(slots(event)[19].end,900);});
test('complete coverage with fair hours',()=>{const ps=make(),r=solve(event,ps);assert.equal(r.complete,true);assert.equal(r.assigned,60);verify(r,ps);for(const p of ps)assert.equal(r.rows.filter(r=>r.people.includes(p.id)).length,10);});
test('unavailable responsible slot is explicitly uncovered',()=>{const ps=make();ps[0].available=ps[0].available.filter(x=>x!==0);ps[1].available=ps[1].available.filter(x=>x!==0);const r=solve(event,ps);assert.equal(r.complete,false);assert.ok(r.shortages.some(s=>s.slot===0&&s.group===0));verify(r,ps);});
test('rejects wrong grade and missing or duplicated registered leaders',()=>{let ps=make();ps[0].grade=2;assert.ok(solve(event,ps).errors.length);ps=make().filter(p=>p.role!=='fire');assert.ok(solve(event,ps).errors.length);ps=make();ps[3].role='chief';assert.ok(solve(event,ps).errors.length);});
test('total work caps are hard constraints',()=>{const ps=make();ps[0].maxHours=0;ps[1].maxHours=2;const r=solve(event,ps);assert.equal(r.shortages.filter(s=>s.group===0).length,16);verify(r,ps);});
test('finds feasible assignment with constrained participant instead of greedy dead end',()=>{const ps=make();ps[0].available=Array.from({length:10},(_,i)=>i);ps[1].maxHours=5;const r=solve(event,ps);assert.equal(r.complete,true);verify(r,ps);for(let i=10;i<20;i++)assert.equal(r.rows[i].people[0],'1');});
test('nobody available produces all 60 explicit shortages',()=>{const ps=make();ps.forEach(p=>p.available=[]);const r=solve(event,ps);assert.equal(r.shortages.length,60);verify(r,ps);});
test('random cases satisfy invariants and independent group max-flow optimum',()=>{
 let seed=12345;const rand=()=>((seed=(seed*1664525+1013904223)>>>0)/2**32);
 // Independent bipartite matching with one clone for each allowed half hour of work.
 function maximum(ps,g){const clones=ps.filter(p=>groupFor(p.role)===g).flatMap(p=>Array.from({length:Math.floor(p.maxHours*2)},()=>p));const owner=Array(20).fill(-1);function dfs(c,seen){for(const s of clones[c].available){if(seen.has(s))continue;seen.add(s);if(owner[s]===-1||dfs(owner[s],seen)){owner[s]=c;return true;}}return false;}let n=0;for(let c=0;c<clones.length;c++)if(dfs(c,new Set()))n++;return n;}
 for(let k=0;k<80;k++){const ps=make();ps.forEach(p=>{p.available=p.available.filter(()=>rand()>.35);p.maxHours=Math.floor(rand()*16)/2;});const r=solve(event,ps);verify(r,ps);assert.equal(r.assigned,[0,1,2].reduce((n,g)=>n+maximum(ps,g),0));}
});
