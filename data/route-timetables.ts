import type { OperationsInput, Section, Movement } from '../lib/operations-types';
import { istDay } from '../lib/reports/types';

export const timetableResearch={
 researched_at:'2026-09-07',
 status:'Public reference timetable — incomplete traffic coverage',
 notes:['Only the three corridors in the supplied maintenance dataset are included.',
  'Times and daily frequency were transcribed from the cited public timetable tables. They are not a live COA or NTES feed and are not certified for a future operating date.',
  'Selected services only. Other passenger services, suburban/DEMU services, specials, cancellations, freight and local restrictions remain incomplete.',
  'These entries conservatively occupy the entire named corridor between the published endpoint times, in both directions. No intermediate passing times or UP/DOWN track allocations are invented.',
  'Pune–Daund records below use Daund Junction (DD), not Daund Chord Line (DDCC) or Hadapsar. Services with those different endpoints were excluded.',
  'No freight probabilities are produced from these passenger records.']
};
type Service={train_no:string;name:string;from:string;to:string;departure:string;arrival:string;corridor:string;source:string;frequency:string};
const routes:[string,string,string,string,string[][]][]=[
 ['Pune-Lonavala','PUNE','LNL','pune-to-lonavala',[
 ['11140','HPT CSMT Express','01:10','02:05'],['22158','MS CSMT SF Express','01:50','02:50'],['17317','UBL DR Express','03:05','04:12'],['17412','Mahalaxmi Express','03:30','04:27'],['11010','Sinhagad Express','06:05','07:13'],['12124','Deccan Queen','07:15','08:06'],['12126','Pragati Express','07:45','08:28'],['11020','Konark Express','23:40','00:40']]],
 ['Pune-Lonavala','LNL','PUNE','lonavala-to-pune',[
 ['22157','CSMT MS SF Mail','01:37','02:50'],['22944','INDB Daund Express','07:45','08:50'],['22105','Indrayani Express','08:00','09:05'],['12127','Intercity Express','08:50','10:00'],['11007','Deccan Express','09:40','11:05'],['11029','Koyna Express','11:10','12:35'],['12123','Deccan Queen','19:20','20:25'],['17318','DR Hubballi Express','23:02','00:01']]],
 ['Pune-Daund','PUNE','DD','pune-to-daund',[
 ['12115','Siddheshwar Express','02:20','03:33'],['22157','CSMT MS SF Mail','02:55','04:05'],['22944','INDB Daund Express','08:55','10:30'],['12169','SUR Intercity','09:25','10:33'],['11301','Udyan Express','11:45','12:55'],['22159','CSMT Chennai Express','16:25','17:30'],['12157','Hutatma Express','17:50','18:55'],['11019','Konark Express','18:00','19:10']]],
 ['Pune-Daund','DD','PUNE','daund-to-pune',[
 ['22158','MS CSMT SF Express','00:35','01:45'],['12116','Siddheshwar Express','01:30','02:45'],['17614','NED PNVL Express','04:15','05:25'],['22160','MAS CSMT SF Express','06:50','08:10'],['11014','CBE LTT Express','08:50','10:15'],['12158','Hutatma Express','09:05','10:30'],['22943','Daund Indore Express','14:10','15:23'],['11302','Udyan Express','14:30','16:05']]],
 ['Pune-Miraj','PUNE','MRJ','pune-to-miraj',[
 ['17318','DR Hubballi Express','00:06','05:00'],['17411','Mahalaxmi Express','00:15','05:35'],['11040','Maharashtra Express','03:40','09:45'],['11029','Koyna Express','12:40','18:52'],['12780','Goa Express','17:10','22:40']]],
 ['Pune-Miraj','MRJ','PUNE','miraj-to-pune',[
 ['11030','Koyna Express','09:25','15:45'],['11039','Maharashtra Express','15:50','22:10'],['17317','UBL DR Express','21:20','03:00'],['17412','Mahalaxmi Express','21:55','03:25'],['12779','Goa Express','22:45','04:15']]],
];
export const referenceServices:Service[]=routes.flatMap(([corridor,from,to,path,rows])=>rows.map(([train_no,name,departure,arrival])=>({train_no,name,departure,arrival,corridor,from,to,frequency:'Daily (public listing)',source:`https://www.confirmtkt.com/trains/${path}-train-tickets`})));
export const referenceSections:Section[]=[['Pune-Lonavala','PUNE-LNL','PUNE','LNL'],['Pune-Daund','PUNE-DD','PUNE','DD'],['Pune-Miraj','PUNE-MRJ','PUNE','MRJ']].map(([corridor,id,from_station,to_station])=>({id,corridor,name:`${corridor} — whole corridor`,from_station,to_station,source:'Central Railway division system map (2019), route identity only: https://cr.indianrailways.gov.in/cris/uploads/files/1561376559029-all_div_merged.pdf'}));
export function addReferenceTimetable(input:OperationsInput,startDate:string,horizon:number):OperationsInput{
 if(![1,7,30].includes(horizon))throw new Error('Choose 1, 7 or 30 days.');
 const base=Date.parse(istDay(startDate).start),movements:Movement[]=[];
 for(const s of referenceServices){
  const section=referenceSections.find(r=>r.corridor===s.corridor)!;
  const existing=input.sections.find(r=>r.id===section.id);if(existing&&JSON.stringify(existing)!==JSON.stringify(section))throw new Error(`Section ${section.id} has been customized. Keep it and import reference records under a different section ID.`);
  for(let day=-1;day<horizon;day++){
   const localDay=new Date(base+day*86400000+330*60000).toISOString().slice(0,10);
   const start=new Date(localDay+'T'+s.departure+':00+05:30').getTime();let end=new Date(localDay+'T'+s.arrival+':00+05:30').getTime();if(end<=start)end+=86400000;
   if(end<=base)continue;
   movements.push({id:`REF-${s.train_no}-${section.id}-${localDay}`,section_id:section.id,train_no:s.train_no,kind:'Passenger',start_at:new Date(start).toISOString(),end_at:new Date(end).toISOString(),source:`Public reference; retrieved ${timetableResearch.researched_at}; ${s.from} to ${s.to}; ${s.source}`});
  }
 }
 // Re-import is append-only: manually corrected movements are never overwritten.
 return {...input,sections:[...input.sections,...referenceSections.filter(r=>!input.sections.some(s=>s.id===r.id))],movements:[...input.movements,...movements.filter(m=>!input.movements.some(old=>old.id===m.id))]};
}
