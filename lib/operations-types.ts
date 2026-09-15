export const corridors=['Pune-Lonavala','Pune-Daund','Pune-Miraj'] as const;
export type Section={id:string;corridor:string;name:string;from_station:string;to_station:string;source:string};
export type Movement={id:string;section_id:string;train_no:string;kind:'Passenger'|'Freight';start_at:string;end_at:string;source:string};
export type WorkWindow={id:string;section_id:string;start_at:string;end_at:string;power:boolean;traffic_complete:boolean;reference:string};
export type TaskDetails={request_id:string;section_id:string;station:string;crew:number;release_at:string;due_at:string;machine:string;power:boolean;compatibility_group:string;compatibility_reference:string;location_reference:string};
export type OperationsInput={sections:Section[];movements:Movement[];windows:WorkWindow[];tasks:TaskDetails[];machines:Record<string,number>;headway:number;setup:number};
export type OperationsPlan={id:string;status:string;revision:number;input_revision:number;created_at:string;payload:any};

// RFC 4180 quoting, BOM and CRLF support. No spreadsheet formula execution.
export function csvRows(text:string):Record<string,string>[] {
 if(text.length>1_000_000)throw new Error('CSV must be smaller than 1 MB.');
 const rows:string[][]=[],row:string[]=[];let cell='',quoted=false,closed=false;
 text=text.replace(/^\uFEFF/,'');
 for(let i=0;i<text.length;i++){
  const c=text[i];
  if(quoted){if(c==='"'){if(text[i+1]==='"'){cell+='"';i++}else{quoted=false;closed=true}}else cell+=c;continue}
  if(c==='"'){if(cell||closed)throw new Error('Unexpected quote in CSV.');quoted=true}
  else if(c===','||c==='\n'||c==='\r'){row.push(cell);cell='';closed=false;if(c!==','){if(c==='\r'&&text[i+1]==='\n')i++;if(row.some(x=>x!==''))rows.push([...row]);row.length=0}}
  else{if(closed)throw new Error('Unexpected text after a quoted CSV field.');cell+=c}
 }
 if(quoted)throw new Error('An unfinished quoted field was found.');
 if(cell||row.length){row.push(cell);rows.push(row)}
 const headers=rows.shift()?.map(s=>s.trim());if(!headers?.length||headers.some(x=>!x)||new Set(headers).size!==headers.length)throw new Error('CSV headers must be present and unique.');
 if(rows.length>2000)throw new Error('Import at most 2,000 rows at a time.');
 return rows.map((r,i)=>{if(r.length!==headers.length)throw new Error(`CSV row ${i+2}: expected ${headers.length} columns, received ${r.length}.`);return Object.fromEntries(headers.map((h,j)=>[h,r[j].trim()]))});
}
export const importHeaders:Record<string,string[]>={
 sections:['id','corridor','name','from_station','to_station','source'],
 movements:['id','section_id','train_no','kind','start_at','end_at','source'],
 windows:['id','section_id','start_at','end_at','power','traffic_complete','reference'],
 tasks:['request_id','section_id','station','crew','release_at','due_at','machine','power','compatibility_group','compatibility_reference','location_reference'],
};
