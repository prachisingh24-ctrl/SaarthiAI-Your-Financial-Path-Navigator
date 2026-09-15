export type ReportTable={headers:string[];widths:number[];rows:string[][]};
export type ReportSection={title:string;label?:string;facts?:[string,string][];paragraphs?:string[];table?:ReportTable};
export type Report={title:string;subtitle:string;reference:string;generatedAt:string;summary:[string,string][];notes:string[];sections:ReportSection[];filename:string};

export function istDay(date:string){
 if(!/^\d{4}-\d{2}-\d{2}$/.test(date))throw new Error('Choose a valid report date.');
 const start=new Date(date+'T00:00:00+05:30');
 if(!Number.isFinite(start.getTime())||new Date(start.getTime()+330*60000).toISOString().slice(0,10)!==date)throw new Error('Choose a valid calendar date.');
 return {start:start.toISOString(),end:new Date(start.getTime()+86400000).toISOString()};
}
export function overlapsDay(start:string,end:string,date:string){const day=istDay(date);return new Date(start).getTime()<new Date(day.end).getTime()&&new Date(end).getTime()>new Date(day.start).getTime()}
export function todayIST(){return new Date(Date.now()+330*60000).toISOString().slice(0,10)}
export function finalizedCrew(job:{status:string;assigned_at:string|null;required_crew:number;crew_count:number}){return ['Assigned','In progress','Awaiting review','Completed'].includes(job.status)&&!!job.assigned_at&&job.required_crew>0&&job.crew_count===job.required_crew}
