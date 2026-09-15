import { db, seed, session } from '@/lib/server';
import { state, records, snapshot, validateInput, parseImport, releaseIssues, releasedInputIssues } from '@/lib/operations';
import { csvRows, importHeaders } from '@/lib/operations-types';
import { localEngine } from '@/lib/local-engine';
import { addReferenceTimetable, referenceServices, timetableResearch } from '@/data/route-timetables';
import { istDay } from '@/lib/reports/types';

export const dynamic='force-dynamic';
const json=(data:unknown,status=200)=>Response.json(data,{status,headers:{'Cache-Control':'private, no-store'}});
const unpack=(r:any)=>({...r,payload:JSON.parse(r.payload),release_issues:releaseIssues(JSON.parse(r.payload))});
function audit(entity:string,action:string,reason:string,actor:string){return db().prepare('INSERT INTO operations_audit (id,entity_id,action,reason,actor,created_at) VALUES (?,?,?,?,?,?)').bind(crypto.randomUUID(),entity,action,reason,actor,new Date().toISOString())}
export async function GET(req:Request){
 try{
  await seed();const user=await session(req);if(!user)return json({error:'Sign in first.'},401);if(user.role!=='controller')return json({error:'Control Centre access required.'},403);
  const params=new URL(req.url).searchParams;
  if(params.has('id')){const row=await db().prepare('SELECT * FROM operations_plans WHERE id=?').bind(params.get('id')).first();return row?json(unpack(row)):json({error:'Plan not found.'},404)}
  const s=await state(),r=await records();
  const saved=await db().batch([db().prepare('SELECT id,revision,input_revision,status,created_at FROM operations_plans ORDER BY created_at DESC LIMIT 50'),db().prepare('SELECT * FROM operations_audit ORDER BY created_at DESC LIMIT 50')]);
  const {results:released}=await db().prepare("SELECT id,payload FROM operations_plans WHERE status='Released'").all<any>();
  const alerts=released.flatMap(p=>releasedInputIssues(s.input,JSON.parse(p.payload)).map(message=>({plan_id:p.id,message})));
  return json({revision:s.revision,input:s.input,requests:r.requests,stations:[...new Set(r.workers.map(w=>w.station_code))],plans:saved[0].results,audit:saved[1].results,alerts,reference:{...timetableResearch,services:referenceServices}});
 }catch(e){return json({error:(e as Error).message},400)}
}
export async function POST(req:Request){
 try{
  if(req.headers.get('origin')&&req.headers.get('origin')!==new URL(req.url).origin)return json({error:'Request origin not allowed.'},403);
  if(!req.headers.get('content-type')?.includes('application/json'))return json({error:'JSON is required.'},415);
  await seed();const user=await session(req);if(!user)return json({error:'Sign in first.'},401);if(user.role!=='controller')return json({error:'Control Centre access required.'},403);
  const text=await req.text();if(text.length>2_000_000)return json({error:'Request exceeds 2 MB.'},413);
  const body=JSON.parse(text),s=await state();
  if(['save_record','import','remove_record','settings','reference'].includes(body.action)){
   if(body.revision!==s.revision)return json({error:'The input register changed. Refresh before saving.'},409);
   let next=structuredClone(s.input),reason='';
   if(body.action==='reference'){next=addReferenceTimetable(next,body.start_date,body.horizon);reason=`Added public reference timetable for ${body.horizon} days from ${body.start_date}; incomplete traffic coverage.`}
   else if(body.action==='settings'){next.headway=body.headway;next.setup=body.setup;next.machines=body.machines;reason='Updated planning buffers and machine capacities.'}
   else{
    const kind=String(body.kind);if(!importHeaders[kind])throw new Error('Unknown input type.');
    const key=kind==='tasks'?'request_id':'id',list=(next as any)[kind] as any[];
    if(body.action==='remove_record'){
     (next as any)[kind]=list.filter(r=>r[key]!==body.id);reason=`Removed ${kind} ${body.id}.`;
    }else{
     const incoming=body.action==='import'?parseImport(kind,csvRows(body.csv)): [body.record];
     if(!incoming.length)throw new Error('No records were supplied.');
     if(new Set(incoming.map((r:any)=>r[key])).size!==incoming.length)throw new Error('The import contains duplicate IDs.');
     (next as any)[kind]=[...list.filter(r=>!incoming.some((i:any)=>i[key]===r[key])),...incoming];reason=`Saved ${incoming.length} ${kind} records${body.action==='import'?' from CSV':''}.`;
    }
   }
   const r=await records();next=validateInput(next,r.requests,new Set(r.workers.map(w=>w.station_code)));
   // Never reinterpret already released work by changing its section identity.
   const {results:used}=await db().prepare('SELECT DISTINCT section_id FROM operations_jobs').all<{section_id:string}>();
   for(const u of used){if(JSON.stringify(s.input.sections.find((x:any)=>x.id===u.section_id))!==JSON.stringify(next.sections.find((x:any)=>x.id===u.section_id)))throw new Error('A released job uses this section. Its identity cannot be changed.');}
   const now=new Date().toISOString();
   const changes=await db().batch([
    db().prepare('UPDATE operations_state SET payload=?,revision=revision+1,updated_at=?,updated_by=? WHERE id=? AND revision=?').bind(JSON.stringify(next),now,user.id,'main',s.revision),
    db().prepare('INSERT INTO operations_audit (id,entity_id,action,reason,actor,created_at) SELECT ?,?,?,?,?,? WHERE changes()=1').bind(crypto.randomUUID(),'main',body.action,reason,user.id,now)
   ]);
   if(!changes[0].meta.changes)return json({error:'Another input edit was saved first. Refresh and retry.'},409);
   return json({ok:true,revision:s.revision+1,message:reason});
  }
  if(body.action==='generate'){
   if(body.revision!==s.revision)return json({error:'Inputs changed. Refresh before generating.'},409);
   const input=await snapshot(s.input,body.start_date,body.horizon,body.request_ids);
   const result=await localEngine('/operations/generate',{input});
   let parent_id:string|null=null;
   if(body.parent_id){const parent=await db().prepare('SELECT status FROM operations_plans WHERE id=?').bind(body.parent_id).first<any>();if(!parent||parent.status==='Released')throw new Error('Choose an unreleased plan to revise. Released jobs retain their approved schedule.');parent_id=body.parent_id;}
   const payload={...result,input,config:{start_date:body.start_date,horizon:body.horizon},parent_id,provenance:'Supplied maintenance requests and versioned local planning inputs. Public timetable references are partial coverage.'};
   const id='OPS-'+crypto.randomUUID().slice(0,8).toUpperCase(),now=new Date().toISOString();
   const saved=await db().prepare("INSERT INTO operations_plans (id,revision,input_revision,status,payload,created_at,created_by) SELECT ?,1,?,'Draft',?,?,? WHERE EXISTS (SELECT 1 FROM operations_state WHERE id='main' AND revision=?)").bind(id,s.revision,JSON.stringify(payload),now,user.id,s.revision).run();
   if(!saved.meta.changes)return json({error:'Inputs changed while planning. Generate again using the updated register.'},409);
   return json({id,revision:1,input_revision:s.revision,status:'Draft',payload,created_at:now,release_issues:releaseIssues(payload)});
  }
  if(!['accept','reject','release'].includes(body.action))throw new Error('Unknown operation.');
  const row=await db().prepare('SELECT * FROM operations_plans WHERE id=?').bind(String(body.plan_id||'')).first<any>();
  if(!row)return json({error:'Plan not found.'},404);
  if(row.revision!==body.revision)return json({error:'This plan changed. Refresh before reviewing.'},409);
  if(['Released','Rejected'].includes(row.status))return json({error:'This plan is archived or released. Create a new draft.'},409);
  const reason=typeof body.reason==='string'?body.reason.trim():'';if(!reason||reason.length>1000)throw new Error('Enter a review reason up to 1,000 characters.');
  const plan=JSON.parse(row.payload);
  if(body.action!=='reject'){
   if(row.input_revision!==s.revision)return json({error:'Planning inputs or released work changed. Generate a revised draft before approving.'},409);
   if(!plan.blocks.length)throw new Error('There are no scheduled blocks to approve.');
   const current=await snapshot(s.input,plan.config.start_date,plan.config.horizon,plan.input.tasks.map((t:any)=>t.id));
   const check=await localEngine('/operations/validate',{input:current,blocks:plan.blocks});if(check.errors.length)return json({error:check.errors.join(' ')},409);
   if(body.action==='release'){
    if(row.status!=='Accepted')return json({error:'Accept the plan before releasing jobs.'},409);
    const issues=releaseIssues({...plan,input:current});if(issues.length)return json({error:issues.join(' ')},409);
    const base=Date.parse(istDay(plan.config.start_date).start);if(plan.blocks.some((b:any)=>base+b.start*60000<Date.now()))return json({error:'A block start has passed. Generate a revised future schedule.'},409);
    const now=new Date().toISOString(),newRevision=row.revision+1,guard=crypto.randomUUID();
    const batch=[db().prepare("UPDATE operations_state SET revision=revision+1,updated_at=?,updated_by=? WHERE id='main' AND revision=?").bind(now,user.id,s.revision),
     db().prepare('INSERT INTO operations_transaction_guard (id,changed) VALUES (?,changes())').bind(guard+'-input'),
     db().prepare("UPDATE operations_plans SET status='Released',revision=revision+1 WHERE id=? AND revision=? AND status='Accepted'").bind(row.id,row.revision),
     db().prepare('INSERT INTO operations_transaction_guard (id,changed) VALUES (?,changes())').bind(guard+'-plan')];
    for(const block of plan.blocks)for(const id of block.tasks){
     const t=current.tasks.find((t:any)=>t.id===id)!;const jobId=`${row.id}-${id}`;
     const start=new Date(base+block.start*60000).toISOString(),end=new Date(base+block.end*60000).toISOString();
     const description=`${t.title}. Work location: ${t.location_reference}. Source request: ${id}. Approved block: ${block.id}. ${t.duration} minutes work; ${current.setup} minutes setup/clearance. Select ${t.crew} workers manually; the block time is fixed by the controller.`;
     batch.push(db().prepare("INSERT INTO jobs (id,title,description,department,station,location,priority,required_crew,start_at,end_at,status,created_by,created_at,simulated,source_request_id) SELECT ?,?,?,?,?,?,?,?,?,?,'Pending',?,?,0,? WHERE EXISTS (SELECT 1 FROM operations_plans WHERE id=? AND revision=? AND status='Released')").bind(jobId,t.title,description,t.department,t.station,`${t.source!.corridor_name} · ${t.line} · ${t.section_id}`,t.priority>=70?'High':t.priority>=40?'Medium':'Low',t.crew,start,end,user.id,now,id,row.id,newRevision));
     batch.push(db().prepare("INSERT INTO operations_jobs (job_id,plan_id,block_id,request_id,section_id) SELECT ?,?,?,?,? WHERE EXISTS (SELECT 1 FROM jobs WHERE id=?)").bind(jobId,row.id,block.id,id,t.section_id,jobId));
    }
    batch.push(audit(row.id,'Released',reason,user.id));
    batch.push(db().prepare('DELETE FROM operations_transaction_guard WHERE id IN (?,?)').bind(guard+'-input',guard+'-plan'));
    try{await db().batch(batch)}catch(e){if(/UNIQUE|constraint/i.test(String(e)))return json({error:'The register or plan changed, or a request was already planned. Refresh before releasing.'},409);throw e}
    return json({...unpack({...row,revision:newRevision,status:'Released'}),message:'Jobs released to their department heads for manual crew selection.'});
   }
  }
  const status=body.action==='accept'?'Accepted':'Rejected',now=new Date().toISOString();
  const saved=await db().batch([db().prepare('UPDATE operations_plans SET status=?,revision=revision+1 WHERE id=? AND revision=? AND EXISTS (SELECT 1 FROM operations_state WHERE id=? AND revision=?)').bind(status,row.id,row.revision,'main',s.revision),db().prepare('INSERT INTO operations_audit (id,entity_id,action,reason,actor,created_at) SELECT ?,?,?,?,?,? WHERE changes()=1').bind(crypto.randomUUID(),row.id,status,reason,user.id,now)]);
  if(!saved[0].meta.changes)return json({error:'A concurrent review or input change occurred. Refresh and retry.'},409);
  return json(unpack({...row,status,revision:row.revision+1}));
 }catch(e){console.error('Operations:',e);return json({error:(e as Error).message},400)}
}
