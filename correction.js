import * as XLSX from './vendor/xlsx.mjs';
import * as pdfjs from './vendor/pdf.mjs';
import {createSheetReader} from './sheet-identity.js?v=19';
pdfjs.GlobalWorkerOptions.workerSrc=new URL('./vendor/pdf.worker.mjs',import.meta.url).href;
const el=id=>document.getElementById(id), storage='atelier-correction-v1';
let exam=null,pages=[],current=0,loading=false;
let draftAssessment=null;
let excludedIds=new Set(),rosterUndo=null;
const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function message(id,s){el(id).textContent=s;}
function error(e){message('exam-status',e.message);}
function readForm(source=draftAssessment){
 const versions=el('exam-versions').value.trim().toUpperCase().split(/[\s,;]+/);if(!versions.length||versions.length>6||new Set(versions).size!==versions.length||versions.some(v=>! /^[A-Z0-9_-]{1,8}$/.test(v)))throw Error('Informe de 1 a 6 versões únicas, com até 8 letras ou números cada.');
 const keys={};for(const line of el('grading-keys').value.trim().split(/\n/).filter(l=>l.trim())){const m=line.trim().toUpperCase().match(/^([A-Z0-9_-]+)\s*:\s*(.+)$/);if(!m)throw Error('Informe um gabarito por linha, como A: A B C D E.');if(keys[m[1]])throw Error('Modelo repetido: '+m[1]);const a=m[2].split(/[\s,;]+/);if(a.some(x=>! /^[A-EX]$/.test(x)))throw Error('Use respostas A a E ou X para anular.');keys[m[1]]=a;}
 const n=source?.n;if(n===undefined)throw Error('Gere as versões da avaliação nas etapas 01 a 04 antes de salvar ou imprimir os cartões.');el('question-count').value=n;if(!Number.isInteger(n)||n<10||n>100)throw Error('Escolha um número inteiro de 10 a 100 questões.');if(Object.values(keys).some(a=>a.length!==n))throw Error('Cada gabarito deve ter exatamente '+n+' respostas.');
 if(Object.keys(keys).some(k=>!versions.includes(k)))throw Error('Há gabaritos de versões que não estão cadastradas na avaliação.');
 const rosterPool=parseRoster(el('roster').value);const students=rosterPool.filter(s=>!excludedIds.has(s.id));
 if(!students.length)throw Error('Selecione pelo menos um aluno para a avaliação.');
 const savedBank=source.questionBank;
 const mappedVersions=versions.filter(version=>savedBank?.[version]);
 const questionBank=mappedVersions.length
   ? Object.fromEntries(mappedVersions.map(version=>[version,savedBank[version]]))
   : undefined;
 const scoring=parseScoring(el('scoring-mode').value,el('question-scores').value,n,questionBank,versions);
 const max=scoring.mode==='points'?Object.values(scoring.values).reduce((sum,v)=>sum+v,0):Number(el('max-grade').value);if(!Number.isFinite(max)||max<=0||max>1000000)throw Error('A nota máxima deve estar entre 0 e 1.000.000.');el('max-grade').value=max;
 return {title:el('exam-title').value.trim()||'Avaliação',keys,students,rosterPool,excluded:rosterPool.filter(s=>excludedIds.has(s.id)).map(s=>s.id),n,max,versions,scoring,...(questionBank?{questionBank}:{}),results:[]};
}
function persist(value=exam,status='exam-status'){
 try{
  localStorage.setItem(storage,JSON.stringify(value));
  return true;
 }catch{
  message(status,'Não foi possível salvar no navegador. Baixe o backup.');
  return false;
 }
}
function assessmentLayout(e){
 return JSON.stringify([e.n,e.versions.map(model=>[model,e.questionBank?.[model]])]);
}
function clearScans(){
 pages=[];
 current=0;
 el('scans').value='';
 el('clear-scans').disabled=true;
 el('review-scans').hidden=true;
 el('answers-grid').replaceChildren();
 el('scan-preview').width=0;
 renderPendingScans();
}
function save(){
 try{
  if(loading)throw Error('Aguarde o fim da leitura das folhas.');
  const next=readForm();
  const sameLayout=exam&&assessmentLayout(exam)===assessmentLayout(next);
  const selected=new Set(next.students.map(s=>s.id));
  const results=sameLayout?exam.results.filter(r=>selected.has(r.id)):[];
  const missingKeys=[...new Set(results.map(r=>r.model).filter(model=>!next.keys[model]))];
  if(missingKeys.length)throw Error('Preencha os gabaritos das versões já corrigidas: '+missingKeys.join(', ')+'.');
  const keysChanged=sameLayout&&next.versions.some(model=>
   exam.keys[model]?.join(' ')!==next.keys[model]?.join(' '));
  if(sameLayout){
   const lost=exam.results.length-results.length;
   if(lost&&!confirm(lost+' correção(ões) de alunos desmarcados ou removidos sairão desta avaliação. Continuar?'))return false;
  }else if(exam&&(exam.results.length||pages.length)&&!confirm('Alterar a configuração da prova remove as correções atuais. Continuar?'))return false;
  exam={...next,results};
  if(!sameLayout){
   clearScans();
  }else if(pages.length){
   for(const page of pages){
    if(selected.has(page.student))continue;
    page.student='';
    page.suggestion='';
    page.confirmed=false;
   }
   suggestStudentsByOrder();
   show();
  }
  rosterUndo=null;
  const status=exam.students.length+' alunos selecionados · '+exam.n+' questões · avaliação salva.';
  const regraded=results.length===1?'1 correção recalculada.':results.length+' correções recalculadas.';
  message('exam-status',keysChanged&&results.length?status+' Gabarito atualizado. '+regraded:status);
  persist();
  report();
  renderStudentManager();
  return true;
 }catch(e){error(e);return false;}
}
function writeExamForm(e){
 el('exam-versions').value=(e.versions||Object.keys(e.keys)).join(' ')||'A';
 el('question-count').value=e.n;
 el('exam-title').value=e.title;
 el('max-grade').value=e.max;
 excludedIds=new Set(e.excluded||[]);
 el('roster').value=(e.rosterPool||e.students).map(s=>[s.id,s.name,s.group,s.call||''].join(';')).join('\n');
 el('grading-keys').value=Object.entries(e.keys).map(([k,v])=>k+': '+v.join(' ')).join('\n');
 loadScoring(e);
}
function fill(){
 draftAssessment=exam;
 rosterUndo=null;
 writeExamForm(exam);
 report();
 renderStudentManager();
 message('exam-status','Avaliação recuperada · '+exam.students.length+' alunos.');
}
function download(data,name,type){const url=URL.createObjectURL(new Blob([data],{type}));const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),2000);}
function printHTML(content){const w=window.open('','_blank');if(!w)throw Error('Permita abrir a janela de impressão neste site.');w.document.write('<!doctype html><html lang="pt-BR"><meta charset="utf-8"><title>'+esc(exam.title)+'</title><style>@page{size:A4;margin:0}*{box-sizing:border-box}body{margin:0;font:14px Arial}svg{display:block;width:210mm;height:297mm;break-after:page}svg:last-child{break-after:auto}table{border-collapse:collapse;width:100%}td,th{border:1px solid #bbb;padding:8px;text-align:left}.report{padding:20mm}</style><body>'+content+'</body></html>');w.document.close();w.focus();w.print();}
function pos(i,j){return exam.n<=60?{x:107+Math.floor(i/20)*235+j*32,y:266+(i%20)*34}:{x:83+Math.floor(i/25)*185+j*27,y:266+(i%25)*29};}
function modelPos(i){return {x:260+i*85,y:215};}
function modelField(){return '<text x="65" y="220" font-size="13" font-weight="bold">Versão da prova:</text>'+exam.versions.map((v,i)=>{const p=modelPos(i);return `<circle cx="${p.x}" cy="${p.y}" r="9" fill="white" stroke="black" stroke-width="1.3"/><text x="${p.x+14}" y="${p.y+4}" font-size="12">${esc(v)}</text>`;}).join('');}
function sheet(student){let items='';for(let i=0;i<exam.n;i++){const p=pos(i,0);items+=`<text x="${p.x-17}" y="${p.y+5}" text-anchor="end" font-size="14">${i+1}</text>`;for(let j=0;j<5;j++){const p=pos(i,j);items+=`<circle cx="${p.x}" cy="${p.y}" r="9" fill="white" stroke="black" stroke-width="1.3"/><text x="${p.x}" y="${p.y+4}" text-anchor="middle" fill="#777" font-size="10">${'ABCDE'[j]}</text>`;}}
 return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 794 1123"><rect width="794" height="1123" fill="white"/><g fill="black">${[[40,40],[754,40],[40,1083],[754,1083]].map(([x,y])=>`<rect x="${x-7}" y="${y-7}" width="14" height="14"/>`).join('')}<text x="65" y="90" font-size="25" font-weight="bold">Folha de respostas</text><text x="65" y="125" font-size="17">${esc(exam.title.slice(0,65))}</text><text x="65" y="161" font-size="15">Aluno: ${esc(student.name.slice(0,65))}</text><text x="65" y="190" font-size="14">RA: ${esc(student.id)} · Chamada: ${esc(student.call||'____')} · Turma: ${esc(student.group)}</text>${modelField()}<text x="65" y="244" font-size="11">Marque uma versão e uma alternativa por questão. Preencha a bolha com caneta preta.</text>${items}<text x="65" y="1015" font-size="12">Ateliê de Provas · ${exam.n} questões · AP-OMR-3</text><text x="65" y="1040" font-size="11">Imprima em A4, escala 100%. Mantenha os quatro quadrados dos cantos na digitalização.</text></g></svg>`;
}
function renderPDFPage(page){const v=page.getViewport({scale:794/page.getViewport({scale:1}).width});const c=document.createElement('canvas');c.width=Math.round(v.width);c.height=Math.round(v.height);return page.render({canvasContext:c.getContext('2d'),viewport:v}).promise.then(()=>c);}
function findAnchors(c){const ctx=c.getContext('2d',{willReadFrequently:true}),{width:w,height:h}=c,data=ctx.getImageData(0,0,w,h).data;const dark=(x,y)=>{const i=(y*w+x)*4;return data[i]+data[i+1]+data[i+2]<280;};const points=[];
 for(const [right,bottom] of [[0,0],[1,0],[0,1],[1,1]]){let best=null;const x0=right?Math.floor(w*.78):0,x1=right?w:Math.floor(w*.22),y0=bottom?Math.floor(h*.84):0,y1=bottom?h:Math.floor(h*.16);const seen=new Set();for(let y=y0;y<y1;y++)for(let x=x0;x<x1;x++){const idx=y*w+x;if(seen.has(idx)||!dark(x,y))continue;let stack=[[x,y]],minx=x,maxx=x,miny=y,maxy=y,count=0;seen.add(idx);while(stack.length){const [a,b]=stack.pop();count++;minx=Math.min(minx,a);maxx=Math.max(maxx,a);miny=Math.min(miny,b);maxy=Math.max(maxy,b);for(const [dx,dy] of [[1,0],[-1,0],[0,1],[0,-1]]){const nx=a+dx,ny=b+dy,k=ny*w+nx;if(nx>=x0&&nx<x1&&ny>=y0&&ny<y1&&!seen.has(k)&&dark(nx,ny)){seen.add(k);stack.push([nx,ny]);}}}const bw=maxx-minx+1,bh=maxy-miny+1;if(bw<7||bh<7||bw>35||bh>35||bw/bh<.65||bw/bh>1.5||count/(bw*bh)<.78)continue;const cx=(maxx+minx)/2,cy=(maxy+miny)/2,score=Math.hypot(cx-(right?w*.95:w*.05),cy-(bottom?h*.965:h*.035));if(!best||score<best.score)best={x:cx,y:cy,score};}if(!best)return null;points.push(best);}return points;
}
function classify(scores){const marks=scores.map((s,i)=>s>.55?i:-1).filter(i=>i>=0);return marks.length===1&&scores.every((s,i)=>i===marks[0]||s<.35)?marks[0]:-1;}
function responseMap(canvas,anchors){
 if(!anchors)return (x,y)=>({x:x*canvas.width/794,y:y*canvas.height/1123});
 const [topLeft,topRight,bottomLeft,bottomRight]=anchors;
 return (x,y)=>{
  const u=(x-40)/714,v=(y-40)/1043;
  return {
   x:(1-v)*((1-u)*topLeft.x+u*topRight.x)+v*((1-u)*bottomLeft.x+u*bottomRight.x),
   y:(1-v)*((1-u)*topLeft.y+u*topRight.y)+v*((1-u)*bottomLeft.y+u*bottomRight.y),
  };
 };
}
function detect(c,anchors,map){
 if(!anchors)return {answers:Array(exam.n).fill('?'),aligned:false,model:''};
 const data=c.getContext('2d').getImageData(0,0,c.width,c.height).data;
 const score=p=>{let count=0,total=0;for(let dy=-5;dy<=5;dy++)for(let dx=-5;dx<=5;dx++)if(dx*dx+dy*dy<=25){const q=map(p.x+dx,p.y+dy),x=Math.round(q.x),y=Math.round(q.y);if(x<0||y<0||x>=c.width||y>=c.height)continue;const k=(y*c.width+x)*4;total++;if(data[k]+data[k+1]+data[k+2]<450)count++;}return total?count/total:0;};
 const answers=Array.from({length:exam.n},(_,i)=>{const scores=Array.from({length:5},(_,j)=>score(pos(i,j))),mark=classify(scores);return mark>=0?'ABCDE'[mark]:Math.max(...scores)<.35?'-':'?';});const selected=classify(exam.versions.map((_,i)=>score(modelPos(i))));return {answers,aligned:true,model:selected>=0?exam.versions[selected]:''};}
