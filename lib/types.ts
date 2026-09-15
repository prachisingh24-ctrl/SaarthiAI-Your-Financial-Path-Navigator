export type Account={id:string;name:string;role:'head'|'worker'|'controller';department:string};
export type Worker={worker_id:string;name:string;department_code:string;department_name:string;designation:string;station_code:string;station_name:string;shift:string;availability_status:string};
export type MaintenanceRequest={request_id:string;department:string;department_code:string;task_type:string;corridor_name:string;line_type:string;longitude:number;latitude:number;defect_severity:number;backlog_age_days:number;required_duration_mins:number;timestamp:string;job_id?:string|null;job_status?:string|null};
export type Job={approved_block?:string|null;id:string;title:string;description:string;department:string;station:string;location:string;priority:string;required_crew:number;start_at:string;end_at:string;status:string;created_by:string;created_at:string;assigned_at:string|null;started_at?:string|null;completed_at?:string|null;simulated:number;crew_count:number;crew?:{worker_id:string;name:string;status:string}[];my_status?:string;source_request_id?:string|null;source_request?:MaintenanceRequest|null};
export type Booking={worker_id:string;job_id:string;start_at:string;end_at:string};
export const departments:Record<string,string>={TRK:'Track',SIG:'Signal',TRC:'Traction'};
export function withinShift(shift:string,start:string,end:string){
 const s=new Date(start).getTime(), e=new Date(end).getTime();if(!Number.isFinite(s)||!Number.isFinite(e)||e<=s)return false;
 const local=new Date(s+330*60000);const day=Date.UTC(local.getUTCFullYear(),local.getUTCMonth(),local.getUTCDate())-330*60000;
 const hour=local.getUTCHours();let from=6,to=14;
 if(shift.startsWith('B')){from=14;to=22;}
 if(shift.startsWith('C')){from=hour<6?-2:22;to=hour<6?6:30;}
 return s>=day+from*3600000 && e<=day+to*3600000;
}
export function localInput(iso:string){return new Date(new Date(iso).getTime()+330*60000).toISOString().slice(0,16)}
export function toISO(local:string){return new Date(local+'+05:30').toISOString()}
export function formatDate(iso:string){return new Date(iso).toLocaleDateString('en-IN',{day:'numeric',month:'short',year:'numeric',timeZone:'Asia/Kolkata'})}
export function formatTime(iso:string){return new Date(iso).toLocaleTimeString('en-IN',{hour:'2-digit',minute:'2-digit',hour12:false,timeZone:'Asia/Kolkata'})}
