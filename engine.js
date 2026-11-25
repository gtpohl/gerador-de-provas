const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const XML = new XMLSerializer();
const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const list = (node, tag) => [...node.getElementsByTagNameNS(W,tag)];
const is = (node, tag) => node?.namespaceURI === W && node.localName === tag;
const txt = node => list(node,'t').map(t=>t.textContent).join('');
const assert = (condition, message) => {if (!condition) throw Error(message);};
const heading = /^\s*(?:(?:quest[aã]o|quest[oõ]es|item)\s*(?:n[º°.]\s*)?0*(\d+)\s*[.:–-]?\s*$|0*(\d+)[.)–-]\s+)/i;
const option = /^\s*\(?([A-H])[).]\s*/i;
const answer = /^\s*(?:gabarito|resposta correta)\s*:\s*([A-H])\s*$/i;

async function readWord(data) {
  const zip = await JSZip.loadAsync(data,{checkCRC32:true});
  const part = zip.file('word/document.xml');
  assert(part,'O arquivo não contém a parte principal de um documento Word.');
  const doc = parseXML(await part.async('string'));
  const body = list(doc,'body')[0];
  assert(body,'O documento Word não tem um corpo legível.');
  return {zip,doc,body};
}
function parseXML(raw) {
  const doc = new DOMParser().parseFromString(raw,'application/xml');
  assert(!doc.querySelector('parsererror'),'XML do Word inválido.');
  return doc;
}
function nodeText(nodes) {return nodes.map(node=>is(node,'t')?node.textContent:txt(node)).join('');}