async function scans(files){
 if(loading||!files.length)return;
 if(!save()){
  message('scan-status','Confira a configuração em Alunos e folhas ópticas antes de importar.');
  el('scans').value='';
  return;
 }
 if(exam.versions.some(model=>!exam.keys[model])){
  message('scan-status','Preencha e salve os gabaritos de todos os modelos antes de corrigir.');
  el('scans').value='';
  return;
 }

 const automatic=el('auto-confirm-scans').checked;
 const start=pages.length;
 const identification=createSheetReader(exam.students);
 let importError=null;
 loading=true;
 el('scans').disabled=true;
 el('clear-scans').disabled=true;
 el('auto-confirm-scans').disabled=true;
 el('pending-scans').hidden=true;
 el('review-scans').hidden=true;

 try{
  for(const file of files){
   if(file.size>80*1024*1024)throw Error('Arquivo maior que 80 MB. Divida o PDF em lotes menores.');
   if(/\.pdf$/i.test(file.name)){
    const pdf=await pdfjs.getDocument({data:new Uint8Array(await file.arrayBuffer()),isEvalSupported:false}).promise;
    try{
     for(let i=1;i<=pdf.numPages;i++){
      message('scan-status','Lendo '+file.name+' · página '+i+' de '+pdf.numPages);
      const pdfPage=await pdf.getPage(i);
      const canvas=await renderPDFPage(pdfPage);
      await addScan(canvas,file.name+' · '+i,identification,pdfPage);
     }
    }finally{
     await pdf.destroy();
    }
   }else{
    const bitmap=await createImageBitmap(file);
    try{
     const canvas=document.createElement('canvas');
     canvas.width=794;
     canvas.height=Math.round(bitmap.height*794/bitmap.width);
     if(canvas.height>3000||canvas.height<600)throw Error('Use uma imagem vertical da folha A4 inteira.');
     canvas.getContext('2d').drawImage(bitmap,0,0,canvas.width,canvas.height);
     await addScan(canvas,file.name,identification);
    }finally{
     bitmap.close();
    }
   }
  }
 }catch(err){
  importError=err;
 }finally{
  await identification.close();
  loading=false;
  el('scans').disabled=false;
  el('scans').value='';
  el('clear-scans').disabled=!pages.length;
  el('auto-confirm-scans').disabled=false;
 }

 const imported=pages.slice(start);
 if(!importError)suggestStudentsByOrder();
 const confirmed=automatic&&!importError?confirmAlignedScans(imported):0;
 let saved=true;
 if(confirmed){
  saved=persist();
  report();
 }
 current=Math.max(0,pages.findIndex(page=>!isScanConfirmed(page)));
 show();
 if(!importError&&imported.length&&imported.every(page=>!page.detectedStudent)){
  el('bulk-links').open=true;
  renderBulkPreview();
 }
 if(importError){
  message('scan-status','Importação interrompida: '+importError.message);
  return;
 }
 const loaded=imported.length===1?'1 página carregada':imported.length+' páginas carregadas';
 const approved=confirmed===1?'1 confirmada automaticamente':confirmed+' confirmadas automaticamente';
 message('scan-status',loaded+' · '+approved+'.'+
  (saved?'':' Baixe um backup para guardar as novas correções.'));
}
async function addScan(canvas,name,identification,pdfPage){
 const anchors=findAnchors(canvas);
 const map=responseMap(canvas,anchors);
 const reading=detect(canvas,anchors,map);
 const match=await identification.identify(canvas,map,pdfPage);
 pages.push({
  image:canvas.toDataURL('image/jpeg',.88),
  name,
  student:match.id,
  detectedStudent:match.kind==='verified'?match.id:'',
  headerConflict:match.kind==='conflict',
  suggestion:match.kind==='suggested'?'header':'',
  ...reading,
  confirmed:false,
 });
}
function suggestStudentsByOrder(){
 const evidence=new Set();
 let agreesWithOrder=true;
 pages.forEach((page,index)=>{
  if(page.suggestion==='order'){
   page.student='';
   page.suggestion='';
  }
  if(page.student){
   evidence.add(page.student);
   if(page.student!==exam.students[index]?.id)agreesWithOrder=false;
  }
  if(page.headerConflict||(page.detectedStudent&&page.detectedStudent!==exam.students[index]?.id))agreesWithOrder=false;
 });
 if(!agreesWithOrder)return;
 pages.forEach((page,index)=>{
  const candidate=exam.students[index]?.id;
  if(!candidate||page.student||page.manualLink||!page.aligned||evidence.has(candidate))return;
  page.student=candidate;
  page.suggestion='order';
 });
}
function detectedSheetCounts(){
 const counts=new Map();
 for(const page of pages){
  if(page.detectedStudent)counts.set(page.detectedStudent,(counts.get(page.detectedStudent)||0)+1);
 }
 return counts;
}
function recordCorrection(page,automatic=false){
 const result={id:page.student,model:page.model,answers:[...page.answers]};
 exam.results=exam.results.filter(previous=>previous!==page.savedResult&&previous.id!==result.id);
 exam.results.push(result);
 page.savedResult=result;
 page.suggestion='';
 page.confirmed=true;
 page.autoConfirmed=automatic;
}
function scanCanBeGraded(page){
 return page.aligned&&exam.keys[page.model]&&!page.answers.includes('?');
}
function confirmAlignedScans(imported){
 const corrected=new Set(exam.results.map(result=>result.id));
 const identities=detectedSheetCounts();
 let count=0;
 for(const page of imported){
  if(!page.detectedStudent||page.student!==page.detectedStudent||!scanCanBeGraded(page))continue;
  if(corrected.has(page.student)||identities.get(page.student)!==1)continue;
  recordCorrection(page,true);
  corrected.add(page.student);
  count++;
 }
 return count;
}
function isScanConfirmed(page){
 return page.confirmed&&exam.results.includes(page.savedResult);
}
function bulkStudents(){
 const group=el('bulk-group').value;
 return exam.students.filter(student=>!group||student.group===group);
}
function bulkLinkPlan(){
 const first=el('bulk-first').valueAsNumber;
 const end=el('bulk-last');
 const last=end.value===''&&!end.validity.badInput?pages.length:end.valueAsNumber;
 if(!Number.isInteger(first)||!Number.isInteger(last)||first<1||last<first||last>pages.length){
  throw Error('Informe um intervalo de páginas entre 1 e '+pages.length+'.');
 }
 const students=bulkStudents();
 const offset=students.findIndex(student=>student.id===el('bulk-student').value);
 if(offset<0||offset+last-first>=students.length){
  throw Error('O intervalo tem mais páginas que alunos a partir da seleção. Confira a turma e a última página.');
 }

 const locked=new Map();
 pages.forEach((page,index)=>{
  for(const id of [page.detectedStudent,page.manualLink||isScanConfirmed(page)?page.student:'']){
   if(id){
    const positions=locked.get(id)||new Set();
    positions.add(index);
    locked.set(id,positions);
   }
  }
 });
 const scored=new Set(exam.results.map(result=>result.id));
 const entries=pages.slice(first-1,last).map((page,i)=>{
  const student=students[offset+i];
  const index=first-1+i;
  const confirmed=isScanConfirmed(page);
  const ownLink=page.manualLink||confirmed?page.student:'';
  const assigned=locked.get(student.id);
  const conflict=Boolean(
   (page.detectedStudent&&page.detectedStudent!==student.id)||
   (ownLink&&ownLink!==student.id)||
   (assigned&&(assigned.size>1||!assigned.has(index)))
  );
  const existingGrade=scored.has(student.id);
  const grade=!conflict&&!confirmed&&!existingGrade&&!page.headerConflict&&el('bulk-grade').checked&&scanCanBeGraded(page);
  return {page,index,student,conflict,confirmed,existingGrade,grade};
 });
 return entries;
}
function refreshBulkStudents(){
 const select=el('bulk-student');
 const selected=select.value;
 const students=bulkStudents();
 select.replaceChildren(...students.map(student=>new Option(student.name+' · RA '+student.id,student.id)));
 if(students.some(student=>student.id===selected))select.value=selected;
}
function renderBulkPreview(){
 const target=el('bulk-preview');
 target.replaceChildren();
 el('apply-bulk-links').disabled=true;
 if(!el('bulk-links').open||el('bulk-links').hidden)return;
 try{
  const entries=bulkLinkPlan();
  const conflicts=entries.filter(entry=>entry.conflict).length;
  const count=entries.filter(entry=>!entry.confirmed).length;
  const rows=entries.map(({page,index,student,conflict,confirmed,existingGrade,grade})=>{
   const disposition=conflict?'Conflito com um vínculo existente':
    confirmed?'Correção já confirmada':grade?'Vincular e registrar nota':'Vincular para revisão';
   const notes=[disposition];
   if(!conflict&&!confirmed&&page.headerConflict)notes.push('Confira o cabeçalho');
   if(!conflict&&!confirmed&&existingGrade)notes.push('Nota existente preservada');
   return [(index+1)+' · '+page.name,student.name+' · RA '+student.id,notes.join(' · ')];
  });
  target.append(dataTable(['Página da fila','Aluno pela ordem','Ação'],rows));
  el('apply-bulk-links').disabled=Boolean(conflicts)||!count||loading;
  message('bulk-status',conflicts?
   'A sequência diverge de um vínculo existente. Ajuste o intervalo ou o primeiro aluno.':
   count===0?'Todas as folhas deste intervalo já estão confirmadas.':
   'Confira a sequência na tabela antes de aplicar.');
 }catch(err){
  message('bulk-status',err.message);
 }
}
function refreshBulkLinks(available){
 const panel=el('bulk-links');
 panel.hidden=!available;
 if(!available){
  el('bulk-preview').replaceChildren();
  if(!pages.length){
   panel.open=false;
   el('bulk-group').replaceChildren();
   el('bulk-student').replaceChildren();
   el('bulk-first').value='1';
   el('bulk-last').value='';
   el('bulk-grade').checked=el('auto-confirm-scans').checked;
  }
  return;
 }
 const group=el('bulk-group');
 const selected=group.value;
 const groups=[...new Set(exam.students.map(student=>student.group).filter(Boolean))];
 group.replaceChildren(new Option('Todas as turmas',''),...groups.map(name=>new Option(name,name)));
 if(groups.includes(selected))group.value=selected;
 el('bulk-first').max=el('bulk-last').max=String(pages.length);
 refreshBulkStudents();
 renderBulkPreview();
}
function applyBulkLinks(){
 if(loading)return;
 let entries;
 try{
  entries=bulkLinkPlan();
 }catch(err){
  message('bulk-status',err.message);
  return;
 }
 if(entries.some(entry=>entry.conflict))return;
 let linked=0,graded=0;
 for(const {page,student,grade,confirmed} of entries){
  if(confirmed)continue;
  page.student=student.id;
  page.manualLink=true;
  page.suggestion='';
  linked++;
  if(grade){
   recordCorrection(page,true);
   graded++;
  }
 }
 const saved=!graded||persist();
 if(graded)report();
 current=Math.max(0,pages.findIndex(page=>!isScanConfirmed(page)));
 el('bulk-links').open=false;
 show();
 el('pending-scan-heading').focus();
 message('scan-status',(linked===1?'1 folha vinculada':linked+' folhas vinculadas')+' em lote. '+
  (graded===1?'1 nota registrada.':graded+' notas registradas.')+
  (saved?'':' Baixe um backup para guardar as novas correções.'));
}
el('bulk-links').ontoggle=renderBulkPreview;
el('bulk-group').onchange=()=>{refreshBulkStudents();renderBulkPreview();};
for(const id of ['bulk-student','bulk-first','bulk-last','bulk-grade']){
 el(id).addEventListener('input',renderBulkPreview);
}
el('apply-bulk-links').onclick=applyBulkLinks;

