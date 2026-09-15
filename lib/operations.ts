import { db } from './server';
import { nearbyStations } from './stations';
import { istDay } from './reports/types';
import { corridors, importHeaders, type OperationsInput } from './operations-types';
import type { MaintenanceRequest, Worker } from './types';

export const emptyInput:OperationsInput={sections:[],movements:[],windows:[],tasks:[],machines:{},headway:5,setup:10};
const fail=(s:string):never=>{throw new Error(s)};
const str=(v:unknown,label:string,max=200)=>typeof v==='string'&&v.trim()&&v.trim().length<=max?v.trim():fail(`${label}: enter text up to ${max} characters.`);
const optional=(v:unknown,max=200)=>v===''||v===undefined?'':str(v,'Optional field',max);
const num=(v:unknown,label:string,lo:number,hi:number)=>typeof v==='number'&&Number.isInteger(v)&&v>=lo&&v<=hi?v:fail(`${label}: enter a whole number from ${lo} to ${hi}.`);
const bool=(v:unknown,label:string)=>typeof v==='boolean'?v:fail(`${label}: choose true or false.`);
export function timestamp(v:unknown){
 const text=str(v,'Date and time',40);
 if(!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::00(?:\.000)?)?(?:Z|\+05:30)$/.test(text))fail('Use whole-minute ISO times with Z or +05:30.');
 istDay(text.slice(0,10));
 if(Number(text.slice(11,13))>23||Number(text.slice(14,16))>59||!Number.isFinite(Date.parse(text)))fail('Invalid date or time.');
 return new Date(text).toISOString();
}
export function validateInput(raw:any,requests:MaintenanceRequest[],stations:Set<string>):OperationsInput{
 if(!raw||typeof raw!=='object')fail('Planning inputs are required.');
 for(const [key,max] of Object.entries({sections:100,movements:10000,windows:2000,tasks:1000})){
  if(!Array.isArray(raw[key])||raw[key].length>max)fail(`${key}: at most ${max} records are supported.`);
  const ids=raw[key].map((r:any)=>str(r?.[key==='tasks'?'request_id':'id'],`${key} ID`,100));
  if(new Set(ids).size!==ids.length)fail(`${key}: duplicate IDs are not allowed.`);
 }
 const sections=raw.sections.map((r:any)=>{if(!corridors.includes(r.corridor))fail('Sections must belong to a supplied dataset corridor.');return {id:str(r.id,'Section ID',80),corridor:r.corridor,name:str(r.name,'Section name'),from_station:str(r.from_station,'From station',12),to_station:str(r.to_station,'To station',12),source:str(r.source,'Section source / reference',500)}});
 const sectionMap=new Map(sections.map((r:any)=>[r.id,r]));
 const section=(id:any)=>sectionMap.has(id)?id:fail('Choose an existing section.');
 const timeRange=(a:any,b:any)=>{const start_at=timestamp(a),end_at=timestamp(b);if(end_at<=start_at)fail('End must be after start. Use the following date for overnight work.');return {start_at,end_at}};
 const movements=raw.movements.map((r:any)=>{if(!['Passenger','Freight'].includes(r.kind))fail('Train kind must be Passenger or Freight.');return {id:str(r.id,'Movement ID',100),section_id:section(r.section_id),train_no:str(r.train_no,'Train number / movement ID',60),kind:r.kind,...timeRange(r.start_at,r.end_at),source:str(r.source,'Movement source',500)}});
 const windows=raw.windows.map((r:any)=>({id:str(r.id,'Window ID',100),section_id:section(r.section_id),...timeRange(r.start_at,r.end_at),power:bool(r.power,'Power window'),traffic_complete:bool(r.traffic_complete,'Traffic completeness'),reference:str(r.reference,'Window / traffic verification reference',500)}));
 const lookup=new Map(requests.map(r=>[r.request_id,r]));
 const tasks=raw.tasks.map((t:any)=>{
  const r=lookup.get(t.request_id);if(!r)fail('Choose a request from the supplied maintenance dataset.');
  const sid=section(t.section_id);if((sectionMap.get(sid) as any).corridor!==r!.corridor_name)fail(`${t.request_id}: section corridor must match its source request.`);
  if(!stations.has(t.station))fail('Reporting station must exist in the worker dataset.');
  const times=timeRange(t.release_at,t.due_at),group=optional(t.compatibility_group,80),ref=optional(t.compatibility_reference,500);
  if(group&&!ref)fail('Joint work needs a recorded compatibility review reference.');
  return {request_id:r!.request_id,section_id:sid,station:t.station,crew:num(t.crew,'Required crew',1,100),release_at:times.start_at,due_at:times.end_at,machine:optional(t.machine,60),power:bool(t.power,'Power requirement'),compatibility_group:group,compatibility_reference:ref,location_reference:str(t.location_reference,'Verified work location / reference',500)};
 });
 const machines:Record<string,number>={};if(!raw.machines||Array.isArray(raw.machines)||typeof raw.machines!=='object')fail('Machine capacities are required.');
 if(Object.keys(raw.machines).length>30)fail('At most 30 machine pools are supported.');
 for(const [key,value] of Object.entries(raw.machines)){if(!/^[a-zA-Z0-9_-]{1,60}$/.test(key))fail('Use letters, numbers or hyphens in machine names.');machines[key]=num(value,'Machine capacity',0,100)}
 for(const t of tasks)if(t.machine&&!Object.hasOwn(machines,t.machine))fail(`Set a capacity for machine ${t.machine}.`);
 return {sections,movements,windows,tasks,machines,headway:num(raw.headway,'Train buffer',1,120),setup:num(raw.setup,'Setup and clearance',0,120)};
}
export function parseImport(kind:string,rows:Record<string,string>[]){
 const keys=importHeaders[kind];if(!keys)fail('Choose a supported import type.');
 return rows.map((r,i)=>{if(Object.keys(r).length!==keys.length||keys.some(k=>!Object.hasOwn(r,k)))fail(`Row ${i+2}: use the supplied ${kind} CSV template.`);return Object.fromEntries(Object.entries(r).map(([key,value])=>{
  if(['power','traffic_complete'].includes(key)){if(!['true','false'].includes(value))fail(`Row ${i+2}: ${key} must be true or false.`);return [key,value==='true']}
  if(key==='crew'){if(!/^\d+$/.test(value))fail(`Row ${i+2}: crew must be a whole number.`);return [key,Number(value)]}return [key,value]
 }))});
}
export async function state(){
 await db().prepare('INSERT OR IGNORE INTO operations_state (id,revision,payload,updated_at,updated_by) VALUES (?,1,?,?,?)').bind('main',JSON.stringify(emptyInput),new Date().toISOString(),'SYSTEM').run();
 const row=(await db().prepare('SELECT * FROM operations_state WHERE id=?').bind('main').first<any>())!;
 return {...row,input:JSON.parse(row.payload) as OperationsInput};
}
export async function records(){
 const batch=await db().batch([db().prepare('SELECT r.*,j.id AS job_id,j.status AS job_status FROM maintenance_requests r LEFT JOIN jobs j ON j.source_request_id=r.request_id ORDER BY r.defect_severity DESC,r.backlog_age_days DESC,r.request_id'),db().prepare('SELECT * FROM workers ORDER BY worker_id')]);
 return {requests:batch[0].results as unknown as MaintenanceRequest[],workers:batch[1].results as unknown as Worker[]};
}
export async function snapshot(input:OperationsInput,startDate:string,horizon:number,ids:string[]){
 if(![1,7,30].includes(horizon))fail('Choose a daily, weekly or monthly horizon.');
 const base=Date.parse(istDay(startDate).start),limit=horizon*1440;
 const minute=(s:string)=>Math.round((Date.parse(s)-base)/60000);
 if(!Array.isArray(ids)||!ids.length||ids.length>150||new Set(ids).size!==ids.length)fail('Choose 1–150 distinct prepared requests.');
 const {requests,workers}=await records(),lookup=new Map(requests.map(r=>[r.request_id,r]));
 const tasks=ids.map(id=>{
  const t=input.tasks.find(t=>t.request_id===id),r=lookup.get(id);if(!t||!r)fail('Prepare every selected maintenance request first.');if(r!.job_id)fail(`${id} already has a job.`);
  const priority=Math.min(100,r!.defect_severity*15+Math.min(r!.backlog_age_days,25));
  return {...t,id,department:r!.department_code,line:r!.line_type,title:r!.task_type,duration:r!.required_duration_mins,priority,priority_reason:`Severity ${r!.defect_severity}/5 × 15 + backlog capped at 25 days. Source backlog is a dataset snapshot.`,release:minute(t!.release_at),due:minute(t!.due_at),nearby:nearbyStations(t!.station),source:r};
 });
 const {results:bookings}=await db().prepare("SELECT a.worker_id,j.start_at,j.end_at FROM assignments a JOIN jobs j ON j.id=a.job_id WHERE j.status IN ('Assigned','In progress','Awaiting review') AND j.end_at>? AND j.start_at<?").bind(new Date(base).toISOString(),new Date(base+limit*60000).toISOString()).all<any>();
 const available=workers.filter(w=>w.availability_status==='Available').map(w=>{
  let ranges:number[][]=[];
  for(let day=-1;day<horizon;day++){const [start,end]=w.shift.startsWith('C')?[1320,1800]:w.shift.startsWith('B')?[840,1320]:[360,840];const lo=Math.max(0,day*1440+start),hi=Math.min(limit,day*1440+end);if(lo<hi)ranges.push([lo,hi])}
  for(const b of bookings.filter(b=>b.worker_id===w.worker_id)){const a=minute(b.start_at),z=minute(b.end_at);ranges=ranges.flatMap(([lo,hi])=>a>=hi||z<=lo?[[lo,hi]]:[...(lo<a?[[lo,a]]:[]),...(z<hi?[[z,hi]]:[])])}
  return {id:w.worker_id,department:w.department_code,station:w.station_code,ranges};
 });
 const {results:released}=await db().prepare("SELECT DISTINCT p.id,p.payload FROM operations_plans p JOIN operations_jobs l ON l.plan_id=p.id JOIN jobs j ON j.id=l.job_id WHERE j.end_at>? AND j.start_at<?").bind(new Date(base).toISOString(),new Date(base+limit*60000).toISOString()).all<any>();
 const existing_blocks=released.flatMap(p=>{const old=JSON.parse(p.payload),oldBase=Date.parse(istDay(old.config.start_date).start),offset=(oldBase-base)/60000;return old.blocks.map((b:any)=>({section_id:b.section_id,start:b.start+offset,end:b.end+offset,machines:b.tasks.reduce((n:any,id:string)=>{const t=old.input.tasks.find((t:any)=>t.id===id);if(t?.machine)n[t.machine]=(n[t.machine]||0)+1;return n},{})})).filter((b:any)=>b.end>0&&b.start<limit)});
 return {start_date:startDate,horizon,tasks,workers:available,movements:input.movements.map(m=>({...m,start:minute(m.start_at),end:minute(m.end_at)})),windows:input.windows.map(w=>({...w,start:minute(w.start_at),end:minute(w.end_at)})),existing_blocks,machines:input.machines,headway:input.headway,setup:input.setup,sections:input.sections};
}
export function releaseIssues(plan:any){
 const issues:string[]=[];
 if(!plan.blocks.length)issues.push('There are no blocks to release.');
 for(const b of plan.blocks){
  if(!plan.input.windows.some((w:any)=>w.section_id===b.section_id&&w.start<=b.start&&w.end>=b.end&&w.traffic_complete&&(!b.tasks.some((id:string)=>plan.input.tasks.find((t:any)=>t.id===id)?.power)||w.power)))issues.push(`${b.id}: confirm the complete traffic and restriction record for this work window.`);
 }
 return issues;
}

