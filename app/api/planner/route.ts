import { env } from 'cloudflare:workers';
import { db, seed, session } from '@/lib/server';

export const dynamic='force-dynamic';
const json=(data:unknown,status=200)=>Response.json(data,{status,headers:{'Cache-Control':'no-store'}});
type Row={id:string;status:string;revision:number;payload:string;created_at:string;created_by:string};
async function engine(path:string,body?:unknown){
 let res:Response;
 try{res=await fetch('http://127.0.0.1:8008'+path,{method:body?'POST':'GET',headers:{'Content-Type':'application/json','X-Engine-Token':(env as unknown as {RAILBLOCK_ENGINE_TOKEN:string}).RAILBLOCK_ENGINE_TOKEN||''},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(110000)})}
 catch(e){console.error('Local planning connection:',(e as Error).message);throw new Error('The local planning engine is unavailable. Restart with npm run dev.')}
 const data=await res.json() as any;if(!res.ok)throw new Error(data.error||'Planning failed.');return data;
}
async function authorize(req:Request){await seed();const user=await session(req);return user?.role==='controller'?user:null}
const unpack=(r:Row)=>({...JSON.parse(r.payload),id:r.id,status:r.status,revision:r.revision,created_at:r.created_at});
export async function GET(req:Request){
 try{
 if(!await authorize(req))return json({error:'Control Centre access required.'},403);
 const id=new URL(req.url).searchParams.get('id');
 if(id){const row=await db().prepare('SELECT * FROM planner_plans WHERE id=?').bind(id).first<Row>();return row?json(unpack(row)):json({error:'Plan not found.'},404)}
 const dataset=await engine('/dataset');
 const {results:plans}=await db().prepare('SELECT id,status,revision,created_at FROM planner_plans ORDER BY created_at DESC LIMIT 30').all();
 const {results:feedback}=await db().prepare('SELECT * FROM planner_feedback ORDER BY created_at DESC LIMIT 100').all();
 return json({dataset,plans,feedback});
 }catch(e){return json({error:(e as Error).message},503)}
}
export async function POST(req:Request){
 try{
 if(req.headers.get('origin')&&req.headers.get('origin')!==new URL(req.url).origin)return json({error:'Request origin not allowed.'},403);
 if(!req.headers.get('content-type')?.includes('application/json'))return json({error:'JSON required.'},415);
 const user=await authorize(req);if(!user)return json({error:'Control Centre access required.'},403);
 const body=await req.json() as any;
 if(body.action==='generate'||body.action==='reoptimize'){
 let previous:any=null;
 if(body.action==='reoptimize'){
 const old=await db().prepare('SELECT * FROM planner_plans WHERE id=?').bind(String(body.plan_id||'')).first<Row>();
 if(!old)return json({error:'Choose an existing plan.'},404);
 if(old.status==='Rejected')return json({error:'Rejected plans are archived. Generate a new plan.'},409);
 if(old.revision!==body.revision)return json({error:'This plan changed. Reload before re-optimizing.'},409);
 previous=unpack(old);
 }
 const {results:feedback}=await db().prepare("SELECT f.decision,f.block_id,p.payload FROM planner_feedback f JOIN planner_plans p ON p.id=f.plan_id WHERE f.decision IN ('Accepted','Rejected') ORDER BY f.created_at DESC LIMIT 100").all<{decision:string;block_id:string|null;payload:string}>();
 const votes:Record<string,number[]>={};
 for(const f of feedback){const payload=JSON.parse(f.payload);const blocks=[...payload.blocks,...(payload.rejected_blocks||[])];for(const b of blocks.filter((b:any)=>!f.block_id||b.id===f.block_id)){(votes[b.section]??=[]).push(f.decision==='Accepted'?1:-1)}}
 const preferences=Object.fromEntries(Object.entries(votes).map(([s,v])=>[s,v.reduce((a,b)=>a+b,0)/(v.length+5)]));
 const config=previous?{...previous.config,incidents:[...previous.config.incidents,body.incident]}:body.config;
 const plan=await engine('/generate',{config,previous,preferences});
 if(previous)plan.parent_id=previous.id;
 const id='PLAN-'+crypto.randomUUID().slice(0,8).toUpperCase();const now=new Date().toISOString();
 if(previous){
 const saved=await db().prepare("INSERT INTO planner_plans (id,created_at,created_by,status,revision,payload) SELECT ?,?,?,'Draft',1,? WHERE EXISTS (SELECT 1 FROM planner_plans WHERE id=? AND revision=? AND status<> 'Rejected')").bind(id,now,user.id,JSON.stringify(plan),previous.id,previous.revision).run();
 if(!saved.meta.changes)return json({error:'The parent plan changed while solving. Reload it and retry.'},409);
 }else await db().prepare("INSERT INTO planner_plans (id,created_at,created_by,status,revision,payload) VALUES (?,?,?,'Draft',1,?)").bind(id,now,user.id,JSON.stringify(plan)).run();
 return json({...plan,id,status:'Draft',revision:1,created_at:now});
 }
 if(!['accept','reject','modify','reject_block'].includes(body.action))return json({error:'Unknown planner action.'},400);
 const row=await db().prepare('SELECT * FROM planner_plans WHERE id=?').bind(String(body.plan_id||'')).first<Row>();
 if(!row)return json({error:'Plan not found.'},404);
 if(row.revision!==body.revision)return json({error:'This plan changed. Reload before saving your decision.'},409);
 if(row.status==='Rejected')return json({error:'Rejected plans are archived. Generate a new plan.'},409);
 const plan=JSON.parse(row.payload);const reason=typeof body.reason==='string'?body.reason.trim():'';
 if(!reason||reason.length>1000)return json({error:'Add a review reason (up to 1,000 characters).'},400);
 let decision='Accepted',status='Accepted';
 if(body.action==='reject'){decision='Rejected';status='Rejected'}
 if(body.action==='modify'){
 const block=plan.blocks.find((b:any)=>b.id===body.block_id);if(!block)return json({error:'Block not found.'},404);
 if(!Number.isInteger(body.start))return json({error:'Choose a valid whole-minute start.'},400);
 block.start=body.start;block.end=body.start+block.duration;block.decision='Modified';block.frozen=false;
 block.reasons=['Start time changed by the controller. Hard constraints were rechecked; opportunity and forecast scores require a new planning run.'];delete block.opportunity;delete block.expected_freight;
 decision='Modified';status='Draft';plan.comparison=null;plan.changes=[];
 }
 if(body.action==='reject_block'){
 const block=plan.blocks.find((b:any)=>b.id===body.block_id);if(!block)return json({error:'Block not found.'},404);
 (plan.rejected_blocks??=[]).push({...block,decision:'Rejected'});
 plan.blocks=plan.blocks.filter((b:any)=>b.id!==block.id);
 plan.unscheduled.push(...block.tasks.map((id:string)=>({id,reason:'Controller rejected this block: '+reason})));
 decision='Rejected';status='Draft';plan.comparison=null;
 }
 if(body.action!=='reject'){
 const check=await engine('/validate',{plan});if(check.errors.length)return json({error:'Cannot save: '+check.errors.slice(0,3).join(' ')},409);
 plan.metrics=check.metrics;plan.validation={...plan.validation,checked_blocks:plan.blocks.length};
 }
 if(body.action==='accept')plan.blocks=plan.blocks.map((b:any)=>({...b,decision:'Accepted'}));
 // The insert is conditional on this update's new revision and exact payload. A stale review cannot create feedback.
 const payload=JSON.stringify(plan),now=new Date().toISOString();
 const results=await db().batch([
 db().prepare('UPDATE planner_plans SET payload=?,status=?,revision=revision+1 WHERE id=? AND revision=?').bind(payload,status,row.id,row.revision),
 db().prepare('INSERT INTO planner_feedback (id,plan_id,block_id,decision,reason,created_by,created_at) SELECT ?,?,?,?,?,?,? WHERE changes()=1').bind(crypto.randomUUID(),row.id,body.block_id||null,decision,reason,user.id,now)
 ]);
 if(!results[0].meta.changes)return json({error:'Another controller review was saved first. Reload this plan.'},409);
 return json({...plan,id:row.id,status,revision:row.revision+1,created_at:row.created_at});
 }catch(e){return json({error:(e as Error).message},400)}
}