function renderPendingScans(){
 el('pending-scans').hidden=!pages.length;
 const container=el('pending-scan-table');
 if(!pages.length){
  refreshBulkLinks(false);
  container.replaceChildren();
  return;
 }
 const students=new Map(exam.students.map(student=>[student.id,student]));
 const corrected=new Set(exam.results.map(result=>result.id));
 const identities=detectedSheetCounts();
 const rows=[];
 pages.forEach((page,index)=>{
  if(isScanConfirmed(page))return;
  const student=students.get(page.student);
  const reasons=[];
  if(!page.aligned){
   reasons.push('Alinhamento não reconhecido');
  }else{
   if(!page.model)reasons.push('Versão a selecionar');
   else if(!exam.keys[page.model])reasons.push('Gabarito a preencher');
   const uncertain=page.answers.filter(answer=>answer==='?').length;
   if(uncertain)reasons.push(uncertain===1?'1 resposta duvidosa':uncertain+' respostas duvidosas');
  }
  if(page.headerConflict)reasons.push('Cabeçalho divergente da lista');
  else if(!student)reasons.push('Confira o RA e vincule o aluno');
  if(page.suggestion==='order')reasons.push('Sugestão pela ordem. Confira o RA');
  if(page.suggestion==='header')reasons.push('Leitura parcial. Confira o RA e o nome');
  if(identities.get(page.detectedStudent)>1)reasons.push('RA repetido nas folhas importadas');
  if(student&&corrected.has(student.id))reasons.push('Aluno com nota registrada');

  const button=document.createElement('button');
  button.type='button';
  button.className='secondary';
  button.textContent='Revisar';
  button.setAttribute('aria-label','Revisar folha '+(index+1)+' · '+page.name);
  button.setAttribute('aria-controls','review-scans');
  if(index===current)button.setAttribute('aria-current','true');
  button.onclick=()=>{
   const pageIndex=pages.indexOf(page);
   if(pageIndex<0)return;
   current=pageIndex;
   show();
   el('page-label').focus();
  };
  const identity=student?[student.name,student.group,'RA '+student.id].filter(Boolean).join(' · '):'A vincular';
  rows.push([page.name,identity,reasons.join(' · ')||'Aguardando confirmação',button]);
 });
 const count=rows.length===0?'Nenhuma folha pendente.':rows.length===1?'1 folha para revisar.':rows.length+' folhas para revisar.';
 if(el('pending-scan-count').textContent!==count)message('pending-scan-count',count);
 if(rows.length)container.replaceChildren(dataTable(['Arquivo e página','Aluno','Motivo','Ação'],rows));
 else container.replaceChildren();
 refreshBulkLinks(Boolean(rows.length));
}
function updateScanReview(p){
 const alignment=p.aligned?'Quatro referências detectadas.':'Alinhamento não reconhecido: preencha as respostas manualmente ou digitalize novamente.';
 const model=p.model?'Versão lida/selecionada: '+p.model+'.':'Versão não identificada: confira a marcação do aluno e selecione acima.';
 const uncertain=p.answers.filter(answer=>answer==='?').length;
 const confirmed=isScanConfirmed(p);
 const alreadyCorrected=!confirmed&&p.student&&exam.results.some(result=>result.id===p.student);
 const review=alreadyCorrected?' Este aluno já tem nota. Revise a folha antes de substituir.':'';
 let identity='';
 if(!p.student)identity=' Confira o RA no cabeçalho e selecione o aluno desta folha.';
 if(p.suggestion==='order')identity=' Aluno sugerido pela ordem da lista. Confira o RA no cabeçalho.';
 if(p.suggestion==='header')identity=' Aluno sugerido pela leitura parcial. Confira o RA e o nome.';
 message('read-status',alignment+' '+model+' '+uncertain+(uncertain===1?' resposta para revisar.':' respostas para revisar.')+identity+review);
 el('confirm-scan').disabled=confirmed;
 const confirmation=p.autoConfirmed?'Correção confirmada automaticamente':'Correção confirmada ✓';
 message('confirm-scan',confirmed?confirmation:'Confirmar correção desta página');
}
function show(){
 const p=pages[current];
 if(!p)return;
 el('review-scans').hidden=false;
 message('page-label',`${current+1} / ${pages.length} · ${p.name}`);
 el('prev-scan').disabled=current===0;
 el('next-scan').disabled=current===pages.length-1;
 el('scan-student').replaceChildren(new Option('Selecione o aluno da folha',''),...exam.students.map(s=>new Option(s.name+' · '+s.id,s.id)));
 el('scan-student').value=p.student;
 el('scan-model').replaceChildren(new Option('Selecione a versão marcada',''),...exam.versions.map(k=>new Option(k,k)));
 el('scan-model').value=p.model;
 const canvas=el('scan-preview');
 canvas.getContext('2d').clearRect(0,0,canvas.width,canvas.height);
 const img=new Image();
 img.onload=()=>{
  if(p!==pages[current])return;
  canvas.width=img.width;
  canvas.height=img.height;
  canvas.getContext('2d').drawImage(img,0,0);
 };
 img.src=p.image;
 el('answers-grid').replaceChildren(...p.answers.map((a,i)=>{
  const label=document.createElement('label');
  label.textContent=String(i+1);
  const select=document.createElement('select');
  select.setAttribute('aria-label','Resposta da questão '+(i+1));
  select.replaceChildren(...['?','-','A','B','C','D','E'].map(v=>new Option(v==='-'?'—':v,v)));
  select.value=a;
  select.classList.toggle('uncertain',a==='?');
  select.onchange=()=>{
   p.answers[i]=select.value;
   p.confirmed=false;
   select.classList.toggle('uncertain',select.value==='?');
   updateScanReview(p);
   renderPendingScans();
  };
  label.append(select);
  return label;
 }));
 updateScanReview(p);
 renderPendingScans();
}
function captureQuestionBank(versions){return Object.fromEntries(versions.map(v=>[v.name,v.rows.map(r=>({number:r.number,original:r.q.id,lines:renderBlocks(r,false).map(txt)}))]));}
function validQuestionBank(bank,e){return bank&&typeof bank==='object'&&Object.entries(bank).every(([model,rows])=>e.versions.includes(model)&&Array.isArray(rows)&&rows.length===e.n&&rows.every(r=>Number.isInteger(r.original)&&Array.isArray(r.lines)&&r.lines.every(t=>typeof t==='string')));}
function questionUnits(e,model,i){const id=e.questionBank?.[model]?.[i]?.original??i+1;return e.scoring&&e.scoring.mode!=='equal'?Number(e.scoring.values[id]??0):1;}
function questionPoints(e,model,i){const unit=questionUnits(e,model,i),total=e.keys[model].reduce((sum,_,j)=>sum+questionUnits(e,model,j),0);return e.scoring?.mode==='points'?unit:total?unit/total*e.max:0;}
function scoreResult(e,r){let hits=0,earned=0,total=0;e.keys[r.model].forEach((k,i)=>{const value=questionUnits(e,r.model,i);total+=value;if(k==='X'||k===r.answers[i]){hits++;earned+=value;}});const rate=total?earned/total:0;return {hits,note:e.scoring?.mode==='points'?earned:rate*e.max,rate};}
function grade(r){return scoreResult(exam,r);}
function groupSummary(e,students){const ids=new Set(students.map(s=>s.id));const results=e.results.filter(r=>ids.has(r.id));const count=results.length;return {enrolled:students.length,participants:count,pending:students.length-count,participation:students.length?count/students.length:0,mean:count?results.reduce((sum,r)=>sum+scoreResult(e,r).note,0)/count:null,performance:count?results.reduce((sum,r)=>sum+scoreResult(e,r).rate,0)/count:null};}
function reportData(e){return {overall:groupSummary(e,e.students),classes:[...new Set(e.students.map(s=>s.group))].sort((a,b)=>a.localeCompare(b,'pt-BR',{numeric:true})).map(group=>({group,...groupSummary(e,e.students.filter(s=>s.group===group))}))};}
function questionData(e,model,index,group=null){const students=new Map(e.students.map(s=>[s.id,s]));const results=e.results.filter(r=>r.model===model&&(group===null||students.get(r.id)?.group===group));const key=e.keys[model][index],counts={A:0,B:0,C:0,D:0,E:0,'-':0};for(const r of results)counts[r.answers[index]]++;const correct=key==='X'?results.length:counts[key];return {model,number:index+1,original:e.questionBank?.[model]?.[index]?.original??null,key,participants:results.length,correct,wrong:results.length-correct,blank:counts['-'],rate:results.length?correct/results.length:null,counts,results};}
const fmt=n=>n===null?'—':n.toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2});
const pct=n=>n===null?'—':(n*100).toLocaleString('pt-BR',{maximumFractionDigits:1})+'%';
function dataTable(headers,rows){const t=document.createElement('table'),head=t.createTHead().insertRow(),body=t.createTBody();for(const h of headers){const th=document.createElement('th');th.textContent=h;head.append(th);}for(const row of rows){const tr=body.insertRow();for(const value of row){const td=tr.insertCell();if(value instanceof Node)td.append(value);else td.textContent=value??'—';}}return t;}
function report(){
 el('clear-results').disabled=!exam?.results.length;
 if(!exam){
  const sections=['grade-stats','class-stats','grades','performance-columns','performance-people',
   'question-columns','chart-correct-students','question-stats','original-stats'];
  for(const id of sections)el(id).replaceChildren();
  el('report-group').replaceChildren(new Option('Todas as turmas',''));
  el('report-model').replaceChildren();
  el('report-question').replaceChildren();
  message('chart-question-summary','');
  renderQuestionReview();
  message('report-status','Salve uma avaliação para gerar os relatórios.');
  return;
 }
 const data=reportData(exam),s=data.overall;el('grade-stats').replaceChildren(...[[s.participants+' / '+s.enrolled,'alunos com correção confirmada'],[pct(s.participation),'participação geral'],[fmt(s.mean),'média geral · nota máxima '+exam.max],[pct(s.performance),'desempenho médio geral']].map(([value,label])=>{const div=document.createElement('div'),b=document.createElement('b');b.textContent=value;div.append(b,label);return div;}));el('class-stats').replaceChildren(dataTable(['Turma','Cadastrados','Participantes','Pendentes','Participação','Média','Desempenho médio'],data.classes.map(c=>[c.group||'Sem turma',c.enrolled,c.participants,c.pending,pct(c.participation),fmt(c.mean),pct(c.performance)])));
 const selectedGroup=el('report-group').value;
 el('report-group').replaceChildren(new Option('Todas as turmas',''),...data.classes.filter(c=>c.group).map(c=>new Option(c.group,c.group)));
 if(data.classes.some(c=>c.group===selectedGroup))el('report-group').value=selectedGroup;
 const selectedModel=el('report-model').value;
 el('report-model').replaceChildren(...Object.keys(exam.keys).map(k=>new Option(k,k)));
 if(exam.keys[selectedModel])el('report-model').value=selectedModel;
 populateQuestionOptions();
 renderReportDetails();
 message('report-status','');
}
function renderGrades(){
 const group=el('report-group').value;
 const results=new Map(exam.results.map(r=>[r.id,r]));
 el('grades').replaceChildren(...exam.students.filter(s=>!group||s.group===group).map(s=>{
  const r=results.get(s.id),g=r?grade(r):null,tr=document.createElement('tr');
  [s.name,s.group,s.call||'—',r?.model||'—',g?g.hits+' / '+exam.n:'Pendente',g?fmt(g.note):'—'].forEach(v=>tr.insertCell().textContent=v);
  return tr;
 }));
}
function renderReportDetails(){
 if(!exam)return;
 renderGrades();
 renderQuestionStats();
 renderQuestionReview();
 renderColumnCharts();
}
function populateQuestionOptions(){const old=el('report-question').value;el('report-question').replaceChildren(...Array.from({length:exam.n},(_,i)=>new Option('Questão '+(i+1),String(i))));if(old!==''&&Number(old)<exam.n)el('report-question').value=old;}
function renderQuestionStats(){const group=el('report-group').value||null;const rows=[],originals=new Map();for(const model of Object.keys(exam.keys))for(let i=0;i<exam.n;i++){const q=questionData(exam,model,i,group);const button=document.createElement('button');button.className='secondary';button.textContent='Revisar';button.setAttribute('aria-label','Revisar versão '+model+' questão '+(i+1));button.onclick=()=>{el('report-model').value=model;el('report-question').value=String(i);el('individual-review').open=true;renderQuestionReview();el('individual-review').scrollIntoView({block:'start'});};rows.push([model,i+1,q.original??'—',q.key==='X'?'Anulada':q.key,q.participants,q.correct,q.wrong,q.blank,pct(q.rate),button]);if(q.original!==null){const item=originals.get(q.original)||{correct:0,total:0,refs:[]};item.correct+=q.correct;item.total+=q.participants;item.refs.push(model+' / '+(i+1));originals.set(q.original,item);}}
 el('question-stats').replaceChildren(rows.length?dataTable(['Versão','Questão','Original','Gabarito','Respostas','Acertos','Erros (incl. brancos)','Em branco','Acertos %','Revisão'],rows):document.createTextNode('Salve os gabaritos para analisar as questões.'));
 el('original-stats').replaceChildren(originals.size?dataTable(['Questão original','Posição nas versões','Acertos','Respostas','Acertos %'],[...originals].sort((a,b)=>a[0]-b[0]).map(([id,q])=>[id,q.refs.join(' · '),q.correct,q.total,pct(q.total?q.correct/q.total:null)])):document.createTextNode('Gere e salve as versões para preservar a correspondência entre questões. Em avaliações antigas, a análise permanece separada por versão.'));}
