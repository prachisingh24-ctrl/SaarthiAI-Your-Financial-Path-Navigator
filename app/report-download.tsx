'use client';
import { useId, useState } from 'react';
import { CalendarDays, FileDown, Loader2 } from 'lucide-react';
import { overlapsDay, todayIST } from '@/lib/reports/types';

type ReportQuery={kind:'job'|'daily'|'plan'|'operations';job_id?:string;date?:string;department?:string;plan_id?:string;revision?:number};
export function PdfDownload({query,children,disabled=false}:{query:ReportQuery;children:React.ReactNode;disabled?:boolean}){
 const [busy,setBusy]=useState(false),[error,setError]=useState('');
 async function download(){
  setBusy(true);setError('');
  try{
   const params=new URLSearchParams();for(const [key,value] of Object.entries(query))if(value!==undefined&&value!=='')params.set(key,String(value));
   const res=await fetch('/api/reports?'+params,{cache:'no-store'});
   if(!res.ok){const data=await res.json() as {error?:string};throw new Error(data.error||'The report could not be downloaded.')}
   if(!res.headers.get('content-type')?.includes('application/pdf'))throw new Error('A PDF was not returned. Please sign in and try again.');
   const blob=await res.blob(),url=URL.createObjectURL(blob),link=document.createElement('a');
   link.href=url;link.download=res.headers.get('content-disposition')?.match(/filename="([^"]+)"/)?.[1]||'railblock-schedule.pdf';
   document.body.appendChild(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),30000);
  }catch(e){setError((e as Error).message)}finally{setBusy(false)}
 }
 return <div className="pdf-download-control"><button type="button" className="btn report-download" disabled={disabled||busy} onClick={download} aria-busy={busy}>{busy?<Loader2 className="spin" size={16}/>:<FileDown size={16}/>}<span>{busy?'Preparing PDF…':children}</span></button>{error&&<p className="report-error" role="alert">{error}</p>}</div>
}

export function DailyReportBar({jobs=[],department,worker=false,plan}:{jobs?:{start_at:string;end_at:string}[];department?:string;worker?:boolean;plan?:{id:string;revision:number;config:{start_date:string;horizon:number};blocks:{start:number;end:number}[]}}){
 const inputId=useId(),[date,setDate]=useState(()=>plan?.config.start_date||todayIST());
 const rangeEnd=plan?new Date(new Date(plan.config.start_date+'T00:00:00+05:30').getTime()+(plan.config.horizon-1)*86400000+330*60000).toISOString().slice(0,10):undefined;
 let count=0;
 if(date)try{if(plan){const base=new Date(plan.config.start_date+'T00:00:00+05:30').getTime();count=plan.blocks.filter(b=>overlapsDay(new Date(base+b.start*60000).toISOString(),new Date(base+b.end*60000).toISOString(),date)).length}else count=jobs.filter(j=>overlapsDay(j.start_at,j.end_at,date)).length}catch{}
 return <section className="daily-report-bar panel" aria-label="Download a daily schedule"><div className="daily-report-copy"><span className="daily-report-icon"><CalendarDays size={21}/></span><div><h2>{plan?'Daily block plan':worker?'Your daily schedule':'Daily maintenance plan'}</h2><p>{date?`${count} ${plan?'blocks':'jobs'} on the selected day`:'Choose a report date'}{worker?' · Your assignments only':plan?' · Current saved revision':' · Includes jobs awaiting crew'} · IST</p></div></div><div className="daily-report-actions"><label htmlFor={inputId}>Report date<input id={inputId} type="date" value={date} min={plan?.config.start_date} max={rangeEnd} onChange={e=>setDate(e.target.value)}/></label>{!plan&&<button className="btn" type="button" onClick={()=>setDate(todayIST())}>Today</button>}<PdfDownload disabled={!date} query={plan?{kind:'plan',plan_id:plan.id,revision:plan.revision,date}:{kind:'daily',date,department}}>Download daily PDF</PdfDownload></div></section>
}