// Split only text runs with ordinary manual line breaks. Keep the actual break
// and the formatting of the run on either side, including mixed-format formulas.
function paragraphLines(p) {
  const lines = [[]], separators = [];
  for (const child of p.childNodes) {
    if (is(child,'pPr')) continue;
    const parts = is(child,'r') ? [...child.childNodes] : [];
    if (!parts.some(n=>is(n,'br'))) {lines.at(-1).push(child);continue;}
    let run = child.cloneNode(false);
    const props = parts.find(n=>is(n,'rPr'));
    const reset = () => {run = child.cloneNode(false);if(props) run.append(props.cloneNode(true));};
    const push = () => {if ([...run.childNodes].some(n=>!is(n,'rPr'))) lines.at(-1).push(run);};
    reset();
    for (const part of parts) {
      if (is(part,'rPr')) continue;
      if (is(part,'br') && !['page','column'].includes(part.getAttributeNS(W,'type'))) {
        push();reset();run.append(part.cloneNode(true));separators.push(run);
        lines.push([]);reset();
      } else run.append(part.cloneNode(true));
    }
    push();
  }
  return {lines,separators};
}
const optionLabel = /^(\s*\(?)([A-H])(?=[).])/i;
const keyLabel = /^(\s*(?:gabarito|resposta correta)\s*:\s*)([A-H])(?=\s*$)/i;
const numberLabel = /^(\s*(?:(?:quest[aã]o|item)\s*(?:n[º°.]\s*)?)?)(\d+)/i;
// Capture the exact prefix length so repeated letters in a label are harmless.
function relabel(nodes, pattern, value) {
  const text = nodeText(nodes);
  const m=pattern.exec(text);
  assert(m,'Rótulo inválido.');
  const label = m[2];
  const start = m[1].length;
  if (value===label) return nodes.map(n=>n.cloneNode(true));
  const copied=nodes.map(n=>n.cloneNode(true));
  let cursor=0;
  for(const t of copied.flatMap(n=>list(n,'t'))) {
    const s=t.textContent, end=cursor+s.length;
    if(end>start && cursor<start+label.length) t.textContent=s.slice(0,Math.max(0,start-cursor))+(cursor<=start?value:'')+s.slice(Math.min(s.length,start+label.length-cursor));
    cursor=end;
  }
  return copied;
}
function inspect(word) {
  const pre=[], tail=[], questions=[];
  for(const node of word.body.children) {
    if (is(node,'sectPr')) {tail.push(node);continue;}
    const m=is(node,'p') && heading.exec(txt(node));
    if(m) questions.push({id:Number(m[1]||m[2]),nodes:[],options:[],key:null});
    (questions.at(-1)?.nodes||pre).push(node);
  }
  assert(questions.length,'Nenhuma questão identificada. Use títulos “Questão 1” ou “1. Enunciado”.');
  assert(new Set(questions.map(q=>q.id)).size===questions.length,'Há números de questão repetidos.');
  for(const q of questions) {
    let keySeen=false;
    q.nodes.forEach((p,index)=>{
      if(!is(p,'p')) return;
      const {lines}=paragraphLines(p);
      const a=answer.exec(txt(p));
      if(a) {
        assert(!q.key,'Questão '+q.id+' tem mais de um gabarito interno.');
        q.key={index,letter:a[1].toUpperCase()}; keySeen=true;
      }
      lines.forEach((nodes,line)=>{
        const m=option.exec(nodeText(nodes));
        if(m && !keySeen) q.options.push({index,line,nodes,whole:lines.length===1 && index>0,letter:m[1].toUpperCase()});
      });
    });
    assert(q.options.every(o=>o.index!==0),'Questão '+q.id+' tem uma alternativa no parágrafo do título. Separe o título em um parágrafo próprio.');
    assert(q.options.length>=2 && q.options.every((o,i)=>o.letter===letters[i]),
      'Questão '+q.id+' tem alternativas não identificadas ou fora da sequência A–H. Use letras explícitas e uma alternativa por linha.');
    assert(!q.key || q.options.some(o=>o.letter===q.key.letter),'Questão '+q.id+' tem uma resposta interna inválida.');
    for(const node of q.nodes) {
      assert(!list(node,'sectPr').length,'Questão '+q.id+' contém uma quebra de seção interna.');
      assert(!['ins','del','moveFrom','moveTo'].some(t=>list(node,t).length),'Questão '+q.id+' contém alterações controladas no Word.');
    }
  }
  return {...word,pre,tail,questions};
}
function shuffled(items) {
  const output=[...items];
  for(let i=output.length-1;i>0;i--) {
    const j=Math.floor(Math.random()*(i+1));
    [output[i],output[j]]=[output[j],output[i]];
  }
  if(output.length>1 && output.every((v,i)=>v===items[i])) output.push(output.shift());
  return output;
}
function makePlans(base, keys, count, reorder, mix) {
  const used=new Set(), out=[];
  for(let index=0;index<count;index++) {
    const target=keys.targets[index];
    let rows, signature, attempts=0;
    do {
      let qs=reorder?shuffled(base.questions):base.questions;
      rows=qs.map((q,i)=>{
        const correct=keys.base.get(q.id);
        let opts=mix?shuffled(q.options):[...q.options];
        if(target) {
          const pos=letters.indexOf(target[i]);
          assert(pos<opts.length,'Versão '+letters[index]+', questão '+(i+1)+': a letra solicitada não existe para a questão-base '+q.id+'.');
          const from=opts.findIndex(o=>o.letter===correct);
          assert(mix || pos===from,'Ative a reorganização das alternativas para seguir o gabarito da versão '+letters[index]+'.');
          [opts[from],opts[pos]]=[opts[pos],opts[from]];
        }
        return {q,number:i+1,opts,correct:letters[opts.findIndex(o=>o.letter===correct)]};
      });
      signature=JSON.stringify(rows.map(r=>[r.q.id,r.opts.map(o=>o.letter)]));
    } while(used.has(signature) && ++attempts<30 && (reorder||mix));
    assert(!used.has(signature),'As configurações atuais não permitem gerar mais versões distintas.');
    used.add(signature);out.push({name:letters[index],rows});
  }
  return out;
}
function serializeNodes(nodes) {return nodes.map(n=>XML.serializeToString(n)).join('');}
function rewrite(p, replacements) {
  const out=p.cloneNode(false);
  const props=[...p.childNodes].find(n=>is(n,'pPr'));
  if(props) out.append(props.cloneNode(true));
  const {lines,separators}=paragraphLines(p);
  lines.forEach((line,i)=>{
    if(i) out.append(separators[i-1].cloneNode(true));
    out.append(...(replacements.get(i)||line).map(n=>n.cloneNode(true)));
  });
  return out;
}
function paragraphProperties(p) {return [...p.children].filter(n=>is(n,'pPr'));}
function paragraphTemplate(q,opts,index) {
  const slot=q.options.findIndex(o=>o.index===index&&o.whole);
  return slot>=0&&opts[slot].whole?q.nodes[opts[slot].index]:q.nodes[index];
}
function renderBlocks(row, keep) {
  const {q,opts,number,correct}=row;
  return q.nodes.flatMap((p,index)=>{
    if(index===q.key?.index && !keep) return [];
    if(index===0 || index===q.key?.index) {
      const props=[...p.childNodes].find(n=>is(n,'pPr'));
      const out=p.cloneNode(false);
      if(props) out.append(props.cloneNode(true));
      out.append(...relabel([...p.childNodes].filter(n=>!is(n,'pPr')),index===0?numberLabel:keyLabel,index===0?String(number):correct));
      return [out];
    }
    const replacements=new Map();
    q.options.forEach((slot,i)=>{
      if(slot.index===index) replacements.set(slot.line,relabel(opts[i].nodes,optionLabel,letters[i].toLowerCase()===nodeText(slot.nodes).match(optionLabel)[2]?letters[i].toLowerCase():letters[i]));
    });
    return [replacements.size?rewrite(paragraphTemplate(q,opts,index),replacements):p.cloneNode(true)];
  });
}
function verify(row, blocks, keep) {
  const {q,opts,number,correct}=row;
  assert(blocks.length===q.nodes.length-(!keep&&q.key?1:0),'Contagem de blocos divergente na questão '+q.id+'.');
  const labelBody = nodes=>serializeNodes(relabel(nodes,optionLabel,'#'));
  let offset=0;
  q.nodes.forEach((original,i)=>{
    if(i===q.key?.index && !keep) {offset++;return;}
    const output=blocks[i-offset];
    if(i===0 || i===q.key?.index) {
      const pattern=i===0?numberLabel:keyLabel;
      const children=p=>[...p.childNodes];
      assert(serializeNodes(relabel(children(output),pattern,'#'))===serializeNodes(relabel(children(original),pattern,'#')),'Rótulo alterou o conteúdo da questão '+q.id+'.');
      assert(pattern.exec(txt(output))[2]===(i===0?String(number):correct),'Rótulo final incorreto.');
      return;
    }
    const slots=q.options.map((o,j)=>({...o,j})).filter(o=>o.index===i);
    if(!slots.length) {
      assert(serializeNodes([output])===serializeNodes([original]),'Bloco alterado na questão '+q.id+'.');return;
    }
    const before=paragraphLines(original), after=paragraphLines(output);
    assert(before.lines.length===after.lines.length && serializeNodes(before.separators)===serializeNodes(after.separators),'Quebra de linha alterada na questão '+q.id+'.');
    assert(serializeNodes(paragraphProperties(paragraphTemplate(q,opts,i)))===serializeNodes(paragraphProperties(output)),'Formatação de parágrafo alterada.');
    before.lines.forEach((line,k)=>{
      const slot=slots.find(s=>s.line===k);
      assert(slot ? labelBody(after.lines[k])===labelBody(opts[slot.j].nodes) : serializeNodes(line)===serializeNodes(after.lines[k]),'Conteúdo ou formatação de linha alterados na questão '+q.id+'.');
    });
  });
}
async function exportVersion(base, version, keep) {
  const doc=base.doc.cloneNode(true), body=list(doc,'body')[0];
  const blocks=version.rows.flatMap(r=>{const nodes=renderBlocks(r,keep);verify(r,nodes,keep);return nodes;});
  body.replaceChildren(...[...base.pre,...blocks,...base.tail].map(n=>doc.importNode(n,true)));
  const raw=XML.serializeToString(doc);
  const roundTrip=parseXML(raw);
  assert(serializeNodes([...list(roundTrip,'body')[0].children])===serializeNodes([...body.children]),'Divergência na serialização do Word.');
  const zip=new JSZip();
  for(const [path,file] of Object.entries(base.zip.files)) {
    if(file.dir) continue;
    zip.file(path,path==='word/document.xml'?raw:await file.async('uint8array'));
  }
  return zip.generateAsync({type:'uint8array',compression:'DEFLATE'});
}
