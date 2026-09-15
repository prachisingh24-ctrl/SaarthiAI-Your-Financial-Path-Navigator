import { db, seed, session } from '@/lib/server';
import { departments } from '@/lib/types';
import { finalizedCrew, istDay } from '@/lib/reports/types';
import { jobReport, planReport, operationsReport, type ReportJob, type ReportCrew } from '@/lib/reports/builders';
import { renderReport } from '@/lib/reports/pdf';
import scenario from '@/data/synthetic-scenario.json';

export const dynamic='force-dynamic';
const error=(message:string,status=400)=>Response.json({error:message},{status,headers:{'Cache-Control':'private, no-store'}});

export async function GET(req:Request){
 try{
  await seed();const user=await session(req);if(!user)return error('Sign in to download a report.',401);
  const params=new URL(req.url).searchParams,kind=params.get('kind');
  if(!['job','daily','plan','operations'].includes(kind||''))return error('Choose a schedule or daily report.');
  // The caller cannot choose another worker's identity, even through an ignored parameter.
  if(params.has('worker_id'))return error('Worker reports use the signed-in account only.',403);
  const date=params.get('date');if(date)istDay(date);
  const generatedAt=new Date().toISOString();let report;
  if(kind==='operations'){
   if(user.role!=='controller')return error('Control Centre access required.',403);
   const revision=params.get('revision');if(!revision||!/^\d+$/.test(revision))return error('Choose a saved plan revision.');
   const row=await db().prepare('SELECT id,status,revision,payload FROM operations_plans WHERE id=?').bind(params.get('plan_id')||'').first<{id:string;status:string;revision:number;payload:string}>();
   if(!row)return error('Plan not found.',404);if(row.revision!==Number(revision))return error('The plan changed. Refresh before downloading.',409);
   const p=JSON.parse(row.payload);if(date){const offset=(Date.parse(istDay(date).start)-Date.parse(istDay(p.config.start_date).start))/86400000;if(offset<0||offset>=p.config.horizon)return error('Choose a date inside this plan.');}
   report=operationsReport(user,row,date,generatedAt);
  }else if(kind==='plan'){
   if(user.role!=='controller')return error('Control Centre access is required for block-plan reports.',403);
   const revision=params.get('revision');if(!revision||!/^\d+$/.test(revision)||!Number.isSafeInteger(Number(revision))||Number(revision)<1)return error('Select a saved plan revision.');
   const row=await db().prepare('SELECT id,status,revision,payload FROM planner_plans WHERE id=?').bind(params.get('plan_id')||'').first<{id:string;status:string;revision:number;payload:string}>();
   if(!row)return error('Plan not found.',404);
   if(row.revision!==Number(revision))return error('This plan changed. Refresh it before downloading the PDF.',409);
   const payload=JSON.parse(row.payload);
   if(payload.scenario!==scenario.version)return error('The scenario for this saved plan is unavailable.',409);
   if(date){const offset=(new Date(istDay(date).start).getTime()-new Date(istDay(payload.config.start_date).start).getTime())/86400000;if(offset<0||offset>=payload.config.horizon)return error('Choose a day within this plan’s horizon.');}
   report=planReport(user,row,date,generatedAt,new Map(scenario.tasks.map(t=>[t.id,t])));
  }else{
   if(kind==='job'&&user.role==='worker')return error('Use your personal daily report to download your own assignments.',403);
   if(kind==='daily'&&!date)return error('Choose a date for the daily report.');
   if(kind==='job'&&!params.get('job_id'))return error('Choose a finalized job.');
   const requestedDepartment=params.get('department');
   if(requestedDepartment&&!departments[requestedDepartment])return error('Choose a valid department.');
   if(user.role!=='controller'&&requestedDepartment&&requestedDepartment!==user.department)return error('You can only export your own department.',403);
   const department=user.role==='controller'?requestedDepartment||undefined:user.department;
   const clauses:string[]=[],bindings:string[]=[];
   if(user.role==='worker'){clauses.push('EXISTS (SELECT 1 FROM assignments own WHERE own.job_id=j.id AND own.worker_id=?)');bindings.push(user.id)}
   else if(department){clauses.push('j.department=?');bindings.push(department)}
   if(kind==='job'){clauses.push('j.id=?');bindings.push(params.get('job_id')!)}
   else{const range=istDay(date!);clauses.push('j.start_at<? AND j.end_at>?');bindings.push(range.end,range.start)}
   const where=clauses.join(' AND ')||'1=1';
   const personal=user.role==='worker'?' AND a.worker_id=?':'';
   // A single D1 read batch provides a consistent saved-job / crew snapshot.
   const result=await db().batch([
    db().prepare(`SELECT j.*,h.name AS head_name,r.line_type,r.corridor_name,r.required_duration_mins,r.latitude,r.longitude,(SELECT COUNT(*) FROM assignments a WHERE a.job_id=j.id) AS crew_count FROM jobs j LEFT JOIN accounts h ON h.id=j.created_by LEFT JOIN maintenance_requests r ON r.request_id=j.source_request_id WHERE ${where} ORDER BY j.start_at,j.department,j.id`).bind(...bindings),
    db().prepare(`SELECT a.job_id,a.worker_id,a.status,w.name,w.designation,w.station_code,w.shift FROM assignments a JOIN workers w ON w.worker_id=a.worker_id JOIN jobs j ON j.id=a.job_id WHERE ${where}${personal} ORDER BY w.name,w.worker_id`).bind(...bindings,...(personal?[user.id]:[]))
   ]);
   const crew=result[1].results as unknown as ReportCrew[];
   const jobs=(result[0].results as unknown as ReportJob[]).map(j=>({...j,crew:crew.filter(w=>w.job_id===j.id)}));
   if(kind==='job'){
    if(!jobs.length)return error('Job not found in your authorized workspace.',404);
    if(!finalizedCrew(jobs[0]))return error('Finalize the schedule and assign its complete crew before downloading a crew sheet.',409);
   }
   report=jobReport(user,jobs,kind==='daily'?date:null,generatedAt,department);
  }
  const pdf=await renderReport(report);
  return new Response(new Uint8Array(pdf).buffer,{headers:{'Content-Type':'application/pdf','Content-Disposition':`attachment; filename="${report.filename}"`,'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'}});
 }catch(e){console.error('Report generation:',e);return error((e as Error).message||'The PDF could not be created. Please retry.',400)}
}
