import {purposes,safeApiBase} from './core.js';
const $=s=>document.querySelector(s),all=s=>[...document.querySelectorAll(s)];
const el=(tag,text,cls)=>{const n=document.createElement(tag);if(text)n.textContent=text;if(cls)n.className=cls;return n;};
const config=await fetch('config/site.json').then(r=>r.json());
let catalog=structuredClone(config.catalog),apiBase=safeApiBase(config.apiBase,location.origin),authenticated=false,cursor=null,activeTab='catalog';
const live=apiBase&&new URL(apiBase).origin===location.origin&&!location.hostname.endsWith('.github.io');
const status=message=>{$('#admin-status').textContent=message;};
async function api(path,options={}) {
  const response=await fetch(apiBase+'/api/admin/'+path,{credentials:'same-origin',...options,headers:{'Content-Type':'application/json',...options.headers}});
  const body=await response.json().catch(()=>({}));
  if(!response.ok)throw new Error(response.status===401?'Войдите в панель команды.':typeof body.error==='string'?body.error:'Не удалось выполнить действие.');
  return body;
}
async function init(){
  if(!live){$('#team-panel').hidden=false;status('Редактор предварительной версии. Заявки не собираются. Изменения можно скачать в файл конфигурации.');$('#save-note').textContent='Скачанный файл не меняет опубликованный сайт автоматически. После подключения сервера изменения будут сохраняться прямо из панели.';setTab('catalog');render();return;}
  try{await api('session');authenticated=true;await enter();}catch{$('#login-panel').hidden=false;status('Сервер подключён. Войдите для доступа к заявкам и каталогу.');}
}
async function enter(){
  const state=await api('catalog');catalog=state.catalog;authenticated=true;
  $('#login-panel').hidden=true;$('#team-panel').hidden=false;$('#logout').hidden=false;
  $('#save-catalog').textContent='Сохранить изменения →';$('#save-note').textContent='Изменения сохранятся в общем каталоге и будут доступны посетителям после обновления страницы.';
  status(state.collectionEnabled?'Приём заявок включён.':'Приём заявок выключен. Проверьте компанию, юридические документы, контакты и канал уведомлений.');
  render();setTab('leads');
}
$('#login-form').addEventListener('submit',async e=>{
  e.preventDefault();const button=$('#login-form button');button.disabled=true;
  const password=$('#admin-password').value;$('#admin-password').value='';
  try{await api('session',{method:'POST',body:JSON.stringify({password})});await enter();}catch(error){status(error.message);}finally{button.disabled=false;}
});
$('#logout').addEventListener('click',async()=>{try{await api('session',{method:'DELETE'});location.reload();}catch(e){status(e.message);}});
function setTab(name){
  activeTab=name;for(const tab of ['leads','catalog','settings'])$('#tab-'+tab).hidden=tab!==name;
  $('#catalog-form').hidden=name==='leads';
  all('[data-tab]').forEach(button=>button.setAttribute('aria-selected',button.dataset.tab===name));
  if(name==='leads'){if(authenticated){loadLeads(true);loadMetrics();}else{$('#lead-list').replaceChildren(el('p','Приём заявок не подключён. Здесь будут обращения вашей команды после запуска сервера.'));$('#leads-note').textContent='Демонстрационные обращения не создаются.';$('#refresh-leads').disabled=true;$('#lead-filter').disabled=true;}}
}
all('[data-tab]').forEach(b=>b.addEventListener('click',()=>setTab(b.dataset.tab)));
function render(){
  $('#catalog-list').replaceChildren();
  catalog.destinations.forEach((country,index)=>{
    const row=el('div',null,'catalog-row');row.dataset.index=index;
    for(const [field,label]of [['id','Код ISO'],['name','Название страны'],['city','Город / подпись']]){
      const lab=el('label',label),input=el('input');input.type='text';input.value=country[field]||'';input.dataset.field=field;input.required=field!=='city';input.maxLength=field==='id'?2:100;
      input.addEventListener('input',()=>{country[field]=field==='id'?input.value.toUpperCase():input.value;});lab.append(input);row.append(lab);
    }
    const remove=el('button','Удалить','remove-country');remove.type='button';remove.addEventListener('click',()=>{catalog.destinations.splice(index,1);render();});row.append(remove);
    const toggles=el('div',null,'service-toggles');
    for(const [id,p]of Object.entries(purposes)){const label=el('label'),input=el('input');input.type='checkbox';input.checked=country.services.includes(id);input.addEventListener('change',()=>{country.services=input.checked?[...new Set([...country.services,id])]:country.services.filter(s=>s!==id);});label.append(input,document.createTextNode(p.name));toggles.append(label);}
    const label=el('label'),input=el('input');input.type='checkbox';input.checked=!!country.popular;input.addEventListener('change',()=>{country.popular=input.checked;});label.append(input,document.createTextNode('Популярное'));toggles.append(label);row.append(toggles);$('#catalog-list').append(row);
  });
  for(const [section,fields]of Object.entries({company:['legalName','registrationId','jurisdiction','address'],contacts:['telegram','whatsapp','email'],legal:['privacyVersion','termsVersion']})){
    for(const field of fields){$('#'+field).value=catalog[section]?.[field]||'';$('#'+field).oninput=()=>{catalog[section]??={};catalog[section][field]=$('#'+field).value.trim();};}
  }
  $('#reviewed').checked=catalog.reviewed;$('#reviewed').onchange=()=>{catalog.reviewed=$('#reviewed').checked;};
}
$('#add-country').addEventListener('click',()=>{catalog.destinations.push({id:'',name:'',services:['other'],popular:false,city:'',image:'assets/alpine-journey-poster.jpg',alt:''});render();$('#catalog-list').lastElementChild.querySelector('input').focus();});
$('#catalog-form').addEventListener('invalid',event=>{if(event.target.closest('#tab-catalog'))setTab('catalog');else if(event.target.closest('#tab-settings'))setTab('settings');},true);
$('#catalog-form').addEventListener('submit',async e=>{
  e.preventDefault();
  const ids=new Set();
  for(const c of catalog.destinations){if(!/^[A-Z]{2}$/.test(c.id)||!c.name.trim()||!c.services.length||ids.has(c.id)){status('У каждой страны должны быть уникальный код ISO, название и хотя бы одна услуга.');setTab('catalog');return;}ids.add(c.id);}
  $('#save-catalog').disabled=true;
  try{
    if(authenticated){const result=await api('catalog',{method:'PUT',body:JSON.stringify({catalog})});catalog=result.catalog;status('Каталог сохранён. '+(result.collectionEnabled?'Приём заявок включён.':'Приём заявок пока выключен.'));render();}
    else{const blob=new Blob([JSON.stringify({...config,catalog},null,2)+'\n'],{type:'application/json'});const url=URL.createObjectURL(blob),a=el('a');a.href=url;a.download='visa2go-site.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);status('Конфигурация подготовлена к скачиванию. Опубликованный сайт пока не изменён.');}
  }catch(error){status(error.message);}finally{$('#save-catalog').disabled=false;}
});
$('#import-config').addEventListener('change',async e=>{
  const file=e.target.files[0];if(!file)return;
  try{
    if(file.size>200000)throw new Error('Файл слишком большой.');
    const parsed=JSON.parse(await file.text()),next=parsed.catalog||parsed;
    if(!Array.isArray(next.destinations)||!Array.isArray(next.citizenships)||!next.company||!next.contacts||!next.legal||next.destinations.some(c=>typeof c.id!=='string'||typeof c.name!=='string'||!Array.isArray(c.services)||c.services.some(s=>!purposes[s])))throw new Error('Некорректная конфигурация.');
    catalog=next;render();status('Конфигурация загружена в редактор. Сохраните её, чтобы применить.');
  }catch(error){status(error.message);}
  e.target.value='';
});
async function loadLeads(reset=false){
  if(reset){cursor=null;$('#lead-list').replaceChildren();}
  try{
    const query=new URLSearchParams({limit:'30'});if(cursor)query.set('cursor',cursor);if($('#lead-filter').value)query.set('status',$('#lead-filter').value);
    const result=await api('leads?'+query);cursor=result.nextCursor;$('#more-leads').hidden=!cursor;
    for(const lead of result.leads){
      const card=el('article',null,'lead-card');card.append(el('h3',lead.name),el('p',new Date(lead.createdAt).toLocaleString('ru-RU')+' · '+lead.id,'lead-meta'));
      const citizenship=catalog.citizenships.find(c=>c.id===lead.citizenship)?.name||lead.citizenshipOther||lead.citizenship;
      const destination=catalog.destinations.find(c=>c.id===lead.destination)?.name||'Ещё выбирает';
      card.append(el('p',citizenship+' → '+destination+' · '+(purposes[lead.purpose]?.name||lead.purpose)),el('p',lead.channel+' · '+lead.contact));
      if(lead.residence)card.append(el('p','Проживает: '+lead.residence));if(lead.comment)card.append(el('p',lead.comment,'comment'));
      const select=el('select');select.setAttribute('aria-label','Статус заявки '+lead.name);
      for(const [id,name]of Object.entries({new:'Новая',contacted:'Связались',closed:'Закрыта'})){const opt=el('option',name);opt.value=id;select.append(opt);}select.value=lead.status;
      select.addEventListener('change',async()=>{select.disabled=true;try{await api('leads/'+encodeURIComponent(lead.id),{method:'PATCH',body:JSON.stringify({status:select.value})});lead.status=select.value;await loadMetrics();}catch(e){select.value=lead.status;status(e.message);}finally{select.disabled=false;}});
      card.append(select);$('#lead-list').append(card);
    }
    $('#leads-note').textContent=$('#lead-list').children.length?'Контакты доступны только авторизованной команде.':'Заявок с выбранным статусом пока нет.';
  }catch(e){status(e.message);}
}
async function loadMetrics(){
  try{
    const data=await api('metrics');
    const count=t=>data.events.filter(e=>e.type===t).reduce((n,e)=>n+e.count,0);
    const pending=data.notifications.filter(n=>n.status!=='delivered').reduce((sum,n)=>sum+n.count,0);
    const values=[['Посещения',count('page_view')],['Начали заявку',count('form_start')],['Сохранённые заявки',data.leads.reduce((n,s)=>n+s.count,0)],['Уведомления в очереди',pending]];
    $('#metrics').replaceChildren(...values.map(([name,value])=>{const n=el('div',name,'metric');n.append(el('strong',String(value)));return n;}));
    if(!data.notificationConfigured)status('Канал уведомлений не подключён. Проверяйте заявки в панели; сообщения команде пока не доставляются.');
  }catch(e){status(e.message);}
}
$('#lead-filter').addEventListener('change',()=>loadLeads(true));$('#refresh-leads').addEventListener('click',()=>{loadLeads(true);loadMetrics();});$('#more-leads').addEventListener('click',()=>loadLeads(false));
await init();