function renderQuestionReview(){const model=el('report-model').value;if(!exam?.keys[model]){el('question-content').textContent='Cadastre os gabaritos e salve a avaliação para revisar cada questão.';el('question-summary').textContent='';el('answer-distribution').replaceChildren();el('question-students').replaceChildren();el('question-prev').disabled=el('question-next').disabled=true;return;}const index=Number(el('report-question').value),q=questionData(exam,model,index,el('report-group').value||null),snapshot=exam.questionBank?.[model]?.[index];el('question-prev').disabled=index===0;el('question-next').disabled=index===exam.n-1;el('question-content').replaceChildren();const heading=document.createElement('h3');heading.textContent='Versão '+model+' · questão '+(index+1)+(snapshot?' · original '+snapshot.original:'');el('question-content').append(heading);if(snapshot){for(const line of snapshot.lines){const p=document.createElement('p');p.textContent=line;el('question-content').append(p);}}else el('question-content').append('Enunciado não disponível neste registro. Gere e salve as versões para incluir o texto na revisão.');el('question-summary').textContent='Gabarito: '+(q.key==='X'?'anulada — todos recebem o ponto':q.key)+' · valor: '+fmt(questionPoints(exam,model,index))+' ponto(s) · '+q.participants+' respostas confirmadas · '+q.correct+' acertos ('+pct(q.rate)+') · '+q.blank+' em branco. As imagens e a formatação original permanecem na etapa 03.';el('answer-distribution').replaceChildren(dataTable(['Alternativa','Quantidade','Percentual'],Object.entries(q.counts).map(([a,n])=>[(a==='-'?'Em branco':a)+(a===q.key?' ✓':''),n,pct(q.participants?n/q.participants:null)])));const students=new Map(exam.students.map(s=>[s.id,s]));el('question-students').replaceChildren(dataTable(['RA','Aluno','Turma','Chamada','Resposta','Situação'],q.results.map(r=>{const s=students.get(r.id),answer=r.answers[index];return [s.id,s.name,s.group,s.call||'—',answer==='-'?'Em branco':answer,q.key==='X'?'Anulada':answer===q.key?'Acerto':'Erro'];})));}
function makeReportWorkbook(e){const wb=XLSX.utils.book_new(),data=reportData(e),o=data.overall;function add(name,rows,widths,percentCols=[],numberCols=[]){const ws=XLSX.utils.aoa_to_sheet(rows);ws['!cols']=widths.map(wch=>({wch}));ws['!autofilter']={ref:ws['!ref']};for(let row=1;row<rows.length;row++){for(const c of percentCols){const cell=ws[XLSX.utils.encode_cell({r:row,c})];if(cell?.t==='n')cell.z='0.0%';}for(const c of numberCols){const cell=ws[XLSX.utils.encode_cell({r:row,c})];if(cell?.t==='n')cell.z='0.00';}}XLSX.utils.book_append_sheet(wb,ws,name);}
 add('Resumo',[['Avaliação','Cadastrados','Participantes','Pendentes','Participação','Média geral','Desempenho geral','Nota máxima','Critério'],[e.title,o.enrolled,o.participants,o.pending,o.participation,o.mean,o.performance,e.max,'Participação = correções confirmadas / cadastrados. Médias somente de correções confirmadas.']],[35,15,15,15,16,16,20,14,85],[4,6],[5]);add('Turmas',[['Turma','Cadastrados','Participantes','Pendentes','Participação','Média','Desempenho médio'],...data.classes.map(c=>[c.group||'Sem turma',c.enrolled,c.participants,c.pending,c.participation,c.mean,c.performance])],[22,15,15,15,16,14,22],[4,6],[5]);
 add('Alunos',[['RA','Aluno','Turma','Chamada','Versão','Situação','Acertos','Questões','Nota','Desempenho'],...e.students.map(s=>{const r=e.results.find(r=>r.id===s.id),g=r?scoreResult(e,r):null;return [s.id,s.name,s.group,s.call||'',r?.model||'',r?'Confirmada':'Pendente',g?.hits??null,e.n,g?.note??null,g?.rate??null];})],[20,35,22,12,12,16,12,12,14,18],[9],[8]);
 const questionRows=[['Versão','Questão','Original','Gabarito','Respostas','Acertos','Erros (incl. brancos)','Em branco','Acertos %','A','B','C','D','E','Enunciado e alternativas']],byClass=[['Turma','Versão','Questão','Original','Gabarito','Respostas','Acertos','Erros (incl. brancos)','Em branco','Acertos %']],answers=[['RA','Aluno','Turma','Chamada','Versão','Questão','Original','Gabarito','Resposta','Situação']];
 for(const model of Object.keys(e.keys))for(let i=0;i<e.n;i++){const q=questionData(e,model,i);questionRows.push([model,i+1,q.original,q.key,q.participants,q.correct,q.wrong,q.blank,q.rate,...'ABCDE'.split('').map(a=>q.counts[a]),e.questionBank?.[model]?.[i]?.lines.join('\n')||'']);for(const c of data.classes){const cq=questionData(e,model,i,c.group);byClass.push([c.group||'Sem turma',model,i+1,cq.original,cq.key,cq.participants,cq.correct,cq.wrong,cq.blank,cq.rate]);}}
 for(const r of e.results){const s=e.students.find(s=>s.id===r.id);r.answers.forEach((a,i)=>{const key=e.keys[r.model][i];answers.push([s.id,s.name,s.group,s.call||'',r.model,i+1,e.questionBank?.[r.model]?.[i]?.original??null,key,a==='-'?'Em branco':a,key==='X'?'Anulada':key===a?'Acerto':'Erro']);});}
 add('Questões',questionRows,[12,12,12,12,14,12,12,14,16,10,10,10,10,10,80],[8]);add('Questões por turma',byClass,[22,12,12,12,12,14,12,12,14,16],[9]);add('Respostas',answers,[20,35,22,12,12,12,12,12,14,14]);const originals=new Map();for(const row of questionRows.slice(1)){if(row[2]===null)continue;const item=originals.get(row[2])||{refs:[],total:0,correct:0};item.refs.push(row[0]+' / '+row[1]);item.total+=row[4];item.correct+=row[5];originals.set(row[2],item);}add('Questões originais',[['Questão original','Posição nas versões','Respostas','Acertos','Acertos %'],...[...originals].sort((a,b)=>a[0]-b[0]).map(([id,q])=>[id,q.refs.join(' · '),q.total,q.correct,q.total?q.correct/q.total:null])],[20,50,15,15,18],[4]);add('Pontuação',[['Versão','Posição','Questão original','Modo','Peso ou pontos','Valor na nota'],...Object.keys(e.keys).flatMap(model=>e.keys[model].map((_,i)=>[model,i+1,e.questionBank?.[model]?.[i]?.original??i+1,e.scoring?.mode||'equal',questionUnits(e,model,i),questionPoints(e,model,i)]))],[14,14,20,16,20,20],[],[4,5]);return wb;}
