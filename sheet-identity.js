const ocrFiles=new URL('./vendor/ocr/',import.meta.url);
const normalizedId=id=>id.normalize('NFKC').toUpperCase().replace(/\s+/g,'');
const normalizedName=name=>name.normalize('NFD').toUpperCase().replace(/[^\p{L}\p{N}]/gu,'');
const headerKey=(id,name)=>JSON.stringify([id,name]);
const unidentified=Object.freeze({kind:'unreadable',id:''});
const conflict=Object.freeze({kind:'conflict',id:''});

function indexStudent(index,key,id){
 if(key)index.set(key,index.has(key)?'':id);
}

function studentFromHeader(text,roster){
 const name=normalizedName(text.match(/(?:^|\s)Alun[oa]\s*[:;]\s*([^\r\n]+?)(?=\s+R\s*A\s*[:;]|\r?\n|$)/iu)?.[1]||'');
 const id=normalizedId(text.match(/(?:^|\s)R\s*A\s*[:;]\s*([^\r\n]+?)(?=\s*[·•+|–—-]?\s*(?:Chamada|Turma)\s*[:;]|\r?\n|$)/iu)?.[1]||'');
 const exact=roster.headers.get(headerKey(id,name));
 if(exact)return {kind:'verified',id:exact};

 const byId=roster.ids.get(id);
 const byName=roster.names.get(name);
 if((id&&!byId)||(byId&&byName&&byId!==byName))return conflict;
 const possible=byId||byName;
 return possible?{kind:'suggested',id:possible}:unidentified;
}

async function headerImage(canvas,map,pdfPage){
 const corners=[[55,139],[775,139],[55,205],[775,205]].map(([x,y])=>map(x,y));
 const left=Math.max(0,Math.floor(Math.min(...corners.map(point=>point.x))));
 const top=Math.max(0,Math.floor(Math.min(...corners.map(point=>point.y))));
 const right=Math.min(canvas.width,Math.ceil(Math.max(...corners.map(point=>point.x))));
 const bottom=Math.min(canvas.height,Math.ceil(Math.max(...corners.map(point=>point.y))));
 if(right<=left||bottom<=top)return null;

 const crop=document.createElement('canvas');
 crop.width=(right-left)*3;
 crop.height=(bottom-top)*3;
 const ctx=crop.getContext('2d');
 ctx.fillStyle='white';
 ctx.fillRect(0,0,crop.width,crop.height);
 if(pdfPage){
  const viewport=pdfPage.getViewport({scale:canvas.width/pdfPage.getViewport({scale:1}).width});
  try{
   await pdfPage.render({
    canvasContext:ctx,viewport,
    transform:[3,0,0,3,-3*left,-3*top],
   }).promise;
   return crop;
  }catch{}
 }
 ctx.drawImage(canvas,left,top,right-left,bottom-top,0,0,crop.width,crop.height);
 return crop;
}

async function startReader(){
 const {default:{createWorker,OEM,PSM}}=await import('./vendor/ocr/tesseract.esm.min.js');
 // Keep both the OCR runtime and its language model on this origin.
 let fail;
 const failure=new Promise((_,reject)=>{fail=reject;});
 const initialized=createWorker('eng',OEM.LSTM_ONLY,{
  workerPath:new URL('worker.min.js',ocrFiles).href,
  corePath:new URL('tesseract-core-lstm.wasm.js',ocrFiles).href,
  langPath:ocrFiles.href,
  workerBlobURL:false,
  cacheMethod:'none',
  errorHandler:fail,
 });
 const reader=await Promise.race([initialized,failure]);
 try{
  await reader.setParameters({tessedit_pageseg_mode:PSM.SINGLE_BLOCK,user_defined_dpi:'300'});
  return reader;
 }catch(err){
  await reader.terminate();
  throw err;
 }
}

export function createSheetReader(students){
 const roster={ids:new Map(),names:new Map(),headers:new Map()};
 for(const student of students){
  const id=normalizedId(student.id);
  const name=normalizedName(student.name.slice(0,65));
  indexStudent(roster.ids,id,student.id);
  indexStudent(roster.names,name,student.id);
  indexStudent(roster.headers,headerKey(id,name),student.id);
 }
 let reader=null;
 let unavailable=false;
 return {
  async identify(canvas,map,pdfPage){
   let textMatch=unidentified;
   if(pdfPage){
    try{
     const {items}=await pdfPage.getTextContent();
     const text=items.map(item=>typeof item.str==='string'?item.str+(item.hasEOL?'\n':' '):'').join('');
     textMatch=studentFromHeader(text,roster);
    }catch{}
    if(textMatch.kind==='verified')return textMatch;
   }
   if(unavailable)return textMatch;
   const crop=await headerImage(canvas,map,pdfPage);
   if(!crop)return textMatch;
   try{
    reader??=await startReader();
    const {data}=await reader.recognize(crop);
    if(data.confidence<55)return textMatch;
    const match=studentFromHeader(data.text,roster);
    if(match.kind==='unreadable')return textMatch;
    if(textMatch.id&&match.id&&textMatch.id!==match.id)return conflict;
    if(match.kind==='verified'&&(data.confidence<75||textMatch.kind==='conflict')){
     return {kind:'suggested',id:match.id};
    }
    return match;
   }catch{
    unavailable=true;
    return textMatch;
   }
  },
  async close(){
   await reader?.terminate();
  },
 };
}
