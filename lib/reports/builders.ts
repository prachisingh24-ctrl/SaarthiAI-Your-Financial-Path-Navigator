import { departments, formatDate, formatTime, type Job, type Account } from '../types';
import { finalizedCrew, istDay, type Report, type ReportSection } from './types';

export type ReportCrew={job_id:string;worker_id:string;name:string;designation:string;station_code:string;shift:string;status:string};
export type ReportJob=Omit<Job,'crew'>&{head_name:string|null;line_type:string|null;corridor_name:string|null;required_duration_mins:number|null;latitude:number|null;longitude:number|null;crew:ReportCrew[]};
const time=(iso:string)=>`${formatDate(iso)} ${formatTime(iso)} IST`;
const safe=(s:string)=>s.replace(/[^a-zA-Z0-9_-]/g,'-');

export function jobReport(user:Account,jobs:ReportJob[],date:string|null,generatedAt:string,department?:string):Report{
 const personal=user.role==='worker';
 const title=date?(personal?'My daily job schedule':'Daily maintenance plan'):'Finalized schedule & crew';
 const scope=personal?`${user.name} (${user.id})`:departments[department||user.department]?`${departments[department||user.department]} department`:'Control Centre / all departments';
 const sections:ReportSection[]=jobs.map((job,i)=>{
  const final=finalizedCrew(job),demoHistory=!!job.simulated&&job.required_crew===0;
  const state=demoHistory?'Demo completion history':final?'Saved schedule and crew':'Awaiting crew finalization';
  const facts:[string,string][]=[['Department',departments[job.department]||job.department],['Reporting site',`${job.station} / ${job.location}`],['Scheduled start',time(job.start_at)],['Scheduled end',time(job.end_at)],['Job status',job.status],['Priority',job.priority]];
  if(job.assigned_at)facts.push(['Crew assigned',time(job.assigned_at)]);
  if(job.head_name||job.created_by)facts.push(['Assigned / planned by',job.created_by==='DEMO-HISTORY'?'Demo history':`${job.head_name||job.created_by} (${job.created_by})`]);
  if(job.source_request_id)facts.push(['Source request',`${job.source_request_id} / ${job.corridor_name} / ${job.line_type}`],['Source duration',`${job.required_duration_mins} minutes`],['Coordinates',`${job.latitude}, ${job.longitude}`]);
  if(job.completed_at)facts.push(['Completion saved',time(job.completed_at)]);
  const paragraphs=[job.description];
  if(date){const d=istDay(date);if(new Date(job.start_at)<new Date(d.start)||new Date(job.end_at)>new Date(d.end))paragraphs.push('Overnight / cross-day job: the full saved start and end times are shown. This job overlaps the selected report day.')}
  if(personal){facts.push(['Your work status',job.crew[0]?.status||job.my_status||'Assigned'],['Assigned crew size',`${job.crew_count} workers`]);return {title:`${i+1}. ${job.title}`,label:`${job.id} / ${state}${job.simulated?' / SAMPLE JOB':''}`,facts,paragraphs}}
  if(!job.crew.length){paragraphs.push(demoHistory?'This is a clearly marked demo completion record. No worker reports or assigned crew are inferred.':'No workers have been assigned yet. This job is a pending crew plan.');return {title:`${i+1}. ${job.title}`,label:`${job.id} / ${state}${job.simulated?' / SAMPLE JOB':''}`,facts,paragraphs}}
  facts.push(['Crew allocation',`${job.crew_count} assigned / ${job.required_crew} required`]);
  return {title:`${i+1}. ${job.title}`,label:`${job.id} / ${state}${job.simulated?' / SAMPLE JOB':''}`,facts,paragraphs,table:{headers:['Worker ID','Name','Designation','Home site','Shift / IST','Work status'],widths:[60,104,111,49,90,97],rows:job.crew.map(w=>[w.worker_id,w.name,w.designation,w.station_code,w.shift,w.status])}};
 });
 if(!jobs.length)sections.push({title:'No jobs scheduled',paragraphs:[`No saved ${personal?'assignments for this worker':'maintenance jobs'} overlap the selected IST day.`]});
 const dateLabel=date?formatDate(istDay(date).start):jobs[0].id;
 return {title,subtitle:scope,reference:date?`REPORT DATE: ${dateLabel} / 00:00-24:00 IST`:`JOB: ${jobs[0].id}`,generatedAt,
 summary:[['Report coverage',date?`${jobs.length} jobs overlapping ${dateLabel}`:'One saved job with its complete assigned crew'],['Prepared for',`${user.name} (${user.id})`],...(date&&!personal?[['Crew finalized',`${jobs.filter(finalizedCrew).length} jobs`],['Awaiting crew',`${jobs.filter(j=>j.status==='Pending').length} jobs`]] as [string,string][]:[])],
 notes:[date?'Includes every matching saved job, regardless of table pagination. Jobs ending exactly at midnight are included only in the preceding day.':'The named crew and schedule are read from saved assignments at export time.','This report is a saved snapshot. Later changes require a new download. Crew allocation does not grant operational clearance.'],sections,
 filename:`railblock-${personal?'worker-'+safe(user.id):date?'daily-'+safe(department||user.department):'crew-'+safe(jobs[0].id)}${date?'-'+date:''}.pdf`};
}