el('save-exam').onclick=save;
function generatedQuestionCount(versions){
 if(!versions.length)throw Error('Gere as versões nas etapas 01 a 04 primeiro.');
 const count=versions[0].rows.length;
 if(versions.some(v=>v.rows.length!==count))throw Error('As versões têm quantidades diferentes de questões. Gere novamente antes de criar os cartões.');
 if(!Number.isInteger(count)||count<10||count>100)throw Error('As versões geradas têm '+count+' questões. Os cartões aceitam de 10 a 100; ajuste a prova-base e gere novamente.');
 if(versions.some(v=>v.rows.some(r=>r.opts.length!==5)))throw Error('Cada questão objetiva deve ter cinco alternativas (A a E). Ajuste a prova-base e gere novamente.');
 return count;
}
function syncGeneratedVersions(){
 try{
  const n=generatedQuestionCount(state.versions);
  const questionBank=captureQuestionBank(state.versions);
  const versions=state.versions.map(v=>v.name);
  const sameQuestions=draftAssessment&&scoringIds(n,questionBank).join(',')===
    scoringIds(draftAssessment.n,draftAssessment.questionBank).join(',');
  draftAssessment={n,questionBank};
  el('question-count').value=n;
  el('exam-versions').value=versions.join(' ');
  el('grading-keys').value=state.versions.map(v=>v.name+': '+v.rows.map(r=>r.correct).join(' ')).join('\n');
  if(sameQuestions)updateScoringPreview();
  else loadScoring({n,questionBank,versions});
  message('exam-status',n+' questões objetivas por versão. Quantidade, versões e gabaritos sincronizados. Salve a avaliação para aplicar aos cartões.');
 }catch(e){error(e);}
}
el('use-models').onclick=syncGeneratedVersions;
document.addEventListener('atelier-versions-generated',syncGeneratedVersions);
el('print-sheets').onclick=()=>{if(save())try{printHTML(exam.students.map(sheet).join(''));}catch(e){error(e);}};
el('backup').onclick=()=>{if(save())download(JSON.stringify({format:'atelier-1',exam},null,2),'avaliacao-backup.json','application/json');};
el('roster-file').onchange=importWorkbook;
el('restore').onchange=async event=>{
 const input=event.target,file=input.files[0];
 if(!file)return;
 try{
  const content=await file.text();
  if(input.files[0]!==file)return;
  const data=JSON.parse(content);
  if(loading)throw Error('Aguarde o fim da leitura das folhas.');
  const saved=data?.exam;
  if(data?.format!=='atelier-1'||!Array.isArray(saved?.students)||!Array.isArray(saved.results))throw Error('Backup inválido.');
  const versions=saved.versions||Object.keys(saved.keys);
  const questionBank=validQuestionBank(saved.questionBank,{...saved,versions})?saved.questionBank:undefined;
  const source={...saved,versions,questionBank};
  const fields=['exam-title','max-grade','roster','grading-keys','question-count','exam-versions','scoring-mode','question-scores'];
  const previous=fields.map(id=>el(id).value),previousExcluded=excludedIds;
  let validated;
  try{
   writeExamForm(source);
   validated=readForm(source);
  }finally{
   fields.forEach((id,i)=>el(id).value=previous[i]);
   excludedIds=previousExcluded;
   updateScoringPreview();
  }
  const selected=new Set(validated.students.map(s=>s.id));
  if(new Set(saved.results.map(r=>r.id)).size!==saved.results.length||saved.results.some(r=>
   !selected.has(r.id)||!validated.keys[r.model]||!Array.isArray(r.answers)||
   r.answers.length!==validated.n||r.answers.some(a=>! /^[A-E-]$/.test(a))
  ))throw Error('Resultados inválidos no backup.');
  if(!confirm('Substituir a avaliação atual por este backup?'))throw Error('Restauração cancelada.');
  exam={...validated,results:saved.results};
  clearScans();
  fill();
  persist();
 }catch(err){if(input.files[0]===file)error(err);}
 finally{if(input.files[0]===file)input.value='';}
};
el('clear-assessment').onclick=()=>{
 if(loading){message('exam-status','Aguarde o fim da leitura das folhas.');return;}
 if(!confirm('Apagar a avaliação atual deste navegador? Isso inclui os alunos, os gabaritos, as folhas importadas e as notas. Para guardar uma cópia, cancele e use Baixar backup.'))return;
 try{
  localStorage.removeItem(storage);
 }catch{
  message('exam-status','Não foi possível apagar a avaliação salva neste navegador.');
  return;
 }

 exam=null;
 draftAssessment=null;
 excludedIds.clear();
 rosterUndo=null;
 for(const id of ['exam-title','roster','question-count','exam-versions','grading-keys','max-grade','question-scores','student-search']){
  el(id).value=el(id).defaultValue;
 }
 el('restore').value='';
 el('student-group').value='';
 el('scoring-mode').selectedIndex=0;
 el('scoring-preview').replaceChildren();
 updateScoringPreview();
 resetWorkbookImport();
 clearScans();
 report();
 renderStudentManager();
 message('scan-status','Cadastre a nova avaliação para importar folhas.');
 message('exam-status','Dados da avaliação limpos. Você pode cadastrar uma nova avaliação.');
};
el('clear-results').onclick=()=>{
 if(loading){message('report-status','Aguarde o fim da leitura das folhas.');return;}
 const count=exam?.results.length||0;
 if(!count)return;
 const corrections=count===1?'1 correção confirmada':count+' correções confirmadas';
 if(!confirm('Apagar '+corrections+' desta avaliação? A lista de alunos e os gabaritos serão mantidos.'))return;

 const next={...exam,results:[]};
 if(!persist(next,'report-status'))return;
 exam=next;
 el('restore').value='';
 for(const page of pages){
  page.confirmed=false;
  page.autoConfirmed=false;
  page.savedResult=undefined;
 }
 if(pages.length){
  show();
  message('scan-status','Resultados limpos. As folhas importadas estão disponíveis para revisão.');
 }
 report();
 message('report-status','Resultados limpos. As próximas correções alimentarão o relatório.');
};
el('clear-scans').onclick=()=>{
 clearScans();
 message('scan-status','Fila vazia. Selecione as folhas para importar novamente.');
 el('scans').focus();
};
el('scans').onchange=e=>scans([...e.target.files]);el('prev-scan').onclick=()=>{current--;show();};el('next-scan').onclick=()=>{current++;show();};
el('scan-student').onchange=()=>{const p=pages[current];p.student=el('scan-student').value;p.manualLink=true;p.suggestion='';p.confirmed=false;show();};el('scan-model').onchange=()=>{pages[current].model=el('scan-model').value;pages[current].confirmed=false;show();};
el('confirm-scan').onclick=()=>{
 const page=pages[current];
 if(loading||!page)return;
 if(!exam.keys[page.model]){
  message('read-status','Selecione a versão marcada pelo aluno antes de confirmar.');
  return;
 }
 if(page.answers.includes('?')){
  message('read-status','Revise todas as respostas com ? antes de confirmar.');
  return;
 }
 if(!page.student){
  message('read-status','Selecione o aluno desta página antes de confirmar.');
  return;
 }
 const previousId=page.savedResult?.id;
 const moving=previousId!==page.student&&exam.results.includes(page.savedResult);
 const replacing=exam.results.some(result=>result.id===page.student);
 const change=moving&&replacing
  ? 'Mudar o vínculo desta correção e substituir a nota do aluno selecionado?'
  : moving?'Mudar o vínculo desta correção para o aluno selecionado?'
  : replacing?'Este aluno já tem nota. Substituir a correção anterior?':'';
 const differentStudent=page.detectedStudent&&page.detectedStudent!==page.student;
 const identityNotice=differentStudent?'O cabeçalho desta folha identifica outro aluno. Confira o RA.':'';
 const confirmation=[identityNotice,change|| (differentStudent?'Confirmar para o aluno selecionado?':'')].filter(Boolean).join(' ');
 if(confirmation&&!confirm(confirmation))return;
 recordCorrection(page);
 persist();
 report();
 show();
 el('pending-scan-heading').focus();
};
el('export-grades').onclick=()=>{if(!exam){message('report-status','Salve uma avaliação primeiro.');return;}try{const workbook=makeReportWorkbook(exam);download(XLSX.write(workbook,{bookType:'xlsx',type:'array'}),'Relatorio_avaliacao.xlsx','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');}catch(e){message('report-status','Não foi possível exportar o relatório: '+e.message);}};
el('print-report').onclick=()=>{if(!exam){message('report-status','Salve uma avaliação primeiro.');return;}try{printHTML('<div class="report"><h1>'+esc(exam.title)+'</h1>'+el('grade-stats').innerHTML+'<h2>Participação e desempenho por turma</h2>'+el('class-stats').innerHTML+'<p>Participação: correções confirmadas / alunos cadastrados. Médias somente de correções confirmadas.</p>'+el('grades').closest('table').outerHTML+'<h2>Desempenho por questão</h2>'+el('question-stats').innerHTML+'</div>');}catch(e){message('report-status',e.message);}};
el('report-group').onchange=renderReportDetails;el('report-model').onchange=()=>{populateQuestionOptions();renderQuestionReview();};el('report-question').onchange=renderQuestionReview;
el('question-prev').onclick=()=>{el('report-question').selectedIndex--;renderQuestionReview();};el('question-next').onclick=()=>{el('report-question').selectedIndex++;renderQuestionReview();};
let workbook=null,importRows=[];
const normHeader=v=>String(v).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]/g,'');
const aliases={ra:['ra','matricula','numerodamatricula','numerodematricula','registrodoaluno','registroacademico','registro','id'],name:['nome','aluno','nomedoaluno','nomecompleto','estudante','nomedoestudante'],call:['n','no','numero','num','chamada','nchamada','nochamada','nodechamada','ndechamada','numerochamada','numerodechamada','numerodachamada','numerodoaluno','numeronachamada','nordem','ordem']};
function prepareSheet(){
 const raw=XLSX.utils.sheet_to_json(workbook.Sheets[el('workbook-sheet').value],{header:1,raw:false,defval:'',blankrows:false});
 let h=raw.findIndex(row=>row.some(v=>aliases.ra.includes(normHeader(v)))&&row.some(v=>aliases.name.includes(normHeader(v))));if(h<0)h=0;
 const headers=raw[h]||[];importRows=raw.slice(h+1).filter(row=>row.some(v=>String(v).trim()));
 for(const [id,kind] of [['column-ra','ra'],['column-name','name'],['column-call','call']]){const select=el(id);select.replaceChildren(new Option(kind==='call'?'Usar ordem dos alunos nesta aba (1, 2, 3...)':'Selecione a coluna',''),...headers.map((name,i)=>new Option((name||'Coluna '+(i+1))+' ['+(i+1)+']',String(i))));const match=headers.findIndex(v=>aliases[kind].includes(normHeader(v)));if(match>=0)select.value=String(match);}
 updateImportPreview();
}
function updateImportPreview(){message('sheet-class','Turma automática: '+el('workbook-sheet').value);const index=el('column-name').value;message('import-preview',importRows.length+' linhas de alunos encontradas.'+(index!==''?' Prévia: '+importRows.slice(0,3).map(r=>r[Number(index)]||'—').join(', '):''));}
function resetWorkbookImport(){
 workbook=null;
 importRows=[];
 el('roster-file').value='';
 el('spreadsheet-map').hidden=true;
 el('import-mode').selectedIndex=0;
 for(const id of ['workbook-sheet','column-ra','column-name','column-call','sheet-class','import-preview']){
  el(id).replaceChildren();
 }
}
async function importWorkbook(event){
 const input=event.target,file=input.files[0];
 if(!file)return;
 try{
  if(file.size>20*1024*1024)throw Error('A planilha deve ter no máximo 20 MB.');
  const bytes=await file.arrayBuffer();
  if(input.files[0]!==file)return;
  const imported=XLSX.read(bytes,{type:'array',cellDates:false,cellHTML:false,cellFormula:false});
  if(!imported.SheetNames.length)throw Error('A planilha não contém abas.');
  workbook=imported;
  el('workbook-sheet').replaceChildren(...workbook.SheetNames.map(s=>new Option(s,s)));
  prepareSheet();
  el('spreadsheet-map').hidden=false;
  message('exam-status','Planilha aberta. A turma será o nome da aba. Confira RA, nome e chamada e clique em carregar alunos.');
 }catch(err){if(input.files[0]===file)error(err);}
 finally{if(input.files[0]===file)input.value='';}
}
el('workbook-sheet').onchange=prepareSheet;
for(const id of ['column-ra','column-name','column-call'])el(id).onchange=updateImportPreview;
function mappedStudents(rows,columns,sheetName){const required=[columns.ra,columns.name];if(required.some(x=>x==='')||new Set(required).size!==2)throw Error('Selecione colunas diferentes para RA e nome.');if(columns.call!==''&&required.includes(columns.call))throw Error('A coluna de chamada deve ser diferente das colunas de RA e nome.');const group=String(sheetName||'').trim();if(!group)throw Error('Selecione a aba que identifica a turma.');const seen=new Set();return rows.map((row,i)=>{const get=kind=>String(row[Number(columns[kind])]??'').trim();const ra=get('ra'),name=get('name'),call=columns.call===''?String(i+1):get('call');if(!ra||!name||!call)throw Error('Linha de aluno '+(i+1)+': RA, nome e chamada são obrigatórios.');if(seen.has(ra))throw Error('RA repetido na planilha: '+ra);if([ra,name,group,call].some(v=>/[;\r\n]/.test(v)))throw Error('Remova ponto e vírgula e quebras de linha das células ou do nome da aba (linha '+(i+1)+').');seen.add(ra);return [ra,name,group,call].join(';');});}
function mergeRoster(existing,incoming,append){const rows=append?[...existing.split(/\n/).filter(l=>l.trim()&&! /^(ra|matr[ií]cula|id);/i.test(l.trim())),...incoming]:incoming;const ids=rows.map(l=>l.split(';')[0].trim());if(new Set(ids).size!==ids.length)throw Error('Há RAs repetidos entre a lista atual e esta aba. Nenhuma linha foi alterada.');return rows.join('\n');}
el('apply-roster').onclick=()=>{try{const columns={ra:el('column-ra').value,name:el('column-name').value,call:el('column-call').value};const rows=mappedStudents(importRows,columns,el('workbook-sheet').value);if(!rows.length)throw Error('Nenhum aluno encontrado nesta aba.');const append=el('import-mode').value==='append';const merged=mergeRoster(el('roster').value,rows,append);el('roster').value=merged;if(!append)excludedIds.clear();rosterUndo=null;renderStudentManager();message('exam-status',rows.length+' alunos carregados da aba '+el('workbook-sheet').value+'. Selecione outra aba para acrescentar mais turmas ou salve a avaliação.');el('import-mode').value='append';}catch(err){error(err);}};
function parseRoster(text){const students=text.trim().split(/\n/).filter(x=>x.trim()).map((line,i)=>{const a=line.split(';').map(x=>x.trim());if(i===0&&/^(ra|matr[ií]cula|id)$/i.test(a[0]))return null;const student=a.length===1?{id:String(i+1),name:a[0],group:'',call:''}:{id:a[0],name:a[1],group:a[2]||'',call:a[3]||''};if(!student.id||!student.name)throw Error('Confira o RA e nome na linha '+(i+1)+'.');return student;}).filter(Boolean);if(new Set(students.map(s=>s.id)).size!==students.length)throw Error('Há RAs repetidos na lista. Corrija-os antes de selecionar alunos.');return students;}
function matchingStudents(students,search,group){const normalize=s=>String(s).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();const query=normalize(search.trim());return students.filter(s=>(!group||s.group===group)&&(!query||normalize([s.name,s.id,s.call].join(' ')).includes(query)));}
function currentRoster(){return parseRoster(el('roster').value);}
function visibleRoster(){return matchingStudents(currentRoster(),el('student-search').value,el('student-group').value);}
function renderStudentManager(){try{const pool=currentRoster(),group=el('student-group').value,groups=[...new Set(pool.map(s=>s.group))].filter(Boolean).sort((a,b)=>a.localeCompare(b,'pt-BR',{numeric:true}));el('student-group').replaceChildren(new Option('Todas as turmas',''),...groups.map(g=>new Option(g,g)));if(groups.includes(group))el('student-group').value=group;const ids=new Set(pool.map(s=>s.id));excludedIds=new Set([...excludedIds].filter(id=>ids.has(id)));const visible=visibleRoster();message('selection-status',(pool.length-excludedIds.size)+' selecionados de '+pool.length+' importados · '+visible.length+' exibidos.');const rows=visible.map(s=>{const check=document.createElement('input');check.type='checkbox';check.checked=!excludedIds.has(s.id);check.setAttribute('aria-label','Incluir '+s.name+' · RA '+s.id);check.onchange=()=>{if(check.checked)excludedIds.delete(s.id);else excludedIds.add(s.id);renderStudentManager();};const remove=document.createElement('button');remove.className='secondary';remove.textContent='Remover';remove.setAttribute('aria-label','Remover '+s.name+' · RA '+s.id);remove.onclick=()=>removeRosterIds(new Set([s.id]));return [check,s.id,s.name,s.group,s.call||'—',remove];});el('student-choice-table').replaceChildren(rows.length?dataTable(['Incluir','RA','Nome','Turma','Chamada','Ação'],rows):document.createTextNode(pool.length?'Nenhum aluno corresponde ao filtro.':'Importe uma planilha ou preencha a lista para escolher os alunos.'));el('remove-unselected').disabled=!excludedIds.size;el('undo-roster').disabled=!rosterUndo;}catch(e){message('selection-status',e.message);el('student-choice-table').replaceChildren();}}
function removeRosterIds(ids){try{const pool=currentRoster();if(!pool.some(s=>ids.has(s.id)))return;rosterUndo={text:el('roster').value,excluded:[...excludedIds]};el('roster').value=pool.filter(s=>!ids.has(s.id)).map(s=>[s.id,s.name,s.group,s.call].join(';')).join('\n');for(const id of ids)excludedIds.delete(id);renderStudentManager();message('exam-status','Alunos removidos da lista. Você pode desfazer a remoção antes de salvar.');}catch(e){error(e);}}
el('roster').addEventListener('input',()=>{rosterUndo=null;renderStudentManager();});el('student-search').oninput=renderStudentManager;el('student-group').onchange=renderStudentManager;
el('select-visible').onclick=()=>{try{visibleRoster().forEach(s=>excludedIds.delete(s.id));renderStudentManager();}catch(e){error(e);}};el('unselect-visible').onclick=()=>{try{visibleRoster().forEach(s=>excludedIds.add(s.id));renderStudentManager();}catch(e){error(e);}};
el('remove-unselected').onclick=()=>removeRosterIds(new Set(excludedIds));el('undo-roster').onclick=()=>{if(!rosterUndo)return;el('roster').value=rosterUndo.text;excludedIds=new Set(rosterUndo.excluded);rosterUndo=null;renderStudentManager();message('exam-status','Última remoção desfeita. Salve a avaliação para aplicar a lista.');};
function scoringIds(n,bank){const first=bank&&Object.values(bank)[0];return first?first.map(q=>String(q.original)).sort((a,b)=>Number(a)-Number(b)):Array.from({length:n},(_,i)=>String(i+1));}
function parseScoring(mode,text,n,bank,versions){if(!['equal','weights','points'].includes(mode))throw Error('Escolha uma forma válida de pontuação.');if(mode==='equal')return {mode:'equal',values:{}};if(versions.length>1&&!bank)throw Error('Gere e salve as versões para vincular os pesos às questões originais.');const ids=scoringIds(n,bank),values={};for(const line of text.trim().split(/\n/).filter(l=>l.trim())){const cells=line.split(';').map(s=>s.trim());if(cells.length!==2||!ids.includes(cells[0])||Object.hasOwn(values,cells[0]))throw Error('Use uma linha por questão original, sem repetir: questão;valor.');const value=Number(cells[1].replace(',','.'));if(!cells[1]||!Number.isFinite(value)||value<0||value>1000000)throw Error('Informe pesos ou pontos de 0 a 1.000.000.');values[cells[0]]=value;}if(Object.keys(values).length!==ids.length)throw Error('Preencha o peso ou os pontos de todas as '+n+' questões.');if(Object.values(values).reduce((sum,v)=>sum+v,0)<=0)throw Error('A soma dos pesos ou pontos deve ser maior que zero.');if(bank){const expected=[...ids].sort().join(',');if(versions.some(v=>!bank[v]||bank[v].map(q=>String(q.original)).sort().join(',')!==expected))throw Error('As versões precisam conter as mesmas questões originais para aplicar os pesos.');}return {mode,values};}
function draftScoringContext(){const {n,questionBank:bank}=draftAssessment||{};return {n,bank,versions:el('exam-versions').value.trim().toUpperCase().split(/[\s,;]+/)};}
function loadScoring(e){el('scoring-mode').value=e.scoring?.mode||'equal';const ids=scoringIds(e.n,e.questionBank);el('question-scores').value=ids.map(id=>id+';'+(e.scoring?.values?.[id]??1)).join('\n');updateScoringPreview(e);}
function updateScoringPreview(source){const mode=el('scoring-mode').value;el('scoring-fields').hidden=mode==='equal';el('max-grade').readOnly=mode==='points';try{const context=source?{n:source.n,bank:source.questionBank,versions:source.versions||Object.keys(source.questionBank||{})}:draftScoringContext();if(!context.n){message('scoring-summary','Gere as versões para configurar a pontuação por questão.');return;}const scoring=parseScoring(mode,el('question-scores').value,context.n,context.bank,context.versions);const sum=mode==='equal'?context.n:Object.values(scoring.values).reduce((s,v)=>s+v,0);if(mode==='points')el('max-grade').value=sum;const max=Number(el('max-grade').value);message('scoring-summary',mode==='equal'?'Cada questão vale '+fmt(max/context.n)+' ponto(s).':mode==='points'?'Nota máxima: '+fmt(sum)+' · soma dos pontos por questão.':'Soma dos pesos: '+fmt(sum)+' · nota máxima: '+fmt(max)+'.');if(mode!=='equal')el('scoring-preview').replaceChildren(dataTable(['Questão original',mode==='points'?'Pontos':'Peso','Valor na nota'],scoringIds(context.n,context.bank).map(id=>[id,fmt(scoring.values[id]),fmt(mode==='points'?scoring.values[id]:scoring.values[id]/sum*max)])));}catch(e){message('scoring-summary',e.message);}}
el('exam-versions').addEventListener('input',()=>updateScoringPreview());
el('scoring-mode').onchange=()=>updateScoringPreview();el('question-scores').oninput=()=>updateScoringPreview();el('max-grade').addEventListener('input',()=>updateScoringPreview());
function questionColumnData(e,group=null){const data=new Map(),students=new Map(e.students.map(s=>[s.id,s]));const hasBank=Object.keys(e.keys).every(model=>e.questionBank?.[model]?.length===e.n);for(const model of Object.keys(e.keys))for(let i=0;i<e.n;i++){const q=questionData(e,model,i,group),id=hasBank?String(q.original):model+'-'+(i+1);const item=data.get(id)||{id,label:hasBank?'Q'+q.original:model+' Q'+(i+1),correct:0,total:0,people:[],refs:[]};item.correct+=q.correct;item.total+=q.participants;item.refs.push(model+' / '+(i+1));for(const r of q.results)if(q.key==='X'||r.answers[i]===q.key){const s=students.get(r.id);item.people.push({...s,model,answer:r.answers[i],annulled:q.key==='X'});}data.set(id,item);}return [...data.values()].sort((a,b)=>hasBank?Number(a.id)-Number(b.id):a.id.localeCompare(b.id,'pt-BR',{numeric:true})).map(q=>({...q,rate:q.total?q.correct/q.total:null}));}
function columnPlot(container,items,onSelect){const plot=document.createElement('div');plot.className='column-plot';plot.setAttribute('role','group');plot.setAttribute('aria-label','Gráfico de colunas de 0 a 100 por cento');const axis=document.createElement('div');axis.className='column-axis';axis.textContent='100%\n50%\n0%';const columns=document.createElement('div');columns.className='columns';for(const item of items){const button=document.createElement('button');button.type='button';button.className='column-button';button.setAttribute('aria-label',item.label+': '+item.text+'. Exibir alunos');const value=document.createElement('span');value.className='column-value';value.textContent=item.text;const track=document.createElement('span');track.className='column-track';const bar=document.createElement('span');bar.className='vertical-column';bar.style.height=Math.max(1,(item.rate||0)*180)+'px';track.append(bar);const label=document.createElement('span');label.className='column-label';label.textContent=item.label;button.append(value,track,label);button.onclick=()=>{columns.querySelectorAll('button').forEach(b=>b.setAttribute('aria-pressed','false'));button.setAttribute('aria-pressed','true');onSelect(item);};button.setAttribute('aria-pressed','false');columns.append(button);}plot.append(axis,columns);container.replaceChildren(plot);if(items.length){columns.firstElementChild.setAttribute('aria-pressed','true');onSelect(items[0]);}}
function renderColumnCharts(){if(!exam)return;const data=reportData(exam),students=new Map(exam.students.map(s=>[s.id,s]));const overview=[{label:'Geral',group:null,...data.overall},...data.classes.map(c=>({label:c.group||'Sem turma',...c}))].map(c=>({...c,rate:c.performance,text:pct(c.performance)}));columnPlot(el('performance-columns'),overview,item=>{const rs=exam.results.filter(r=>item.group===null||students.get(r.id)?.group===item.group);el('performance-people').replaceChildren(dataTable(['Alunos · '+item.label,'Turma','Acertos','Nota','Desempenho'],rs.map(r=>{const s=students.get(r.id),g=grade(r);return [s.name,s.group,g.hits+' / '+exam.n,fmt(g.note),pct(g.rate)];})));});const questions=questionColumnData(exam,el('report-group').value||null).map(q=>({...q,text:q.correct+'/'+q.total+' · '+pct(q.rate)}));columnPlot(el('question-columns'),questions,q=>{message('chart-question-summary',q.label+' · '+q.correct+' de '+q.total+' alunos com acerto/ponto atribuído ('+pct(q.rate)+'). Versão / posição: '+q.refs.join(' · '));el('chart-correct-students').replaceChildren(dataTable(['RA','Alunos que acertaram','Turma','Chamada','Versão','Situação'],q.people.map(s=>[s.id,s.name,s.group,s.call||'—',s.model,s.annulled?'Ponto por anulação':'Acerto'])));});if(!questions.length){message('chart-question-summary','Salve os gabaritos para ver os acertos por questão.');el('chart-correct-students').replaceChildren();}}

try{const saved=localStorage.getItem(storage);if(saved){exam=JSON.parse(saved);fill();}}catch{message('exam-status','Não foi possível recuperar a avaliação salva. Restaure um backup.');}
if(!exam){
 report();
 renderStudentManager();
}
