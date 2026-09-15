'use client';
import { useEffect, useState } from 'react';
import { Clock3, FileDown } from 'lucide-react';

export default function PageTools(){
 const [now,setNow]=useState<Date|null>(null);
 useEffect(()=>{setNow(new Date());const timer=setInterval(()=>setNow(new Date()),1000);return()=>clearInterval(timer)},[]);
 const stamp=now?.toLocaleString('en-IN',{day:'2-digit',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false,timeZone:'Asia/Kolkata'});
 function exportPDF(){
  const original=document.title;
  document.title=(document.querySelector('main h1')?.textContent||'RailBlock AI')+' - '+new Date().toLocaleDateString('en-CA',{timeZone:'Asia/Kolkata'});
  window.addEventListener('afterprint',()=>{document.title=original},{once:true});
  window.print();
 }
 return <><div className="page-tools"><time dateTime={now?.toISOString()}><Clock3 size={14}/><span>{stamp||'Loading time…'}<small>IST</small></span></time><button className="btn pdf-button" onClick={exportPDF} title="Open the print dialog and choose Save as PDF to export this page"><FileDown size={15}/>Save as PDF</button></div><div className="print-heading"><b>RailBlock AI · Railway maintenance</b><span>Exported {stamp} IST · Current page and filters</span></div></>
}