export function releasedInputIssues(input:OperationsInput,plan:any,now=Date.now()){
 const base=Date.parse(istDay(plan.config.start_date).start),issues:string[]=[];
 for(const b of plan.blocks){
  const start=base+b.start*60000,end=base+b.end*60000;if(end<=now)continue;
  const section=input.sections.find(s=>s.id===b.section_id),power=b.tasks.some((id:string)=>plan.input.tasks.find((t:any)=>t.id===id)?.power);
  if(!input.windows.some(w=>w.section_id===b.section_id&&Date.parse(w.start_at)<=start&&Date.parse(w.end_at)>=end&&w.traffic_complete&&(!power||w.power)))issues.push(`${b.id}: the verified work window is no longer available.`);
  if(input.movements.some(m=>input.sections.find(s=>s.id===m.section_id)?.corridor===section?.corridor&&Date.parse(m.start_at)-input.headway*60000<end&&Date.parse(m.end_at)+input.headway*60000>start))issues.push(`${b.id}: updated train timings conflict with released work.`);
 }
 return issues;
}
export async function operationalJobIssue(jobId:string,starting=false){
 const row=await db().prepare('SELECT p.payload,l.block_id,j.start_at,j.end_at FROM operations_jobs l JOIN operations_plans p ON p.id=l.plan_id JOIN jobs j ON j.id=l.job_id WHERE l.job_id=?').bind(jobId).first<any>();
 if(!row)return null;
 if(starting&&(Date.now()<Date.parse(row.start_at)||Date.now()>=Date.parse(row.end_at)))return 'Work can start only inside the controller-approved block. Contact Control Centre if the timing needs review.';
 const s=await state(),plan=JSON.parse(row.payload);plan.blocks=plan.blocks.filter((b:any)=>b.id===row.block_id);
 return releasedInputIssues(s.input,plan)[0]||null;
}
