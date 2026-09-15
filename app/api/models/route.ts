import { db, seed, session } from '@/lib/server';
import { state } from '@/lib/operations';
import { localEngine } from '@/lib/local-engine';
export const dynamic='force-dynamic';
const json=(d:unknown,status=200)=>Response.json(d,{status,headers:{'Cache-Control':'private, no-store'}});
export async function GET(req:Request){try{await seed();const user=await session(req);if(!user)return json({error:'Sign in first.'},401);if(user.role!=='controller')return json({error:'Control Centre access required.'},403);return json(await localEngine('/ml/status',{}))}catch(e){return json({error:(e as Error).message},503)}}
export async function POST(req:Request){try{
 if(req.headers.get('origin')&&req.headers.get('origin')!==new URL(req.url).origin)return json({error:'Request origin not allowed.'},403);
 if(!req.headers.get('content-type')?.includes('application/json'))return json({error:'JSON required.'},415);
 await seed();const user=await session(req);if(!user)return json({error:'Sign in first.'},401);if(user.role!=='controller')return json({error:'Control Centre access required.'},403);
 const text=await req.text();if(text.length>2_100_000)return json({error:'History exceeds the 2 MB limit.'},413);const body=JSON.parse(text);
 let result,reason;
 if(body.action==='train'){
  if(typeof body.csv!=='string'||typeof body.source!=='string')return json({error:'Supply observed history CSV and its source description.'},400);
  const s=await state();result=await localEngine('/ml/train',{csv:body.csv,source:body.source,sections:s.input.sections.map((s:any)=>s.id)});reason=`Trained candidate ${result.id}; chronological holdout MAE ${result.mae}; baseline MAE ${result.baseline_mae}.`;
 }else if(body.action==='activate'){
  if(typeof body.id!=='string'||body.id.length>100)return json({error:'Choose a saved model.'},400);
  result=await localEngine('/ml/activate',{id:body.id});reason=`Activated reviewed freight model ${body.id}.`;
 }else return json({error:'Unknown model action.'},400);
 await db().prepare('INSERT INTO operations_audit (id,entity_id,action,reason,actor,created_at) VALUES (?,?,?,?,?,?)').bind(crypto.randomUUID(),body.id||result.id,body.action,reason,user.id,new Date().toISOString()).run();
 return json(result);
 }catch(e){return json({error:(e as Error).message},400)}}
