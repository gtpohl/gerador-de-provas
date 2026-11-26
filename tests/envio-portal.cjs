const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const ids=['portal-email','portal-password','portal-login','portal-logout','portal-send','portal-exam','portal-links','portal-publish','portal-details','portal-status'];
const fields=Object.fromEntries(ids.map(id=>[id,{value:'',checked:false,textContent:'',disabled:false}]));
let calls=[];
const c={document:{getElementById:id=>fields[id]},login:async()=>{},logout:async()=>{},request:async(...args)=>{calls.push(args);return [];},window:{atelierPortalSnapshot:()=>({title:'Avaliação',rows:[{ra:'001',payload:{note:10,questions:[{key:'X',answer:'A'}]}}]})}};
vm.createContext(c);vm.runInContext(fs.readFileSync('professor-portal.js','utf8').replace(/^import[^\n]+\n/,''),c);
(async()=>{
 fields['portal-exam'].value='quimica-2026';fields['portal-links'].value='001;10000000-0000-4000-8000-000000000002';fields['portal-publish'].checked=true;
 await fields['portal-send'].onclick();assert.equal(calls.length,1);assert.equal(calls[0][1].p_published,true);assert.equal(calls[0][1].p_rows[0].payload.questions,undefined);
 fields['portal-details'].checked=true;await fields['portal-send'].onclick();assert.equal(calls[1][1].p_rows[0].payload.questions[0].key,'X');
 fields['portal-links'].value='';await fields['portal-send'].onclick();assert.equal(calls.length,2);assert.match(fields['portal-status'].textContent,/Falta vincular/);
 fields['portal-links'].value='001;10000000-0000-4000-8000-000000000002\n002;10000000-0000-4000-8000-000000000002';await fields['portal-send'].onclick();assert.equal(calls.length,2);assert.match(fields['portal-status'].textContent,/duplicados/);
 assert.equal(fields['portal-send'].disabled,false);console.log('Envio aprovado: liberação, ocultação do gabarito, detalhes, vínculos e duplicidade.');
})().catch(e=>{console.error(e);process.exitCode=1});
