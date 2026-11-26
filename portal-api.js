import {config} from './portal-config.js';
let token=null;
export function configured(){return /^https:\/\/[^/]+\.supabase\.co$/.test(config.url)&&!!config.publishableKey;}
export async function request(path,body,method=body?'POST':'GET'){
 if(!configured())throw Error('Configure portal-config.js com a URL e a chave publicável do Supabase.');
 const r=await fetch(config.url+path,{method,headers:{apikey:config.publishableKey,...(token?{Authorization:'Bearer '+token}:{}),'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});
 const data=await r.json().catch(()=>null);if(!r.ok)throw Error(data?.msg||data?.message||data?.error_description||'Falha de conexão.');return data;
}
export async function login(email,password){const s=await request('/auth/v1/token?grant_type=password',{email,password});token=s.access_token;return s.user;}
export async function logout(){try{if(token)await request('/auth/v1/logout',{});}finally{token=null;}}
export async function recover(email){const redirect=new URL('aluno.html',location.href);await request('/auth/v1/recover?redirect_to='+encodeURIComponent(redirect.href),{email});}
export function acceptRecovery(){const h=new URLSearchParams(location.hash.slice(1));if(h.get('type')==='recovery'&&h.get('access_token')){token=h.get('access_token');history.replaceState(null,'',location.pathname);return true;}return false;}
export async function changePassword(password){if(password.length<12)throw Error('Use pelo menos 12 caracteres.');await request('/auth/v1/user',{password},'PUT');}
