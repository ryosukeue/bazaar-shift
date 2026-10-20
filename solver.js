export const ROLES = {chief:'出店責任者',fire:'火気取扱責任者',cooklead:'調理責任者',cook:'調理従事者',selllead:'販売責任者',sell:'販売従事者'};
export const GROUPS = ['責任者枠','調理枠','販売枠'];
export const groupFor = role => ['chief','fire'].includes(role)?0:['cooklead','cook'].includes(role)?1:['selllead','sell'].includes(role)?2:-1;
export const time = n => `${Math.floor(n/60)}:${String(n%60).padStart(2,'0')}`;
export function slots(event) {return event.dates.flatMap((date,day)=>Array.from({length:10},(_,i)=>({id:day*10+i,day,date,start:600+i*30,end:630+i*30})));}
export function registrationErrors(people) {
 const errors=[];
 for(const role of ['chief','fire','cooklead','selllead']) {
  const ps=people.filter(p=>p.role===role);
  if(ps.length!==1) errors.push(`${ROLES[role]}を1人登録してください（現在${ps.length}人）。`);
 }
 for(const p of people) {
  const min=['chief','fire'].includes(p.role)?3:['cooklead','selllead'].includes(p.role)?2:1;
  if(!ROLES[p.role]) errors.push(`${p.name}さんの役割を設定してください。`);
  else if(!Number.isInteger(p.grade)||p.grade<min||p.grade>5) errors.push(`${p.name}さんは${ROLES[p.role]}の学年条件を満たしていません。`);
 }
 return errors;
}
// Integral min-cost flow: one person per time slot, role eligibility, total-work cap.
// Increasing source-edge costs spread work while maximizing covered positions.
export function solve(event,people) {
 const errors=registrationErrors(people);if(errors.length)return {errors};
 const ss=slots(event), graph=[]; const node=()=>{graph.push([]);return graph.length-1;};
 const src=node(),sink=node();
 function edge(a,b,cap,cost){const f={to:b,rev:graph[b].length,cap,cost},r={to:a,rev:graph[a].length,cap:0,cost:-cost};graph[a].push(f);graph[b].push(r);return f;}
 const positions=ss.map(()=>GROUPS.map(()=>{const n=node();edge(n,sink,1,0);return n;}));
 const refs=[];
 people.forEach((p,pi)=>{
  const pn=node();const max=Math.min(20,Math.max(0,Math.floor(Number(p.maxHours)*2)));
  for(let k=0;k<max;k++)edge(src,pn,1,k*100+pi);
  for(const s of ss)if(p.available.includes(s.id)) {
   const ps=node();edge(pn,ps,1,0);const g=groupFor(p.role);
   refs.push({person:p.id,slot:s.id,group:g,edge:edge(ps,positions[s.id][g],1,0)});
  }
 });
 let flow=0;
 while(true){
  const d=graph.map(()=>Infinity),prev=graph.map(()=>null),queued=graph.map(()=>false),q=[src];d[src]=0;queued[src]=true;
  for(let h=0;h<q.length;h++){const u=q[h];queued[u]=false;graph[u].forEach((e,i)=>{if(e.cap&&d[e.to]>d[u]+e.cost){d[e.to]=d[u]+e.cost;prev[e.to]=[u,i];if(!queued[e.to]){queued[e.to]=true;q.push(e.to);}}});}
  if(!prev[sink])break;
  for(let v=sink;v!==src;){const [u,i]=prev[v],e=graph[u][i];e.cap--;graph[v][e.rev].cap++;v=u;}flow++;
 }
 const rows=ss.map(s=>({...s,people:[null,null,null]}));refs.filter(r=>r.edge.cap===0).forEach(r=>rows[r.slot].people[r.group]=r.person);
 // Keep total hours unchanged while reducing unnecessary handovers.
 const byId=new Map(people.map(p=>[p.id,p]));
 const changes=g=>rows.reduce((n,r,i)=>n+(i%10!==0&&r.people[g]!==rows[i-1].people[g]?1:0),0);
 for(let g=0;g<3;g++){
  let improved=true;
  while(improved){improved=false;let score=changes(g);
   outer: for(let a=0;a<20;a++)for(let b=a+1;b<20;b++){
    const x=rows[a].people[g],y=rows[b].people[g];
    if(!x||!y||x===y||!byId.get(x).available.includes(b)||!byId.get(y).available.includes(a))continue;
    rows[a].people[g]=y;rows[b].people[g]=x;
    if(changes(g)<score){improved=true;break outer;}
    rows[a].people[g]=x;rows[b].people[g]=y;
   }
  }
 }
 const shortages=rows.flatMap(r=>r.people.flatMap((p,g)=>p?[]:[{slot:r.id,group:g}]));
 return {rows,shortages,complete:flow===60,errors:[],assigned:flow};
}
