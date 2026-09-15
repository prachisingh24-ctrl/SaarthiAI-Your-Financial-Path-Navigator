import { env } from 'cloudflare:workers';
import controller from '@/data/controller-account.json';
import workers from '@/data/workers.json';
import accounts from '@/data/accounts.json';
import requests from '@/data/maintenance-requests.json';
import requestManifest from '@/data/maintenance-requests.meta.json';
import type { Account, MaintenanceRequest } from './types';
import { assertAppendOnlyRequests } from './request-import';
export function db(){return env.DB}
let seeded:Promise<void>|undefined;
export function seed(){return seeded??=seedData().catch(e=>{seeded=undefined;throw e})}
async function seedData(){
 await seedWorkers();
 await seedRequests();
 const a=controller;await db().prepare('INSERT OR IGNORE INTO accounts (id,name,role,department,salt,password_hash) VALUES (?,?,?,?,?,?)').bind(a.id,a.name,a.role,a.department,a.salt,a.password_hash).run();
 await seedCompletionHistory();
}
async function seedCompletionHistory(){
 const local=new Date(Date.now()+330*60000);
 const statements:D1PreparedStatement[]=[];
 for(const [department,station,title] of [['TRK','TNA','Track inspection completed'],['SIG','KYN','Signal equipment inspection completed'],['TRC','PUNE','OHE inspection completed']]){
  for(let month=0;month<3;month++){
   const day=new Date(Date.UTC(local.getUTCFullYear(),local.getUTCMonth()-month,month?5:Math.max(1,local.getUTCDate()-2),2,30));
   const start=day.toISOString(),end=new Date(day.getTime()+3600000).toISOString();
   statements.push(db().prepare("INSERT OR IGNORE INTO jobs (id,title,description,department,station,location,priority,required_crew,start_at,end_at,status,created_by,created_at,assigned_at,started_at,completed_at,completed_by,simulated) VALUES (?,?,?,?,?,?,?,0,?,?,'Completed','DEMO-HISTORY',?,?,?,?,'DEMO-HISTORY',1)").bind(`DEMO-COMP-${department}-${month+1}`,title,'Completed demo history for the SIH progress demonstration. No worker activity is inferred or reported by this record.',department,station,'Demonstration history','Medium',start,end,start,start,start,end));
  }
 }
 await db().batch(statements);
}
async function seedRequests(){
 const imported=await db().prepare('SELECT sha256 FROM dataset_imports WHERE name=?').bind(requestManifest.filename).first<{sha256:string}>();
 if(imported?.sha256===requestManifest.sha256)return;
 const {results:existing}=await db().prepare('SELECT * FROM maintenance_requests').all<MaintenanceRequest>();
 assertAppendOnlyRequests(existing,requests);
 for(let offset=0;offset<requests.length;offset+=80){
  await db().batch(requests.slice(offset,offset+80).map(r=>db().prepare('INSERT OR IGNORE INTO maintenance_requests (request_id,department,department_code,task_type,corridor_name,line_type,longitude,latitude,defect_severity,backlog_age_days,required_duration_mins,timestamp) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)').bind(r.request_id,r.department,r.department_code,r.task_type,r.corridor_name,r.line_type,r.longitude,r.latitude,r.defect_severity,r.backlog_age_days,r.required_duration_mins,r.timestamp)));
 }
 await db().prepare('INSERT INTO dataset_imports (name,sha256,row_count,imported_at) VALUES (?,?,?,?) ON CONFLICT(name) DO UPDATE SET sha256=excluded.sha256,row_count=excluded.row_count,imported_at=excluded.imported_at').bind(requestManifest.filename,requestManifest.sha256,requestManifest.row_count,new Date().toISOString()).run();
}
async function seedWorkers(){
 const exists=await db().prepare('SELECT id FROM accounts WHERE id = ?').bind('HEAD-TRK').first();if(exists)return;
 const statements: D1PreparedStatement[]=[];
 for(const w of workers)statements.push(db().prepare('INSERT OR IGNORE INTO workers (worker_id,name,department_code,department_name,designation,station_code,station_name,shift,availability_status) VALUES (?,?,?,?,?,?,?,?,?)').bind(w.worker_id,w.name,w.department_code,w.department_name,w.designation,w.station_code,w.station_name,w.shift,w.availability_status));
 for(const a of accounts)statements.push(db().prepare('INSERT OR IGNORE INTO accounts (id,name,role,department,salt,password_hash) VALUES (?,?,?,?,?,?)').bind(a.id,a.name,a.role,a.department,a.salt,a.password_hash));
 const day=new Date(Date.now()+86400000+330*60000).toISOString().slice(0,10);
 const seeds=[['TRK','CSMT','Rail fastening inspection','Inspect and secure rail fastenings in the designated yard section. Report loose or damaged components to the section engineer.','Yard section · inspection point A','High',6,8,10],['TRK','KYN','Track geometry inspection','Check the designated track section and record observations for the section engineer.','Kalyan yard · section B','Medium',4,14,16],['TRK','PUNE','Drainage and ballast inspection','Inspect drainage outlets and ballast condition at the designated section.','Pune yard · section C','Low',3,8,10],['SIG','TNA','Point-machine condition inspection','Inspect point-machine condition and record findings for the signalling supervisor.','Thane yard · point 12','High',2,10,12],['SIG','DR','Signal equipment inspection','Inspect the designated signal equipment and report visible defects.','Dadar yard · signal section','Medium',3,14,16],['TRC','KYN','OHE condition inspection','Inspect the designated overhead equipment section under the supervisor’s instructions.','Kalyan yard · OHE section','High',2,22,23],['TRC','PUNE','Traction equipment inspection','Inspect designated traction equipment and record observations.','Pune yard · traction section','Medium',3,8,10]];
 for(let i=0;i<seeds.length;i++){
 const [dep,station,title,description,location,priority,count,start,end]=seeds[i];
 statements.push(db().prepare('INSERT OR IGNORE INTO jobs (id,title,description,department,station,location,priority,required_crew,start_at,end_at,status,created_by,created_at,simulated) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,1)').bind(`JOB-${String(i+1).padStart(3,'0')}`,title,description,dep,station,location,priority,count,new Date(`${day}T${String(start).padStart(2,'0')}:00:00+05:30`).toISOString(),new Date(`${day}T${String(end).padStart(2,'0')}:00:00+05:30`).toISOString(),'Pending','HEAD-'+dep,new Date().toISOString()));
 }
 await db().batch(statements);
}
export async function digest(value:string){return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value))),v=>v.toString(16).padStart(2,'0')).join('')}
export async function verify(password:string,salt:string,expected:string){
 const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(password),'PBKDF2',false,['deriveBits']);
 const result=new Uint8Array(await crypto.subtle.deriveBits({name:'PBKDF2',hash:'SHA-256',salt:new TextEncoder().encode(salt),iterations:100000},key,256));
 const hash=Array.from(result,v=>v.toString(16).padStart(2,'0')).join('');let diff=0;for(let i=0;i<hash.length;i++)diff|=hash.charCodeAt(i)^expected.charCodeAt(i);return diff===0&&hash.length===expected.length;
}
export async function session(req:Request):Promise<Account|null>{
 const token=req.headers.get('cookie')?.split(';').map(s=>s.trim()).find(s=>s.startsWith('railops_session='))?.split('=')[1];if(!token)return null;
 return db().prepare('SELECT a.id,a.name,a.role,a.department FROM sessions s JOIN accounts a ON a.id=s.account_id WHERE s.token_hash=? AND s.expires_at>?').bind(await digest(token),Date.now()).first<Account>();
}
export function cookie(req:Request,token:string,maxAge=28800){return `railops_session=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${new URL(req.url).protocol==='https:'?'; Secure':''}`}
