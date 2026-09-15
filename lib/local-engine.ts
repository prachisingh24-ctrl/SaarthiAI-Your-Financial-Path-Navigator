import { env } from 'cloudflare:workers';
export async function localEngine(path:string,body:unknown){
 let res:Response;try{res=await fetch('http://127.0.0.1:8008'+path,{method:'POST',headers:{'Content-Type':'application/json','X-Engine-Token':(env as unknown as {RAILBLOCK_ENGINE_TOKEN:string}).RAILBLOCK_ENGINE_TOKEN||''},body:JSON.stringify(body),signal:AbortSignal.timeout(110000)})}catch{throw new Error('The local planning service is unavailable. Restart the local server.')}
 const data=await res.json() as any;if(!res.ok)throw new Error(data.error||'Planning failed.');return data;
}