export function planReport(user:Account,row:{id:string;status:string;revision:number;payload:string},date:string|null,generatedAt:string,tasks:Map<string,any>):Report{
 const plan=JSON.parse(row.payload);const base=istDay(plan.config.start_date).start;
 const asISO=(m:number)=>new Date(new Date(base).getTime()+m*60000).toISOString();
 const day=date?istDay(date):null;
 const blocks=plan.blocks.filter((b:any)=>!day||(asISO(b.start)<day.end&&asISO(b.end)>day.start)).sort((a:any,b:any)=>a.start-b.start||a.id.localeCompare(b.id));
 const sections:ReportSection[]=blocks.map((b:any,i:number)=>({title:`${i+1}. ${b.id} / ${b.section}`,label:`${b.departments.map((d:string)=>departments[d]||d).join(' + ')} / ${row.status==='Accepted'?'Accepted plan':'Not finalized: '+row.status} / SYNTHETIC SCENARIO`,
 facts:[['Work line',b.line+' (both lines reserved)'],['Scheduled start',time(asISO(b.start))],['Scheduled end',time(asISO(b.end))],['Block duration',`${b.duration} minutes, including 10 minutes setup and clearance`],['Power isolation',b.power?'Required and included in the simulated plan':'Not required']],
 paragraphs:[...b.reasons,'Resource numbers below are planning requirements. Named workers must be selected separately by department heads.'],
 table:{headers:['Task / department','Work / asset / KM','Work duration','Crew / machine'],widths:[100,235,65,111],rows:b.tasks.map((id:string)=>{const t=tasks.get(id);if(!t)throw new Error('A saved planning task is missing from its scenario.');return [id+'\n'+(departments[t.department]||t.department),`${t.task_type}\n${t.asset_id}\nKM ${t.km_start}-${t.km_end}${t.dependencies.length?'\nAfter: '+t.dependencies.join(', '):''}`,`${t.duration} min`,`${t.crew} crew\n${t.machine||'No machine'}`]})}}));
 if(!blocks.length)sections.push({title:'No blocks scheduled',paragraphs:['No saved blocks overlap the selected IST day.']});
 if(!date&&plan.unscheduled.length)sections.push({title:'Deferred activities',table:{headers:['Task ID','Reason'],widths:[105,406],rows:plan.unscheduled.map((t:any)=>[t.id,t.reason])}});
 return {title:date?'Daily block plan':'Block schedule',subtitle:`Control Centre / ${row.status==='Accepted'?'Finalized (accepted) plan':row.status+' plan - not finalized'}`,reference:`${row.id} / REVISION ${row.revision}${date?' / '+formatDate(day!.start):''}`,generatedAt,
 summary:[['Planning horizon',`${plan.config.horizon} days from ${formatDate(base)}`],['Report coverage',`${blocks.length} blocks / ${blocks.reduce((n:number,b:any)=>n+b.tasks.length,0)} tasks${date?' overlapping '+formatDate(day!.start):''}`],['Prepared for',`${user.name} (${user.id})`]],
 notes:['Synthetic planning scenario. Crew requirements are not named worker assignments or railway operational authorization.','This PDF preserves the selected saved plan revision. Regenerate it after a plan change.'],sections,
 filename:`railblock-${safe(row.id)}-r${row.revision}-${safe(row.status.toLowerCase())}${date?'-'+date:''}.pdf`};
}

export function operationsReport(user:Account,row:{id:string;status:string;revision:number;payload:string},date:string|null,generatedAt:string):Report{
 const p=JSON.parse(row.payload),base=Date.parse(istDay(p.config.start_date).start),iso=(m:number)=>new Date(base+m*60000).toISOString();
 const day=date?istDay(date):null;
 const blocks=p.blocks.filter((b:any)=>!day||(iso(b.start)<day.end&&iso(b.end)>day.start));
 const sections:ReportSection[]=blocks.map((b:any,i:number)=>({title:`${i+1}. ${b.section_id}`,label:`${b.id} / ${row.status}`,facts:[['Start',time(iso(b.start))],['End',time(iso(b.end))],['Line',`${b.line}; both lines reserved conservatively`],['Duration',`${b.duration} minutes including ${p.input.setup} minutes setup / clearance`]],table:{headers:['Source request','Work / location','Department / crew'],widths:[105,271,135],rows:b.tasks.map((id:string)=>{const t=p.input.tasks.find((t:any)=>t.id===id);return [id,`${t.title}\n${t.location_reference}\n${t.duration} min work`,`${t.department}\n${t.crew} workers at ${t.station}\n${t.machine||'No machine'}`]})}}));
 if(!blocks.length)sections.push({title:'No blocks on this day',paragraphs:['No saved blocks overlap the chosen IST day.']});
 if(!date&&p.unscheduled.length)sections.push({title:'Deferred requests',table:{headers:['Request','Reason'],widths:[105,406],rows:p.unscheduled.map((t:any)=>[t.id,t.reason])}});
 return {title:date?'Daily maintenance block plan':'Maintenance block plan',subtitle:`Control Centre / ${row.status}`,reference:`${row.id} / revision ${row.revision}${date?' / '+date:''}`,generatedAt,
  summary:[['Prepared for',`${user.name} (${user.id})`],['Planning period',`${p.config.horizon} days from ${p.config.start_date}`],['Coverage',`${blocks.length} blocks`],['Input basis','Supplied requests and saved local planning register']],
  notes:['Public timetable reference records have incomplete traffic coverage. A checked work window is required before department job release.',row.status==='Released'?'Jobs have been released for department heads to select named crews. Download a crew sheet after assignment.':'This saved plan has not been released to department jobs.','This document records local maintenance planning. It is not a railway signalling or traffic clearance.'],sections,filename:`railblock-${row.id}-r${row.revision}${date?'-'+date:''}.pdf`};
}
