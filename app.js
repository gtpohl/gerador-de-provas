const $ = id=>document.getElementById(id);
const state={base:null,versions:[],stem:'prova',keep:false,busy:false,urls:[],media:new Map()};
const MIME='application/vnd.openxmlformats-officedocument.wordprocessingml.document';
function setStatus(value,kind='') {$('status').textContent=value;$('status').className='status '+kind;if(kind==='error')window.openAtelierSection('validation-panel');}
function log(message,kind='') {
  const li=document.createElement('li');li.textContent=message;li.className=kind;
  $('log').prepend(li);
  if($('log').children.length>12) $('log').lastElementChild.remove();
}
function fail(error) {setStatus('Conversão interrompida','error');log(error.message||String(error),'error');}
function busy(on) {
  state.busy=on;
  for(const field of document.querySelectorAll('#importar input, #configurar input, #key')) field.disabled=on;
  $('generate').disabled=on||!state.base;
}
function resetResults() {
  state.versions=[];
  state.urls.forEach(URL.revokeObjectURL);state.urls=[];
  $('review').hidden=true;$('review-empty').hidden=false;$('v-count').textContent='—';
  const empty=document.createElement('div');empty.className='empty';empty.textContent='Gere as versões para liberar os downloads.';
  $('exports').replaceChildren(empty);
}
async function loadBase(file) {
  if(!file||state.busy) return;
  resetResults();state.base=null;state.media.forEach(URL.revokeObjectURL);state.media.clear();
  busy(true);$('log').replaceChildren();
  $('source-name').textContent=file.name;
  $('source-info').textContent='Lendo a estrutura do Word…';
  $('q-count').textContent=$('a-count').textContent='—';
  setStatus('Lendo prova-base');
  try {
    assert(/\.docx$/i.test(file.name),'Selecione um arquivo com extensão .docx.');
    const base=inspect(await readWord(await file.arrayBuffer()));
    await loadMedia(base);
    state.base=base;state.stem=file.name.replace(/\.docx$/i,'');
    $('q-count').textContent=base.questions.length;
    $('a-count').textContent=base.questions.reduce((n,q)=>n+q.options.length,0);
    const withKeys=base.questions.filter(q=>q.key).length;
    $('source-info').textContent=base.questions.length+' questões reconhecidas · '+withKeys+' respostas internas';
    setStatus('Prova-base pronta','success');
    log('Estrutura, alternativas e numeração lidas.');
    if(withKeys===base.questions.length) log('O gabarito interno pode ser usado como base.');
  } catch(error) {$('source-info').textContent='Confira o registro e selecione outro arquivo.';fail(error);}
  finally {busy(false);$('source').value='';}
}
function parseKeys(text,base) {
  const fallback=new Map(base.questions.filter(q=>q.key).map(q=>[q.id,q.key.letter]));
  const result={base:new Map(),targets:[]};
  const lines=text.trim().split(/\r?\n/).map(l=>l.trim()).filter(Boolean);
  const validLetter=value=>/^[A-H]$/i.test(value||'');
  if(!lines.length) result.base=fallback;
  else if(/^\s*\d+\s*[-.:]\s*[A-H](?:[\s,;]+\d+\s*[-.:]\s*[A-H])*\s*$/i.test(text)) {
    for(const m of text.matchAll(/(\d+)\s*[-.:]\s*([A-H])/gi)) {
      assert(!result.base.has(Number(m[1])),'Resposta repetida para a questão '+m[1]+'.');
      result.base.set(Number(m[1]),m[2].toUpperCase());
    }
  } else if(/^[A-H](?:[\s,;]+[A-H])*$/i.test(text.trim())) {
    const values=text.trim().toUpperCase().split(/[\s,;]+/);
    assert(values.length===base.questions.length,'A sequência precisa ter uma letra para cada questão.');
    base.questions.forEach((q,i)=>result.base.set(q.id,values[i]));
  } else {
    const norm=s=>s.normalize('NFD').replace(/[\u0300-\u036f]/g,'').trim().toUpperCase();
    const cells=lines.map(l=>l.split(/[;\t,]/).map(s=>s.trim().replace(/^"(.*)"$/,'$1')));
    let headers=[];
    if(!/^\d+$/.test(cells[0][0])) headers=cells.shift().map(norm);
    assert(cells.length===base.questions.length,'A tabela precisa ter uma linha para cada questão.');
    const baseIndex=headers.length?headers.findIndex((h,i)=>i>0&&/^(BASE|ORIGINAL|GABARITO|GABARITO ORIGINAL|GABARITO BASE|RESPOSTA)$/.test(h)):1;
    const columns=headers.map((h,i)=>({i,m:/^(?:(?:VERSAO|MODELO)\s+)?([A-D1-4])$/.exec(h)})).filter(o=>o.i>0&&o.m);
    assert(headers.length ? (baseIndex>0||columns.length) && columns.length+(baseIndex>0?2:1)===headers.length : cells.every(row=>row.length===2),'Use os cabeçalhos Questão, Base e as colunas opcionais A a D.');
    assert(new Set(columns.map(({m})=>/[1-4]/.test(m[1])?Number(m[1])-1:letters.indexOf(m[1]))).size===columns.length,'Há colunas de versão repetidas.');
    if(baseIndex<0) result.base=fallback;
    const seen=new Set();
    cells.forEach((row,position)=>{
      const id=Number(row[0]);
      assert(/^\d+$/.test(row[0])&&base.questions.some(q=>q.id===id)&&!seen.has(id),'Número de questão inválido ou repetido na linha '+(position+1)+'.');
      assert(row.length===(headers.length||2),'Quantidade de colunas incorreta na linha '+(position+1)+'.');
      seen.add(id);
      if(baseIndex>0) {
        assert(validLetter(row[baseIndex]),'Letra-base inválida na questão '+id+'.');
        result.base.set(id,row[baseIndex].toUpperCase());
      }
      for(const {i,m} of columns) {
        const index=/[1-4]/.test(m[1])?Number(m[1])-1:letters.indexOf(m[1]);
        assert(validLetter(row[i]),'Letra inválida na versão '+letters[index]+', posição '+(position+1)+'.');
        (result.targets[index]??=[]).push(row[i].toUpperCase());
      }
    });
  }
  assert(result.base.size===base.questions.length,'O gabarito-base precisa cobrir todas as questões.');
  for(const q of base.questions) {
    const letter=result.base.get(q.id);
    assert(q.options.some(o=>o.letter===letter),'Gabarito-base ausente ou inválido para a questão '+q.id+'.');
    assert(!q.key||q.key.letter===letter,'Questão '+q.id+': o gabarito informado ('+letter+') diverge do Word ('+q.key?.letter+').');
  }
  return result;
}
async function loadKey(file) {
  if(!file||state.busy) return;
  busy(true);resetResults();
  try {
    let data;
    if(/\.docx$/i.test(file.name)) {
      const {body}=await readWord(await file.arrayBuffer());
      const tables=[...body.children].filter(n=>is(n,'tbl'));
      assert(tables.length<=1,'O gabarito tem várias tabelas. Cole a tabela consolidada no campo.');
      data=tables.length ? list(tables[0],'tr').map(r=>[...r.children].filter(c=>is(c,'tc')).map(c=>txt(c)).join(';')).join('\n') : [...body.children].filter(n=>is(n,'p')).flatMap(p=>paragraphLines(p).lines.map(nodeText)).join('\n');
    } else data=await file.text();
    assert(data.trim(),'O arquivo de gabarito está vazio.');
    if(state.base) parseKeys(data,state.base);
    $('key').value=data;
    setStatus('Gabarito importado','success');log('Gabarito importado de '+file.name+'.');
  } catch(error){fail(error);}
  finally {busy(false);$('key-file').value='';}
}
async function loadMedia(base) {
  const rel=base.zip.file('word/_rels/document.xml.rels');
  if(!rel) return;
  const doc=parseXML(await rel.async('string'));
  for(const el of doc.documentElement.children) {
    const target=el.getAttribute('Target');
    if(!el.getAttribute('Type')?.endsWith('/image')||!/^media\/[\w .-]+\.(png|jpe?g|gif|webp|bmp)$/i.test(target)) continue;
    const part=base.zip.file('word/'+target);
    if(!part) continue;
    const ext=target.split('.').at(-1).toLowerCase();
    const blob=new Blob([await part.async('uint8array')],{type:'image/'+(ext==='jpg'?'jpeg':ext)});
    state.media.set(el.getAttribute('Id'),URL.createObjectURL(blob));
  }
}
function appendWord(parent,node) {
  const elements={p:'p',tbl:'table',tr:'tr',tc:'td',r:'span'};
  if(is(node,'t')) {parent.append(node.textContent);return;}
  if(is(node,'br')||is(node,'cr')) {parent.append(document.createElement('br'));return;}
  if(is(node,'tab')) {parent.append('\t');return;}
  if(node.localName==='blip') {
    const id=node.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships','embed');
    const src=state.media.get(id);
    if(src){const img=document.createElement('img');img.src=src;img.alt='Imagem da questão';parent.append(img);}
    else parent.append('[Imagem no Word]');
    return;
  }
  if(node.localName==='oMath'||node.localName==='oMathPara') {parent.append([...node.getElementsByTagNameNS('http://schemas.openxmlformats.org/officeDocument/2006/math','t')].map(n=>n.textContent).join(''));return;}
  if(node.localName.endsWith('Pr')) return;
  const el=elements[node.localName]?document.createElement(elements[node.localName]):parent;
  const prop=tag=>[...node.children].find(n=>is(n,tag));
  if(is(node,'r')) {
    const props=prop('rPr');
    const val=tag=>props&&list(props,tag)[0]?.getAttributeNS(W,'val');
    const on=tag=>props&&list(props,tag).length&&!['0','false','off'].includes(val(tag));
    if(on('b')) el.style.fontWeight='700';
    if(on('i')) el.style.fontStyle='italic';
    if(on('u')&&val('u')!=='none') el.style.textDecoration='underline';
    if(['subscript','superscript'].includes(val('vertAlign'))) {el.style.verticalAlign=val('vertAlign')==='subscript'?'sub':'super';el.style.fontSize='.75em';}
    if(/^[0-9a-f]{6}$/i.test(val('color')||'')) el.style.color='#'+val('color');
  }
  if(is(node,'p')) {
    const props=prop('pPr');
    const align=props&&list(props,'jc')[0]?.getAttributeNS(W,'val');
    if(['left','center','right','both'].includes(align)) el.style.textAlign=align==='both'?'justify':align;
  }
  for(const child of node.children) appendWord(el,child);
  if(el!==parent) {if(is(node,'p')&&!el.hasChildNodes())el.append(document.createElement('br'));parent.append(el);}
}
function fillPaper(el,blocks) {
  el.replaceChildren();
  blocks.forEach(node=>appendWord(el,node));
}
function selectOptions(el,values,selected=0) {
  el.replaceChildren(...values.map((name,i)=>new Option(name,String(i))));
  el.value=String(selected);
}
function updateReview(reset=false) {
  const version=state.versions[Number($('version').value)];
  if(reset) selectOptions($('question'),version.rows.map(row=>'Questão '+row.number+' · original '+row.q.id));
  const row=version.rows[Number($('question').value)];
  $('original-title').textContent='Original · questão '+row.q.id;
  $('output-title').textContent='Versão '+version.name+' · questão '+row.number;
  fillPaper($('original'),row.q.nodes);
  fillPaper($('output'),renderBlocks(row,state.keep));
  $('mapping').replaceChildren(...version.rows.map(r=>{
    const tr=document.createElement('tr');
    [r.number,r.q.id,state.keys.base.get(r.q.id),r.correct,r.opts.map(o=>o.letter).join(' → ')].forEach(value=>{const td=tr.insertCell();td.textContent=value;});
    return tr;
  }));
}
function downloadLink(bytes,name,type) {
  const url=URL.createObjectURL(new Blob([bytes],{type}));
  state.urls.push(url);
  const a=document.createElement('a');a.href=url;a.download=name;a.className='secondary';a.textContent=name;return a;
}
async function keyWord(versions,base,keys) {
  const zip=new JSZip();
  zip.file('[Content_Types].xml','<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>');
  zip.file('_rels/.rels','<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>');
  const para=(text,bold=false)=>'<w:p><w:r>'+(bold?'<w:rPr><w:b/></w:rPr>':'')+'<w:t>'+text+'</w:t></w:r></w:p>';
  const tr=(items,bold=false)=>'<w:tr>'+items.map(s=>'<w:tc>'+para(s,bold)+'</w:tc>').join('')+'</w:tr>';
  const rows=base.questions.map((q,i)=>tr([q.id,keys.base.get(q.id),...versions.map(v=>v.rows[i].correct)])).join('');
  const cols=['Questão','Base',...versions.map(v=>v.name)];
  zip.file('word/document.xml','<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="'+W+'"><w:body>'+para('Gabarito consolidado',true)+para('A coluna Base segue a numeração original. As colunas das versões seguem a posição na prova gerada.')+'<w:tbl><w:tblPr><w:tblBorders><w:top w:val="single"/><w:left w:val="single"/><w:bottom w:val="single"/><w:right w:val="single"/><w:insideH w:val="single"/><w:insideV w:val="single"/></w:tblBorders></w:tblPr><w:tblGrid>'+cols.map(()=>'<w:gridCol w:w="1050"/>').join('')+'</w:tblGrid>'+tr(cols,true)+rows+'</w:tbl><w:sectPr/></w:body></w:document>');
  return zip.generateAsync({type:'uint8array',compression:'DEFLATE'});
}
async function generate() {
  if(!state.base||state.busy)return;
  resetResults();busy(true);
  setStatus('Validando e gerando versões…');
  try {
    const keys=parseKeys($('key').value,state.base);
    const count=Number(document.querySelector('input[name=count]:checked').value);
    const keep=$('keep').checked;
    const versions=makePlans(state.base,keys,count,$('reorder').checked,$('mix').checked);
    for(const version of versions) {
      version.bytes=await exportVersion(state.base,version,keep);
      log('Versão '+version.name+' · '+version.rows.length+' questões verificadas.');
    }
    const keyBytes=await keyWord(versions,state.base,keys);
    const files=versions.map(v=>({name:state.stem+'_'+v.name+'.docx',bytes:v.bytes}));
    files.push({name:'Gabarito_consolidado.docx',bytes:keyBytes});
    const bundle=new JSZip();files.forEach(f=>bundle.file(f.name,f.bytes));
    const zipped=await bundle.generateAsync({type:'uint8array',compression:'STORE'});
    $('exports').replaceChildren(...files.map(f=>downloadLink(f.bytes,f.name,MIME)),downloadLink(zipped,'Provas_e_gabarito.zip','application/zip'));
    Object.assign(state,{versions,keys,keep});
    document.dispatchEvent(new Event('atelier-versions-generated'));
    selectOptions($('version'),versions.map(v=>'Versão '+v.name));
    updateReview(true);
    $('review').hidden=false;$('review-empty').hidden=true;
    $('v-count').textContent=count;
    setStatus('Validação concluída','success');
    if(!keep&&state.base.questions.some(q=>q.key)) log('As linhas de gabarito interno foram omitidas das provas e reunidas no gabarito separado.');
    window.openAtelierSection('revisar');$('revisar').scrollIntoView({block:'start'});
  } catch(error){resetResults();fail(error);}
  finally{busy(false);}
}
$('source').addEventListener('change',e=>loadBase(e.target.files[0]));
$('key-file').addEventListener('change',e=>loadKey(e.target.files[0]));
$('drop').addEventListener('dragover',e=>{e.preventDefault();$('drop').classList.add('over');});
$('drop').addEventListener('dragleave',()=>$('drop').classList.remove('over'));
$('drop').addEventListener('drop',e=>{e.preventDefault();$('drop').classList.remove('over');loadBase(e.dataTransfer.files[0]);});
$('generate').addEventListener('click',generate);
$('version').addEventListener('change',()=>updateReview(true));
$('question').addEventListener('change',()=>updateReview());
function invalidate() {
  if(!state.versions.length)return;
  resetResults();setStatus('Configuração alterada');log('Gere novamente para aplicar as alterações.');
}
$('key').addEventListener('input',invalidate);
$('configurar').addEventListener('change',invalidate);
