import type { MaintenanceRequest } from './types';

const sourceFields = ['request_id','department','department_code','task_type','corridor_name','line_type','longitude','latitude','defect_severity','backlog_age_days','required_duration_mins','timestamp'] as const;

// Existing source records can be linked to live crew plans. Seed imports may
// append records, but must never silently replace or remove those sources.
export function assertAppendOnlyRequests(existing:MaintenanceRequest[],incoming:MaintenanceRequest[]){
 const byId=new Map(incoming.map(r=>[r.request_id,r]));
 for(const current of existing){
  const next=byId.get(current.request_id);
  if(!next||sourceFields.some(k=>current[k]!==next[k])){
   throw new Error(`Request ${current.request_id} is already imported with different source data. Existing records and crew plans have been preserved.`);
  }
 }
}
