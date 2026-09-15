import { PDFDocument, type PDFFont, type PDFPage, rgb } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import fonts from './fonts.json';
import type { Report, ReportTable } from './types';

const PAGE_W=595.28,PAGE_H=841.89,MARGIN=42,WIDTH=PAGE_W-MARGIN*2,BOTTOM=60;
const navy=rgb(.10,.23,.37),ink=rgb(.16,.20,.25),muted=rgb(.39,.44,.49),lineColor=rgb(.85,.88,.91),wash=rgb(.94,.96,.98);
const generated=(iso:string)=>new Date(iso).toLocaleString('en-GB',{day:'2-digit',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit',hour12:false,timeZone:'Asia/Kolkata'})+' IST';

/** Text-native PDF: no browser screenshot, client row limit, or planner service. */
export async function renderReport(report:Report):Promise<Uint8Array>{
 const doc=await PDFDocument.create();doc.registerFontkit(fontkit);
 const regular=await doc.embedFont(fonts.regular,{subset:true});
 const bold=await doc.embedFont(fonts.bold,{subset:true});
 const supported=new Set(regular.getCharacterSet());let usedUnicodeNotation=false;
 const clean=(text:string)=>Array.from(String(text).normalize('NFC').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g,'').replace(/[\u2010-\u2015]/g,'-').replace(/\t/g,'    ')).map(c=>{if(c==='\n'||supported.has(c.codePointAt(0)!))return c;usedUnicodeNotation=true;return `[U+${c.codePointAt(0)!.toString(16).toUpperCase()}]`}).join('');
 doc.setTitle(report.title);doc.setAuthor('RailBlock AI');doc.setSubject(report.subtitle);doc.setCreator('RailBlock AI local reports');doc.setCreationDate(new Date(report.generatedAt));
 let page!:PDFPage,y=0;
 function text(value:string,x:number,top:number,size=10,font:PDFFont=regular,color=ink){page.drawText(clean(value),{x,y:top-size,font,size,color})}
 function wrap(value:string,width:number,size=10,font:PDFFont=regular){
  const lines:string[]=[];
  for(const paragraph of clean(value).split('\n')){
   let current='';
   for(const word of paragraph.split(/ +/)){
    const trial=current?current+' '+word:word;
    if(font.widthOfTextAtSize(trial,size)<=width){current=trial;continue}
    if(current){lines.push(current);current=''}
    for(const char of Array.from(word)){
     if(current&&font.widthOfTextAtSize(current+char,size)>width){lines.push(current);current=''}
     current+=char;
    }
   }
   lines.push(current);
  }
  return lines;
 }
 function newPage(){
  page=doc.addPage([PAGE_W,PAGE_H]);
  page.drawRectangle({x:0,y:PAGE_H-7,width:PAGE_W/3,height:7,color:rgb(.78,.48,.25)});
  page.drawRectangle({x:PAGE_W/3,y:PAGE_H-7,width:PAGE_W/3,height:7,color:rgb(.92,.92,.89)});
  page.drawRectangle({x:PAGE_W*2/3,y:PAGE_H-7,width:PAGE_W/3,height:7,color:rgb(.25,.44,.34)});
  text('RailBlock AI',MARGIN,PAGE_H-29,15,bold,navy);
  const tag='MAINTENANCE & CREW';text(tag,PAGE_W-MARGIN-regular.widthOfTextAtSize(tag,8),PAGE_H-33,8,regular,muted);
  y=PAGE_H-61;
  if(doc.getPageCount()>1){text(report.title+' / continued',MARGIN,y,10,bold,navy);y-=22}
 }
 function ensure(height:number){if(y-height<BOTTOM)newPage()}
 function paragraph(value:string,size=10,font:PDFFont=regular,color=ink,width=WIDTH){
  for(const l of wrap(value,width,size,font)){ensure(size*1.55);text(l,MARGIN,y,size,font,color);y-=size*1.55}
  y-=5;
 }
 function fact(label:string,value:string){
  const values=wrap(value,WIDTH-114,10);ensure(Math.min(values.length,3)*15+8);
  text(label.toUpperCase(),MARGIN,y,8,bold,muted);
  for(let i=0;i<values.length;i++){
   if(y-15<BOTTOM){newPage();text(label.toUpperCase()+' (CONT.)',MARGIN,y,8,bold,muted)}
   text(values[i],MARGIN+114,y,10);y-=15;
  }
  y-=5;
 }
 function table(table:ReportTable){
  const total=table.widths.reduce((a,b)=>a+b,0),widths=table.widths.map(w=>w/total*WIDTH),size=8.5,leading=13,pad=7;
  function header(firstRowHeight=leading+pad*2){
   const lines=table.headers.map((s,i)=>wrap(s,widths[i]-pad*2,size,bold));const h=Math.max(...lines.map(l=>l.length))*leading+pad*2;
   ensure(h+Math.min(firstRowHeight,590));page.drawRectangle({x:MARGIN,y:y-h,width:WIDTH,height:h,color:navy});
   let x=MARGIN;lines.forEach((rows,i)=>{rows.forEach((s,j)=>text(s,x+pad,y-pad-j*leading,size,bold,rgb(1,1,1)));x+=widths[i]});y-=h;
  }
  const first=table.rows[0];
  header(first?Math.max(...table.headers.map((_,i)=>wrap(first[i]||'-',widths[i]-pad*2,size).length))*leading+pad*2:leading+pad*2);
  table.rows.forEach((row,index)=>{
   const cells=table.headers.map((_,i)=>wrap(row[i]||'-',widths[i]-pad*2,size));let at=0;const count=Math.max(...cells.map(c=>c.length));
   if(count*leading+pad*2<590&&y-(count*leading+pad*2)<BOTTOM){newPage();header()}
   while(at<count){
    if(y-(leading+pad*2)<BOTTOM){newPage();header()}
    const lines=Math.min(count-at,Math.floor((y-BOTTOM-pad*2)/leading));
    const h=lines*leading+pad*2;
    if(index%2===0)page.drawRectangle({x:MARGIN,y:y-h,width:WIDTH,height:h,color:wash});
    let x=MARGIN;cells.forEach((cell,i)=>{cell.slice(at,at+lines).forEach((s,j)=>text(s,x+pad,y-pad-j*leading,size));x+=widths[i]});
    page.drawLine({start:{x:MARGIN,y:y-h},end:{x:MARGIN+WIDTH,y:y-h},thickness:.5,color:lineColor});
    y-=h;at+=lines;
   }
  });y-=17;
 }
 newPage();
 paragraph(report.title,23,bold,navy);
 paragraph(report.subtitle,11,regular,muted);
 paragraph(report.reference,9,bold,muted);y-=9;
 for(const [label,value] of report.summary)fact(label,value);
 if(report.notes.length){y-=5;for(const note of report.notes)paragraph(note,9,regular,muted);y-=5}
 for(const section of report.sections){
  const heading=wrap(section.title,WIDTH-18,13,bold);ensure(heading.length*18+90);
  page.drawRectangle({x:MARGIN,y:y-heading.length*18-14,width:WIDTH,height:heading.length*18+14,color:wash});
  heading.forEach((s,i)=>text(s,MARGIN+9,y-6-i*18,13,bold,navy));y-=heading.length*18+25;
  if(section.label)paragraph(section.label,9,bold,muted);
  for(const [label,value] of section.facts||[])fact(label,value);
  for(const value of section.paragraphs||[])paragraph(value,10);
  if(section.table)table(section.table);else y-=10;
 }
 if(usedUnicodeNotation)paragraph('Characters outside the embedded font are preserved using [U+CODEPOINT] notation.',8,regular,muted);
 const pages=doc.getPages();pages.forEach((p,i)=>{
  page=p;page.drawLine({start:{x:MARGIN,y:43},end:{x:PAGE_W-MARGIN,y:43},thickness:.6,color:lineColor});
  text('Saved report / '+generated(report.generatedAt),MARGIN,34,8,regular,muted);
  const n=`Page ${i+1} of ${pages.length}`;text(n,PAGE_W-MARGIN-regular.widthOfTextAtSize(n,8),34,8,regular,muted);
 });
 return doc.save();
}
