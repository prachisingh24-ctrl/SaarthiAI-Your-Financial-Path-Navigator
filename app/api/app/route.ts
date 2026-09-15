import { db, seed, session, verify, digest, cookie } from '@/lib/server';
import { isNearbyStation } from '@/lib/stations';
import { withinShift } from '@/lib/types';
import type { Account, Worker, Job, MaintenanceRequest } from '@/lib/types';
import requestManifest from '@/data/maintenance-requests.meta.json';
import { operationalJobIssue } from '@/lib/operations';
export const dynamic='force-dynamic';
function json(data:unknown,status=200,headers:Record<string,string>={}){return Response.json(data,{status,headers:{'Cache-Control':'no-store',...headers}})}
function fail(message:string,status=400){return json({error:message},status)}
export async function GET(req:Request){
 try{
 await seed();const user=await session(req);if(!user)return json({user:null});
 if(user.role==='controller'){
 const {results:workers}=await db().prepare('SELECT department_code,availability_status,COUNT(*) AS count FROM workers GROUP BY department_code,availability_status').all();
 const {results:requests}=await db().prepare('SELECT r.department_code,COUNT(*) AS total,SUM(CASE WHEN j.id IS NULL THEN 1 ELSE 0 END) AS unplanned FROM maintenance_requests r LEFT JOIN jobs j ON j.source_request_id=r.request_id GROUP BY r.department_code').all();
 const {results:jobs}=await db().prepare("SELECT j.*,(SELECT block_id FROM operations_jobs WHERE job_id=j.id) AS approved_block,(SELECT COUNT(*) FROM assignments a WHERE a.job_id=j.id) AS crew_count,(SELECT COUNT(*) FROM assignments a WHERE a.job_id=j.id AND a.status='Completed') AS crew_completed FROM jobs j ORDER BY j.created_at DESC").all();
 return json({user,jobs,departmentWorkers:workers,departmentRequests:requests});
 }
 if(user.role==='worker'){
 const {results:jobs}=await db().prepare('SELECT j.*,(SELECT block_id FROM operations_jobs WHERE job_id=j.id) AS approved_block,a.status AS my_status,(SELECT COUNT(*) FROM assignments x WHERE x.job_id=j.id) AS crew_count FROM jobs j JOIN assignments a ON a.job_id=j.id WHERE a.worker_id=? ORDER BY j.start_at').bind(user.id).all();
 const {results:sources}=await db().prepare('SELECT r.* FROM maintenance_requests r JOIN jobs j ON j.source_request_id=r.request_id JOIN assignments a ON a.job_id=j.id WHERE a.worker_id=?').bind(user.id).all<MaintenanceRequest>();
 const worker=await db().prepare('SELECT * FROM workers WHERE worker_id=?').bind(user.id).first();return json({user,worker,jobs:jobs.map(j=>({...j,source_request:sources.find(r=>r.request_id===j.source_request_id)||null}))});
 }
 const {results:workers}=await db().prepare('SELECT * FROM workers WHERE department_code=? ORDER BY name').bind(user.department).all();
 const {results:jobs}=await db().prepare('SELECT j.*,(SELECT block_id FROM operations_jobs WHERE job_id=j.id) AS approved_block,(SELECT COUNT(*) FROM assignments a WHERE a.job_id=j.id) AS crew_count FROM jobs j WHERE j.department=? ORDER BY j.created_at DESC,j.id').bind(user.department).all<Job>();
 const {results:crew}=await db().prepare('SELECT a.*,w.name FROM assignments a JOIN workers w ON w.worker_id=a.worker_id WHERE w.department_code=?').bind(user.department).all();
 const {results:bookings}=await db().prepare("SELECT a.worker_id,a.job_id,j.start_at,j.end_at FROM assignments a JOIN jobs j ON j.id=a.job_id WHERE j.department=? AND j.status IN ('Assigned','In progress','Awaiting review')").bind(user.department).all();
 const {results:requests}=await db().prepare('SELECT r.*,j.id AS job_id,j.status AS job_status FROM maintenance_requests r LEFT JOIN jobs j ON j.source_request_id=r.request_id WHERE r.department_code=? ORDER BY r.defect_severity DESC,r.backlog_age_days DESC,r.request_id').bind(user.department).all<MaintenanceRequest>();
 return json({user,workers,jobs:jobs.map(j=>({...j,crew:crew.filter(c=>c.job_id===j.id),source_request:requests.find(r=>r.request_id===j.source_request_id)||null})),bookings,totalWorkers:203,requests,requestDataset:requestManifest});
 }catch(e){console.error(e);return fail('The local database could not be loaded. Please retry.',500)}
}
export async function POST(req:Request){
 try{
 if(req.headers.get('origin')&&req.headers.get('origin')!==new URL(req.url).origin)return fail('Request origin not allowed.',403);
 if(!req.headers.get('content-type')?.includes('application/json'))return fail('JSON request required.',415);
 await seed();const body=await req.json() as Record<string,any>;const action=body.action;
 if(action==='login'){
 if(typeof body.id!=='string'||typeof body.password!=='string'||body.password.length>150)return fail('Enter an account ID and password.');
 const a=await db().prepare('SELECT * FROM accounts WHERE id=?').bind(body.id.trim().toUpperCase()).first<Account&{salt:string;password_hash:string}>();
 if(!a||!await verify(body.password,a.salt,a.password_hash))return fail('Account ID or password is incorrect.',401);
 const token=crypto.randomUUID()+crypto.randomUUID();await db().prepare('INSERT INTO sessions (token_hash,account_id,expires_at) VALUES (?,?,?)').bind(await digest(token),a.id,Date.now()+28800000).run();
 return json({ok:true},200,{'Set-Cookie':cookie(req,token)});
 }
 const user=await session(req);if(!user)return fail('Please sign in to continue.',401);
 if(action==='logout'){
 const token=req.headers.get('cookie')?.split(';').map(s=>s.trim()).find(s=>s.startsWith('railops_session='))?.split('=')[1];if(token)await db().prepare('DELETE FROM sessions WHERE token_hash=?').bind(await digest(token)).run();
 return json({ok:true},200,{'Set-Cookie':cookie(req,'',0)});
 }
 if(action==='acknowledge'){
 if(user.role!=='worker')return fail('Only the assigned worker can acknowledge this job.',403);
 const result=await db().prepare("UPDATE assignments SET status='Acknowledged' WHERE job_id=? AND worker_id=? AND status='Assigned'").bind(String(body.job_id??''),user.id).run();
 if(!result.meta.changes)return fail('No pending assignment found for your account.',404);return json({ok:true});
 }
 if(action==='start_work'||action==='complete_work'){
 if(user.role!=='worker')return fail('Worker access required.',403);
 const id=String(body.job_id??'');const next=action==='start_work'?'In progress':'Completed';const previous=action==='start_work'?'Acknowledged':'In progress';const stamp=action==='start_work'?'started_at':'completed_at';
 const job=await db().prepare('SELECT a.status FROM assignments a JOIN jobs j ON j.id=a.job_id WHERE a.job_id=? AND a.worker_id=? AND j.status<>?').bind(id,user.id,'Completed').first<{status:string}>();
 if(job?.status!==previous)return fail(`This assignment must be ${previous.toLowerCase()} first.`,409);
 if(action==='start_work'){const issue=await operationalJobIssue(id,true);if(issue)return fail(issue,409)}
 const now=new Date().toISOString();
 await db().batch([
 db().prepare(`UPDATE assignments SET status=?,${stamp}=? WHERE job_id=? AND worker_id=? AND status=?`).bind(next,now,id,user.id,previous),
 db().prepare("UPDATE jobs SET status='In progress',started_at=COALESCE(started_at,?) WHERE id=? AND status='Assigned' AND EXISTS (SELECT 1 FROM assignments WHERE job_id=? AND status IN ('In progress','Completed'))").bind(now,id,id),
 db().prepare("UPDATE jobs SET status='Awaiting review' WHERE id=? AND status='In progress' AND (SELECT COUNT(*) FROM assignments WHERE job_id=?)=required_crew AND NOT EXISTS (SELECT 1 FROM assignments WHERE job_id=? AND status<>'Completed')").bind(id,id,id)
 ]);return json({ok:true});
 }
 if(user.role!=='head')return fail('Department-head access required.',403);
 if(action==='confirm_completion'){
 const result=await db().prepare("UPDATE jobs SET status='Completed',completed_at=?,completed_by=? WHERE id=? AND department=? AND status='Awaiting review' AND NOT EXISTS (SELECT 1 FROM assignments a WHERE a.job_id=jobs.id AND a.status<>'Completed')").bind(new Date().toISOString(),user.id,String(body.job_id??''),user.department).run();
 if(!result.meta.changes)return fail('A job in your department must have every worker report completion before confirmation.',409);return json({ok:true});
 }
 if(action==='create'||action==='create_from_request'){
 let source:MaintenanceRequest|null=null;
 if(action==='create_from_request'){
  source=await db().prepare('SELECT * FROM maintenance_requests WHERE request_id=? AND department_code=?').bind(String(body.request_id??''),user.department).first<MaintenanceRequest>();
  if(!source)return fail('Maintenance request not found in your department.',404);
  const existing=await db().prepare('SELECT id FROM jobs WHERE source_request_id=?').bind(source.request_id).first();
  if(existing)return fail('This request already has a job. Open its existing crew plan.',409);
  body.title=source.task_type;
  body.location=`${source.corridor_name} · ${source.line_type}`;
  body.description=`${source.task_type} on ${source.corridor_name}, ${source.line_type}. Required work duration: ${source.required_duration_mins} minutes. Source request: ${source.request_id}.`;
 }
 for(const k of ['title','description','station','location','priority','start_at','end_at'])if(typeof body[k]!=='string'||!body[k].trim())return fail('Complete all job details.');
 if(body.title.length>120||body.description.length>1500||body.location.length>180)return fail('Job details exceed the supported length.');
 if(!['High','Medium','Low'].includes(body.priority))return fail('Choose a valid priority.');
 const station=await db().prepare('SELECT station_code FROM workers WHERE station_code=? LIMIT 1').bind(body.station).first();if(!station)return fail('Choose a station from the dataset.');
 const start=new Date(body.start_at),end=new Date(body.end_at);if(!Number.isFinite(start.getTime())||!Number.isFinite(end.getTime())||end<=start||start.getTime()<Date.now()-60000)return fail('Choose a future start and a later end time.');
 if(source&&end.getTime()-start.getTime()<source.required_duration_mins*60000)return fail(`This request requires at least ${source.required_duration_mins} minutes.`);
 if(!Number.isInteger(body.required_crew)||body.required_crew<1||body.required_crew>100)return fail('Crew size must be between 1 and 100.');
 const {results:candidates}=await db().prepare("SELECT w.* FROM workers w WHERE w.department_code=? AND w.availability_status='Available' AND NOT EXISTS (SELECT 1 FROM assignments a JOIN jobs j ON j.id=a.job_id WHERE a.worker_id=w.worker_id AND j.status IN ('Assigned','In progress','Awaiting review') AND j.start_at<? AND j.end_at>?)").bind(user.department,end.toISOString(),start.toISOString()).all<Worker>();
 const capacity=candidates.filter(w=>isNearbyStation(w.station_code,body.station)&&withinShift(w.shift,start.toISOString(),end.toISOString())).length;
 if(body.required_crew>capacity)return fail(`Only ${capacity} workers at the reporting station and its configured neighbors are eligible for this time. Reduce the crew size or choose a different time.`);
 const id='JOB-'+crypto.randomUUID().slice(0,8).toUpperCase();
 try{await db().prepare('INSERT INTO jobs (id,title,description,department,station,location,priority,required_crew,start_at,end_at,status,created_by,created_at,simulated,source_request_id) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,0,?)').bind(id,body.title.trim(),body.description.trim(),user.department,body.station,body.location.trim(),body.priority,body.required_crew,start.toISOString(),end.toISOString(),'Pending',user.id,new Date().toISOString(),source?.request_id??null).run();}
 catch(e){if(source&&/UNIQUE/i.test(String(e)))return fail('This request was just planned. Refresh to open its existing job.',409);throw e}
 return json({ok:true,id});
 }
 if(action==='assign'){
 const job=await db().prepare('SELECT * FROM jobs WHERE id=? AND department=?').bind(String(body.job_id??''),user.department).first<Job>();if(!job)return fail('Job not found in your department.',404);if(job.status!=='Pending')return fail('This job already has an assignment. Refresh the page.',409);
 if(!Array.isArray(body.worker_ids)||body.worker_ids.some((x:unknown)=>typeof x!=='string')||new Set(body.worker_ids).size!==body.worker_ids.length)return fail('Choose distinct workers from the list.');
 if(body.worker_ids.length!==job.required_crew)return fail(`Select exactly ${job.required_crew} workers for this job.`);
 const start=new Date(body.start_at),end=new Date(body.end_at);if(!Number.isFinite(start.getTime())||!Number.isFinite(end.getTime())||end<=start||start.getTime()<Date.now()-60000)return fail('Choose a future start and a later end time.');
 if(job.source_request_id){
  const source=await db().prepare('SELECT required_duration_mins FROM maintenance_requests WHERE request_id=?').bind(job.source_request_id).first<{required_duration_mins:number}>();
  if(!source||end.getTime()-start.getTime()<source.required_duration_mins*60000)return fail(`Keep at least ${source?.required_duration_mins??0} minutes for this maintenance request.`);
 }
 const approved=await db().prepare('SELECT block_id FROM operations_jobs WHERE job_id=?').bind(job.id).first();
 if(approved){const issue=await operationalJobIssue(job.id);if(issue)return fail(issue,409)}
 if(approved&&(start.toISOString()!==job.start_at||end.toISOString()!==job.end_at))return fail('Keep the controller-approved block start and end time. Contact Control Centre to revise the plan.',409);
 const ids=body.worker_ids as string[];const {results:workers}=await db().prepare(`SELECT * FROM workers WHERE worker_id IN (${ids.map(()=>'?').join(',')})`).bind(...ids).all<Worker>();
 if(workers.length!==ids.length||workers.some(w=>w.department_code!==user.department))return fail('All selected workers must belong to your department.',403);
 for(const w of workers){if(!isNearbyStation(w.station_code,job.station))return fail(`${w.name} is outside the reporting station and its configured neighboring stations.`,409);if(w.availability_status!=='Available')return fail(`${w.name} is ${w.availability_status.toLowerCase()}.`,409);if(!withinShift(w.shift,start.toISOString(),end.toISOString()))return fail(`${w.name} is outside their rostered shift.`,409)}
 const changes=[db().prepare("UPDATE jobs SET start_at=?,end_at=?,status='Assigned',assigned_at=?,created_by=? WHERE id=? AND status='Pending'").bind(start.toISOString(),end.toISOString(),new Date().toISOString(),user.id,job.id),...ids.map(id=>db().prepare('INSERT INTO assignments (job_id,worker_id,status) VALUES (?,?,?)').bind(job.id,id,'Assigned'))];
 try{await db().batch(changes)}catch(e){if(/overlap|UNIQUE|already assigned/i.test(String(e)))return fail('One or more workers have an overlapping assignment, or this job was just assigned. Refresh and choose again.',409);throw e}
 return json({ok:true,count:ids.length});
 }
 return fail('Unknown action.');
 }catch(e){console.error(e);return fail('The request could not be saved. Please retry.',500)}
}
